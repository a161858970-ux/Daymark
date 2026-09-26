import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "@course-manager/contracts";
import { CloudError, type CloudDatabase, type QueryPort } from "./cloud.js";

export const deviceRegistrationSchema = z.object({
  device_id: uuidSchema,
  platform: z.enum(["MOBILE", "WINDOWS"]),
  push_token: z.string().min(1).max(4096).nullish(),
});

export const notificationClaimSchema = z.object({
  device_id: uuidSchema,
  logical_key: z.string().min(1).max(512),
  item_id: uuidSchema,
  reminder_rule_key: z.string().min(1).max(256),
  scheduled_for: isoDateTimeSchema,
  policy_version: z.string().min(1).max(64),
  lease_seconds: z.coerce.number().int().min(15).max(900).default(60),
});

export const notificationAcknowledgeSchema = z.object({
  device_id: uuidSchema,
});

export const notificationCancelSchema = z.object({
  logical_keys: z.array(z.string().min(1).max(512)).min(1).max(200),
});

export type ClaimResult = {
  claimed: boolean;
  delivery_id: string | null;
  reason?: "DELIVERED" | "CANCELED" | "LEASED" | "STALE";
};

/**
 * Cross-device reminder coordination. Delivery itself stays local so an
 * offline device still notifies; the lease only prevents duplicate sends when
 * both devices are reachable.
 */
export class CloudNotificationManager {
  constructor(private readonly db: CloudDatabase) {}

  async registerDevice(
    ownerId: string,
    input: z.infer<typeof deviceRegistrationSchema>,
  ) {
    return this.db.transaction(async (query) => {
      const existing = await query.query<{ id: string }>(
        "SELECT id FROM devices WHERE owner_id=$1 AND id=$2 FOR UPDATE",
        [ownerId, input.device_id],
      );
      if (existing.rows.length) {
        await query.query(
          `UPDATE devices
              SET platform=$3, push_token=COALESCE($4, push_token),
                  last_seen_at=now(), is_active=true,
                  updated_at=now(), row_version=row_version+1
            WHERE owner_id=$1 AND id=$2`,
          [ownerId, input.device_id, input.platform, input.push_token ?? null],
        );
        return { device_id: input.device_id };
      }
      await query.query(
        `INSERT INTO devices (id, owner_id, platform, push_token, last_seen_at, is_active)
         VALUES ($1,$2,$3,$4, now(), true)`,
        [input.device_id, ownerId, input.platform, input.push_token ?? null],
      );
      return { device_id: input.device_id };
    });
  }

  private async touchDevice(
    query: QueryPort,
    ownerId: string,
    deviceId: string,
  ) {
    await query.query(
      "UPDATE devices SET last_seen_at=now(), updated_at=now() WHERE owner_id=$1 AND id=$2",
      [ownerId, deviceId],
    );
  }

  /**
   * Server-side stale guard mirrors the local one: a completed, deleted or
   * muted item cancels the delivery instead of notifying anyone.
   */
  async claim(
    ownerId: string,
    input: z.infer<typeof notificationClaimSchema>,
  ): Promise<ClaimResult> {
    return this.db.transaction(async (query) => {
      const item = await query.query<{
        status: string;
        deleted_at: string | null;
        reminder_level: string;
      }>(
        "SELECT status, deleted_at, reminder_level FROM items WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [input.item_id, ownerId],
      );
      const row = item.rows[0];
      const stale =
        !row ||
        row.deleted_at !== null ||
        row.status !== "INCOMPLETE" ||
        row.reminder_level === "OFF";
      const existing = await query.query<{
        id: string;
        state: string;
        claimed_by_device_id: string | null;
        lease_expires_at: string | null;
      }>(
        `SELECT id, state, claimed_by_device_id, lease_expires_at
           FROM notification_deliveries
          WHERE owner_id=$1 AND logical_key=$2
          FOR UPDATE`,
        [ownerId, input.logical_key],
      );
      const current = existing.rows[0];
      if (stale) {
        if (!current) {
          await query.query(
            `INSERT INTO notification_deliveries
               (id, owner_id, item_id, logical_key, reminder_rule_key, scheduled_for,
                policy_version, state, canceled_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'CANCELED', now())`,
            [
              randomUUID(),
              ownerId,
              input.item_id,
              input.logical_key,
              input.reminder_rule_key,
              input.scheduled_for,
              input.policy_version,
            ],
          );
        } else if (current.state !== "DELIVERED") {
          await query.query(
            `UPDATE notification_deliveries
                SET state='CANCELED', canceled_at=now(), updated_at=now(),
                    row_version=row_version+1
              WHERE id=$1`,
            [current.id],
          );
        }
        await this.touchDevice(query, ownerId, input.device_id);
        return { claimed: false, delivery_id: null, reason: "STALE" };
      }
      if (current?.state === "DELIVERED") {
        await this.touchDevice(query, ownerId, input.device_id);
        return {
          claimed: false,
          delivery_id: current.id,
          reason: "DELIVERED",
        };
      }
      if (current?.state === "CANCELED") {
        await this.touchDevice(query, ownerId, input.device_id);
        return { claimed: false, delivery_id: current.id, reason: "CANCELED" };
      }
      const leaseValid =
        current?.state === "CLAIMED" &&
        current.lease_expires_at !== null &&
        Date.parse(current.lease_expires_at) > Date.now();
      if (
        leaseValid &&
        current.claimed_by_device_id &&
        current.claimed_by_device_id !== input.device_id
      ) {
        await this.touchDevice(query, ownerId, input.device_id);
        return { claimed: false, delivery_id: current.id, reason: "LEASED" };
      }
      if (current) {
        await query.query(
          `UPDATE notification_deliveries
              SET state='CLAIMED', claimed_at=now(), claimed_by_device_id=$2,
                  lease_expires_at=now() + make_interval(secs => $3),
                  policy_version=$4, scheduled_for=$5, updated_at=now(),
                  row_version=row_version+1
            WHERE id=$1`,
          [
            current.id,
            input.device_id,
            input.lease_seconds,
            input.policy_version,
            input.scheduled_for,
          ],
        );
        await this.touchDevice(query, ownerId, input.device_id);
        return { claimed: true, delivery_id: current.id };
      }
      const id = randomUUID();
      await query.query(
        `INSERT INTO notification_deliveries
           (id, owner_id, item_id, logical_key, reminder_rule_key, scheduled_for,
            policy_version, state, claimed_at, claimed_by_device_id, lease_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'CLAIMED', now(), $8,
                 now() + make_interval(secs => $9))`,
        [
          id,
          ownerId,
          input.item_id,
          input.logical_key,
          input.reminder_rule_key,
          input.scheduled_for,
          input.policy_version,
          input.device_id,
          input.lease_seconds,
        ],
      );
      await this.touchDevice(query, ownerId, input.device_id);
      return { claimed: true, delivery_id: id };
    });
  }

  /** Acknowledgement records the send; it never changes Item state. */
  async acknowledge(
    ownerId: string,
    deliveryId: string,
    deviceId: string,
  ): Promise<void> {
    await this.db.transaction(async (query) => {
      const existing = await query.query<{ state: string }>(
        "SELECT state FROM notification_deliveries WHERE owner_id=$1 AND id=$2 FOR UPDATE",
        [ownerId, deliveryId],
      );
      const row = existing.rows[0];
      if (!row) throw new CloudError("NOT_FOUND", 404, "Delivery not found");
      if (row.state === "CANCELED")
        throw new CloudError("VALIDATION_ERROR", 409, "Delivery was canceled");
      if (row.state !== "DELIVERED")
        await query.query(
          `UPDATE notification_deliveries
              SET state='DELIVERED', delivered_at=now(), delivered_by_device_id=$2,
                  lease_expires_at=NULL, updated_at=now(), row_version=row_version+1
            WHERE id=$1`,
          [deliveryId, deviceId],
        );
      await this.touchDevice(query, ownerId, deviceId);
    });
  }

  /** Completion, deletion or a time change cancels every named future key. */
  async cancel(ownerId: string, logicalKeys: string[]): Promise<number> {
    const result = await this.db.query<{ logical_key: string }>(
      `UPDATE notification_deliveries
          SET state='CANCELED', canceled_at=now(), updated_at=now(),
              row_version=row_version+1
        WHERE owner_id=$1 AND logical_key = ANY($2::text[])
          AND state <> 'DELIVERED'
        RETURNING logical_key`,
      [ownerId, logicalKeys],
    );
    return result.rows.length;
  }

  async listForItem(ownerId: string, itemId: string) {
    const result = await this.db.query<{
      logical_key: string;
      state: string;
      scheduled_for: string;
    }>(
      `SELECT logical_key, state, scheduled_for
         FROM notification_deliveries
        WHERE owner_id=$1 AND item_id=$2
        ORDER BY scheduled_for`,
      [ownerId, itemId],
    );
    return result.rows;
  }
}
