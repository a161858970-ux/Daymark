import type { Item } from "@daymark/domain";

export interface ReminderCadence {
  due_leads_ms: number[];
  occurrence_leads_ms: number[];
  overdue_interval_ms: number;
  /** First continuation point after the occurrence ends; defaults to the interval. */
  occurrence_after_initial_ms?: number;
  occurrence_after_interval_ms: number;
  /** Cadence of extra reminders during the local day of the due time. */
  due_same_day_interval_ms?: number;
  /** Per-level override of the policy daily budget. */
  max_per_local_day?: number;
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

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Reminder ${label} is invalid`);
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
    if (cadence.due_same_day_interval_ms !== undefined)
      assertPositive(cadence.due_same_day_interval_ms, "same-day cadence");
    if (cadence.occurrence_after_initial_ms !== undefined)
      assertPositive(cadence.occurrence_after_initial_ms, "occurrence start");
    if (cadence.max_per_local_day !== undefined) {
      if (
        !Number.isSafeInteger(cadence.max_per_local_day) ||
        cadence.max_per_local_day < 1
      )
        throw new Error("Reminder daily limit is invalid");
    }
  }
}

/**
 * Upper bound on how far `nextAllowedTime` may push a reminder (its internal
 * hardStop). Events older than this relative to the window can never be
 * recovered, so they are dropped without consulting the clock.
 */
const MAX_QUIET_DEFERRAL_MS = 48 * 60 * 60 * 1000;

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
  const events: { event: ReminderEvent; limit: number }[] = [];
  for (const item of items) {
    if (
      item.deleted_at ||
      item.status === "COMPLETE" ||
      item.reminder_level === "OFF"
    )
      continue;
    const cadence = policy.levels[item.reminder_level];
    const itemLimit = cadence.max_per_local_day ?? policy.max_per_local_day;
    const snapshot = itemReminderSnapshotKey(item);
    const emit = (ruleKey: string, occurrenceKey: string, at: number) => {
      // Quiet-hour deferral only ever moves a reminder forward, so the window
      // must be judged on the adjusted instant. Judging the raw instant meant
      // that a pre-dawn event left the window as `from` advanced past it, its
      // PENDING record was cancelled on the next tick, and the deferred
      // delivery at the end of the quiet window could never happen.
      if (at >= to || at < from - MAX_QUIET_DEFERRAL_MS) return;
      const scheduled = window.nextAllowedTime(new Date(at).toISOString());
      const adjusted = timestamp(scheduled);
      if (adjusted < at)
        throw new Error("Quiet-hour handler moved a reminder earlier");
      if (adjusted < from || adjusted >= to) return;
      events.push({
        event: {
          logical_key: `${item.id}:${ruleKey}:${policy.version}:${occurrenceKey}`,
          item_id: item.id,
          owner_id: item.owner_id,
          rule_key: ruleKey,
          scheduled_for: new Date(adjusted).toISOString(),
          policy_version: policy.version,
          item_snapshot_key: snapshot,
        },
        limit: itemLimit,
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
      initial: number,
      interval: number,
    ) => {
      let scheduled = at + initial;
      let ordinal = 1;
      if (scheduled < from) {
        const steps = Math.ceil((from - scheduled) / interval);
        scheduled += steps * interval;
        ordinal += steps;
      }
      while (scheduled < to) {
        emit(`${kind}:after:${ordinal}`, new Date(at).toISOString(), scheduled);
        scheduled += interval;
        ordinal += 1;
        if (ordinal > 10_000) throw new Error("Reminder continuation overflow");
      }
    };
    /** Extra points every cadence interval while still on the due's local day. */
    const sameDay = (at: number, interval: number) => {
      const dueDay = window.localDayKey(new Date(at).toISOString());
      let scheduled = at - interval;
      let step = 1;
      while (scheduled >= from) {
        if (window.localDayKey(new Date(scheduled).toISOString()) !== dueDay)
          break;
        emit(`due:same-day:${step}`, new Date(at).toISOString(), scheduled);
        scheduled -= interval;
        step += 1;
        if (step > 1000) throw new Error("Reminder same-day cadence overflow");
      }
    };
    if (item.start_at) {
      const at = timestamp(item.start_at);
      emit("start:once", item.start_at, at + policy.start_offset_ms);
    }
    if (item.due_at) {
      const at = timestamp(item.due_at);
      before("due", at, cadence.due_leads_ms);
      if (cadence.due_same_day_interval_ms)
        sameDay(at, cadence.due_same_day_interval_ms);
      continuation(
        "due",
        at,
        cadence.overdue_interval_ms,
        cadence.overdue_interval_ms,
      );
    }
    const occurrenceStart = item.occurrence_start_at ?? item.occurrence_end_at;
    const occurrenceEnd = item.occurrence_end_at ?? item.occurrence_start_at;
    if (occurrenceStart && occurrenceEnd) {
      const start = timestamp(occurrenceStart);
      const end = timestamp(occurrenceEnd);
      before("occurrence", start, cadence.occurrence_leads_ms);
      continuation(
        "occurrence",
        end,
        cadence.occurrence_after_initial_ms ??
          cadence.occurrence_after_interval_ms,
        cadence.occurrence_after_interval_ms,
      );
    }
  }
  const seen = new Set<string>();
  const unique = events.filter((entry) => {
    if (seen.has(entry.event.logical_key)) return false;
    seen.add(entry.event.logical_key);
    return true;
  });
  // The daily budget is spent per Item: explicit lead times are kept first,
  // then the nearest cadence/continuation points, so the last hours before a
  // deadline are never crowded out by earlier filler reminders.
  const explicit = (ruleKey: string) =>
    ruleKey.startsWith("due:before") ||
    ruleKey.startsWith("occurrence:before") ||
    ruleKey.startsWith("start:");
  unique.sort(
    (a, b) =>
      Number(explicit(b.event.rule_key)) - Number(explicit(a.event.rule_key)) ||
      (explicit(a.event.rule_key)
        ? a.event.scheduled_for.localeCompare(b.event.scheduled_for)
        : b.event.scheduled_for.localeCompare(a.event.scheduled_for)) ||
      a.event.logical_key.localeCompare(b.event.logical_key),
  );
  const kept = new Set<string>();
  const perDay = new Map<string, number>();
  for (const entry of unique) {
    const event = entry.event;
    const day = `${event.item_id}:${window.localDayKey(event.scheduled_for)}`;
    const count = perDay.get(day) ?? 0;
    if (count >= entry.limit) continue;
    perDay.set(day, count + 1);
    kept.add(event.logical_key);
  }
  return unique
    .filter((entry) => kept.has(entry.event.logical_key))
    .map((entry) => entry.event)
    .sort(
      (a, b) =>
        a.scheduled_for.localeCompare(b.scheduled_for) ||
        a.logical_key.localeCompare(b.logical_key),
    );
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

/** Quiet hours are "HH:MM" local wall-clock bounds; start may be after end (crosses midnight). */
export interface QuietHours {
  start: string;
  end: string;
}

function quietMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid quiet-hour bound");
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes > 1439) throw new Error("Invalid quiet-hour bound");
  return minutes;
}

function localParts(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instant));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)!.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    minutes: get("hour") * 60 + get("minute"),
  };
}

/**
 * Quiet-hour window: a delivery may be delayed into the next allowed slot but
 * is never moved earlier. Without configured quiet hours this is identity.
 */
export function createReminderWindow(options: {
  from: string;
  to: string;
  timeZone?: string;
  quietHours?: QuietHours | null;
}): ReminderWindow {
  const timeZone =
    options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const quiet = options.quietHours ?? null;
  const quietStart = quiet ? quietMinutes(quiet.start) : null;
  const quietEnd = quiet ? quietMinutes(quiet.end) : null;
  const suppressed = (minutes: number) => {
    if (quietStart === null || quietEnd === null || quietStart === quietEnd)
      return false;
    return quietStart < quietEnd
      ? minutes >= quietStart && minutes < quietEnd
      : minutes >= quietStart || minutes < quietEnd;
  };
  return {
    from: options.from,
    to: options.to,
    nextAllowedTime(instant: string): string {
      if (!quiet) return instant;
      let allowed = timestamp(instant);
      const hardStop = allowed + 48 * 60 * 60 * 1000;
      while (
        suppressed(
          localParts(new Date(allowed).toISOString(), timeZone).minutes,
        )
      ) {
        allowed += 60 * 1000;
        if (allowed > hardStop)
          throw new Error("Quiet-hour window did not open");
      }
      return new Date(allowed).toISOString();
    },
    localDayKey(instant: string): string {
      const parts = localParts(instant, timeZone);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
    },
  };
}
