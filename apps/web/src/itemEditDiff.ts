import type { Item } from "@course-manager/domain";

/** The values the edit form holds, after input conversion. */
export interface ItemEditValues {
  title: string;
  detail: string | null;
  course_id: string | null;
  start_at: string | null;
  occurrence_start_at: string | null;
  occurrence_end_at: string | null;
  due_at: string | null;
  reminder_level: Item["reminder_level"];
}

const TIME_KEYS = new Set<string>([
  "start_at",
  "occurrence_start_at",
  "occurrence_end_at",
  "due_at",
]);

function sameValue(before: unknown, after: unknown): boolean {
  if (typeof before === "string" && typeof after === "string") {
    const left = Date.parse(before);
    const right = Date.parse(after);
    // A date-time can come back as `…Z` or `…+00:00` for the same instant.
    if (!Number.isNaN(left) && !Number.isNaN(right)) return left === right;
  }
  return before === after;
}

/**
 * Diff a submitted form against the item as it was when the form opened.
 *
 * The form renders every field, so submitting the whole form would report
 * untouched values as edits. That matters twice over:
 * - the server only merges two edits when their field sets are disjoint, so
 *   carried-over values manufacture conflicts (spec 14 §22.3);
 * - a pull that refreshed the row while the form was open would otherwise be
 *   written back as a stale edit.
 */
export function changedItemFields(
  initial: Item,
  next: ItemEditValues,
): Partial<ItemEditValues> {
  const entries = (Object.keys(next) as (keyof ItemEditValues)[]).filter(
    (key) => {
      const before = initial[key] ?? null;
      if (!TIME_KEYS.has(key)) return before !== next[key];
      return !sameValue(before, next[key]);
    },
  );
  return Object.fromEntries(
    entries.map((key) => [key, next[key]]),
  ) as Partial<ItemEditValues>;
}
