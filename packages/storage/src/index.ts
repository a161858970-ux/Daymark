import Dexie, { type Table } from "dexie";
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
  Semester,
  SemesterWeek,
  SyncConflict,
  SyncEntityType,
  SyncRepairDecision,
} from "@course-manager/domain";
import type {
  CaptureContext,
  DeleteUndoRecord,
  LocalRepository,
  RemoteChange,
  LocalReminderRecord,
  ReminderRepository,
  ActionRequiredSyncIssue,
  SyncRepository,
} from "@course-manager/application";

type Setting = { key: string; value: string };
type StoredMutation = OutboxMutation & { local_sequence?: number };

type LegacyCollectionRowType = "SEMESTER_WEEK" | "COURSE_SCHEDULE";
type CollectionCommandType =
  "SEMESTER_WEEK_COLLECTION" | "COURSE_SCHEDULE_COLLECTION";

function textField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}

function semesterWeekSnapshot(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  const id = textField(value, "id");
  const semesterId = textField(value, "semester_id");
  const startDate = textField(value, "start_date");
  const endDate = textField(value, "end_date");
  const weekNumber = value.week_number;
  if (
    !id ||
    !semesterId ||
    !startDate ||
    !endDate ||
    !Number.isSafeInteger(weekNumber)
  )
    return null;
  return {
    id,
    semester_id: semesterId,
    week_number: weekNumber,
    start_date: startDate,
    end_date: endDate,
  };
}

function courseScheduleSnapshot(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  const id = textField(value, "id");
  const courseId = textField(value, "course_id");
  const startTime = textField(value, "start_time");
  const endTime = textField(value, "end_time");
  const createdAt = textField(value, "created_at");
  const updatedAt = textField(value, "updated_at");
  // Times may be absent together (periods-only timetable); one without the
  // other is an invalid row and is dropped, as before.
  const bothTimes = (startTime === null) === (endTime === null);
  if (
    !id ||
    !courseId ||
    !bothTimes ||
    !createdAt ||
    !updatedAt ||
    !Number.isSafeInteger(value.weekday)
  )
    return null;
  return {
    id,
    course_id: courseId,
    weekday: value.weekday,
    start_time: startTime,
    end_time: endTime,
    week_start: value.week_start ?? null,
    week_end: value.week_end ?? null,
    classroom: value.classroom ?? null,
    stage_label: value.stage_label ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function mutationOrder(a: StoredMutation, b: StoredMutation): number {
  return (
    (a.local_sequence ?? Number.MAX_SAFE_INTEGER) -
      (b.local_sequence ?? Number.MAX_SAFE_INTEGER) ||
    a.created_at.localeCompare(b.created_at) ||
    a.mutation_id.localeCompare(b.mutation_id)
  );
}

export class OwnerBindingError extends Error {}

export class CourseManagerDb extends Dexie {
  semesters!: Table<Semester, string>;
  semester_weeks!: Table<SemesterWeek, string>;
  courses!: Table<Course, string>;
  course_schedules!: Table<CourseSchedule, string>;
  course_information!: Table<CourseInformation, string>;
  items!: Table<Item, string>;
  item_associations!: Table<ItemAssociation, string>;
  raw_captures!: Table<RawCapture, string>;
  raw_capture_outputs!: Table<RawCaptureOutput, string>;
  raw_capture_decisions!: Table<RawCaptureDecision, string>;
  capture_contexts!: Table<CaptureContext, string>;
  outbox_mutations!: Table<StoredMutation, string>;
  sync_conflicts!: Table<SyncConflict, string>;
  sync_repair_decisions!: Table<SyncRepairDecision, string>;
  delete_undos!: Table<DeleteUndoRecord, string>;
  local_notification_schedule!: Table<LocalReminderRecord, string>;
  settings!: Table<Setting, string>;

  constructor(name = "course-manager") {
    super(name);
    this.version(1).stores({
      semesters: "id, owner_id, [owner_id+start_date], deleted_at",
      semester_weeks: "id, semester_id, [semester_id+week_number]",
      courses: "id, owner_id, semester_id, [owner_id+name], deleted_at",
      course_schedules: "id, course_id, deleted_at",
      course_information: "id, owner_id, course_id, deleted_at",
      items:
        "id, owner_id, course_id, status, created_at, due_at, occurrence_start_at, start_at, deleted_at",
      item_associations: "id, owner_id, item_id_a, item_id_b, deleted_at",
      raw_captures: "id, owner_id, processing_status, captured_at, deleted_at",
      raw_capture_outputs:
        "id, owner_id, raw_capture_id, [raw_capture_id+object_type+object_id]",
      raw_capture_decisions: "id, raw_capture_id, decided_at",
      outbox_mutations: "mutation_id, owner_id, created_at, acked_at",
      sync_conflicts: "id, owner_id, status",
      delete_undos: "item_id, expires_at",
      settings: "key",
    });
    this.version(2).stores({
      capture_contexts: "raw_capture_id, course_id",
    });
    this.version(3)
      .stores({
        outbox_mutations:
          "mutation_id, owner_id, local_sequence, created_at, acked_at",
      })
      .upgrade(async (tx) => {
        const table = tx.table<StoredMutation, string>("outbox_mutations");
        const old = await table.toArray();
        const rank = (value: StoredMutation) => {
          if (value.operation !== "CREATE")
            return 100 + (value.base_version ?? 0);
          return (
            (
              {
                SEMESTER: 0,
                COURSE: 1,
                RAW_CAPTURE: 2,
                ITEM: 3,
                COURSE_INFORMATION: 4,
                RAW_CAPTURE_OUTPUT: 5,
                RAW_CAPTURE_DECISION: 6,
              } as Record<string, number>
            )[value.entity_type] ?? 20
          );
        };
        old.sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) ||
            rank(a) - rank(b) ||
            a.mutation_id.localeCompare(b.mutation_id),
        );
        for (let index = 0; index < old.length; index++)
          await table.put({ ...old[index]!, local_sequence: index + 1 });
        await tx
          .table<Setting, string>("settings")
          .put({ key: "outbox_next_sequence", value: String(old.length + 1) });
      });
    this.version(4).stores({
      local_notification_schedule: "logical_key, item_id, state, scheduled_for",
    });
    this.version(5).stores({
      sync_repair_decisions: "id, owner_id, mutation_id, decided_at",
    });
    this.version(6)
      .stores({})
      .upgrade(async (tx) => {
        const outbox = tx.table<StoredMutation, string>("outbox_mutations");
        const settings = tx.table<Setting, string>("settings");
        const allMutations = await outbox.toArray();
        const pendingLegacy = allMutations
          .filter(
            (value) =>
              value.acked_at === null &&
              (value.entity_type === "SEMESTER_WEEK" ||
                value.entity_type === "COURSE_SCHEDULE"),
          )
          .sort(mutationOrder);
        if (!pendingLegacy.length) return;

        const weekRows = await tx
          .table<SemesterWeek, string>("semester_weeks")
          .toArray();
        const scheduleRows = await tx
          .table<CourseSchedule, string>("course_schedules")
          .toArray();
        const parentByObject = new Map<string, string>();
        const snapshotByObject = new Map<string, Record<string, unknown>>();
        const objectKey = (type: LegacyCollectionRowType, id: string) =>
          `${type}:${id}`;

        for (const row of weekRows) {
          const key = objectKey("SEMESTER_WEEK", row.id);
          parentByObject.set(key, row.semester_id);
          snapshotByObject.set(
            key,
            semesterWeekSnapshot(row as unknown as Record<string, unknown>)!,
          );
        }
        for (const row of scheduleRows) {
          const key = objectKey("COURSE_SCHEDULE", row.id);
          parentByObject.set(key, row.course_id);
          snapshotByObject.set(
            key,
            courseScheduleSnapshot(row as unknown as Record<string, unknown>)!,
          );
        }
        for (const mutation of [...allMutations].sort(mutationOrder)) {
          if (
            mutation.entity_type !== "SEMESTER_WEEK" &&
            mutation.entity_type !== "COURSE_SCHEDULE"
          )
            continue;
          const key = objectKey(mutation.entity_type, mutation.entity_id);
          const snapshot =
            mutation.entity_type === "SEMESTER_WEEK"
              ? semesterWeekSnapshot(mutation.changed_fields)
              : courseScheduleSnapshot(mutation.changed_fields);
          if (snapshot) {
            snapshotByObject.set(key, snapshot);
            const parent = textField(
              snapshot,
              mutation.entity_type === "SEMESTER_WEEK"
                ? "semester_id"
                : "course_id",
            );
            if (parent) parentByObject.set(key, parent);
          }
        }

        // Legacy replacement wrote all member mutations in one transaction. A
        // delete may only contain its ID, so use the unique parent carried by
        // another member from that same timestamp when history cannot identify it.
        const batchParents = new Map<string, Set<string>>();
        for (const mutation of pendingLegacy) {
          const rowType = mutation.entity_type as LegacyCollectionRowType;
          const parent = parentByObject.get(
            objectKey(rowType, mutation.entity_id),
          );
          if (!parent) continue;
          const batchKey = `${mutation.owner_id}:${rowType}:${mutation.created_at}`;
          const parents = batchParents.get(batchKey) ?? new Set<string>();
          parents.add(parent);
          batchParents.set(batchKey, parents);
        }

        const groups = new Map<
          string,
          {
            ownerId: string;
            rowType: LegacyCollectionRowType;
            commandType: CollectionCommandType;
            parentId: string;
            mutations: StoredMutation[];
          }
        >();
        const unresolved: StoredMutation[] = [];
        for (const mutation of pendingLegacy) {
          const rowType = mutation.entity_type as LegacyCollectionRowType;
          const key = objectKey(rowType, mutation.entity_id);
          let parentId = parentByObject.get(key);
          if (!parentId) {
            const parents = batchParents.get(
              `${mutation.owner_id}:${rowType}:${mutation.created_at}`,
            );
            if (parents?.size === 1) parentId = [...parents][0];
          }
          if (!parentId) {
            unresolved.push(mutation);
            continue;
          }
          const commandType: CollectionCommandType =
            rowType === "SEMESTER_WEEK"
              ? "SEMESTER_WEEK_COLLECTION"
              : "COURSE_SCHEDULE_COLLECTION";
          const groupKey = `${mutation.owner_id}:${commandType}:${parentId}`;
          const group = groups.get(groupKey) ?? {
            ownerId: mutation.owner_id,
            rowType,
            commandType,
            parentId,
            mutations: [],
          };
          group.mutations.push(mutation);
          groups.set(groupKey, group);
        }

        const migratedAt = new Date().toISOString();
        for (const mutation of unresolved) {
          await outbox.update(mutation.mutation_id, {
            last_error:
              "VALIDATION_ERROR: Legacy collection change needs review; open the parent and save the collection again before syncing",
          });
          await settings.put({
            key: `legacy_collection_migration_required:${mutation.entity_type}:${mutation.entity_id}`,
            value: mutation.mutation_id,
          });
        }

        for (const group of groups.values()) {
          group.mutations.sort(mutationOrder);
          const desired = (
            group.rowType === "SEMESTER_WEEK"
              ? weekRows
                  .filter((row) => row.semester_id === group.parentId)
                  .map((row) =>
                    semesterWeekSnapshot(
                      row as unknown as Record<string, unknown>,
                    ),
                  )
              : scheduleRows
                  .filter(
                    (row) =>
                      row.course_id === group.parentId &&
                      row.deleted_at === null,
                  )
                  .map((row) =>
                    courseScheduleSnapshot(
                      row as unknown as Record<string, unknown>,
                    ),
                  )
          ).filter((value): value is Record<string, unknown> => value !== null);
          const before = new Map(
            desired.map((value) => [String(value.id), value]),
          );
          let completePreviousSnapshot = true;
          for (const mutation of [...group.mutations].reverse()) {
            if (mutation.operation === "CREATE") {
              before.delete(mutation.entity_id);
              continue;
            }
            if (mutation.operation === "DELETE") {
              const snapshot = snapshotByObject.get(
                objectKey(group.rowType, mutation.entity_id),
              );
              if (snapshot) before.set(mutation.entity_id, snapshot);
              else completePreviousSnapshot = false;
            }
          }
          // An empty previous snapshot is deliberately conservative. It either
          // applies to an empty remote collection or produces a collection
          // conflict; it can never expose a partially replayed replacement.
          const previous = completePreviousSnapshot ? [...before.values()] : [];
          const commandId = crypto.randomUUID();
          const first = group.mutations[0]!;
          const version = await settings.get(
            `sync_version:${group.commandType}:${group.parentId}`,
          );
          await outbox.put({
            mutation_id: commandId,
            owner_id: group.ownerId,
            entity_type: group.commandType,
            entity_id: group.parentId,
            operation: "UPDATE",
            base_version: version ? Number(version.value) : 0,
            changed_fields: {
              previous_collection: previous,
              collection: desired,
            },
            created_at: first.created_at,
            attempt_count: 0,
            last_error: null,
            acked_at: null,
            ...(first.local_sequence === undefined
              ? {}
              : { local_sequence: first.local_sequence }),
          });
          for (const mutation of group.mutations)
            await outbox.update(mutation.mutation_id, {
              acked_at: migratedAt,
              last_error: `SUPERSEDED_BY_COLLECTION:${commandId}`,
            });
          if (!completePreviousSnapshot)
            await settings.put({
              key: `legacy_collection_snapshot_fallback:${group.commandType}:${group.parentId}`,
              value: commandId,
            });
        }
      });
  }
}

export class DexieLocalRepository
  implements LocalRepository, SyncRepository, ReminderRepository
{
  constructor(readonly db: CourseManagerDb = new CourseManagerDb()) {}

  transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.db.transaction(
      "rw",
      [
        this.db.semesters,
        this.db.semester_weeks,
        this.db.courses,
        this.db.course_schedules,
        this.db.course_information,
        this.db.items,
        this.db.item_associations,
        this.db.raw_captures,
        this.db.raw_capture_outputs,
        this.db.raw_capture_decisions,
        this.db.capture_contexts,
        this.db.outbox_mutations,
        this.db.sync_conflicts,
        this.db.sync_repair_decisions,
        this.db.delete_undos,
        this.db.local_notification_schedule,
        this.db.settings,
      ],
      work,
    );
  }

  async ownerId(): Promise<string> {
    const existing = await this.db.settings.get("local_owner_id");
    if (existing) return existing.value;
    const id = crypto.randomUUID();
    await this.db.settings.add({ key: "local_owner_id", value: id });
    return id;
  }

  async deviceId(): Promise<string> {
    const existing = await this.db.settings.get("local_device_id");
    if (existing) return existing.value;
    const id = crypto.randomUUID();
    await this.db.settings.add({ key: "local_device_id", value: id });
    return id;
  }

  getRawCapture(id: string): Promise<RawCapture | undefined> {
    return this.db.raw_captures.get(id);
  }
  listRawCaptures(): Promise<RawCapture[]> {
    return this.db.raw_captures.toArray();
  }
  async putRawCapture(value: RawCapture): Promise<void> {
    await this.db.raw_captures.put(value);
  }
  getCaptureContext(rawCaptureId: string): Promise<CaptureContext | undefined> {
    return this.db.capture_contexts.get(rawCaptureId);
  }
  async putCaptureContext(value: CaptureContext): Promise<void> {
    await this.db.capture_contexts.put(value);
  }
  listOutputs(rawCaptureId: string): Promise<RawCaptureOutput[]> {
    return this.db.raw_capture_outputs
      .where("raw_capture_id")
      .equals(rawCaptureId)
      .toArray();
  }
  async putOutput(value: RawCaptureOutput): Promise<void> {
    await this.db.raw_capture_outputs.put(value);
  }
  async putDecision(value: RawCaptureDecision): Promise<void> {
    await this.db.raw_capture_decisions.put(value);
  }
  listDecisions(rawCaptureId: string): Promise<RawCaptureDecision[]> {
    return this.db.raw_capture_decisions
      .where("raw_capture_id")
      .equals(rawCaptureId)
      .toArray();
  }
  getItem(id: string): Promise<Item | undefined> {
    return this.db.items.get(id);
  }
  listItems(): Promise<Item[]> {
    return this.db.items.toArray();
  }
  async putItem(value: Item): Promise<void> {
    await this.db.items.put(value);
  }
  getItemAssociation(id: string): Promise<ItemAssociation | undefined> {
    return this.db.item_associations.get(id);
  }
  listItemAssociations(itemId: string): Promise<ItemAssociation[]> {
    return this.db.item_associations
      .filter(
        (value) => value.item_id_a === itemId || value.item_id_b === itemId,
      )
      .toArray();
  }
  async putItemAssociation(value: ItemAssociation): Promise<void> {
    await this.db.item_associations.put(value);
  }
  getCourse(id: string): Promise<Course | undefined> {
    return this.db.courses.get(id);
  }
  listCourses(): Promise<Course[]> {
    return this.db.courses.toArray();
  }
  async putCourse(value: Course): Promise<void> {
    await this.db.courses.put(value);
  }
  getSemester(id: string): Promise<Semester | undefined> {
    return this.db.semesters.get(id);
  }
  listSemesters(): Promise<Semester[]> {
    return this.db.semesters.toArray();
  }
  async putSemester(value: Semester): Promise<void> {
    await this.db.semesters.put(value);
  }
  listSemesterWeeks(semesterId: string): Promise<SemesterWeek[]> {
    return this.db.semester_weeks
      .where("semester_id")
      .equals(semesterId)
      .toArray();
  }
  async putSemesterWeek(value: SemesterWeek): Promise<void> {
    await this.db.semester_weeks.put(value);
  }
  async removeSemesterWeek(id: string): Promise<void> {
    await this.db.semester_weeks.delete(id);
  }
  listCourseSchedules(courseId: string): Promise<CourseSchedule[]> {
    return this.db.course_schedules
      .where("course_id")
      .equals(courseId)
      .toArray();
  }
  async putCourseSchedule(value: CourseSchedule): Promise<void> {
    await this.db.course_schedules.put(value);
  }
  getCourseInformation(id: string): Promise<CourseInformation | undefined> {
    return this.db.course_information.get(id);
  }
  listCourseInformation(courseId: string): Promise<CourseInformation[]> {
    return this.db.course_information
      .where("course_id")
      .equals(courseId)
      .toArray();
  }
  async putCourseInformation(value: CourseInformation): Promise<void> {
    await this.db.course_information.put(value);
  }
  async putOutbox(value: OutboxMutation): Promise<void> {
    const setting = await this.db.settings.get("outbox_next_sequence");
    const next = Number(setting?.value ?? "1");
    await this.db.outbox_mutations.put({ ...value, local_sequence: next });
    await this.db.settings.put({
      key: "outbox_next_sequence",
      value: String(next + 1),
    });
  }
  getDeleteUndo(itemId: string): Promise<DeleteUndoRecord | undefined> {
    return this.db.delete_undos.get(itemId);
  }
  async putDeleteUndo(value: DeleteUndoRecord): Promise<void> {
    await this.db.delete_undos.put(value);
  }
  async removeDeleteUndo(itemId: string): Promise<void> {
    await this.db.delete_undos.delete(itemId);
  }

  listReminderRecords(): Promise<LocalReminderRecord[]> {
    return this.db.local_notification_schedule.toArray();
  }
  async putReminderRecord(record: LocalReminderRecord): Promise<void> {
    await this.db.local_notification_schedule.put(record);
  }

  async bindOwner(ownerId: string): Promise<void> {
    await this.transaction(async () => {
      const bound = await this.db.settings.get("sync_bound_owner_id");
      const tables = [
        this.db.semesters,
        this.db.semester_weeks,
        this.db.courses,
        this.db.course_schedules,
        this.db.course_information,
        this.db.items,
        this.db.item_associations,
        this.db.raw_captures,
        this.db.raw_capture_outputs,
        this.db.raw_capture_decisions,
        this.db.outbox_mutations,
        this.db.sync_conflicts,
      ];
      if (bound && bound.value !== ownerId) {
        // A store that holds no rows carries nothing to protect: a fresh
        // device that first signed into the wrong account (e.g. a throwaway
        // phone OTP before the real one) may simply rebind. Anything else
        // keeps the lock — real data never migrates across accounts.
        let hasRows = false;
        for (const table of tables) {
          const count = await (
            table as Table<{ owner_id: string }, string>
          ).count();
          if (count > 0) {
            hasRows = true;
            break;
          }
        }
        if (hasRows)
          throw new OwnerBindingError("Local data is bound to another account");
      } else if (bound) {
        return;
      }
      for (const table of tables)
        await (table as Table<{ owner_id: string }, string>)
          .toCollection()
          .modify({ owner_id: ownerId });
      await this.db.settings.put({ key: "local_owner_id", value: ownerId });
      await this.db.settings.put({
        key: "sync_bound_owner_id",
        value: ownerId,
      });
    });
  }

  async pendingMutations(): Promise<OutboxMutation[]> {
    const values = await this.db.outbox_mutations
      .filter((value) => value.acked_at === null)
      .toArray();
    values.sort((a, b) => (a.local_sequence ?? 0) - (b.local_sequence ?? 0));
    return values;
  }

  private actionRequiredCode(mutation: OutboxMutation): string | null {
    return (
      /^(VALIDATION_ERROR|FORBIDDEN|NOT_FOUND|IDEMPOTENCY_REPLAY):/.exec(
        mutation.last_error ?? "",
      )?.[1] ?? null
    );
  }

  private async localSyncObject(
    mutation: OutboxMutation,
  ): Promise<Record<string, unknown> | null> {
    switch (mutation.entity_type) {
      case "SEMESTER":
        return (
          ((await this.db.semesters.get(
            mutation.entity_id,
          )) as unknown as Record<string, unknown>) ?? null
        );
      case "SEMESTER_WEEK":
        return (
          ((await this.db.semester_weeks.get(
            mutation.entity_id,
          )) as unknown as Record<string, unknown>) ?? null
        );
      case "COURSE":
        return (
          ((await this.db.courses.get(mutation.entity_id)) as unknown as Record<
            string,
            unknown
          >) ?? null
        );
      case "COURSE_SCHEDULE":
        return (
          ((await this.db.course_schedules.get(
            mutation.entity_id,
          )) as unknown as Record<string, unknown>) ?? null
        );
      case "COURSE_INFORMATION":
        return (
          ((await this.db.course_information.get(
            mutation.entity_id,
          )) as unknown as Record<string, unknown>) ?? null
        );
      case "ITEM":
        return (
          ((await this.db.items.get(mutation.entity_id)) as unknown as Record<
            string,
            unknown
          >) ?? null
        );
      case "ITEM_ASSOCIATION":
        return (
          ((await this.db.item_associations.get(
            mutation.entity_id,
          )) as unknown as Record<string, unknown>) ?? null
        );
      case "RAW_CAPTURE":
        return (
          ((await this.db.raw_captures.get(
            mutation.entity_id,
          )) as unknown as Record<string, unknown>) ?? null
        );
      case "RAW_CAPTURE_OUTPUT":
        return (
          ((await this.db.raw_capture_outputs.get(
            mutation.entity_id,
          )) as unknown as Record<string, unknown>) ?? null
        );
      case "RAW_CAPTURE_DECISION":
        return (
          ((await this.db.raw_capture_decisions.get(
            mutation.entity_id,
          )) as unknown as Record<string, unknown>) ?? null
        );
      case "SEMESTER_WEEK_COLLECTION":
        return {
          id: mutation.entity_id,
          collection: await this.db.semester_weeks
            .where("semester_id")
            .equals(mutation.entity_id)
            .toArray(),
        };
      case "COURSE_SCHEDULE_COLLECTION":
        return {
          id: mutation.entity_id,
          collection: (
            await this.db.course_schedules
              .where("course_id")
              .equals(mutation.entity_id)
              .toArray()
          ).filter((value) => value.deleted_at === null),
        };
    }
  }

  async listActionRequiredIssues(): Promise<ActionRequiredSyncIssue[]> {
    const result: ActionRequiredSyncIssue[] = [];
    for (const mutation of await this.pendingMutations()) {
      const code = this.actionRequiredCode(mutation);
      if (!code) continue;
      const localObject = await this.localSyncObject(mutation);
      const unsafeUndo =
        mutation.entity_type === "ITEM" &&
        mutation.operation === "UPDATE" &&
        mutation.changed_fields.deleted_at === null &&
        typeof mutation.changed_fields.undo_token === "string";
      const complexCourseDelete =
        mutation.entity_type === "COURSE" && mutation.operation === "DELETE";
      result.push({
        mutation,
        local_object: localObject,
        error_code: code,
        can_retry:
          (code === "VALIDATION_ERROR" || code === "IDEMPOTENCY_REPLAY") &&
          localObject !== null &&
          !unsafeUndo &&
          !complexCourseDelete,
        can_abandon:
          mutation.operation !== "CREATE" ||
          mutation.entity_type === "ITEM_ASSOCIATION",
      });
    }
    return result;
  }

  async retryActionRequired(mutationId: string): Promise<string> {
    return this.transaction(async () => {
      const mutation = await this.db.outbox_mutations.get(mutationId);
      if (!mutation || mutation.acked_at)
        throw new Error("Sync issue no longer needs repair");
      const issue = (await this.listActionRequiredIssues()).find(
        (value) => value.mutation.mutation_id === mutationId,
      );
      if (!issue?.can_retry)
        throw new Error("This sync issue cannot be safely resubmitted");
      if (!issue.local_object)
        throw new Error("Local object is unavailable for resubmission");
      const replacementId = crypto.randomUUID();
      const now = new Date().toISOString();
      const controlFields = new Set([
        "undo_token",
        "strategy",
        "item_versions",
      ]);
      const changedFields = { ...mutation.changed_fields };
      if (
        mutation.entity_type === "SEMESTER_WEEK_COLLECTION" ||
        mutation.entity_type === "COURSE_SCHEDULE_COLLECTION"
      ) {
        changedFields.collection = issue.local_object.collection;
      } else {
        for (const key of Object.keys(changedFields))
          if (!controlFields.has(key) && Object.hasOwn(issue.local_object, key))
            changedFields[key] = issue.local_object[key];
      }
      const superseded: string[] = [];
      if (
        mutation.entity_type === "SEMESTER_WEEK_COLLECTION" ||
        mutation.entity_type === "COURSE_SCHEDULE_COLLECTION"
      ) {
        const later = (await this.pendingMutations()).filter(
          (value) =>
            value.mutation_id !== mutationId &&
            value.entity_type === mutation.entity_type &&
            value.entity_id === mutation.entity_id,
        );
        for (const value of later) {
          superseded.push(value.mutation_id);
          await this.db.outbox_mutations.update(value.mutation_id, {
            acked_at: now,
            last_error: null,
          });
        }
      }
      const known = await this.serverVersion(
        mutation.entity_type,
        mutation.entity_id,
      );
      await this.db.outbox_mutations.update(mutationId, {
        acked_at: now,
        last_error: null,
      });
      await this.db.outbox_mutations.put({
        ...mutation,
        mutation_id: replacementId,
        base_version:
          mutation.operation === "CREATE"
            ? null
            : (known ?? mutation.base_version),
        changed_fields: changedFields,
        created_at: now,
        attempt_count: 0,
        last_error: null,
        acked_at: null,
        ...(mutation.local_sequence === undefined
          ? {}
          : { local_sequence: mutation.local_sequence }),
      });
      await this.db.sync_repair_decisions.put({
        id: crypto.randomUUID(),
        owner_id: mutation.owner_id,
        mutation_id: mutation.mutation_id,
        action: "RETRY_CURRENT",
        replacement_mutation_id: replacementId,
        superseded_mutation_ids: superseded,
        previous_error: mutation.last_error!,
        decided_at: now,
        device_id: await this.deviceId(),
      });
      return replacementId;
    });
  }

  async abandonActionRequired(mutationId: string): Promise<void> {
    await this.transaction(async () => {
      const mutation = await this.db.outbox_mutations.get(mutationId);
      if (!mutation || mutation.acked_at)
        throw new Error("Sync issue no longer needs repair");
      const issue = (await this.listActionRequiredIssues()).find(
        (value) => value.mutation.mutation_id === mutationId,
      );
      if (!issue?.can_abandon)
        throw new Error(
          "A new local object must be repaired before it can sync",
        );
      const now = new Date().toISOString();
      if (
        mutation.entity_type === "ITEM_ASSOCIATION" &&
        mutation.operation === "CREATE"
      ) {
        const association = await this.db.item_associations.get(
          mutation.entity_id,
        );
        if (association)
          await this.db.item_associations.put({
            ...association,
            deleted_at: now,
            row_version: association.row_version + 1,
          });
      }
      if (
        mutation.entity_type === "SEMESTER_WEEK_COLLECTION" ||
        mutation.entity_type === "COURSE_SCHEDULE_COLLECTION"
      ) {
        let previous: unknown = mutation.changed_fields.previous_collection;
        if (mutation.entity_type === "COURSE_SCHEDULE_COLLECTION") {
          if (!Array.isArray(previous))
            throw new Error("Previous collection is unavailable");
          const restored = [];
          for (const entry of previous) {
            if (typeof entry !== "object" || entry === null)
              throw new Error("Previous collection is invalid");
            const id = (entry as { id?: unknown }).id;
            if (typeof id !== "string")
              throw new Error("Previous collection is invalid");
            const current = await this.db.course_schedules.get(id);
            restored.push({
              ...current,
              ...entry,
              id,
              owner_id: mutation.owner_id,
              course_id: mutation.entity_id,
              deleted_at: null,
              row_version: (current?.row_version ?? 0) + 1,
            });
          }
          previous = restored;
        }
        await this.applyCollectionEnvelope(
          mutation.entity_type,
          mutation.entity_id,
          mutation.owner_id,
          previous,
          now,
        );
      }
      await this.db.outbox_mutations.update(mutationId, {
        acked_at: now,
        last_error: null,
      });
      if (
        mutation.entity_type === "ITEM" &&
        typeof mutation.changed_fields.undo_token === "string"
      )
        await this.db.delete_undos.delete(mutation.entity_id);
      await this.db.settings.delete("sync_pull_cursor");
      await this.db.sync_repair_decisions.put({
        id: crypto.randomUUID(),
        owner_id: mutation.owner_id,
        mutation_id: mutation.mutation_id,
        action: "ABANDON_TO_SYNCED",
        replacement_mutation_id: null,
        superseded_mutation_ids: [],
        previous_error: mutation.last_error!,
        decided_at: now,
        device_id: await this.deviceId(),
      });
    });
  }

  listSyncRepairDecisions(): Promise<SyncRepairDecision[]> {
    return this.db.sync_repair_decisions.orderBy("decided_at").toArray();
  }

  async serverVersion(
    type: SyncEntityType,
    id: string,
  ): Promise<number | null> {
    const setting = await this.db.settings.get(`sync_version:${type}:${id}`);
    return setting ? Number(setting.value) : null;
  }

  knownSyncVersion(type: SyncEntityType, id: string): Promise<number | null> {
    return this.serverVersion(type, id);
  }

  async acknowledge(mutationId: string, version: number): Promise<void> {
    await this.transaction(async () => {
      const mutation = await this.db.outbox_mutations.get(mutationId);
      if (!mutation) throw new Error("Outbox mutation missing during ACK");
      await this.db.outbox_mutations.update(mutationId, {
        acked_at: new Date().toISOString(),
        last_error: null,
      });
      await this.db.settings.put({
        key: `sync_version:${mutation.entity_type}:${mutation.entity_id}`,
        value: String(version),
      });
    });
  }

  async recordSyncFailure(mutationId: string, error: string): Promise<void> {
    const mutation = await this.db.outbox_mutations.get(mutationId);
    if (!mutation) return;
    await this.db.outbox_mutations.update(mutationId, {
      attempt_count: mutation.attempt_count + 1,
      last_error: error.slice(0, 1000),
    });
  }

  private async applyCollectionEnvelope(
    type: "SEMESTER_WEEK_COLLECTION" | "COURSE_SCHEDULE_COLLECTION",
    parentId: string,
    ownerId: string,
    collection: unknown,
    deletedAt: string,
  ): Promise<void> {
    if (!Array.isArray(collection))
      throw new Error("Remote collection is invalid");
    if (type === "SEMESTER_WEEK_COLLECTION") {
      const weeks = collection.map((entry) => {
        if (
          typeof entry !== "object" ||
          entry === null ||
          typeof (entry as { id?: unknown }).id !== "string" ||
          (entry as { semester_id?: unknown }).semester_id !== parentId
        )
          throw new Error("Remote semester week collection is invalid");
        return { ...(entry as SemesterWeek), owner_id: ownerId };
      });
      await this.db.semester_weeks
        .where("semester_id")
        .equals(parentId)
        .delete();
      if (weeks.length) await this.db.semester_weeks.bulkPut(weeks);
      return;
    }
    const schedules = collection.map((entry) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof (entry as { id?: unknown }).id !== "string" ||
        (entry as { course_id?: unknown }).course_id !== parentId
      )
        throw new Error("Remote course schedule collection is invalid");
      return { ...(entry as CourseSchedule), owner_id: ownerId };
    });
    const ids = new Set(schedules.map((entry) => entry.id));
    const current = await this.db.course_schedules
      .where("course_id")
      .equals(parentId)
      .toArray();
    for (const entry of current) {
      if (!ids.has(entry.id) && entry.deleted_at === null)
        await this.db.course_schedules.put({
          ...entry,
          deleted_at: deletedAt,
          updated_at: deletedAt,
          row_version: entry.row_version + 1,
        });
    }
    if (schedules.length) await this.db.course_schedules.bulkPut(schedules);
  }

  /** Finalize an explicitly resolved conflict without replaying its rejected mutation. */
  async acceptResolvedConflict(
    conflict: SyncConflict,
    entity: Record<string, unknown>,
    undo?: { token: string; expiresAt: string },
  ): Promise<void> {
    await this.transaction(async () => {
      const bound = await this.db.settings.get("sync_bound_owner_id");
      if (!bound || bound.value !== conflict.owner_id)
        throw new OwnerBindingError("Conflict belongs to another account");
      const collectionConflict =
        conflict.entity_type === "SEMESTER_WEEK_COLLECTION" ||
        conflict.entity_type === "COURSE_SCHEDULE_COLLECTION";
      if (
        conflict.status !== "RESOLVED" ||
        entity.id !== conflict.entity_id ||
        entity.owner_id !== conflict.owner_id ||
        !Number.isSafeInteger(Number(entity.row_version)) ||
        Number(entity.row_version) < (collectionConflict ? 0 : 1)
      )
        throw new Error("Resolved conflict response is inconsistent");
      const table = (
        {
          ITEM: this.db.items,
          COURSE_INFORMATION: this.db.course_information,
          RAW_CAPTURE: this.db.raw_captures,
          SEMESTER: this.db.semesters,
          COURSE: this.db.courses,
        } as Record<string, Table<object, string> | undefined>
      )[conflict.entity_type];
      if (!table && !collectionConflict)
        throw new Error("Unsupported conflict entity");
      const pending = await this.db.outbox_mutations
        .filter((value) => value.acked_at === null)
        .toArray();
      const conflicted = pending.find(
        (value) => value.last_error === `VERSION_CONFLICT:${conflict.id}`,
      );
      if (
        conflicted &&
        (conflicted.entity_type !== conflict.entity_type ||
          conflicted.entity_id !== conflict.entity_id)
      )
        throw new Error("Conflict does not match the pending mutation");
      if (conflicted)
        await this.db.outbox_mutations.update(conflicted.mutation_id, {
          acked_at: new Date().toISOString(),
          last_error: null,
        });
      const otherPending = pending.some(
        (value) =>
          value.mutation_id !== conflicted?.mutation_id &&
          value.entity_type === conflict.entity_type &&
          value.entity_id === conflict.entity_id,
      );
      const versionKey = `sync_version:${conflict.entity_type}:${conflict.entity_id}`;
      const knownVersion = Number(
        (await this.db.settings.get(versionKey))?.value ?? "0",
      );
      const currentEntity = table
        ? ((await table.get(conflict.entity_id)) as
            { row_version?: number } | undefined)
        : undefined;
      if (
        !otherPending &&
        knownVersion <= Number(entity.row_version) &&
        Number(currentEntity?.row_version ?? 0) <= Number(entity.row_version)
      )
        if (collectionConflict)
          await this.applyCollectionEnvelope(
            conflict.entity_type as
              "SEMESTER_WEEK_COLLECTION" | "COURSE_SCHEDULE_COLLECTION",
            conflict.entity_id,
            conflict.owner_id,
            entity.collection,
            new Date().toISOString(),
          );
        else await table!.put(entity);
      if (undo && conflict.entity_type === "ITEM" && entity.deleted_at)
        await this.db.delete_undos.put({
          item_id: conflict.entity_id,
          token: undo.token,
          expires_at: undo.expiresAt,
        });
      if (conflicted || !otherPending)
        await this.db.settings.put({
          key: versionKey,
          value: String(Math.max(knownVersion, Number(entity.row_version))),
        });
      await this.db.sync_conflicts.put(conflict);
    });
  }

  async syncCursor(): Promise<string | null> {
    return (await this.db.settings.get("sync_pull_cursor"))?.value ?? null;
  }

  async applyRemoteChanges(
    ownerId: string,
    changes: RemoteChange[],
    cursor: string,
  ): Promise<void> {
    await this.transaction(async () => {
      const pending = await this.db.outbox_mutations
        .filter((value) => value.acked_at === null)
        .toArray();
      const pendingIds = new Set(
        pending.map((value) => `${value.entity_type}:${value.entity_id}`),
      );
      if (
        changes.some((change) =>
          pendingIds.has(`${change.entity_type}:${change.entity_id}`),
        )
      )
        throw new Error(
          "Remote page overlaps a new local mutation; retry after push",
        );
      for (const change of changes) {
        if (
          change.entity_type === "SEMESTER_WEEK_COLLECTION" ||
          change.entity_type === "COURSE_SCHEDULE_COLLECTION"
        ) {
          if (
            change.operation !== "UPDATE" ||
            change.changed_fields.parent_id !== change.entity_id
          )
            throw new Error("Remote collection envelope is invalid");
          await this.applyCollectionEnvelope(
            change.entity_type,
            change.entity_id,
            ownerId,
            change.changed_fields.collection,
            change.server_time,
          );
          await this.db.settings.put({
            key: `sync_version:${change.entity_type}:${change.entity_id}`,
            value: String(change.entity_version),
          });
          continue;
        }
        if (
          change.entity_type === "SEMESTER_WEEK" &&
          change.operation === "DELETE"
        ) {
          await this.db.semester_weeks.delete(change.entity_id);
          await this.db.settings.put({
            key: `sync_version:${change.entity_type}:${change.entity_id}`,
            value: String(change.entity_version),
          });
          continue;
        }
        const table = (
          {
            SEMESTER: this.db.semesters,
            SEMESTER_WEEK: this.db.semester_weeks,
            COURSE: this.db.courses,
            COURSE_SCHEDULE: this.db.course_schedules,
            COURSE_INFORMATION: this.db.course_information,
            ITEM: this.db.items,
            ITEM_ASSOCIATION: this.db.item_associations,
            RAW_CAPTURE: this.db.raw_captures,
            RAW_CAPTURE_OUTPUT: this.db.raw_capture_outputs,
            RAW_CAPTURE_DECISION: this.db.raw_capture_decisions,
          } as Record<string, Table<object, string> | undefined>
        )[change.entity_type];
        if (!table)
          throw new Error(`Unsupported remote entity ${change.entity_type}`);
        const existing = await table.get(change.entity_id);
        if (!existing && change.operation !== "CREATE")
          throw new Error(
            `Remote change has no base entity ${change.entity_type}:${change.entity_id}`,
          );
        const next = {
          ...(existing ?? {}),
          ...change.changed_fields,
          id: change.entity_id,
          owner_id: ownerId,
          ...(change.entity_type === "RAW_CAPTURE_OUTPUT" ||
          change.entity_type === "RAW_CAPTURE_DECISION" ||
          change.entity_type === "SEMESTER_WEEK"
            ? {}
            : { row_version: change.entity_version }),
        };
        await table.put(next);
        const key = `sync_version:${change.entity_type}:${change.entity_id}`;
        const previous = await this.db.settings.get(key);
        await this.db.settings.put({
          key,
          value: String(
            Math.max(Number(previous?.value ?? "0"), change.entity_version),
          ),
        });
      }
      await this.db.settings.put({ key: "sync_pull_cursor", value: cursor });
    });
  }
}
