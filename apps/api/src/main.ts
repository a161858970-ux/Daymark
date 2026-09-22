import { buildServer } from "./server.js";
import pg from "pg";
import { createSupabaseVerifier } from "./auth.js";
import { CloudCourseManager, PoolCloudDatabase } from "./db/cloud.js";
import { CloudSync } from "./db/sync.js";
import { CloudAcademicManager } from "./db/academic.js";
import { CaptureInterpretationService } from "./ai/interpretation.js";
import { OpenAIInterpretationProvider } from "./ai/openai-provider.js";
import { CloudConflictManager } from "./db/conflicts.js";

const port = Number(process.env.PORT ?? 3100);
const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
if (Boolean(databaseUrl) !== Boolean(supabaseUrl))
  throw new Error("DATABASE_URL and SUPABASE_URL must be configured together");
const pool = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl })
  : null;
const cloudDatabase = pool ? new PoolCloudDatabase(pool) : null;
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL;
if (apiKey && !model)
  throw new Error("OPENAI_MODEL is required when OPENAI_API_KEY is set");
const cloud = cloudDatabase ? new CloudCourseManager(cloudDatabase) : null;
const academic = cloudDatabase ? new CloudAcademicManager(cloudDatabase) : null;
const server = buildServer(
  pool && supabaseUrl
    ? {
        cloud: cloud!,
        sync: new CloudSync(cloudDatabase!),
        conflicts: new CloudConflictManager(cloudDatabase!),
        academic: academic!,
        interpretation: new CaptureInterpretationService(
          cloud!,
          academic!,
          apiKey && model
            ? new OpenAIInterpretationProvider(apiKey, model)
            : null,
        ),
        verifyToken: createSupabaseVerifier(supabaseUrl),
      }
    : undefined,
);
server.addHook("onClose", async () => {
  await pool?.end();
});
try {
  await server.listen({ host: "127.0.0.1", port });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
