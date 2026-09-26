import type { QuietHours, ReminderPolicy } from "./reminders.js";

const minute = 60_000;
const hour = 60 * minute;

/**
 * R-01 — product reminder policy v1.
 *
 * Fixed by product decision; these are no longer placeholder numbers. The
 * object stays data-only so a later policy pass bumps `version` instead of
 * changing engine code, and every derived logical key carries the version.
 */
export const REMINDER_POLICY_V1: ReminderPolicy = {
  version: "r01-v1",
  levels: {
    NORMAL: {
      // due: 24h and 2h before
      due_leads_ms: [24 * hour, 2 * hour],
      // same-day cadence: every 6h while still on the due's local day
      due_same_day_interval_ms: 6 * hour,
      // occurrence: 30min before
      occurrence_leads_ms: [30 * minute],
      // overdue: every 24h while unfinished
      overdue_interval_ms: 24 * hour,
      // occurrence-after: 24h, then once a day
      occurrence_after_initial_ms: 24 * hour,
      occurrence_after_interval_ms: 24 * hour,
      // daily max: 3
      max_per_local_day: 3,
    },
    HIGH: {
      // due: 24h, 4h, 1h and 15min before
      due_leads_ms: [24 * hour, 4 * hour, 1 * hour, 15 * minute],
      // same-day cadence: every 3h
      due_same_day_interval_ms: 3 * hour,
      // occurrence: 1h and 15min before
      occurrence_leads_ms: [60 * minute, 15 * minute],
      // overdue: every 6h
      overdue_interval_ms: 6 * hour,
      // occurrence-after: 8h, then every 12h
      occurrence_after_initial_ms: 8 * hour,
      occurrence_after_interval_ms: 12 * hour,
      // daily max: 5
      max_per_local_day: 5,
    },
  },
  // start reminder fires exactly once, at the start time
  start_offset_ms: 0,
  // Ceiling used when a level does not carry its own budget.
  max_per_local_day: 5,
  // dedup window: 60 minutes
  dedup_window_ms: 60 * minute,
};

/** R-01 quiet hours; delivery is delayed into the window's end, never earlier. */
export const REMINDER_QUIET_HOURS_V1: QuietHours = {
  start: "23:00",
  end: "08:00",
};
