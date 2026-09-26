import { describe, expect, it } from "vitest";
import type { Item } from "@course-manager/domain";
import {
  createReminderWindow,
  deriveReminderSchedule,
  reminderIsCurrent,
  reminderMayDeliver,
  type ReminderPolicy,
  type ReminderWindow,
} from "./reminders.js";

// Fixture numbers exercise a configurable interface; they are not product defaults.
const hour = 60 * 60 * 1000;
const policy: ReminderPolicy = {
  version: "test-policy-v1",
  levels: {
    NORMAL: {
      due_leads_ms: [2 * hour, hour],
      occurrence_leads_ms: [hour],
      overdue_interval_ms: 4 * hour,
      occurrence_after_interval_ms: 8 * hour,
    },
    HIGH: {
      due_leads_ms: [3 * hour, 2 * hour, hour],
      occurrence_leads_ms: [2 * hour, hour],
      overdue_interval_ms: 2 * hour,
      occurrence_after_interval_ms: 6 * hour,
    },
  },
  start_offset_ms: 0,
  max_per_local_day: 30,
  dedup_window_ms: 10 * 60 * 1000,
};

const window: ReminderWindow = {
  from: "2026-09-22T00:00:00.000Z",
  to: "2026-09-24T00:00:00.000Z",
  nextAllowedTime: (at) => at,
  localDayKey: (at) => at.slice(0, 10),
};

function item(fields: Partial<Item> = {}): Item {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "22222222-2222-4222-8222-222222222222",
    course_id: null,
    title: "提交报告",
    detail: null,
    status: "INCOMPLETE",
    start_at: null,
    occurrence_start_at: null,
    occurrence_end_at: null,
    due_at: null,
    reminder_level: "NORMAL",
    completed_at: null,
    raw_capture_id: null,
    created_at: "2026-09-21T00:00:00.000Z",
    updated_at: "2026-09-21T00:00:00.000Z",
    deleted_at: null,
    row_version: 1,
    ...fields,
  };
}

describe("configurable reminder derivation", () => {
  it("only schedules timed incomplete, active Items with reminders enabled", () => {
    expect(deriveReminderSchedule([item()], policy, window)).toEqual([]);
    const timed = item({ due_at: "2026-09-22T12:00:00.000Z" });
    expect(
      deriveReminderSchedule([timed], policy, window).length,
    ).toBeGreaterThan(1);
    expect(
      deriveReminderSchedule(
        [{ ...timed, status: "COMPLETE" }],
        policy,
        window,
      ),
    ).toEqual([]);
    expect(
      deriveReminderSchedule(
        [{ ...timed, deleted_at: "2026-09-22T08:00:00.000Z" }],
        policy,
        window,
      ),
    ).toEqual([]);
    expect(
      deriveReminderSchedule(
        [{ ...timed, reminder_level: "OFF" }],
        policy,
        window,
      ),
    ).toEqual([]);
  });

  it("recomputes due and level changes and continues overdue without changing Item status", () => {
    const due = item({ due_at: "2026-09-22T12:00:00.000Z" });
    const normal = deriveReminderSchedule([due], policy, window);
    expect(normal.map((event) => event.scheduled_for)).toContain(
      "2026-09-22T10:00:00.000Z",
    );
    expect(
      normal.some((event) => event.rule_key.startsWith("due:after:")),
    ).toBe(true);
    const high = deriveReminderSchedule(
      [{ ...due, reminder_level: "HIGH" }],
      policy,
      window,
    );
    expect(high.map((event) => event.scheduled_for)).toContain(
      "2026-09-22T09:00:00.000Z",
    );
    expect(
      reminderIsCurrent(
        normal[0]!,
        { ...due, reminder_level: "HIGH" },
        policy.version,
      ),
    ).toBe(false);
    const moved = { ...due, due_at: "2026-09-23T12:00:00.000Z" };
    expect(reminderIsCurrent(normal[0]!, moved, policy.version)).toBe(false);
    expect(
      deriveReminderSchedule([moved], policy, window).map(
        (event) => event.logical_key,
      ),
    ).not.toContain(normal[0]!.logical_key);
    expect(due.status).toBe("INCOMPLETE");
  });

  it("handles occurrence continuation separately and gives start time one event", () => {
    const value = item({
      start_at: "2026-09-22T08:00:00.000Z",
      occurrence_start_at: "2026-09-22T12:00:00.000Z",
      occurrence_end_at: "2026-09-22T14:00:00.000Z",
    });
    const events = deriveReminderSchedule([value], policy, window);
    expect(
      events.filter((event) => event.rule_key === "start:once"),
    ).toHaveLength(1);
    expect(
      events.some((event) => event.rule_key === "occurrence:before:3600000"),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.rule_key === "occurrence:after:1" &&
          event.scheduled_for === "2026-09-22T22:00:00.000Z",
      ),
    ).toBe(true);
    expect(events.some((event) => event.rule_key.startsWith("due:"))).toBe(
      false,
    );
  });

  it("applies quiet hours, a daily bound, stale guard and logical delivery dedup", () => {
    const value = item({ due_at: "2026-09-22T03:00:00.000Z" });
    const limited = { ...policy, max_per_local_day: 1 };
    const quiet: ReminderWindow = {
      ...window,
      nextAllowedTime: (at) =>
        at.startsWith("2026-09-22T") && Number(at.slice(11, 13)) < 8
          ? "2026-09-22T08:00:00.000Z"
          : at,
    };
    const events = deriveReminderSchedule([value], limited, quiet);
    expect(
      events.filter(
        (event) => event.scheduled_for.slice(0, 10) === "2026-09-22",
      ),
    ).toHaveLength(1);
    const event = events[0]!;
    expect(event.scheduled_for).toBe("2026-09-22T08:00:00.000Z");
    expect(reminderIsCurrent(event, value, policy.version)).toBe(true);
    expect(reminderIsCurrent(event, value, "new-policy-version")).toBe(false);
    expect(
      reminderMayDeliver(
        event,
        { logicalDeliveredAt: null, lastItemDeliveredAt: null },
        "2026-09-22T08:00:00.000Z",
        limited,
      ),
    ).toBe(true);
    expect(
      reminderMayDeliver(
        event,
        {
          logicalDeliveredAt: "2026-09-22T08:00:00.000Z",
          lastItemDeliveredAt: null,
        },
        "2026-09-23T08:00:00.000Z",
        limited,
      ),
    ).toBe(false);
    expect(
      reminderMayDeliver(
        event,
        {
          logicalDeliveredAt: null,
          lastItemDeliveredAt: "2026-09-22T07:55:00.000Z",
        },
        "2026-09-22T08:00:00.000Z",
        limited,
      ),
    ).toBe(false);
  });
});

describe("createReminderWindow", () => {
  const timeZone = "Asia/Shanghai";

  it("is identity when no quiet hours are configured", () => {
    const identity = createReminderWindow({
      from: "2026-09-26T00:00:00.000Z",
      to: "2026-09-28T00:00:00.000Z",
      timeZone,
    });
    expect(identity.nextAllowedTime("2026-09-26T15:30:00.000Z")).toBe(
      "2026-09-26T15:30:00.000Z",
    );
    expect(identity.localDayKey("2026-09-26T16:00:00.000Z")).toBe("2026-09-27");
  });

  it("delays suppressed deliveries to the next allowed slot and never earlier", () => {
    const windowWithQuiet = createReminderWindow({
      from: "2026-09-26T00:00:00.000Z",
      to: "2026-09-28T00:00:00.000Z",
      timeZone,
      quietHours: { start: "23:00", end: "07:00" },
    });
    // 15:30Z = 23:30 in Shanghai, inside quiet hours.
    expect(windowWithQuiet.nextAllowedTime("2026-09-26T15:30:00.000Z")).toBe(
      "2026-09-26T23:00:00.000Z",
    );
    // 00:00Z = 08:00 in Shanghai, already allowed.
    expect(windowWithQuiet.nextAllowedTime("2026-09-26T00:00:00.000Z")).toBe(
      "2026-09-26T00:00:00.000Z",
    );
    // A delivery inside quiet hours is delayed, never pulled forward.
    expect(
      Date.parse(windowWithQuiet.nextAllowedTime("2026-09-26T15:30:00.000Z")),
    ).toBeGreaterThan(Date.parse("2026-09-26T15:30:00.000Z"));
  });
});
