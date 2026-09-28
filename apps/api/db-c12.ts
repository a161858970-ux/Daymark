import { readFileSync } from "node:fs";
const text = readFileSync("../../.env", "utf8");
const value = (key) => {
  const hit = text.split(/\r?\n/).find((line) => line.startsWith(`${key}=`));
  return hit ? hit.slice(key.length + 1).trim() : "";
};
const parsed = new URL(value("REAL_DATABASE_URL") || value("DATABASE_URL"));
const { Client } = await import("pg");
const client = new Client({
  host: parsed.hostname,
  port: Number(parsed.port || 5432),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.replace("/", ""),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const OWNER = "645027f0-7b61-480d-9b3d-9c1ad264ee45";
const conf = await client.query(
  `SELECT id, entity_type, conflicting_fields, status, created_at, resolved_at, resolution
   FROM sync_conflicts WHERE entity_type='SEMESTER_WEEK_COLLECTION' AND owner_id=$1
   ORDER BY created_at DESC LIMIT 3`,
  [OWNER],
);
for (const row of conf.rows) {
  console.log(
    "CONFLICT",
    row.id.slice(0, 8),
    row.status,
    "| fields",
    JSON.stringify(row.conflicting_fields),
    "| created",
    row.created_at,
    "| resolved",
    row.resolved_at,
  );
  console.log("   resolution:", JSON.stringify(row.resolution));
}
if (!conf.rows.length) console.log("NO SEMESTER_WEEK CONFLICTS FOUND");
const weeks = await client.query(
  `SELECT semester_id, week_number, start_date, end_date
   FROM semester_weeks WHERE owner_id=$1 ORDER BY semester_id, week_number`,
  [OWNER],
);
console.log(
  "SEMESTER_WEEKS(" + weeks.rowCount + "):",
  JSON.stringify(weeks.rows),
);
const revs = await client.query(
  `SELECT collection_type, parent_id, collection_version, updated_at
   FROM sync_collection_revisions WHERE owner_id=$1 ORDER BY updated_at DESC`,
  [OWNER],
);
console.log("REVISIONS:", JSON.stringify(revs.rows));
await client.end();
