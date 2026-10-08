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
  SyncEntityType,
} from "@daymark/domain";

export interface DeleteUndoRecord {
  item_id: string;
  token: string;
  expires_at: string;
}

/** Local-only metadata needed to resume a capture after an interrupted parse. */
export interface CaptureContext {
  raw_capture_id: string;
  course_id: string | null;
}

/** The UI talks only to use cases; implementations own transactions and persistence. */
export interface LocalRepository {
  transaction<T>(work: () => Promise<T>): Promise<T>;
  ownerId(): Promise<string>;
  deviceId(): Promise<string>;
  getRawCapture(id: string): Promise<RawCapture | undefined>;
  listRawCaptures(): Promise<RawCapture[]>;
  putRawCapture(capture: RawCapture): Promise<void>;
  getCaptureContext(rawCaptureId: string): Promise<CaptureContext | undefined>;
  putCaptureContext(context: CaptureContext): Promise<void>;
  listOutputs(rawCaptureId: string): Promise<RawCaptureOutput[]>;
  putOutput(output: RawCaptureOutput): Promise<void>;
  putDecision(decision: RawCaptureDecision): Promise<void>;
  listDecisions(rawCaptureId: string): Promise<RawCaptureDecision[]>;
  getItem(id: string): Promise<Item | undefined>;
  listItems(): Promise<Item[]>;
  putItem(item: Item): Promise<void>;
  getItemAssociation(id: string): Promise<ItemAssociation | undefined>;
  listItemAssociations(itemId: string): Promise<ItemAssociation[]>;
  putItemAssociation(association: ItemAssociation): Promise<void>;
  getCourse(id: string): Promise<Course | undefined>;
  listCourses(): Promise<Course[]>;
  putCourse(course: Course): Promise<void>;
  getSemester(id: string): Promise<Semester | undefined>;
  listSemesters(): Promise<Semester[]>;
  putSemester(semester: Semester): Promise<void>;
  listSemesterWeeks(semesterId: string): Promise<SemesterWeek[]>;
  putSemesterWeek(week: SemesterWeek): Promise<void>;
  removeSemesterWeek(id: string): Promise<void>;
  listCourseSchedules(courseId: string): Promise<CourseSchedule[]>;
  putCourseSchedule(schedule: CourseSchedule): Promise<void>;
  getCourseInformation(id: string): Promise<CourseInformation | undefined>;
  listCourseInformation(courseId: string): Promise<CourseInformation[]>;
  putCourseInformation(value: CourseInformation): Promise<void>;
  knownSyncVersion(type: SyncEntityType, id: string): Promise<number | null>;
  putOutbox(mutation: OutboxMutation): Promise<void>;
  getDeleteUndo(itemId: string): Promise<DeleteUndoRecord | undefined>;
  putDeleteUndo(record: DeleteUndoRecord): Promise<void>;
  removeDeleteUndo(itemId: string): Promise<void>;
}
