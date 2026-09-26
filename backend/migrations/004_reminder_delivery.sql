-- Reminder delivery engineering: shared claim/lease for cross-device
-- de-duplication plus delivery acknowledgement. Reminder times stay derived
-- from ReminderPolicy; these columns only coordinate delivery.

-- Device registration gains bookkeeping columns.
ALTER TABLE devices
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN row_version bigint NOT NULL DEFAULT 1;

CREATE INDEX devices_owner_active_idx ON devices(owner_id, is_active, last_seen_at DESC);

-- Delivery coordination: logical key, explicit state machine and lease.
ALTER TABLE notification_deliveries
  ADD COLUMN logical_key text,
  ADD COLUMN policy_version text,
  ADD COLUMN state text NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING','CLAIMED','DELIVERED','CANCELED')),
  ADD COLUMN claimed_by_device_id uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN delivered_by_device_id uuid,
  ADD COLUMN canceled_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Existing rows keep their identity: the logical key is what the client
-- de-duplicates on, so it is reconstructed before it becomes mandatory.
UPDATE notification_deliveries
   SET logical_key = item_id || ':' || reminder_rule_key || ':' ||
                     to_char(scheduled_for AT TIME ZONE 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       policy_version = 'legacy'
 WHERE logical_key IS NULL;

ALTER TABLE notification_deliveries
  ALTER COLUMN logical_key SET NOT NULL,
  ALTER COLUMN policy_version SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now();

DO $$
DECLARE existing text;
BEGIN
  SELECT conname INTO existing
    FROM pg_constraint
   WHERE conrelid = 'notification_deliveries'::regclass
     AND contype = 'u';
  IF existing IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notification_deliveries DROP CONSTRAINT %I', existing);
  END IF;
END $$;

ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_owner_logical_key_key
    UNIQUE (owner_id, logical_key);

CREATE INDEX notification_deliveries_due_idx
  ON notification_deliveries(owner_id, state, scheduled_for);

CREATE INDEX notification_deliveries_item_idx
  ON notification_deliveries(owner_id, item_id, state);
