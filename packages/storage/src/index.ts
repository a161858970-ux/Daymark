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
} from "@course-manager/domain";
import type {
  CaptureContext,
  DeleteUndoRecord,
  LocalRepository,
  RemoteChange,
  LocalReminderRecord,
  ReminderRepository,
  SyncRepository,
} from "@course-manager/application";

type Setting = { key: string; value: string };
type StoredMutation = OutboxMutation & { local_sequence?: number };

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
      if (bound && bound.value !== ownerId)
        throw new OwnerBindingError("Local data is bound to another account");
      if (bound) return;
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

  async serverVersion(
    type: SyncEntityType,
    id: string,
  ): Promise<number | null> {
    const setting = await this.db.settings.get(`sync_version:${type}:${id}`);
    return setting ? Number(setting.value) : null;
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
      if (
        conflict.status !== "RESOLVED" ||
        entity.id !== conflict.entity_id ||
        entity.owner_id !== conflict.owner_id ||
        !Number.isSafeInteger(Number(entity.row_version)) ||
        Number(entity.row_version) < 1
      )
        throw new Error("Resolved conflict response is inconsistent");
      const table = (
        {
          ITEM: this.db.items,
          COURSE_INFORMATION: this.db.course_information,
          RAW_CAPTURE: this.db.raw_captures,
        } as Record<string, Table<object, string> | undefined>
      )[conflict.entity_type];
      if (!table) throw new Error("Unsupported conflict entity");
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
      const currentEntity = (await table.get(conflict.entity_id)) as
        { row_version?: number } | undefined;
      if (
        !otherPending &&
        knownVersion <= Number(entity.row_version) &&
        Number(currentEntity?.row_version ?? 0) <= Number(entity.row_version)
      )
        await table.put(entity);
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
