# ADR-004 — Field and collection conflict resolution

**Status:** Accepted; updated 2026-09-24. Real Supabase/PostgreSQL validation remains external.

## Context

The sync protocol detects overlapping edits to the same Semester, Course, Item, CourseInformation, or RawCapture field, and concurrent whole-collection replacement of SemesterWeek or CourseSchedule. The rejected mutation stays in IndexedDB and the API stores a `sync_conflicts` record. Replaying that mutation after a user decision would replay its original idempotent `CONFLICT` response, so a separate resolution operation is required.

## Decision

- Authenticated `GET /sync/conflicts` and `GET /sync/conflicts/:id` return only the owner's records. The detail also reads the current entity so a decision uses the latest remote value.
- `POST /sync/conflicts/:id/resolve` requires an idempotency key and the reviewed entity row version. Every conflicting field must have a LOCAL, REMOTE, or explicit selected value. Allowed fields are whitelisted by entity type; the final entity is validated. A stale review returns a version conflict.
- Resolution writes an ordinary entity revision and change log entry in the same PostgreSQL transaction as the conflict status and idempotency response. A chosen Item deletion creates a new soft-delete revision and Undo token; the existing local token is reused when available.
- IndexedDB atomically acknowledges the rejected outbox mutation and records the resolved server version. If another local mutation for that entity is still pending, it preserves the later local state and sends that mutation against the new version. Otherwise it applies the resolved entity immediately. Pull then converges through the normal change log.
- On restart, the client reads pending conflict IDs. If another session has resolved one, it accepts the resolved server entity before replaying remaining outbox mutations. A lost resolution response can also be recovered by reading the resolved record.
- The UI shows the affected object, only the conflicting fields, local and current remote values, and local/remote/explicit-value actions. It does not show SQL, versions, mutation IDs, raw server errors, or outbox internals.
- A collection conflict exposes one `collection` choice. The UI summarizes each whole group by count; users choose the complete local or synced group. Member-level mixing is deliberately unavailable. The transaction and revision rules are in ADR-005.
- A permanent non-conflict rejection enters ACTION_REQUIRED. Safe edits can be resubmitted from current local data with a new mutation ID; adopting synced state requires a second confirmation and writes repair provenance. Expired Undo cannot be retried as an undelete.

## Verification and remaining work

PGlite/two-Dexie tests cover owner isolation, stale review, invalid choice, explicit value, idempotent replay, preserving later edits, delete-vs-edit, token-bound Undo, whole-collection conflicts and ACTION_REQUIRED repair. A–K results are recorded in `MULTI_DEVICE_VERIFICATION.md`. Real Supabase/PostgreSQL and physical-device convergence remain to be verified.
