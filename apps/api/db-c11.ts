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
const rows = await client.query(
  `SELECT id, entity_type, entity_id, conflicting_fields, status, created_at,
          local_version, remote_version
   FROM sync_conflicts WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 2`,
  [OWNER],
);
for (const row of rows.rows) {
  console.log(
    "== CONFLICT",
    row.id.slice(0, 8),
    row.entity_type,
    row.status,
    row.created_at,
  );
  console.log("   fields:", JSON.stringify(row.conflicting_fields));
  console.log("   LOCAL:", JSON.stringify(row.local_version).slice(0, 700));
  console.log("   REMOTE:", JSON.stringify(row.remote_version).slice(0, 700));
}
const sched = await client.query(
  `SELECT weekday, start_time, end_time, week_start, week_end, classroom, stage_label, row_version
   FROM course_schedules WHERE owner_id=$1 ORDER BY weekday, start_time`,
  [OWNER],
);
console.log("COURSE_SCHEDULES:", JSON.stringify(sched.rows));
await client.end();
