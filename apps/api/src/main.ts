import { buildServer } from "./server.js";
import pg from "pg";
import { createSupabaseVerifier } from "./auth.js";
import { CloudCourseManager, PoolCloudDatabase } from "./db/cloud.js";
import { CloudSync } from "./db/sync.js";
import { CloudAcademicManager } from "./db/academic.js";
import { CaptureInterpretationService } from "./ai/interpretation.js";
import { ChatCompletionsInterpretationProvider } from "./ai/chat-provider.js";
import { CloudConflictManager } from "./db/conflicts.js";
import { CloudCourseImportManager } from "./db/course-import.js";
import { surviveIdleDisconnects } from "./db/poolSupervisor.js";
import { CloudNotificationManager } from "./db/notifications.js";
import { RateLimiter, rateLimitFromEnv } from "./rateLimit.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Repo-root .env keeps secrets out of the shell; real environment wins. */
function loadRootEnvFile(): void {
  const path = fileURLToPath(new URL("../../../.env", import.meta.url));
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    )
      value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadRootEnvFile();
import { ChatCompletionsCourseImportParser } from "./ai/course-import-chat-parser.js";

const port = Number(process.env.PORT ?? 3100);
const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_URL;
if (Boolean(databaseUrl) !== Boolean(supabaseUrl))
  throw new Error("DATABASE_URL and SUPABASE_URL must be configured together");
const pool = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl })
  : null;
// Without a listener a dropped idle socket is an uncaught pool error and
// takes the API down (Connection terminated unexpectedly).
if (pool) surviveIdleDisconnects(pool);
const cloudDatabase = pool ? new PoolCloudDatabase(pool) : null;
const apiKey =
  process.env.AI_API_KEY ??
  process.env.MIMO_API_KEY ??
  process.env.OPENAI_API_KEY;
// Provider is the OpenAI-compatible MiMo endpoint; any other compatible
// endpoint can be selected with AI_BASE_URL.
const model =
  process.env.AI_MODEL ??
  process.env.MIMO_MODEL ??
  process.env.OPENAI_MODEL ??
  "mimo-v2.6-flash";
const baseUrl =
  process.env.AI_BASE_URL ??
  process.env.MIMO_BASE_URL ??
  "https://api.xiaomimimo.com/v1";
const providerConfig = apiKey ? { apiKey, model, baseUrl } : null;
const cloud = cloudDatabase ? new CloudCourseManager(cloudDatabase) : null;
// Security default (configurable): AI endpoints only, per authenticated owner.
const aiRateLimiter = new RateLimiter(rateLimitFromEnv());
const academic = cloudDatabase ? new CloudAcademicManager(cloudDatabase) : null;
const server = buildServer(
  pool && supabaseUrl
    ? {
        cloud: cloud!,
        sync: new CloudSync(cloudDatabase!),
        conflicts: new CloudConflictManager(cloudDatabase!),
        academic: academic!,
        notifications: new CloudNotificationManager(cloudDatabase!),
        courseImports: new CloudCourseImportManager(
          cloudDatabase!,
          providerConfig
            ? new ChatCompletionsCourseImportParser(providerConfig)
            : null,
          aiRateLimiter,
        ),
        interpretation: new CaptureInterpretationService(
          cloud!,
          academic!,
          providerConfig
            ? new ChatCompletionsInterpretationProvider(providerConfig)
            : null,
          aiRateLimiter,
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
