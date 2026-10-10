import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import {
  ReminderCoordinator,
  type ReminderDeliveryPort,
  type ReminderPolicy,
  type ReminderWindow,
} from "@daymark/application";
import type { Item } from "@daymark/domain";
import { DaymarkDb, DexieLocalRepository } from "./index.js";

const hour = 60 * 60 * 1000;
// Test-only numbers. Production remains gated on R-01.
const policy: ReminderPolicy = {
  version: "test-v1",
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
  max_per_local_day: 20,
  dedup_window_ms: 10 * 60 * 1000,
};

const window: ReminderWindow = {
  from: "2026-09-22T09:00:00.000Z",
  to: "2026-09-23T09:00:00.000Z",
  nextAllowedTime: (instant) => instant,
  localDayKey: (instant) => instant.slice(0, 10),
};

function item(): Item {
  return {
    id: crypto.randomUUID(),
    owner_id: crypto.randomUUID(),
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
    due_at: "2026-09-22T12:00:00.000Z",
    due_date: null,
    time_zone: "UTC",
    reminder_level: "NORMAL",
    completed_at: null,
    raw_capture_id: null,
    created_at: "2026-09-22T08:00:00.000Z",
    updated_at: "2026-09-22T08:00:00.000Z",
    deleted_at: null,
    row_version: 1,
  };
}

it("persists derived schedules, cancels stale deliveries, and recovers across restart", async () => {
  const name = `reminders-${crypto.randomUUID()}`;
  let db = new DaymarkDb(name);
  let repo = new DexieLocalRepository(db);
  const value = item();
  const delivered: string[] = [];
  const canceled: string[] = [];
  const port: ReminderDeliveryPort = {
    claim: async () => true,
    deliver: async (event) => {
      delivered.push(event.logical_key);
    },
    cancel: async (key) => {
      canceled.push(key);
    },
  };
  try {
    await repo.putItem(value);
    let engine = new ReminderCoordinator(repo, port);
    await engine.reconcile([value], policy, window);
    const first = (await repo.listReminderRecords()).find(
      (record) => record.scheduled_for === "2026-09-22T10:00:00.000Z",
    )!;
    expect(first.state).toBe("PENDING");
    expect(await engine.deliverDue("2026-09-22T10:00:00.000Z", policy)).toBe(1);
    expect(delivered).toEqual([first.logical_key]);
    expect(await engine.deliverDue("2026-09-22T10:00:00.000Z", policy)).toBe(0);
    const opened = await engine.consume(first.logical_key);
    expect(opened?.id).toBe(value.id);
    expect(opened?.status).toBe("INCOMPLETE");
    expect(
      (await repo.listReminderRecords()).find(
        (record) => record.logical_key === first.logical_key,
      )?.state,
    ).toBe("CONSUMED");

    db.close();
    db = new DaymarkDb(name);
    repo = new DexieLocalRepository(db);
    engine = new ReminderCoordinator(repo, port);
    expect(
      (await repo.listReminderRecords()).find(
        (record) => record.logical_key === first.logical_key,
      )?.state,
    ).toBe("CONSUMED");
    const changed = {
      ...value,
      due_at: "2026-09-22T18:00:00.000Z",
      row_version: 2,
    };
    await repo.putItem(changed);
    await engine.reconcile([changed], policy, window);
    expect(canceled.length).toBeGreaterThan(0);
    expect(
      (await repo.listReminderRecords()).some(
        (record) =>
          record.state === "PENDING" &&
          record.rule_key === "due:before:7200000" &&
          record.scheduled_for === "2026-09-22T16:00:00.000Z",
      ),
    ).toBe(true);
    const completed = {
      ...changed,
      status: "COMPLETE" as const,
      row_version: 3,
    };
    await repo.putItem(completed);
    expect(await engine.deliverDue("2026-09-22T19:00:00.000Z", policy)).toBe(0);
    await engine.reconcile([completed], policy, window);
    expect(
      (await repo.listReminderRecords()).filter(
        (record) => record.state === "PENDING",
      ),
    ).toHaveLength(0);
  } finally {
    db.close();
    await db.delete();
  }
});
