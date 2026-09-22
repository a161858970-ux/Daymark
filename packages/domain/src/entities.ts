export type UUID = string;
export type IsoDateTime = string;
export type DateOnly = string;

export interface EntityBase {
  id: UUID;
  owner_id: UUID;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  deleted_at: IsoDateTime | null;
  row_version: number;
}

export interface Semester extends EntityBase {
  name: string;
  start_date: DateOnly;
  end_date: DateOnly;
}

export interface SemesterWeek {
  id: UUID;
  owner_id: UUID;
  semester_id: UUID;
  week_number: number;
  start_date: DateOnly;
  end_date: DateOnly;
}

export interface Course extends EntityBase {
  semester_id: UUID | null;
  name: string;
  instructor: string | null;
}

export interface CourseSchedule extends EntityBase {
  course_id: UUID;
  weekday: number;
  start_time: string;
  end_time: string;
  week_start: number | null;
  week_end: number | null;
  classroom: string | null;
  stage_label: string | null;
}

export interface CourseInformation extends EntityBase {
  course_id: UUID;
  content: string;
}

export type ItemStatus = "INCOMPLETE" | "COMPLETE";
export type ReminderLevel = "OFF" | "NORMAL" | "HIGH";

export interface Item extends EntityBase {
  course_id: UUID | null;
  title: string;
  detail: string | null;
  status: ItemStatus;
  start_at: IsoDateTime | null;
  occurrence_start_at: IsoDateTime | null;
  occurrence_end_at: IsoDateTime | null;
  due_at: IsoDateTime | null;
  reminder_level: ReminderLevel;
  completed_at: IsoDateTime | null;
  raw_capture_id: UUID | null;
}

export interface ItemAssociation extends EntityBase {
  item_id_a: UUID;
  item_id_b: UUID;
}

export type RawCaptureStatus =
  "RAW" | "PROCESSING" | "RESOLVED" | "UNRESOLVED" | "DELETED";
export type RawCaptureSource =
  "QUICK_CAPTURE" | "COURSE_ITEM" | "COURSE_INFORMATION";

export interface RawCapture extends Omit<
  EntityBase,
  "created_at" | "updated_at"
> {
  source: RawCaptureSource;
  raw_text: string;
  captured_at: IsoDateTime;
  processing_status: RawCaptureStatus;
  unresolved_reason: string | null;
}

export interface RawCaptureOutput {
  id: UUID;
  owner_id: UUID;
  raw_capture_id: UUID;
  object_type: "ITEM" | "COURSE_INFORMATION";
  object_id: UUID;
  created_at: IsoDateTime;
}

export interface RawCaptureDecision {
  id: UUID;
  owner_id: UUID;
  raw_capture_id: UUID;
  decision_type: "ITEM" | "COURSE_INFORMATION" | "SPLIT" | "KEEP_ONE" | "DEFER";
  decision_payload: Record<string, unknown> | null;
  decided_at: IsoDateTime;
  device_id: UUID;
}

export type SyncEntityType =
  | "SEMESTER"
  | "SEMESTER_WEEK"
  | "COURSE"
  | "COURSE_SCHEDULE"
  | "COURSE_INFORMATION"
  | "ITEM"
  | "ITEM_ASSOCIATION"
  | "RAW_CAPTURE"
  | "RAW_CAPTURE_OUTPUT"
  | "RAW_CAPTURE_DECISION";

export interface OutboxMutation {
  mutation_id: UUID;
  owner_id: UUID;
  entity_type: SyncEntityType;
  entity_id: UUID;
  operation: "CREATE" | "UPDATE" | "DELETE";
  base_version: number | null;
  changed_fields: Record<string, unknown>;
  created_at: IsoDateTime;
  attempt_count: number;
  last_error: string | null;
  acked_at: IsoDateTime | null;
}

export interface SyncConflict {
  id: UUID;
  owner_id: UUID;
  entity_type: SyncEntityType;
  entity_id: UUID;
  local_version: Record<string, unknown>;
  remote_version: Record<string, unknown>;
  conflicting_fields: string[];
  status: "OPEN" | "RESOLVED";
  created_at: IsoDateTime;
  resolved_at: IsoDateTime | null;
}
