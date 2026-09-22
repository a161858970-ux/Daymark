# ADR-004 — Field conflict resolution

## Context

The sync protocol detects overlapping edits to the same Item, CourseInformation, or RawCapture field. The rejected mutation stays in IndexedDB and the API stores a `sync_conflicts` record. Replaying that mutation after a user decision would replay its original idempotent `CONFLICT` response, so a separate resolution operation is required.

## Decision

- Authenticated `GET /sync/conflicts` and `GET /sync/conflicts/:id` return only the owner's records. The detail also reads the current entity so a decision uses the latest remote value.
- `POST /sync/conflicts/:id/resolve` requires an idempotency key and the reviewed entity row version. Every conflicting field must have a LOCAL, REMOTE, or explicit selected value. Allowed fields are whitelisted by entity type; the final entity is validated. A stale review returns a version conflict.
- Resolution writes an ordinary entity revision and change log entry in the same PostgreSQL transaction as the conflict status and idempotency response. A chosen Item deletion creates a new soft-delete revision and Undo token; the existing local token is reused when available.
- IndexedDB atomically acknowledges the rejected outbox mutation and records the resolved server version. If another local mutation for that entity is still pending, it preserves the later local state and sends that mutation against the new version. Otherwise it applies the resolved entity immediately. Pull then converges through the normal change log.
- On restart, the client reads pending conflict IDs. If another session has resolved one, it accepts the resolved server entity before replaying remaining outbox mutations. A lost resolution response can also be recovered by reading the resolved record.
- The UI shows the affected object, only the conflicting fields, local and current remote values, and explicit selection actions. It does not show SQL, versions, or outbox internals.

## Verification and remaining work

PGlite/IndexedDB tests cover owner isolation, stale review, invalid choice, idempotent replay, preserving later edits, choosing a local deletion, and token-bound Undo. Real Supabase/PostgreSQL multi-device convergence and collection-level schedule/week replacement concurrency remain to be verified. The `ACTION_REQUIRED` path for rejected non-conflict mutations still needs a repair UI.
