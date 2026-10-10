-- 007_date_precision.sql — DATE / DATETIME precision (ADR-010)
-- Forward-only. Does not modify historical migrations.
-- Legacy *_at columns remain DATETIME instants (timestamptz); new date columns
-- hold calendar-day DATE values. Same endpoint never holds both.

ALTER TABLE raw_captures
  ADD COLUMN IF NOT EXISTS captured_tz text;

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS occurrence_start_date date,
  ADD COLUMN IF NOT EXISTS occurrence_end_date date,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS time_zone text;

-- Mutual exclusion: DATE xor DATETIME per semantic endpoint.
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_start_precision_check,
  DROP CONSTRAINT IF EXISTS items_occurrence_start_precision_check,
  DROP CONSTRAINT IF EXISTS items_occurrence_end_precision_check,
  DROP CONSTRAINT IF EXISTS items_due_precision_check,
  DROP CONSTRAINT IF EXISTS items_occurrence_date_order_check;

ALTER TABLE items
  ADD CONSTRAINT items_start_precision_check
    CHECK (NOT (start_at IS NOT NULL AND start_date IS NOT NULL)),
  ADD CONSTRAINT items_occurrence_start_precision_check
    CHECK (NOT (occurrence_start_at IS NOT NULL AND occurrence_start_date IS NOT NULL)),
  ADD CONSTRAINT items_occurrence_end_precision_check
    CHECK (NOT (occurrence_end_at IS NOT NULL AND occurrence_end_date IS NOT NULL)),
  ADD CONSTRAINT items_due_precision_check
    CHECK (NOT (due_at IS NOT NULL AND due_date IS NOT NULL)),
  ADD CONSTRAINT items_occurrence_date_order_check
    CHECK (
      occurrence_start_date IS NULL
      OR occurrence_end_date IS NULL
      OR occurrence_start_date <= occurrence_end_date
    );

CREATE INDEX IF NOT EXISTS items_owner_due_date
  ON items(owner_id, due_date, deleted_at)
  WHERE due_date IS NOT NULL;
