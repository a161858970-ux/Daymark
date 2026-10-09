import { describe, expect, it } from "vitest";
import type { Item } from "@daymark/domain";
import {
  createReminderWindow,
  deriveReminderSchedule,
  reminderIsCurrent,
  reminderMayDeliver,
  type ReminderWindow,
} from "./reminders.js";
import {
  REMINDER_POLICY_V1 as POLICY,
  REMINDER_QUIET_HOURS_V1,
} from "./reminderPolicy.js";

const hour = 60 * 60 * 1000;
const minute = 60 * 1000;
const timeZone = "Asia/Shanghai";

function windowBetween(
  from: string,
  to: string,
  quiet = false,
): ReminderWindow {
  return createReminderWindow({
    from,
    to,
    timeZone,
    quietHours: quiet ? REMINDER_QUIET_HOURS_V1 : null,
  });
}

function item(fields: Partial<Item> = {}): Item {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "22222222-2222-4222-8222-222222222222",
    course_id: null,
    title: "提交报告",
    detail: null,
    status: "INCOMPLETE",
    start_at: null,
    start_date: null,
    occurrence_start_at: null,
    occurrence_start_date: null,
    occurrence_end_at: null,
    occurrence_end_date: null,
    due_at: null,
    due_date: null,
    time_zone: "Asia/Shanghai",
    reminder_level: "NORMAL",
    completed_at: null,
    raw_capture_id: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    deleted_at: null,
    row_version: 1,
    ...fields,
  };
}

const keys = (events: { rule_key: string }[]) =>
  new Set(events.map((event) => event.rule_key));

describe("R-01 product reminder policy (r01-v2)", () => {
  it("keeps the fixed policy numbers", () => {
    expect(POLICY.version).toBe("r01-v2");
    expect(POLICY.dedup_window_ms).toBe(60 * minute);
    expect(REMINDER_QUIET_HOURS_V1).toEqual({ start: "23:00", end: "08:00" });

    const normal = POLICY.levels.NORMAL;
    expect(normal.due_leads_ms).toEqual([24 * hour, 2 * hour, 0]);
    expect(normal.due_same_day_interval_ms).toBe(6 * hour);
    expect(normal.occurrence_leads_ms).toEqual([30 * minute]);
    expect(normal.overdue_interval_ms).toBe(24 * hour);
    expect(normal.occurrence_after_initial_ms).toBe(24 * hour);
    expect(normal.occurrence_after_interval_ms).toBe(24 * hour);
    expect(normal.max_per_local_day).toBe(3);

    const high = POLICY.levels.HIGH;
    expect(high.due_leads_ms).toEqual([
      24 * hour,
      4 * hour,
      1 * hour,
      15 * minute,
      0,
    ]);
    expect(high.due_same_day_interval_ms).toBe(3 * hour);
    expect(high.occurrence_leads_ms).toEqual([60 * minute, 15 * minute]);
    expect(high.overdue_interval_ms).toBe(6 * hour);
    expect(high.occurrence_after_initial_ms).toBe(8 * hour);
    expect(high.occurrence_after_interval_ms).toBe(12 * hour);
    expect(high.max_per_local_day).toBe(5);
    expect(POLICY.start_offset_ms).toBe(0);
  });

  it("schedules NORMAL due leads, same-day cadence and overdue continuation", () => {
    // 2026-10-05 10:00 +08:00
    const due = "2026-10-05T02:00:00.000Z";
    const events = deriveReminderSchedule(
      [item({ due_at: due })],
      POLICY,
      windowBetween("2026-10-04T00:00:00.000Z", "2026-10-08T00:00:00.000Z"),
    );
    const rules = keys(events);
    expect(rules).toContain("due:before:86400000");
    expect(rules).toContain("due:before:7200000");
    expect(rules).toContain("due:same-day:1");
    expect(rules).toContain("due:after:1");

    // The 2h lead lands at 08:00 local, the same-day point at 04:00 local.
    const twoHours = events.find((e) => e.rule_key === "due:before:7200000")!;
    expect(twoHours.scheduled_for).toBe("2026-10-05T00:00:00.000Z");
    const sameDay = events.find((e) => e.rule_key === "due:same-day:1")!;
    expect(sameDay.scheduled_for).toBe("2026-10-04T20:00:00.000Z");
    // First overdue continuation is exactly one day after the due time.
    const overdue = events.find((e) => e.rule_key === "due:after:1")!;
    expect(Date.parse(overdue.scheduled_for)).toBe(Date.parse(due) + 24 * hour);
  });

  it("emits every HIGH due lead", () => {
    const due = "2026-10-05T10:00:00.000Z";
    const events = deriveReminderSchedule(
      [item({ due_at: due, reminder_level: "HIGH" })],
      POLICY,
      windowBetween("2026-10-04T00:00:00.000Z", "2026-10-08T00:00:00.000Z"),
    );
    const rules = keys(events);
    for (const lead of [86400000, 14400000, 3600000, 900000])
      expect(rules).toContain(`due:before:${lead}`);
    expect(rules).toContain("due:same-day:1");
    expect(rules).toContain("due:after:1");
  });

  it("emits the HIGH occurrence leads and the 8h/12h continuation", () => {
    const occurrenceEnd = "2026-10-05T06:00:00.000Z";
    const events = deriveReminderSchedule(
      [
        item({
          reminder_level: "HIGH",
          occurrence_start_at: "2026-10-05T05:00:00.000Z",
          occurrence_end_at: occurrenceEnd,
        }),
      ],
      POLICY,
      windowBetween("2026-10-04T00:00:00.000Z", "2026-10-08T00:00:00.000Z"),
    );
    const rules = keys(events);
    expect(rules).toContain("occurrence:before:3600000");
    expect(rules).toContain("occurrence:before:900000");
    const first = events.find((e) => e.rule_key === "occurrence:after:1")!;
    expect(Date.parse(first.scheduled_for)).toBe(
      Date.parse(occurrenceEnd) + 8 * hour,
    );
    const second = events.find((e) => e.rule_key === "occurrence:after:2")!;
    expect(Date.parse(second.scheduled_for)).toBe(
      Date.parse(occurrenceEnd) + 8 * hour + 12 * hour,
    );
  });

  it("caps reminders per local day at the level budget", () => {
    // 23:59 local due produces four same-day candidates for NORMAL.
    const due = "2026-10-05T15:59:00.000Z";
    const events = deriveReminderSchedule(
      [item({ due_at: due })],
      POLICY,
      windowBetween("2026-10-04T00:00:00.000Z", "2026-10-08T00:00:00.000Z"),
    );
    const localDay = (instant: string) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(instant));
    const perDay = new Map<string, number>();
    for (const event of events) {
      const day = localDay(event.scheduled_for);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    for (const count of perDay.values()) expect(count).toBeLessThanOrEqual(3);
    expect(perDay.get("2026-10-05")).toBe(3);

    const high = deriveReminderSchedule(
      [item({ due_at: due, reminder_level: "HIGH" })],
      POLICY,
      windowBetween("2026-10-04T00:00:00.000Z", "2026-10-08T00:00:00.000Z"),
    );
    const highPerDay = new Map<string, number>();
    for (const event of high) {
      const day = localDay(event.scheduled_for);
      highPerDay.set(day, (highPerDay.get(day) ?? 0) + 1);
    }
    for (const count of highPerDay.values())
      expect(count).toBeLessThanOrEqual(5);
  });

  it("fires the start reminder exactly once, at start time", () => {
    const start = "2026-10-05T02:00:00.000Z";
    const events = deriveReminderSchedule(
      [item({ start_at: start })],
      POLICY,
      windowBetween("2026-10-04T00:00:00.000Z", "2026-10-07T00:00:00.000Z"),
    );
    const starts = events.filter((event) => event.rule_key === "start:once");
    expect(starts).toHaveLength(1);
    expect(starts[0]!.scheduled_for).toBe(start);
  });

  it("delays quiet-hour deliveries to 08:00 local without moving them earlier", () => {
    // 2026-10-05 23:30 +08:00 falls inside 23:00-08:00.
    const due = "2026-10-05T15:30:00.000Z";
    const events = deriveReminderSchedule(
      [item({ due_at: due })],
      POLICY,
      windowBetween(
        "2026-10-05T00:00:00.000Z",
        "2026-10-08T00:00:00.000Z",
        true,
      ),
    );
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const localHour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone,
          hour: "2-digit",
          hour12: false,
        }).format(new Date(event.scheduled_for)),
      );
      const localMinute = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone,
          minute: "2-digit",
        }).format(new Date(event.scheduled_for)),
      );
      const local = localHour * 60 + localMinute;
      const insideQuiet = local >= 23 * 60 || local < 8 * 60;
      expect(insideQuiet).toBe(false);
    }
  });

  it("produces no events for completed or deleted items", () => {
    const window = windowBetween(
      "2026-10-04T00:00:00.000Z",
      "2026-10-08T00:00:00.000Z",
    );
    const due = "2026-10-05T02:00:00.000Z";
    expect(
      deriveReminderSchedule(
        [item({ due_at: due, status: "COMPLETE" })],
        POLICY,
        window,
      ),
    ).toHaveLength(0);
    expect(
      deriveReminderSchedule(
        [item({ due_at: due, deleted_at: "2026-10-04T01:00:00.000Z" })],
        POLICY,
        window,
      ),
    ).toHaveLength(0);
    expect(
      deriveReminderSchedule(
        [item({ due_at: due, reminder_level: "OFF" })],
        POLICY,
        window,
      ),
    ).toHaveLength(0);
  });

  it("invalidates events after completion, level or policy changes", () => {
    const due = "2026-10-05T02:00:00.000Z";
    const window = windowBetween(
      "2026-10-04T00:00:00.000Z",
      "2026-10-08T00:00:00.000Z",
    );
    const [event] = deriveReminderSchedule(
      [item({ due_at: due })],
      POLICY,
      window,
    );
    expect(reminderIsCurrent(event!, item({ due_at: due }), "r01-v2")).toBe(
      true,
    );
    // Time change invalidates the snapshot.
    expect(
      reminderIsCurrent(
        event!,
        item({ due_at: "2026-10-06T02:00:00.000Z" }),
        "r01-v2",
      ),
    ).toBe(false);
    // Completion invalidates the snapshot.
    expect(
      reminderIsCurrent(
        event!,
        item({ due_at: due, status: "COMPLETE" }),
        "r01-v2",
      ),
    ).toBe(false);
    // Policy change invalidates the key.
    expect(reminderIsCurrent(event!, item({ due_at: due }), "r02-v1")).toBe(
      false,
    );

    // Dedup window: a delivered key is not delivered again within 60 minutes.
    expect(
      reminderMayDeliver(
        event!,
        {
          logicalDeliveredAt: null,
          lastItemDeliveredAt: "2026-10-04T10:00:00.000Z",
        },
        "2026-10-04T10:30:00.000Z",
        POLICY,
      ),
    ).toBe(false);
    expect(
      reminderMayDeliver(
        event!,
        {
          logicalDeliveredAt: "2026-10-04T09:00:00.000Z",
          lastItemDeliveredAt: null,
        },
        "2026-10-04T10:00:00.000Z",
        POLICY,
      ),
    ).toBe(false);
  });

  it("derives stable logical keys so a repeat run never duplicates a delivery", () => {
    const due = "2026-10-05T02:00:00.000Z";
    const window = windowBetween(
      "2026-10-04T00:00:00.000Z",
      "2026-10-08T00:00:00.000Z",
    );
    const first = deriveReminderSchedule(
      [item({ due_at: due })],
      POLICY,
      window,
    );
    const second = deriveReminderSchedule(
      [item({ due_at: due })],
      POLICY,
      window,
    );
    expect(first.map((event) => event.logical_key)).toEqual(
      second.map((event) => event.logical_key),
    );
    expect(new Set(first.map((event) => event.logical_key)).size).toBe(
      first.length,
    );
    // Changing the due time changes the identity of every derived key.
    const moved = deriveReminderSchedule(
      [item({ due_at: "2026-10-06T02:00:00.000Z" })],
      POLICY,
      window,
    );
    expect(
      moved.some((event) =>
        first.some((old) => old.logical_key === event.logical_key),
      ),
    ).toBe(false);
  });
});
