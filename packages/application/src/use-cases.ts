import type {
  Course,
  CourseInformation,
  CourseSchedule,
  Item,
  ItemAssociation,
  OutboxMutation,
  RawCapture,
  RawCaptureDecision,
  RawCaptureOutput,
  RawCaptureSource,
  Semester,
  SemesterWeek,
  SyncEntityType,
} from "@course-manager/domain";
import {
  projectItemToCalendar,
  semesterForDate,
  sortOverview,
  visibleOverviewItems,
} from "@course-manager/domain";
import { createItemSchema, updateItemSchema } from "@course-manager/contracts";
import {
  preprocessCapture,
  reminderLevelForCapture,
} from "./captureParsing.js";
import type { LocalRepository } from "./repository.js";

export interface Runtime {
  now(): string;
  id(): string;
}

export type ManualCaptureResolution =
  | ({ kind: "ITEM" } & Pick<
      Item,
      | "title"
      | "detail"
      | "course_id"
      | "start_at"
      | "occurrence_start_at"
      | "occurrence_end_at"
      | "due_at"
      | "reminder_level"
    >)
  | { kind: "COURSE_INFORMATION"; course_id: string; content: string };

const browserRuntime: Runtime = {
  now: () => new Date().toISOString(),
  id: () => crypto.randomUUID(),
};

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** ISO date-times arrive in different formats for the same instant. */
const TIME_FIELDS = new Set([
  "start_at",
  "due_at",
  "occurrence_start_at",
  "occurrence_end_at",
  "completed_at",
  "deleted_at",
]);

function fieldChanged(key: string, current: unknown, next: unknown): boolean {
  if (
    TIME_FIELDS.has(key) &&
    typeof current === "string" &&
    typeof next === "string"
  ) {
    const left = Date.parse(current);
    const right = Date.parse(next);
    if (!Number.isNaN(left) && !Number.isNaN(right)) return left !== right;
  }
  return current !== next;
}

export class CourseManager {
  constructor(
    private readonly repo: LocalRepository,
    private readonly runtime: Runtime = browserRuntime,
  ) {}

  private mutation(
    ownerId: string,
    entityType: SyncEntityType,
    entityId: string,
    operation: OutboxMutation["operation"],
    baseVersion: number | null,
    fields: Record<string, unknown>,
  ): OutboxMutation {
    return {
      mutation_id: this.runtime.id(),
      owner_id: ownerId,
      entity_type: entityType,
      entity_id: entityId,
      operation,
      base_version: baseVersion,
      changed_fields: fields,
      created_at: this.runtime.now(),
      attempt_count: 0,
      last_error: null,
      acked_at: null,
    };
  }

  async capture(
    rawText: string,
    source: RawCaptureSource = "QUICK_CAPTURE",
    contextCourseId: string | null = null,
  ): Promise<RawCapture> {
    if (!rawText.trim()) throw new Error("Record cannot be empty");
    const ownerId = await this.repo.ownerId();
    const capture: RawCapture = {
      id: this.runtime.id(),
      owner_id: ownerId,
      source,
      raw_text: rawText,
      captured_at: this.runtime.now(),
      processing_status: "RAW",
      unresolved_reason: null,
      deleted_at: null,
      row_version: 1,
    };
    await this.repo.transaction(async () => {
      await this.repo.putRawCapture(capture);
      await this.repo.putCaptureContext({
        raw_capture_id: capture.id,
        course_id: contextCourseId,
      });
      await this.repo.putOutbox(
        this.mutation(ownerId, "RAW_CAPTURE", capture.id, "CREATE", null, {
          ...capture,
        }),
      );
    });
    return capture;
  }

  /** Safe deterministic subset. All other input remains available for confirmation. */
  async processClearCapture(
    captureId: string,
    courseId: string | null = null,
  ): Promise<Item | CourseInformation | null> {
    const capture = await this.repo.getRawCapture(captureId);
    if (
      !capture ||
      capture.deleted_at ||
      capture.processing_status === "DELETED"
    )
      return null;
    const existing = await this.repo.listOutputs(captureId);
    if (existing.length) {
      const output = existing[0]!;
      return output.object_type === "ITEM"
        ? ((await this.repo.getItem(output.object_id)) ?? null)
        : ((await this.repo.getCourseInformation(output.object_id)) ?? null);
    }
    if (capture.processing_status === "UNRESOLVED") return null;
    const storedContext = await this.repo.getCaptureContext(captureId);
    const contextCourseId = courseId ?? storedContext?.course_id ?? null;
    const parsed = preprocessCapture({
      rawText: capture.raw_text,
      source: capture.source,
      contextCourseId,
      courses: (await this.repo.listCourses()).filter(
        (course) => course.owner_id === capture.owner_id,
      ),
    });
    const { resolvedCourseId, title } = parsed;
    if (parsed.classification === "COURSE_INFORMATION") {
      return this.createInformationOutput(capture, resolvedCourseId!, title);
    }
    if (parsed.classification === "UNRESOLVED") {
      const unresolvedReason = parsed.unresolvedReason!;
      await this.repo.transaction(async () => {
        if (resolvedCourseId) {
          await this.repo.putCaptureContext({
            raw_capture_id: capture.id,
            course_id: resolvedCourseId,
          });
        }
        await this.repo.putRawCapture({
          ...capture,
          processing_status: "UNRESOLVED",
          unresolved_reason: unresolvedReason,
          row_version: capture.row_version + 1,
        });
        await this.repo.putOutbox(
          this.mutation(
            capture.owner_id,
            "RAW_CAPTURE",
            capture.id,
            "UPDATE",
            capture.row_version,
            {
              processing_status: "UNRESOLVED",
              unresolved_reason: unresolvedReason,
            },
          ),
        );
      });
      return null;
    }
    if (resolvedCourseId) {
      const course = await this.repo.getCourse(resolvedCourseId);
      if (!course || course.deleted_at || course.owner_id !== capture.owner_id)
        throw new Error("Course context is unavailable");
    }
    const now = this.runtime.now();
    const item: Item = {
      id: this.runtime.id(),
      owner_id: capture.owner_id,
      course_id: resolvedCourseId,
      title,
      detail: null,
      status: "INCOMPLETE",
      start_at: null,
      occurrence_start_at: null,
      occurrence_end_at: null,
      due_at: null,
      reminder_level: reminderLevelForCapture(capture.raw_text),
      completed_at: null,
      raw_capture_id: capture.id,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      row_version: 1,
    };
    const output: RawCaptureOutput = {
      id: this.runtime.id(),
      owner_id: capture.owner_id,
      raw_capture_id: capture.id,
      object_type: "ITEM",
      object_id: item.id,
      created_at: now,
    };
    await this.repo.transaction(async () => {
      if ((await this.repo.listOutputs(captureId)).length) return;
      await this.repo.putItem(item);
      await this.repo.putOutput(output);
      await this.repo.putRawCapture({
        ...capture,
        processing_status: "RESOLVED",
        row_version: capture.row_version + 1,
      });
      await this.repo.putOutbox(
        this.mutation(capture.owner_id, "ITEM", item.id, "CREATE", null, {
          ...item,
        }),
      );
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "RAW_CAPTURE_OUTPUT",
          output.id,
          "CREATE",
          null,
          { ...output },
        ),
      );
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "RAW_CAPTURE",
          capture.id,
          "UPDATE",
          capture.row_version,
          { processing_status: "RESOLVED" },
        ),
      );
    });
    return item;
  }

  private async createInformationOutput(
    capture: RawCapture,
    courseId: string,
    content: string,
  ): Promise<CourseInformation> {
    const course = await this.repo.getCourse(courseId);
    if (!course || course.deleted_at || course.owner_id !== capture.owner_id)
      throw new Error("Course context is unavailable");
    const now = this.runtime.now();
    const value: CourseInformation = {
      id: this.runtime.id(),
      owner_id: capture.owner_id,
      course_id: courseId,
      content,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      row_version: 1,
    };
    const output: RawCaptureOutput = {
      id: this.runtime.id(),
      owner_id: capture.owner_id,
      raw_capture_id: capture.id,
      object_type: "COURSE_INFORMATION",
      object_id: value.id,
      created_at: now,
    };
    await this.repo.transaction(async () => {
      if ((await this.repo.listOutputs(capture.id)).length) return;
      await this.repo.putCourseInformation(value);
      await this.repo.putOutput(output);
      await this.repo.putRawCapture({
        ...capture,
        processing_status: "RESOLVED",
        unresolved_reason: null,
        row_version: capture.row_version + 1,
      });
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "COURSE_INFORMATION",
          value.id,
          "CREATE",
          null,
          {
            ...value,
          },
        ),
      );
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "RAW_CAPTURE_OUTPUT",
          output.id,
          "CREATE",
          null,
          {
            ...output,
          },
        ),
      );
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "RAW_CAPTURE",
          capture.id,
          "UPDATE",
          capture.row_version,
          {
            processing_status: "RESOLVED",
            unresolved_reason: null,
          },
        ),
      );
    });
    return value;
  }

  async resolveRawCapture(
    captureId: string,
    resolution: ManualCaptureResolution,
    decisionType: "KEEP_ONE" | null = null,
  ): Promise<Item | CourseInformation> {
    if (decisionType === "KEEP_ONE" && resolution.kind !== "ITEM")
      throw new Error("Keeping one record requires an Item");
    const capture = await this.repo.getRawCapture(captureId);
    if (
      !capture ||
      capture.deleted_at ||
      capture.processing_status === "DELETED"
    )
      throw new Error("Raw capture not found");
    if ((await this.repo.listOutputs(captureId)).length)
      throw new Error("Raw capture has already been resolved");
    const courseId = resolution.course_id;
    if (courseId) {
      const course = await this.repo.getCourse(courseId);
      if (!course || course.deleted_at || course.owner_id !== capture.owner_id)
        throw new Error("Course not found");
    } else if (resolution.kind === "COURSE_INFORMATION") {
      throw new Error("Course information needs a course");
    }
    const now = this.runtime.now();
    const decision: RawCaptureDecision = {
      id: this.runtime.id(),
      owner_id: capture.owner_id,
      raw_capture_id: capture.id,
      decision_type: decisionType ?? resolution.kind,
      decision_payload: { ...resolution },
      decided_at: now,
      device_id: await this.repo.deviceId(),
    };
    let object: Item | CourseInformation;
    if (resolution.kind === "ITEM") {
      const fields = createItemSchema.parse({
        title: resolution.title,
        detail: resolution.detail,
        course_id: resolution.course_id,
        status: "INCOMPLETE",
        start_at: resolution.start_at,
        occurrence_start_at: resolution.occurrence_start_at,
        occurrence_end_at: resolution.occurrence_end_at,
        due_at: resolution.due_at,
        reminder_level: resolution.reminder_level,
        raw_capture_id: capture.id,
      });
      object = {
        ...fields,
        id: this.runtime.id(),
        owner_id: capture.owner_id,
        completed_at: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        row_version: 1,
      };
    } else {
      const content = resolution.content.trim();
      if (!content) throw new Error("Course information cannot be empty");
      object = {
        id: this.runtime.id(),
        owner_id: capture.owner_id,
        course_id: resolution.course_id,
        content,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        row_version: 1,
      };
    }
    const output: RawCaptureOutput = {
      id: this.runtime.id(),
      owner_id: capture.owner_id,
      raw_capture_id: capture.id,
      object_type: resolution.kind,
      object_id: object.id,
      created_at: now,
    };
    await this.repo.transaction(async () => {
      if ((await this.repo.listOutputs(capture.id)).length)
        throw new Error("Raw capture has already been resolved");
      if (resolution.kind === "ITEM") await this.repo.putItem(object as Item);
      else await this.repo.putCourseInformation(object as CourseInformation);
      await this.repo.putOutput(output);
      await this.repo.putDecision(decision);
      await this.repo.putRawCapture({
        ...capture,
        processing_status: "RESOLVED",
        unresolved_reason: null,
        row_version: capture.row_version + 1,
      });
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          resolution.kind,
          object.id,
          "CREATE",
          null,
          {
            ...object,
          },
        ),
      );
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "RAW_CAPTURE_OUTPUT",
          output.id,
          "CREATE",
          null,
          {
            ...output,
          },
        ),
      );
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "RAW_CAPTURE_DECISION",
          decision.id,
          "CREATE",
          null,
          {
            ...decision,
          },
        ),
      );
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "RAW_CAPTURE",
          capture.id,
          "UPDATE",
          capture.row_version,
          {
            processing_status: "RESOLVED",
            unresolved_reason: null,
          },
        ),
      );
    });
    return object;
  }

  /** One explicit user decision creates several Items from the same RawCapture. */
  async resolveSplitCapture(
    captureId: string,
    resolutions: Extract<ManualCaptureResolution, { kind: "ITEM" }>[],
  ): Promise<Item[]> {
    if (resolutions.length < 2 || resolutions.length > 20)
      throw new Error("Split requires two to twenty Items");
    const capture = await this.repo.getRawCapture(captureId);
    if (
      !capture ||
      capture.deleted_at ||
      capture.processing_status === "DELETED"
    )
      throw new Error("Raw capture not found");
    const priorOutputs = await this.repo.listOutputs(captureId);
    const payload = { items: resolutions };
    if (priorOutputs.length) {
      const decisions = await this.repo.listDecisions(captureId);
      const split = decisions.find(
        (decision) => decision.decision_type === "SPLIT",
      );
      if (
        split &&
        JSON.stringify(split.decision_payload?.items) ===
          JSON.stringify(resolutions)
      ) {
        const outputIds = new Set(
          priorOutputs
            .filter((output) => output.object_type === "ITEM")
            .map((output) => output.object_id),
        );
        const orderedIds = Array.isArray(split.decision_payload?.item_ids)
          ? split.decision_payload.item_ids
          : priorOutputs.map((output) => output.object_id);
        if (
          orderedIds.length !== priorOutputs.length ||
          !orderedIds.every(
            (id): id is string => typeof id === "string" && outputIds.has(id),
          )
        )
          throw new Error("Split decision does not match its outputs");
        const existing = await Promise.all(
          orderedIds.map((id) => this.repo.getItem(id)),
        );
        if (existing.every((item): item is Item => Boolean(item)))
          return existing;
      }
      throw new Error("Raw capture has already been resolved");
    }
    for (const resolution of resolutions) {
      if (!resolution.course_id) continue;
      const course = await this.repo.getCourse(resolution.course_id);
      if (!course || course.deleted_at || course.owner_id !== capture.owner_id)
        throw new Error("Course not found");
    }
    const now = this.runtime.now();
    const items = resolutions.map((resolution): Item => {
      const fields = createItemSchema.parse({
        ...resolution,
        status: "INCOMPLETE",
        raw_capture_id: capture.id,
      });
      return {
        ...fields,
        id: this.runtime.id(),
        owner_id: capture.owner_id,
        completed_at: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        row_version: 1,
      };
    });
    const outputs: RawCaptureOutput[] = items.map((item) => ({
      id: this.runtime.id(),
      owner_id: capture.owner_id,
      raw_capture_id: capture.id,
      object_type: "ITEM",
      object_id: item.id,
      created_at: now,
    }));
    const decision: RawCaptureDecision = {
      id: this.runtime.id(),
      owner_id: capture.owner_id,
      raw_capture_id: capture.id,
      decision_type: "SPLIT",
      decision_payload: { ...payload, item_ids: items.map((item) => item.id) },
      decided_at: now,
      device_id: await this.repo.deviceId(),
    };
    await this.repo.transaction(async () => {
      if ((await this.repo.listOutputs(captureId)).length)
        throw new Error("Raw capture has already been resolved");
      for (const [index, item] of items.entries()) {
        const output = outputs[index]!;
        await this.repo.putItem(item);
        await this.repo.putOutput(output);
        await this.repo.putOutbox(
          this.mutation(capture.owner_id, "ITEM", item.id, "CREATE", null, {
            ...item,
          }),
        );
        await this.repo.putOutbox(
          this.mutation(
            capture.owner_id,
            "RAW_CAPTURE_OUTPUT",
            output.id,
            "CREATE",
            null,
            { ...output },
          ),
        );
      }
      await this.repo.putDecision(decision);
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "RAW_CAPTURE_DECISION",
          decision.id,
          "CREATE",
          null,
          { ...decision },
        ),
      );
      await this.repo.putRawCapture({
        ...capture,
        processing_status: "RESOLVED",
        unresolved_reason: null,
        row_version: capture.row_version + 1,
      });
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "RAW_CAPTURE",
          capture.id,
          "UPDATE",
          capture.row_version,
          {
            processing_status: "RESOLVED",
            unresolved_reason: null,
          },
        ),
      );
    });
    return items;
  }

  async recoverPendingCaptures(): Promise<void> {
    const pending = (await this.repo.listRawCaptures()).filter(
      (capture) =>
        capture.deleted_at === null &&
        (capture.processing_status === "RAW" ||
          capture.processing_status === "PROCESSING"),
    );
    for (const capture of pending) {
      try {
        await this.processClearCapture(capture.id);
      } catch {
        const latest = await this.repo.getRawCapture(capture.id);
        if (!latest || (await this.repo.listOutputs(capture.id)).length)
          continue;
        await this.repo.transaction(async () => {
          await this.repo.putRawCapture({
            ...latest,
            processing_status: "UNRESOLVED",
            unresolved_reason: "需要确认记录上下文",
            row_version: latest.row_version + 1,
          });
          await this.repo.putOutbox(
            this.mutation(
              latest.owner_id,
              "RAW_CAPTURE",
              latest.id,
              "UPDATE",
              latest.row_version,
              {
                processing_status: "UNRESOLVED",
                unresolved_reason: "需要确认记录上下文",
              },
            ),
          );
        });
      }
    }
  }

  async createSemester(
    name: string,
    startDate: string,
    endDate: string,
  ): Promise<Semester> {
    const cleanName = name.trim();
    if (
      !cleanName ||
      !validDateOnly(startDate) ||
      !validDateOnly(endDate) ||
      startDate > endDate
    )
      throw new Error("Invalid semester name or date range");
    const ownerId = await this.repo.ownerId();
    const now = this.runtime.now();
    const semester: Semester = {
      id: this.runtime.id(),
      owner_id: ownerId,
      name: cleanName,
      start_date: startDate,
      end_date: endDate,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      row_version: 1,
    };
    await this.repo.transaction(async () => {
      await this.repo.putSemester(semester);
      await this.repo.putOutbox(
        this.mutation(ownerId, "SEMESTER", semester.id, "CREATE", null, {
          ...semester,
        }),
      );
    });
    return semester;
  }

  async listSemesters(): Promise<Semester[]> {
    return (await this.repo.listSemesters())
      .filter((value) => value.deleted_at === null)
      .sort(
        (a, b) =>
          b.start_date.localeCompare(a.start_date) || b.id.localeCompare(a.id),
      );
  }

  async updateSemester(
    id: string,
    fields: Partial<Pick<Semester, "name" | "start_date" | "end_date">>,
  ): Promise<Semester> {
    const semester = await this.repo.getSemester(id);
    if (!semester || semester.deleted_at) throw new Error("Semester not found");
    if (!Object.keys(fields).length)
      throw new Error("No Semester fields changed");
    const next: Semester = {
      ...semester,
      ...fields,
      name: fields.name?.trim() ?? semester.name,
      updated_at: this.runtime.now(),
      row_version: semester.row_version + 1,
    };
    if (
      !next.name ||
      !validDateOnly(next.start_date) ||
      !validDateOnly(next.end_date) ||
      next.start_date > next.end_date
    )
      throw new Error("Invalid Semester");
    const changed = Object.fromEntries(
      Object.keys(fields).map((key) => [key, next[key as keyof Semester]]),
    );
    await this.repo.transaction(async () => {
      await this.repo.putSemester(next);
      await this.repo.putOutbox(
        this.mutation(
          semester.owner_id,
          "SEMESTER",
          semester.id,
          "UPDATE",
          semester.row_version,
          changed,
        ),
      );
    });
    return next;
  }

  async semesterWeeks(semesterId: string): Promise<SemesterWeek[]> {
    const semester = await this.repo.getSemester(semesterId);
    if (!semester || semester.deleted_at) throw new Error("Semester not found");
    return (await this.repo.listSemesterWeeks(semesterId)).sort(
      (a, b) => a.week_number - b.week_number,
    );
  }

  async replaceSemesterWeeks(
    semesterId: string,
    weeks: Pick<SemesterWeek, "week_number" | "start_date" | "end_date">[],
  ): Promise<SemesterWeek[]> {
    const semester = await this.repo.getSemester(semesterId);
    if (!semester || semester.deleted_at) throw new Error("Semester not found");
    const seen = new Set<number>();
    const sorted = [...weeks].sort((a, b) =>
      a.start_date.localeCompare(b.start_date),
    );
    for (let index = 0; index < sorted.length; index++) {
      const week = sorted[index]!;
      if (
        !Number.isSafeInteger(week.week_number) ||
        week.week_number < 1 ||
        seen.has(week.week_number) ||
        !validDateOnly(week.start_date) ||
        !validDateOnly(week.end_date) ||
        week.start_date > week.end_date ||
        week.start_date < semester.start_date ||
        week.end_date > semester.end_date ||
        (index > 0 && sorted[index - 1]!.end_date >= week.start_date)
      )
        throw new Error("Invalid semester week mapping");
      seen.add(week.week_number);
    }
    const old = await this.repo.listSemesterWeeks(semesterId);
    const result = sorted.map((week) => ({
      id: this.runtime.id(),
      owner_id: semester.owner_id,
      semester_id: semesterId,
      ...week,
    }));
    await this.repo.transaction(async () => {
      for (const week of old) {
        await this.repo.removeSemesterWeek(week.id);
      }
      for (const week of result) {
        await this.repo.putSemesterWeek(week);
      }
      await this.repo.putOutbox(
        this.mutation(
          semester.owner_id,
          "SEMESTER_WEEK_COLLECTION",
          semesterId,
          "UPDATE",
          (await this.repo.knownSyncVersion(
            "SEMESTER_WEEK_COLLECTION",
            semesterId,
          )) ?? 0,
          {
            previous_collection: old.map((week) => ({
              id: week.id,
              semester_id: week.semester_id,
              week_number: week.week_number,
              start_date: week.start_date,
              end_date: week.end_date,
            })),
            collection: result.map((week) => ({
              id: week.id,
              semester_id: week.semester_id,
              week_number: week.week_number,
              start_date: week.start_date,
              end_date: week.end_date,
            })),
          },
        ),
      );
    });
    return result;
  }

  async createCourse(
    name: string,
    semesterId?: string | null,
    today = this.runtime.now().slice(0, 10),
  ): Promise<Course> {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Course name cannot be empty");
    const ownerId = await this.repo.ownerId();
    const now = this.runtime.now();
    const resolvedSemesterId =
      semesterId === undefined
        ? (semesterForDate(today, await this.listSemesters())?.id ?? null)
        : semesterId;
    if (resolvedSemesterId) {
      const semester = await this.repo.getSemester(resolvedSemesterId);
      if (!semester || semester.deleted_at || semester.owner_id !== ownerId)
        throw new Error("Semester not found");
    }
    const course: Course = {
      id: this.runtime.id(),
      owner_id: ownerId,
      name: cleanName,
      semester_id: resolvedSemesterId,
      instructor: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      row_version: 1,
    };
    await this.repo.transaction(async () => {
      await this.repo.putCourse(course);
      await this.repo.putOutbox(
        this.mutation(ownerId, "COURSE", course.id, "CREATE", null, {
          ...course,
        }),
      );
    });
    return course;
  }

  async updateCourse(
    id: string,
    fields: Partial<Pick<Course, "name" | "semester_id" | "instructor">>,
  ): Promise<Course> {
    const course = await this.repo.getCourse(id);
    if (!course || course.deleted_at) throw new Error("Course not found");
    if (!Object.keys(fields).length)
      throw new Error("No Course fields changed");
    const next: Course = {
      ...course,
      ...fields,
      name: fields.name?.trim() ?? course.name,
      updated_at: this.runtime.now(),
      row_version: course.row_version + 1,
    };
    if (!next.name) throw new Error("Course name cannot be empty");
    if (next.semester_id) {
      const semester = await this.repo.getSemester(next.semester_id);
      if (
        !semester ||
        semester.deleted_at ||
        semester.owner_id !== course.owner_id
      )
        throw new Error("Semester not found");
    }
    const changed = Object.fromEntries(
      Object.keys(fields).map((key) => [key, next[key as keyof Course]]),
    );
    await this.repo.transaction(async () => {
      await this.repo.putCourse(next);
      await this.repo.putOutbox(
        this.mutation(
          course.owner_id,
          "COURSE",
          course.id,
          "UPDATE",
          course.row_version,
          changed,
        ),
      );
    });
    return next;
  }

  listCourses(): Promise<Course[]> {
    return this.repo
      .listCourses()
      .then((courses) =>
        courses.filter((course) => course.deleted_at === null),
      );
  }

  async deleteCourseWithStrategy(
    courseId: string,
    strategy: "DELETE_ASSOCIATED_ITEMS" | "UNLINK_ASSOCIATED_ITEMS",
    expectedItemIds: string[],
  ): Promise<{ course: Course; items: Item[] }> {
    const course = await this.repo.getCourse(courseId);
    const ownerId = await this.repo.ownerId();
    if (!course || course.deleted_at || course.owner_id !== ownerId)
      throw new Error("Course not found");
    const attached = (await this.repo.listItems())
      .filter(
        (item) =>
          item.owner_id === ownerId &&
          item.course_id === courseId &&
          item.deleted_at === null,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    if (
      attached.map((item) => item.id).join("|") !==
      [...expectedItemIds].sort().join("|")
    )
      throw new Error("Course items changed; review the deletion list");
    const now = this.runtime.now();
    const nextCourse = {
      ...course,
      deleted_at: now,
      updated_at: now,
      row_version: course.row_version + 1,
    };
    const items = attached.map((item) => ({
      ...item,
      ...(strategy === "DELETE_ASSOCIATED_ITEMS"
        ? { deleted_at: now }
        : { course_id: null }),
      updated_at: now,
      row_version: item.row_version + 1,
    }));
    await this.repo.transaction(async () => {
      for (const item of items) await this.repo.putItem(item);
      await this.repo.putCourse(nextCourse);
      await this.repo.putOutbox(
        this.mutation(
          ownerId,
          "COURSE",
          courseId,
          "DELETE",
          course.row_version,
          {
            strategy,
            deleted_at: now,
            item_versions: attached.map(({ id, row_version }) => ({
              id,
              row_version,
            })),
          },
        ),
      );
    });
    return { course: nextCourse, items };
  }

  async priorCourseCandidate(
    name: string,
    targetSemesterId: string | null,
  ): Promise<Course | null> {
    if (!targetSemesterId) return null;
    const target = await this.repo.getSemester(targetSemesterId);
    if (!target || target.deleted_at) throw new Error("Semester not found");
    const ownerId = await this.repo.ownerId();
    if (target.owner_id !== ownerId) throw new Error("Semester not found");
    const semesters = await this.listSemesters();
    const semesterById = new Map(
      semesters.map((semester) => [semester.id, semester]),
    );
    const candidates = (await this.listCourses()).filter(
      (course) =>
        course.owner_id === ownerId &&
        course.name === name.trim() &&
        course.semester_id !== null &&
        (semesterById.get(course.semester_id)?.end_date ?? "9999-12-31") <
          target.start_date,
    );
    candidates.sort((a, b) =>
      (semesterById.get(b.semester_id!)?.end_date ?? "").localeCompare(
        semesterById.get(a.semester_id!)?.end_date ?? "",
      ),
    );
    return candidates[0] ?? null;
  }

  /** Called only after the user confirms that the exact-name candidate is the same course. */
  async createCourseWithInheritance(
    name: string,
    semesterId: string,
    priorCourseId: string,
  ): Promise<Course> {
    const candidate = await this.priorCourseCandidate(name, semesterId);
    if (!candidate || candidate.id !== priorCourseId)
      throw new Error("No matching prior course candidate");
    const now = this.runtime.now();
    const course: Course = {
      id: this.runtime.id(),
      owner_id: candidate.owner_id,
      name: name.trim(),
      semester_id: semesterId,
      instructor: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      row_version: 1,
    };
    const inherited = (await this.repo.listCourseInformation(priorCourseId))
      .filter((value) => value.deleted_at === null)
      .map((value): CourseInformation => ({
        id: this.runtime.id(),
        owner_id: candidate.owner_id,
        course_id: course.id,
        content: value.content,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        row_version: 1,
      }));
    await this.repo.transaction(async () => {
      await this.repo.putCourse(course);
      await this.repo.putOutbox(
        this.mutation(course.owner_id, "COURSE", course.id, "CREATE", null, {
          ...course,
        }),
      );
      for (const value of inherited) {
        await this.repo.putCourseInformation(value);
        await this.repo.putOutbox(
          this.mutation(
            value.owner_id,
            "COURSE_INFORMATION",
            value.id,
            "CREATE",
            null,
            { ...value },
          ),
        );
      }
    });
    return course;
  }

  async courseSchedules(courseId: string): Promise<CourseSchedule[]> {
    const course = await this.repo.getCourse(courseId);
    if (!course || course.deleted_at) throw new Error("Course not found");
    return (await this.repo.listCourseSchedules(courseId))
      .filter((value) => value.deleted_at === null)
      .sort(
        (a, b) =>
          a.weekday - b.weekday ||
          // Undated rows (start_time null) sort after timed ones.
          (a.start_time ?? "99:99").localeCompare(b.start_time ?? "99:99"),
      );
  }

  /** Timetable facts stay attached to Course and never create Calendar Items. */
  async replaceCourseSchedules(
    courseId: string,
    schedules: Pick<
      CourseSchedule,
      | "weekday"
      | "start_time"
      | "end_time"
      | "week_start"
      | "week_end"
      | "classroom"
      | "stage_label"
    >[],
  ): Promise<CourseSchedule[]> {
    const course = await this.repo.getCourse(courseId);
    if (!course || course.deleted_at) throw new Error("Course not found");
    const ownerId = await this.repo.ownerId();
    if (course.owner_id !== ownerId) throw new Error("Course not found");
    const time = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
    for (const value of schedules) {
      const validWeek = (week: number | null) =>
        week === null || (Number.isSafeInteger(week) && week > 0);
      // Both times or neither; when present they must be valid HH:MM with
      // end strictly after start — mirrors the database CHECK.
      const timesValid =
        value.start_time === null && value.end_time === null
          ? true
          : value.start_time !== null &&
            value.end_time !== null &&
            time.test(value.start_time) &&
            time.test(value.end_time) &&
            value.start_time < value.end_time;
      if (
        !Number.isSafeInteger(value.weekday) ||
        value.weekday < 1 ||
        value.weekday > 7 ||
        !timesValid ||
        !validWeek(value.week_start) ||
        !validWeek(value.week_end) ||
        (value.week_start !== null &&
          value.week_end !== null &&
          value.week_start > value.week_end)
      )
        throw new Error("Invalid course schedule");
    }
    const now = this.runtime.now();
    const old = await this.courseSchedules(courseId);
    const created = schedules.map((value): CourseSchedule => ({
      id: this.runtime.id(),
      owner_id: ownerId,
      course_id: courseId,
      ...value,
      start_time:
        value.start_time === null
          ? null
          : value.start_time.length === 5
            ? `${value.start_time}:00`
            : value.start_time,
      end_time:
        value.end_time === null
          ? null
          : value.end_time.length === 5
            ? `${value.end_time}:00`
            : value.end_time,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      row_version: 1,
    }));
    await this.repo.transaction(async () => {
      for (const value of old) {
        await this.repo.putCourseSchedule({
          ...value,
          deleted_at: now,
          updated_at: now,
          row_version: value.row_version + 1,
        });
      }
      for (const value of created) {
        await this.repo.putCourseSchedule(value);
      }
      const snapshot = (value: CourseSchedule) => ({
        id: value.id,
        course_id: value.course_id,
        weekday: value.weekday,
        start_time: value.start_time,
        end_time: value.end_time,
        week_start: value.week_start,
        week_end: value.week_end,
        classroom: value.classroom,
        stage_label: value.stage_label,
        created_at: value.created_at,
        updated_at: value.updated_at,
      });
      await this.repo.putOutbox(
        this.mutation(
          ownerId,
          "COURSE_SCHEDULE_COLLECTION",
          courseId,
          "UPDATE",
          (await this.repo.knownSyncVersion(
            "COURSE_SCHEDULE_COLLECTION",
            courseId,
          )) ?? 0,
          {
            previous_collection: old.map(snapshot),
            collection: created.map(snapshot),
          },
        ),
      );
    });
    return created;
  }

  async courseInformation(courseId: string): Promise<CourseInformation[]> {
    const course = await this.repo.getCourse(courseId);
    if (!course || course.deleted_at) throw new Error("Course not found");
    return (await this.repo.listCourseInformation(courseId))
      .filter((value) => value.deleted_at === null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async allCourseInformation(): Promise<CourseInformation[]> {
    const courses = await this.listCourses();
    const values = await Promise.all(
      courses.map((course) => this.repo.listCourseInformation(course.id)),
    );
    return values
      .flat()
      .filter((value) => value.deleted_at === null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async addCourseInformation(
    courseId: string,
    content: string,
  ): Promise<CourseInformation> {
    const clean = content.trim();
    if (!clean) throw new Error("Course information cannot be empty");
    const course = await this.repo.getCourse(courseId);
    if (!course || course.deleted_at) throw new Error("Course not found");
    const now = this.runtime.now();
    const value: CourseInformation = {
      id: this.runtime.id(),
      owner_id: course.owner_id,
      course_id: courseId,
      content: clean,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      row_version: 1,
    };
    await this.repo.transaction(async () => {
      await this.repo.putCourseInformation(value);
      await this.repo.putOutbox(
        this.mutation(
          value.owner_id,
          "COURSE_INFORMATION",
          value.id,
          "CREATE",
          null,
          { ...value },
        ),
      );
    });
    return value;
  }

  async updateCourseInformation(
    id: string,
    content: string,
  ): Promise<CourseInformation> {
    const clean = content.trim();
    if (!clean) throw new Error("Course information cannot be empty");
    const value = await this.repo.getCourseInformation(id);
    if (!value || value.deleted_at)
      throw new Error("Course information not found");
    const next = {
      ...value,
      content: clean,
      updated_at: this.runtime.now(),
      row_version: value.row_version + 1,
    };
    await this.repo.transaction(async () => {
      await this.repo.putCourseInformation(next);
      await this.repo.putOutbox(
        this.mutation(
          value.owner_id,
          "COURSE_INFORMATION",
          value.id,
          "UPDATE",
          value.row_version,
          { content: clean },
        ),
      );
    });
    return next;
  }

  async deleteCourseInformation(id: string): Promise<void> {
    const value = await this.repo.getCourseInformation(id);
    if (!value || value.deleted_at)
      throw new Error("Course information not found");
    const now = this.runtime.now();
    await this.repo.transaction(async () => {
      await this.repo.putCourseInformation({
        ...value,
        deleted_at: now,
        updated_at: now,
        row_version: value.row_version + 1,
      });
      await this.repo.putOutbox(
        this.mutation(
          value.owner_id,
          "COURSE_INFORMATION",
          value.id,
          "DELETE",
          value.row_version,
          { deleted_at: now },
        ),
      );
    });
  }

  getItem(itemId: string): Promise<Item | undefined> {
    return this.repo.getItem(itemId);
  }

  async listItems(): Promise<Item[]> {
    return (await this.repo.listItems()).filter(
      (item) => item.deleted_at === null,
    );
  }

  async itemAssociations(itemId: string): Promise<ItemAssociation[]> {
    const item = await this.repo.getItem(itemId);
    if (!item || item.deleted_at) throw new Error("Item not found");
    return (await this.repo.listItemAssociations(itemId)).filter(
      (value) => value.deleted_at === null,
    );
  }

  async associateItems(
    itemId: string,
    associatedItemId: string,
  ): Promise<ItemAssociation> {
    if (itemId === associatedItemId)
      throw new Error("An Item cannot be associated with itself");
    const [first, second] = await Promise.all([
      this.repo.getItem(itemId),
      this.repo.getItem(associatedItemId),
    ]);
    if (
      !first ||
      !second ||
      first.deleted_at ||
      second.deleted_at ||
      first.owner_id !== second.owner_id
    )
      throw new Error("Item not found");
    const [itemA, itemB] = [itemId, associatedItemId].sort();
    const existing = (await this.repo.listItemAssociations(itemId)).find(
      (value) =>
        value.deleted_at === null &&
        value.item_id_a === itemA &&
        value.item_id_b === itemB,
    );
    if (existing) return existing;
    const now = this.runtime.now();
    const association: ItemAssociation = {
      id: this.runtime.id(),
      owner_id: first.owner_id,
      item_id_a: itemA!,
      item_id_b: itemB!,
      created_at: now,
      deleted_at: null,
      row_version: 1,
    };
    await this.repo.transaction(async () => {
      await this.repo.putItemAssociation(association);
      await this.repo.putOutbox(
        this.mutation(
          association.owner_id,
          "ITEM_ASSOCIATION",
          association.id,
          "CREATE",
          null,
          {
            item_id_a: association.item_id_a,
            item_id_b: association.item_id_b,
            created_at: association.created_at,
          },
        ),
      );
    });
    return association;
  }

  async deleteItemAssociation(id: string): Promise<void> {
    const association = await this.repo.getItemAssociation(id);
    if (!association || association.deleted_at)
      throw new Error("Item association not found");
    const now = this.runtime.now();
    await this.repo.transaction(async () => {
      await this.repo.putItemAssociation({
        ...association,
        deleted_at: now,
        row_version: association.row_version + 1,
      });
      await this.repo.putOutbox(
        this.mutation(
          association.owner_id,
          "ITEM_ASSOCIATION",
          association.id,
          "DELETE",
          association.row_version,
          { deleted_at: now },
        ),
      );
    });
  }

  async rawCaptureForItem(itemId: string): Promise<RawCapture | undefined> {
    const item = await this.repo.getItem(itemId);
    return item?.raw_capture_id
      ? this.repo.getRawCapture(item.raw_capture_id)
      : undefined;
  }

  async unresolvedCaptures(): Promise<RawCapture[]> {
    return (await this.repo.listRawCaptures()).filter(
      (capture) =>
        capture.deleted_at === null &&
        capture.processing_status === "UNRESOLVED",
    );
  }

  async courseContextForCapture(captureId: string): Promise<string | null> {
    return (await this.repo.getCaptureContext(captureId))?.course_id ?? null;
  }

  async deferRawCapture(captureId: string): Promise<void> {
    const capture = await this.repo.getRawCapture(captureId);
    if (
      !capture ||
      capture.deleted_at ||
      capture.processing_status !== "UNRESOLVED"
    )
      throw new Error("Unresolved record not found");
    const decision: RawCaptureDecision = {
      id: this.runtime.id(),
      owner_id: capture.owner_id,
      raw_capture_id: captureId,
      decision_type: "DEFER",
      decision_payload: null,
      decided_at: this.runtime.now(),
      device_id: await this.repo.deviceId(),
    };
    await this.repo.transaction(async () => {
      await this.repo.putDecision(decision);
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "RAW_CAPTURE_DECISION",
          decision.id,
          "CREATE",
          null,
          {
            ...decision,
          },
        ),
      );
    });
  }

  async deleteUnresolvedCapture(captureId: string): Promise<void> {
    const capture = await this.repo.getRawCapture(captureId);
    if (
      !capture ||
      capture.processing_status !== "UNRESOLVED" ||
      capture.deleted_at
    )
      throw new Error("Unresolved record not found");
    const now = this.runtime.now();
    await this.repo.transaction(async () => {
      await this.repo.putRawCapture({
        ...capture,
        processing_status: "DELETED",
        deleted_at: now,
        row_version: capture.row_version + 1,
      });
      await this.repo.putOutbox(
        this.mutation(
          capture.owner_id,
          "RAW_CAPTURE",
          capture.id,
          "DELETE",
          capture.row_version,
          { deleted_at: now, processing_status: "DELETED" },
        ),
      );
    });
  }

  async overview(
    today: string,
    now: string,
    selectedSemesterId?: string,
  ): Promise<Item[]> {
    const [items, courses, semesters] = await Promise.all([
      this.repo.listItems(),
      this.repo.listCourses(),
      this.repo.listSemesters(),
    ]);
    return sortOverview(
      visibleOverviewItems(
        items,
        courses,
        semesters,
        today,
        selectedSemesterId,
      ),
      now,
    );
  }

  async calendarItems(): Promise<Item[]> {
    return (await this.repo.listItems()).filter(
      (item) => projectItemToCalendar(item) !== null,
    );
  }

  async courseItems(courseId: string, now: string): Promise<Item[]> {
    return sortOverview(
      (await this.repo.listItems()).filter(
        (item) => item.course_id === courseId,
      ),
      now,
    );
  }

  async updateItem(
    itemId: string,
    fields: Partial<
      Pick<
        Item,
        | "title"
        | "detail"
        | "course_id"
        | "start_at"
        | "occurrence_start_at"
        | "occurrence_end_at"
        | "due_at"
        | "reminder_level"
      >
    >,
  ): Promise<Item> {
    const validated = updateItemSchema.parse(fields);
    const item = await this.repo.getItem(itemId);
    if (!item || item.deleted_at) throw new Error("Item not found");
    if (validated.course_id) {
      const course = await this.repo.getCourse(validated.course_id);
      if (!course || course.deleted_at || course.owner_id !== item.owner_id)
        throw new Error("Course not found");
    }
    // Out-of-sync field sets decide whether the server can merge two edits.
    // The edit form submits every field it renders, so sending that whole
    // snapshot would report untouched values as changes and turn disjoint
    // edits into a false conflict (spec 14 §22.3 and 17: non-overlapping
    // edits must merge automatically). Queue only what actually changed.
    const changes = Object.fromEntries(
      Object.entries(validated).filter(([key, value]) => {
        if (value === undefined) return false;
        return fieldChanged(key, item[key as keyof Item], value);
      }),
    ) as typeof validated;
    if (Object.keys(changes).length === 0) return item;
    const now = this.runtime.now();
    const next = {
      ...item,
      ...changes,
      updated_at: now,
      row_version: item.row_version + 1,
    } as Item;
    if (
      next.occurrence_start_at &&
      next.occurrence_end_at &&
      next.occurrence_start_at > next.occurrence_end_at
    )
      throw new Error("Occurrence end must not precede start");
    await this.repo.transaction(async () => {
      await this.repo.putItem(next);
      await this.repo.putOutbox(
        this.mutation(
          item.owner_id,
          "ITEM",
          item.id,
          "UPDATE",
          item.row_version,
          changes,
        ),
      );
    });
    return next;
  }

  async completeItem(itemId: string): Promise<Item> {
    const item = await this.repo.getItem(itemId);
    if (!item || item.deleted_at) throw new Error("Item not found");
    if (item.status === "COMPLETE") return item;
    const now = this.runtime.now();
    const next: Item = {
      ...item,
      status: "COMPLETE",
      completed_at: now,
      updated_at: now,
      row_version: item.row_version + 1,
    };
    await this.repo.transaction(async () => {
      await this.repo.putItem(next);
      await this.repo.putOutbox(
        this.mutation(
          item.owner_id,
          "ITEM",
          item.id,
          "UPDATE",
          item.row_version,
          { status: "COMPLETE", completed_at: now },
        ),
      );
    });
    return next;
  }

  async restoreItem(itemId: string): Promise<Item> {
    const item = await this.repo.getItem(itemId);
    if (!item || item.deleted_at) throw new Error("Item not found");
    if (item.status === "INCOMPLETE") return item;
    const now = this.runtime.now();
    const next: Item = {
      ...item,
      status: "INCOMPLETE",
      completed_at: null,
      updated_at: now,
      row_version: item.row_version + 1,
    };
    await this.repo.transaction(async () => {
      await this.repo.putItem(next);
      await this.repo.putOutbox(
        this.mutation(
          item.owner_id,
          "ITEM",
          item.id,
          "UPDATE",
          item.row_version,
          { status: "INCOMPLETE", completed_at: null },
        ),
      );
    });
    return next;
  }

  async deleteItem(
    itemId: string,
  ): Promise<{ item: Item; token: string; expiresAt: string }> {
    const item = await this.repo.getItem(itemId);
    if (!item || item.deleted_at) throw new Error("Item not found");
    const now = this.runtime.now();
    const token = this.runtime.id();
    const expiresAt = new Date(Date.parse(now) + 10_000).toISOString();
    const next: Item = {
      ...item,
      deleted_at: now,
      updated_at: now,
      row_version: item.row_version + 1,
    };
    await this.repo.transaction(async () => {
      await this.repo.putItem(next);
      await this.repo.putDeleteUndo({
        item_id: item.id,
        token,
        expires_at: expiresAt,
      });
      await this.repo.putOutbox(
        this.mutation(
          item.owner_id,
          "ITEM",
          item.id,
          "DELETE",
          item.row_version,
          { deleted_at: now, undo_token: token },
        ),
      );
    });
    return { item: next, token, expiresAt };
  }

  async undoDelete(itemId: string, token: string): Promise<Item> {
    const [item, record] = await Promise.all([
      this.repo.getItem(itemId),
      this.repo.getDeleteUndo(itemId),
    ]);
    if (
      !item?.deleted_at ||
      !record ||
      record.token !== token ||
      record.expires_at < this.runtime.now()
    )
      throw new Error("Delete Undo has expired");
    const now = this.runtime.now();
    const next: Item = {
      ...item,
      deleted_at: null,
      updated_at: now,
      row_version: item.row_version + 1,
    };
    await this.repo.transaction(async () => {
      await this.repo.putItem(next);
      await this.repo.removeDeleteUndo(itemId);
      await this.repo.putOutbox(
        this.mutation(
          item.owner_id,
          "ITEM",
          item.id,
          "UPDATE",
          item.row_version,
          { deleted_at: null, undo_token: token },
        ),
      );
    });
    return next;
  }
}
