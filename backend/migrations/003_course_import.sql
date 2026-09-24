-- Recoverable Course Import checkpoints. Source bytes remain transient; the
-- normalized preview and user decisions are persisted before atomic commit.

CREATE TABLE course_import_jobs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  semester_id uuid NOT NULL REFERENCES semesters(id),
  source_type text NOT NULL CHECK (source_type IN ('PDF','IMAGE')),
  status text NOT NULL CHECK (
    status IN ('AWAITING_SOURCE','NEEDS_RESOLUTION','READY','COMMITTED','FAILED')
  ),
  source_name text,
  source_media_type text,
  source_sha256 text,
  preview jsonb,
  resolutions jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  commit_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz
);

CREATE INDEX course_import_jobs_owner_status_idx
  ON course_import_jobs(owner_id, status, updated_at DESC);

CREATE TABLE course_import_commits (
  owner_id uuid NOT NULL,
  semester_id uuid NOT NULL REFERENCES semesters(id),
  source_sha256 text NOT NULL,
  job_id uuid NOT NULL REFERENCES course_import_jobs(id),
  result jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, semester_id, source_sha256)
);
