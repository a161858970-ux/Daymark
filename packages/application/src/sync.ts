import type { OutboxMutation, SyncEntityType } from "@daymark/domain";

export interface ActionRequiredSyncIssue {
  mutation: OutboxMutation;
  local_object: Record<string, unknown> | null;
  error_code: string;
  can_retry: boolean;
  can_abandon: boolean;
}

export interface RemoteChange {
  id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  changed_fields: Record<string, unknown>;
  entity_version: number;
  server_time: string;
}

export type PushResult =
  | {
      mutation_id: string;
      result: "ACK";
      entity_version: number;
      undo_expires_at?: string;
    }
  | { mutation_id: string; result: "CONFLICT"; conflict_id: string };

export interface SyncTransport {
  identity(): Promise<string>;
  push(deviceId: string, mutation: OutboxMutation): Promise<PushResult>;
  changes(cursor: string | null): Promise<{
    data: RemoteChange[];
    next_cursor: string;
    has_more: boolean;
  }>;
}

export interface SyncRepository {
  deviceId(): Promise<string>;
  bindOwner(ownerId: string): Promise<void>;
  pendingMutations(): Promise<OutboxMutation[]>;
  serverVersion(type: SyncEntityType, id: string): Promise<number | null>;
  acknowledge(mutationId: string, serverVersion: number): Promise<void>;
  recordSyncFailure(mutationId: string, error: string): Promise<void>;
  syncCursor(): Promise<string | null>;
  applyRemoteChanges(
    ownerId: string,
    changes: RemoteChange[],
    cursor: string,
  ): Promise<void>;
}

/** One ordered pass. Errors retain the outbox row for a later retry. */
export class SyncWorker {
  constructor(
    private readonly repo: SyncRepository,
    private readonly transport: SyncTransport,
  ) {}

  async runOnce(): Promise<{
    pushed: number;
    pulled: number;
    stopped: string | null;
  }> {
    const ownerId = await this.transport.identity();
    await this.repo.bindOwner(ownerId);
    const deviceId = await this.repo.deviceId();
    let pushed = 0;
    for (const mutation of await this.repo.pendingMutations()) {
      if (
        /^(VALIDATION_ERROR|FORBIDDEN|NOT_FOUND|IDEMPOTENCY_REPLAY):/.test(
          mutation.last_error ?? "",
        )
      )
        return { pushed, pulled: 0, stopped: "ACTION_REQUIRED" };
      const observed = await this.repo.serverVersion(
        mutation.entity_type,
        mutation.entity_id,
      );
      const outgoing: OutboxMutation = {
        ...mutation,
        owner_id: ownerId,
        base_version:
          mutation.operation === "CREATE"
            ? null
            : (observed ?? mutation.base_version),
      };
      try {
        const result = await this.transport.push(deviceId, outgoing);
        if (result.mutation_id !== mutation.mutation_id)
          throw new Error("Sync ACK ID mismatch");
        if (result.result === "CONFLICT") {
          await this.repo.recordSyncFailure(
            mutation.mutation_id,
            `VERSION_CONFLICT:${result.conflict_id}`,
          );
          return { pushed, pulled: 0, stopped: "VERSION_CONFLICT" };
        }
        await this.repo.acknowledge(
          mutation.mutation_id,
          result.entity_version,
        );
        pushed++;
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : null;
        await this.repo.recordSyncFailure(
          mutation.mutation_id,
          `${code ?? "NETWORK_OR_UNKNOWN"}: ${String(error)}`,
        );
        const actionRequired =
          code &&
          [
            "VALIDATION_ERROR",
            "FORBIDDEN",
            "NOT_FOUND",
            "IDEMPOTENCY_REPLAY",
          ].includes(code);
        return {
          pushed,
          pulled: 0,
          stopped: actionRequired ? "ACTION_REQUIRED" : "RETRY",
        };
      }
    }
    let pulled = 0;
    let cursor = await this.repo.syncCursor();
    for (;;) {
      const page = await this.transport.changes(cursor);
      if (page.data.length === 0 && page.has_more)
        throw new Error("Empty sync page cannot advance");
      await this.repo.applyRemoteChanges(ownerId, page.data, page.next_cursor);
      pulled += page.data.length;
      cursor = page.next_cursor;
      if (!page.has_more) break;
    }
    return { pushed, pulled, stopped: null };
  }
}
