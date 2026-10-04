-- Timetable rows may legitimately have no clock time: a PDF that labels
-- meetings only by period (节次) cannot state one, and inventing a time is
-- worse than storing none. Both times therefore become nullable, with the
-- invariant that they are present together or absent together.
ALTER TABLE course_schedules ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE course_schedules ALTER COLUMN end_time DROP NOT NULL;

-- Drop the original unnamed CHECK (start_time < end_time) wherever Postgres
-- named it, then re-add one that also guards the all-or-nothing rule.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'course_schedules'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%start_time < end_time%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE course_schedules DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE course_schedules
  ADD CONSTRAINT course_schedules_time_range_check
  CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  );
