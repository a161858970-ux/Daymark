-- Collection-level optimistic concurrency for whole SemesterWeek and CourseSchedule replacement.
CREATE TABLE sync_collection_revisions (
  owner_id uuid NOT NULL,
  collection_type text NOT NULL CHECK (
    collection_type IN ('SEMESTER_WEEK_COLLECTION','COURSE_SCHEDULE_COLLECTION')
  ),
  parent_id uuid NOT NULL,
  collection_version bigint NOT NULL DEFAULT 0 CHECK (collection_version >= 0),
  snapshot_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, collection_type, parent_id)
);

CREATE INDEX sync_collection_revisions_parent_idx
  ON sync_collection_revisions(owner_id, parent_id);
