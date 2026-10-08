import { randomUUID } from "node:crypto";
import pg from "pg";
import { uuidSchema } from "@daymark/contracts";

if (process.env.ALLOW_DEVELOPMENT_SEED !== "1")
  throw new Error(
    "Set ALLOW_DEVELOPMENT_SEED=1 to seed a development database",
  );
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const ownerId = uuidSchema.parse(process.env.SEED_OWNER_ID);
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  const existingSemester = await client.query<{ id: string }>(
    "SELECT id FROM semesters WHERE owner_id=$1 AND name='开发验证学期' AND deleted_at IS NULL LIMIT 1",
    [ownerId],
  );
  const semesterId = existingSemester.rows[0]?.id ?? randomUUID();
  if (!existingSemester.rows[0]) {
    await client.query(
      `INSERT INTO semesters
       (id,owner_id,name,start_date,end_date,created_at,updated_at,deleted_at,row_version)
       VALUES ($1,$2,'开发验证学期','2026-09-01','2026-12-31',now(),now(),NULL,1)`,
      [semesterId, ownerId],
    );
  }
  const existingCourse = await client.query<{ id: string }>(
    "SELECT id FROM courses WHERE owner_id=$1 AND semester_id=$2 AND name='同步验证课程' AND deleted_at IS NULL LIMIT 1",
    [ownerId, semesterId],
  );
  const courseId = existingCourse.rows[0]?.id ?? randomUUID();
  if (!existingCourse.rows[0]) {
    await client.query(
      `INSERT INTO courses
       (id,owner_id,semester_id,name,instructor,created_at,updated_at,deleted_at,row_version)
       VALUES ($1,$2,$3,'同步验证课程',NULL,now(),now(),NULL,1)`,
      [courseId, ownerId, semesterId],
    );
  }
  await client.query("COMMIT");
  process.stdout.write(
    `Seed ready for owner ${ownerId}: semester ${semesterId}, course ${courseId}\n`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
