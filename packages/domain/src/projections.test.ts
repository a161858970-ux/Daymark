import { describe, expect, it } from "vitest";
import {
  calendarItems,
  canonicalAssociationPair,
  overviewSortAt,
  projectItemToCalendar,
  sortOverview,
  visibleOverviewItems,
} from "./projections.js";
import type { Course, Item, Semester } from "./entities.js";

const item = (id: string, patch: Partial<Item> = {}): Item => ({
  id,
  owner_id: "owner",
  course_id: null,
  title: id,
  detail: null,
  status: "INCOMPLETE",
  start_at: null,
  occurrence_start_at: null,
  occurrence_end_at: null,
  due_at: null,
  reminder_level: "NORMAL",
  completed_at: null,
  raw_capture_id: null,
  created_at: "2026-09-21T00:00:00Z",
  updated_at: "2026-09-21T00:00:00Z",
  deleted_at: null,
  row_version: 1,
  ...patch,
});

describe("Item projections", () => {
  it("orders no-time items by creation time before timed items", () => {
    const items = [
      item("timed", { due_at: "2026-09-24T10:00:00Z" }),
      item("older", {
        created_at: "2026-09-20T00:00:00Z",
        updated_at: "2026-09-30T00:00:00Z",
      }),
      item("newer", { created_at: "2026-09-22T00:00:00Z" }),
    ];
    expect(
      sortOverview(items, "2026-09-22T00:00:00Z").map((value) => value.id),
    ).toEqual(["newer", "older", "timed"]);
  });

  it("keeps every incomplete Item before the completed section", () => {
    const values = [
      item("done-new", {
        status: "COMPLETE",
        completed_at: "2026-09-22T09:00:00Z",
      }),
      item("timed", { due_at: "2026-09-23T10:00:00Z" }),
      item("no-time"),
      item("done-old", {
        status: "COMPLETE",
        completed_at: "2026-09-22T08:00:00Z",
      }),
    ];
    expect(
      sortOverview(values, "2026-09-22T00:00:00Z").map((value) => value.id),
    ).toEqual(["no-time", "timed", "done-new", "done-old"]);
  });

  it("uses the earliest future time, or the most recent past time", () => {
    expect(
      overviewSortAt(
        item("a", {
          start_at: "2026-09-20T00:00:00Z",
          due_at: "2026-09-25T00:00:00Z",
        }),
        "2026-09-22T00:00:00Z",
      ),
    ).toBe("2026-09-25T00:00:00Z");
    expect(
      overviewSortAt(
        item("b", {
          start_at: "2026-09-20T00:00:00Z",
          due_at: "2026-09-21T00:00:00Z",
        }),
        "2026-09-22T00:00:00Z",
      ),
    ).toBe("2026-09-21T00:00:00Z");
  });

  it("projects one range Item, preferring occurrence over start/due", () => {
    const value = item("range", {
      start_at: "2026-09-20T00:00:00Z",
      due_at: "2026-10-05T00:00:00Z",
      occurrence_start_at: "2026-09-23T00:00:00Z",
      occurrence_end_at: "2026-09-27T00:00:00Z",
    });
    expect(projectItemToCalendar(value)).toEqual({
      item_id: "range",
      start: "2026-09-23T00:00:00Z",
      end: "2026-09-27T00:00:00Z",
      kind: "RANGE",
    });
    expect(
      calendarItems([value], "2026-09-25T00:00:00Z", "2026-09-25T23:59:59Z"),
    ).toHaveLength(1);
    expect(projectItemToCalendar(item("no-time"))).toBeNull();
  });

  it("keeps no-course and old unfinished Items, excluding old completed course Items", () => {
    const semesters: Semester[] = [
      {
        id: "old",
        owner_id: "owner",
        name: "old",
        start_date: "2026-01-01",
        end_date: "2026-06-30",
        created_at: "",
        updated_at: "",
        deleted_at: null,
        row_version: 1,
      },
      {
        id: "current",
        owner_id: "owner",
        name: "current",
        start_date: "2026-09-01",
        end_date: "2027-01-31",
        created_at: "",
        updated_at: "",
        deleted_at: null,
        row_version: 1,
      },
    ];
    const courses: Course[] = [
      {
        id: "old-course",
        owner_id: "owner",
        semester_id: "old",
        name: "Old",
        instructor: null,
        created_at: "",
        updated_at: "",
        deleted_at: null,
        row_version: 1,
      },
      {
        id: "current-course",
        owner_id: "owner",
        semester_id: "current",
        name: "Current",
        instructor: null,
        created_at: "",
        updated_at: "",
        deleted_at: null,
        row_version: 1,
      },
    ];
    const values = [
      item("free"),
      item("carry", { course_id: "old-course" }),
      item("old-done", { course_id: "old-course", status: "COMPLETE" }),
      item("now", { course_id: "current-course" }),
    ];
    expect(
      visibleOverviewItems(values, courses, semesters, "2026-09-22").map(
        (value) => value.id,
      ),
    ).toEqual(["free", "carry", "now"]);
  });

  it("canonicalizes symmetric associations", () => {
    expect(canonicalAssociationPair("b", "a")).toEqual(["a", "b"]);
    expect(() => canonicalAssociationPair("a", "a")).toThrow();
  });
});
