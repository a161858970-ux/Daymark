import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

it("applies the canonical schema and enforces two-state Item and provenance constraints", async () => {
  const db = new PGlite();
  try {
    const path = fileURLToPath(
      new URL(
        "../../../../backend/migrations/001_initial.sql",
        import.meta.url,
      ),
    );
    await db.exec(await readFile(path, "utf8"));
    const collectionPath = fileURLToPath(
      new URL(
        "../../../../backend/migrations/002_collection_sync.sql",
        import.meta.url,
      ),
    );
    await db.exec(await readFile(collectionPath, "utf8"));
    const importPath = fileURLToPath(
      new URL(
        "../../../../backend/migrations/003_course_import.sql",
        import.meta.url,
      ),
    );
    await db.exec(await readFile(importPath, "utf8"));
    const reminderPath = fileURLToPath(
      new URL(
        "../../../../backend/migrations/004_reminder_delivery.sql",
        import.meta.url,
      ),
    );
    await db.exec(await readFile(reminderPath, "utf8"));
    const nullablePath = fileURLToPath(
      new URL(
        "../../../../backend/migrations/005_schedule_times_nullable.sql",
        import.meta.url,
      ),
    );
    await db.exec(await readFile(nullablePath, "utf8"));
    const cachePath = fileURLToPath(
      new URL(
        "../../../../backend/migrations/006_course_import_parse_cache.sql",
        import.meta.url,
      ),
    );
    await db.exec(await readFile(cachePath, "utf8"));
    const datePrecisionPath = fileURLToPath(
      new URL(
        "../../../../backend/migrations/007_date_precision.sql",
        import.meta.url,
      ),
    );
    await db.exec(await readFile(datePrecisionPath, "utf8"));
    const tables = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    const names = tables.rows.map((row) => row.tablename);
    expect(names).toContain("items");
    expect(names).toContain("raw_capture_outputs");
    expect(names).toContain("sync_conflicts");
    expect(names).toContain("sync_collection_revisions");
    expect(names).toContain("course_import_jobs");
    expect(names).toContain("course_import_commits");
    expect(names).toContain("course_import_parse_cache");
    expect(names).toContain("notification_deliveries");
    expect(names).toContain("devices");

    const owner = "11111111-1111-4111-8111-111111111111";
    const rawId = "22222222-2222-4222-8222-222222222222";
    const itemId = "33333333-3333-4333-8333-333333333333";
    const now = "2026-09-22T08:00:00Z";
    await db.query(
      "INSERT INTO raw_captures(id, owner_id, source, raw_text, captured_at, processing_status) VALUES($1,$2,'QUICK_CAPTURE','找学姐要笔记',$3,'RAW')",
      [rawId, owner, now],
    );
    await db.query(
      "INSERT INTO items(id, owner_id, title, status, reminder_level, created_at, updated_at, raw_capture_id) VALUES($1,$2,'找学姐要笔记','INCOMPLETE','NORMAL',$3,$3,$4)",
      [itemId, owner, now, rawId],
    );
    await db.query(
      "INSERT INTO raw_capture_outputs(id, owner_id, raw_capture_id, object_type, object_id, created_at) VALUES($1,$2,$3,'ITEM',$4,$5)",
      ["44444444-4444-4444-8444-444444444444", owner, rawId, itemId, now],
    );
    const found = await db.query<{
      course_id: string | null;
      due_at: string | null;
    }>("SELECT course_id, due_at FROM items WHERE id = $1", [itemId]);
    expect(found.rows[0]?.course_id).toBeNull();
    expect(found.rows[0]?.due_at).toBeNull();
    await expect(
      db.query("UPDATE items SET status = 'OVERDUE' WHERE id = $1", [itemId]),
    ).rejects.toThrow();

    // 005: a periods-only timetable carries no clock time. Both times are
    // absent together; a one-sided or inverted pair still violates the CHECK.
    const undatedCourse = "55555555-5555-4555-8555-555555555555";
    await db.query(
      "INSERT INTO courses(id, owner_id, name, created_at, updated_at) VALUES($1,$2,'健康经济学',$3,$3)",
      [undatedCourse, owner, now],
    );
    await db.query(
      "INSERT INTO course_schedules(id, owner_id, course_id, weekday, start_time, end_time, stage_label, created_at, updated_at) VALUES('66666666-6666-4666-8666-666666666666',$1,$2,1,NULL,NULL,'12-13节',$3,$3)",
      [owner, undatedCourse, now],
    );
    const undated = await db.query<{ start_time: string | null }>(
      "SELECT start_time FROM course_schedules WHERE id='66666666-6666-4666-8666-666666666666'",
    );
    expect(undated.rows[0]?.start_time).toBeNull();
    await expect(
      db.query(
        "INSERT INTO course_schedules(id, owner_id, course_id, weekday, start_time, end_time, created_at, updated_at) VALUES('77777777-7777-4777-8777-777777777777',$1,$2,1,'08:00',NULL,$3,$3)",
        [owner, undatedCourse, now],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        "INSERT INTO course_schedules(id, owner_id, course_id, weekday, start_time, end_time, created_at, updated_at) VALUES('88888888-8888-4888-8888-888888888888',$1,$2,1,'09:00','08:00',$3,$3)",
        [owner, undatedCourse, now],
      ),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
});
