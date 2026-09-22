-- Canonical schema for 15_DATABASE_SCHEMA.md. All user-facing entities are owner scoped.
-- Physical deletion is intentionally absent from ordinary domain operations.

CREATE TABLE semesters (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  CHECK (start_date <= end_date)
);

CREATE TABLE semester_weeks (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  semester_id uuid NOT NULL REFERENCES semesters(id),
  week_number integer NOT NULL CHECK (week_number > 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  UNIQUE (semester_id, week_number),
  CHECK (start_date <= end_date)
);

CREATE TABLE courses (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  semester_id uuid REFERENCES semesters(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  instructor text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0)
);

CREATE TABLE course_schedules (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  course_id uuid NOT NULL REFERENCES courses(id),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time time NOT NULL,
  week_start integer CHECK (week_start > 0),
  week_end integer CHECK (week_end > 0),
  classroom text,
  stage_label text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  CHECK (start_time < end_time),
  CHECK (week_start IS NULL OR week_end IS NULL OR week_start <= week_end)
);

CREATE TABLE course_information (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  course_id uuid NOT NULL REFERENCES courses(id),
  content text NOT NULL CHECK (btrim(content) <> ''),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0)
);

CREATE TABLE raw_captures (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('QUICK_CAPTURE','COURSE_ITEM','COURSE_INFORMATION')),
  raw_text text NOT NULL CHECK (btrim(raw_text) <> ''),
  captured_at timestamptz NOT NULL,
  processing_status text NOT NULL CHECK (processing_status IN ('RAW','PROCESSING','RESOLVED','UNRESOLVED','DELETED')),
  unresolved_reason text,
  deleted_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0)
);

CREATE TABLE items (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  course_id uuid REFERENCES courses(id),
  title text NOT NULL CHECK (btrim(title) <> ''),
  detail text,
  status text NOT NULL CHECK (status IN ('INCOMPLETE','COMPLETE')),
  start_at timestamptz,
  occurrence_start_at timestamptz,
  occurrence_end_at timestamptz,
  due_at timestamptz,
  reminder_level text NOT NULL CHECK (reminder_level IN ('OFF','NORMAL','HIGH')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  deleted_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  raw_capture_id uuid REFERENCES raw_captures(id),
  CHECK (occurrence_start_at IS NULL OR occurrence_end_at IS NULL OR occurrence_start_at <= occurrence_end_at),
  CHECK ((status = 'COMPLETE') = (completed_at IS NOT NULL))
);

CREATE TABLE item_associations (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  item_id_a uuid NOT NULL REFERENCES items(id),
  item_id_b uuid NOT NULL REFERENCES items(id),
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  CHECK (item_id_a < item_id_b)
);
CREATE UNIQUE INDEX item_associations_active_pair ON item_associations(owner_id, item_id_a, item_id_b) WHERE deleted_at IS NULL;

CREATE TABLE raw_capture_outputs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  raw_capture_id uuid NOT NULL REFERENCES raw_captures(id),
  object_type text NOT NULL CHECK (object_type IN ('ITEM','COURSE_INFORMATION')),
  object_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (raw_capture_id, object_type, object_id)
);
-- Polymorphic object_id target, owner, and live status are checked in application transactions.

CREATE TABLE raw_capture_decisions (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  raw_capture_id uuid NOT NULL REFERENCES raw_captures(id),
  decision_type text NOT NULL CHECK (decision_type IN ('ITEM','COURSE_INFORMATION','SPLIT','KEEP_ONE','DEFER')),
  decision_payload jsonb,
  decided_at timestamptz NOT NULL,
  device_id uuid NOT NULL
);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES items(id),
  reminder_rule_key text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  claimed_at timestamptz,
  delivered_at timestamptz,
  device_id uuid,
  created_at timestamptz NOT NULL,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE (owner_id, item_id, reminder_rule_key, scheduled_for)
);

CREATE TABLE devices (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('MOBILE','WINDOWS')),
  push_token text,
  last_seen_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE change_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('CREATE','UPDATE','DELETE')),
  changed_fields jsonb,
  entity_version bigint NOT NULL,
  server_time timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_conflicts (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  local_version jsonb NOT NULL,
  remote_version jsonb NOT NULL,
  conflicting_fields jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN','RESOLVED')),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution jsonb
);

CREATE TABLE idempotency_keys (
  owner_id uuid NOT NULL,
  mutation_id uuid NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, mutation_id)
);

CREATE TABLE delete_undo_tokens (
  owner_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES items(id),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (owner_id, item_id)
);

CREATE INDEX items_overview_idx ON items(owner_id, deleted_at, status, created_at);
CREATE INDEX items_course_idx ON items(owner_id, course_id, deleted_at);
CREATE INDEX items_due_idx ON items(owner_id, due_at, deleted_at);
CREATE INDEX items_occurrence_idx ON items(owner_id, occurrence_start_at, deleted_at);
CREATE INDEX items_start_idx ON items(owner_id, start_at, deleted_at);
CREATE INDEX course_information_course_idx ON course_information(owner_id, course_id, deleted_at);
CREATE INDEX courses_semester_name_idx ON courses(owner_id, semester_id, name, deleted_at);
CREATE INDEX semester_weeks_dates_idx ON semester_weeks(semester_id, start_date, end_date);
CREATE INDEX raw_captures_status_idx ON raw_captures(owner_id, processing_status, captured_at);
CREATE INDEX raw_capture_outputs_capture_idx ON raw_capture_outputs(owner_id, raw_capture_id);
CREATE INDEX change_log_owner_cursor_idx ON change_log(owner_id, id);
