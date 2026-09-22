import type { Item } from "@course-manager/domain";

export interface ReminderCadence {
  due_leads_ms: number[];
  occurrence_leads_ms: number[];
  overdue_interval_ms: number;
  occurrence_after_interval_ms: number;
}

/** Numeric values are supplied by product policy; no production defaults live here. */
export interface ReminderPolicy {
  version: string;
  levels: { NORMAL: ReminderCadence; HIGH: ReminderCadence };
  start_offset_ms: number;
  max_per_local_day: number;
  dedup_window_ms: number;
}

export interface ReminderEvent {
  logical_key: string;
  item_id: string;
  owner_id: string;
  rule_key: string;
  scheduled_for: string;
  policy_version: string;
  item_snapshot_key: string;
}

export interface LocalReminderRecord extends ReminderEvent {
  state: "PENDING" | "DELIVERED" | "CONSUMED" | "CANCELED";
  delivered_at: string | null;
  consumed_at: string | null;
}

export interface ReminderRepository {
  transaction<T>(work: () => Promise<T>): Promise<T>;
  listReminderRecords(): Promise<LocalReminderRecord[]>;
  putReminderRecord(record: LocalReminderRecord): Promise<void>;
  getItem(id: string): Promise<Item | undefined>;
}

/** Online implementations claim through a shared lease; offline implementations can claim locally. */
export interface ReminderDeliveryPort {
  claim(event: ReminderEvent): Promise<boolean>;
  deliver(event: ReminderEvent): Promise<void>;
  cancel(logicalKey: string): Promise<void>;
}

export interface ReminderWindow {
  from: string;
  to: string;
  /** The caller owns local-timezone and quiet-hour policy. Must never move time earlier. */
  nextAllowedTime(instant: string): string;
  localDayKey(instant: string): string;
}

export function itemReminderSnapshotKey(item: Item): string {
  return JSON.stringify([
    item.status,
    item.deleted_at,
    item.reminder_level,
    item.start_at,
    item.occurrence_start_at,
    item.occurrence_end_at,
    item.due_at,
  ]);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid reminder instant");
  return parsed;
}

function validatePolicy(policy: ReminderPolicy): void {
  if (!policy.version.trim())
    throw new Error("Reminder policy version is required");
  if (
    !Number.isSafeInteger(policy.max_per_local_day) ||
    policy.max_per_local_day < 1
  )
    throw new Error("Reminder daily limit is invalid");
  if (
    !Number.isFinite(policy.start_offset_ms) ||
    !Number.isFinite(policy.dedup_window_ms) ||
    policy.dedup_window_ms < 0
  )
    throw new Error("Reminder timing policy is invalid");
  for (const cadence of Object.values(policy.levels)) {
    if (
      ![
        cadence.overdue_interval_ms,
        cadence.occurrence_after_interval_ms,
      ].every((value) => Number.isFinite(value) && value > 0)
    )
      throw new Error("Reminder continuation interval is invalid");
    if (
      ![...cadence.due_leads_ms, ...cadence.occurrence_leads_ms].every(
        (value) => Number.isFinite(value) && value >= 0,
      )
    )
      throw new Error("Reminder lead time is invalid");
  }
}

/** One Item remains one object; these are derived logical delivery events. */
export function deriveReminderSchedule(
  items: Item[],
  policy: ReminderPolicy,
  window: ReminderWindow,
): ReminderEvent[] {
  validatePolicy(policy);
  const from = timestamp(window.from);
  const to = timestamp(window.to);
  if (to <= from) throw new Error("Reminder window must be increasing");
  const events: ReminderEvent[] = [];
  for (const item of items) {
    if (
      item.deleted_at ||
      item.status === "COMPLETE" ||
      item.reminder_level === "OFF"
    )
      continue;
    const cadence = policy.levels[item.reminder_level];
    const snapshot = itemReminderSnapshotKey(item);
    const emit = (ruleKey: string, occurrenceKey: string, at: number) => {
      if (at < from || at >= to) return;
      const scheduled = window.nextAllowedTime(new Date(at).toISOString());
      const adjusted = timestamp(scheduled);
      if (adjusted < at)
        throw new Error("Quiet-hour handler moved a reminder earlier");
      if (adjusted >= to) return;
      events.push({
        logical_key: `${item.id}:${ruleKey}:${policy.version}:${occurrenceKey}`,
        item_id: item.id,
        owner_id: item.owner_id,
        rule_key: ruleKey,
        scheduled_for: new Date(adjusted).toISOString(),
        policy_version: policy.version,
        item_snapshot_key: snapshot,
      });
    };
    const before = (
      kind: "due" | "occurrence",
      at: number,
      leads: number[],
    ) => {
      for (const lead of new Set(leads))
        emit(`${kind}:before:${lead}`, new Date(at).toISOString(), at - lead);
    };
    const continuation = (
      kind: "due" | "occurrence",
      at: number,
      interval: number,
    ) => {
      const first = Math.max(1, Math.ceil((from - at) / interval));
      for (let ordinal = first; at + ordinal * interval < to; ordinal++)
        emit(
          `${kind}:after:${ordinal}`,
          new Date(at).toISOString(),
          at + ordinal * interval,
        );
    };
    if (item.start_at) {
      const at = timestamp(item.start_at);
      emit("start:once", item.start_at, at + policy.start_offset_ms);
    }
    if (item.due_at) {
      const at = timestamp(item.due_at);
      before("due", at, cadence.due_leads_ms);
      continuation("due", at, cadence.overdue_interval_ms);
    }
    const occurrenceStart = item.occurrence_start_at ?? item.occurrence_end_at;
    const occurrenceEnd = item.occurrence_end_at ?? item.occurrence_start_at;
    if (occurrenceStart && occurrenceEnd) {
      const start = timestamp(occurrenceStart);
      const end = timestamp(occurrenceEnd);
      before("occurrence", start, cadence.occurrence_leads_ms);
      continuation("occurrence", end, cadence.occurrence_after_interval_ms);
    }
  }
  events.sort(
    (a, b) =>
      a.scheduled_for.localeCompare(b.scheduled_for) ||
      a.logical_key.localeCompare(b.logical_key),
  );
  const result: ReminderEvent[] = [];
  const perDay = new Map<string, number>();
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.logical_key)) continue;
    seen.add(event.logical_key);
    const day = window.localDayKey(event.scheduled_for);
    const count = perDay.get(day) ?? 0;
    if (count >= policy.max_per_local_day) continue;
    perDay.set(day, count + 1);
    result.push(event);
  }
  return result;
}

/** Re-check current Item and policy immediately before delivery or opening detail. */
export function reminderIsCurrent(
  event: ReminderEvent,
  item: Item | null | undefined,
  policyVersion: string,
): boolean {
  return Boolean(
    item &&
    item.id === event.item_id &&
    item.owner_id === event.owner_id &&
    !item.deleted_at &&
    item.status === "INCOMPLETE" &&
    item.reminder_level !== "OFF" &&
    policyVersion === event.policy_version &&
    itemReminderSnapshotKey(item) === event.item_snapshot_key,
  );
}

/** A repeated attempt with the same logical key cannot notify immediately again. */
export function reminderMayDeliver(
  event: ReminderEvent,
  delivery: {
    logicalDeliveredAt: string | null;
    lastItemDeliveredAt: string | null;
  },
  now: string,
  policy: ReminderPolicy,
): boolean {
  if (
    delivery.logicalDeliveredAt ||
    timestamp(now) < timestamp(event.scheduled_for)
  )
    return false;
  return (
    !delivery.lastItemDeliveredAt ||
    timestamp(now) >=
      timestamp(delivery.lastItemDeliveredAt) + policy.dedup_window_ms
  );
}

export class ReminderCoordinator {
  constructor(
    private readonly repo: ReminderRepository,
    private readonly delivery: ReminderDeliveryPort,
  ) {}

  async reconcile(
    items: Item[],
    policy: ReminderPolicy,
    window: ReminderWindow,
  ): Promise<void> {
    const desired = deriveReminderSchedule(items, policy, window);
    const desiredKeys = new Set(desired.map((event) => event.logical_key));
    const old = await this.repo.listReminderRecords();
    const previous = new Map(old.map((record) => [record.logical_key, record]));
    const canceled: string[] = [];
    await this.repo.transaction(async () => {
      for (const record of old) {
        if (
          record.state === "PENDING" &&
          !desiredKeys.has(record.logical_key)
        ) {
          await this.repo.putReminderRecord({ ...record, state: "CANCELED" });
          canceled.push(record.logical_key);
        }
      }
      for (const event of desired) {
        const record = previous.get(event.logical_key);
        if (record?.state === "DELIVERED" || record?.state === "CONSUMED")
          continue;
        await this.repo.putReminderRecord({
          ...event,
          state: "PENDING",
          delivered_at: null,
          consumed_at: null,
        });
      }
    });
    for (const key of canceled) await this.delivery.cancel(key);
  }

  async deliverDue(now: string, policy: ReminderPolicy): Promise<number> {
    const records = (await this.repo.listReminderRecords())
      .filter(
        (record) => record.state === "PENDING" && record.scheduled_for <= now,
      )
      .sort(
        (a, b) =>
          a.scheduled_for.localeCompare(b.scheduled_for) ||
          a.logical_key.localeCompare(b.logical_key),
      );
    let delivered = 0;
    for (const record of records) {
      const item = await this.repo.getItem(record.item_id);
      if (!reminderIsCurrent(record, item, policy.version)) {
        await this.repo.putReminderRecord({ ...record, state: "CANCELED" });
        await this.delivery.cancel(record.logical_key);
        continue;
      }
      const siblings = await this.repo.listReminderRecords();
      const lastItemDeliveredAt =
        siblings
          .filter(
            (sibling) =>
              sibling.item_id === record.item_id && sibling.delivered_at,
          )
          .map((sibling) => sibling.delivered_at!)
          .sort()
          .at(-1) ?? null;
      if (
        !reminderMayDeliver(
          record,
          { logicalDeliveredAt: record.delivered_at, lastItemDeliveredAt },
          now,
          policy,
        )
      )
        continue;
      if (!(await this.delivery.claim(record))) continue;
      // Re-read after the claim: a different device or UI action may have changed the Item.
      if (
        !reminderIsCurrent(
          record,
          await this.repo.getItem(record.item_id),
          policy.version,
        )
      ) {
        await this.repo.putReminderRecord({ ...record, state: "CANCELED" });
        await this.delivery.cancel(record.logical_key);
        continue;
      }
      await this.delivery.deliver(record);
      await this.repo.putReminderRecord({
        ...record,
        state: "DELIVERED",
        delivered_at: now,
      });
      delivered++;
    }
    return delivered;
  }

  async consume(logicalKey: string): Promise<Item | null> {
    const record = (await this.repo.listReminderRecords()).find(
      (value) => value.logical_key === logicalKey,
    );
    if (
      !record ||
      (record.state !== "DELIVERED" && record.state !== "CONSUMED")
    )
      return null;
    const item = await this.repo.getItem(record.item_id);
    if (!item || item.deleted_at) return null;
    if (record.state === "DELIVERED")
      await this.repo.putReminderRecord({
        ...record,
        state: "CONSUMED",
        consumed_at: new Date().toISOString(),
      });
    return item;
  }
}
