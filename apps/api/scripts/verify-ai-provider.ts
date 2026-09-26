/**
 * Real-provider smoke test for the MiMo (or any OpenAI-compatible) endpoint.
 *
 *   pnpm verify:ai                 interpretation round trip
 *   pnpm verify:ai --with-import   also parses the scanned-PDF fixture
 *
 * Never prints the key. Without configuration it exits 2 and reports
 * REAL_AI_REQUIRED instead of a fabricated pass.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  courseImportParseResultSchema,
  interpretationSchema,
} from "@course-manager/contracts";
import {
  ChatCompletionsInterpretationProvider,
  ProviderError,
} from "../src/ai/chat-provider.js";
import { ChatCompletionsCourseImportParser } from "../src/ai/course-import-chat-parser.js";

async function loadRootEnv(): Promise<void> {
  const path = fileURLToPath(new URL("../../../.env", import.meta.url));
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    const value = match[2]!.trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function requireConfig() {
  await loadRootEnv();
  const apiKey = process.env.AI_API_KEY ?? process.env.MIMO_API_KEY;
  const model = process.env.AI_MODEL ?? "mimo-v2.6-flash";
  const baseUrl = process.env.AI_BASE_URL ?? "https://api.xiaomimimo.com/v1";
  if (!apiKey) {
    console.error("REAL_AI_REQUIRED");
    console.error("Set AI_API_KEY in the repository-root .env (or the shell).");
    console.error("Optional: AI_MODEL (default mimo-v2.6-flash), AI_BASE_URL.");
    process.exit(2);
  }
  return { apiKey, model, baseUrl };
}

function describe(error: unknown): string {
  if (error instanceof ProviderError)
    return `ProviderError kind=${error.kind} status=${error.status ?? "-"}`;
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const config = await requireConfig();
  const withImport = process.argv.includes("--with-import");

  const provider = new ChatCompletionsInterpretationProvider(config);
  const started = Date.now();
  try {
    const raw = await provider.interpret({
      rawText: "环境经济学，老师让我们关注一下第三章。",
      source: "QUICK_CAPTURE",
      currentCourseName: "环境经济学",
      candidateCourseNames: ["环境经济学"],
      semesterDates: { start: "2026-09-01", end: "2027-01-15" },
      currentDate: new Date().toISOString().slice(0, 10),
    });
    const interpretation = interpretationSchema.parse(raw);
    console.log(
      `PASS interpretation ${Date.now() - started}ms classification=${interpretation.classification}`,
    );
  } catch (error) {
    console.error(`FAIL interpretation: ${describe(error)}`);
    process.exitCode = 1;
    return;
  }

  if (!withImport) return;
  const fixture = fileURLToPath(
    new URL("../src/ai/__fixtures__/scanned-timetable.pdf", import.meta.url),
  );
  const parser = new ChatCompletionsCourseImportParser(config);
  const importStarted = Date.now();
  try {
    const raw = await parser.parse({
      sourceType: "PDF",
      fileName: "scanned-timetable.pdf",
      mediaType: "application/pdf",
      contentBase64: (await readFile(fixture)).toString("base64"),
    });
    const preview = courseImportParseResultSchema.parse(raw);
    console.log(
      `PASS import ${Date.now() - importStarted}ms courses=${preview.courses.length}`,
    );
  } catch (error) {
    console.error(`FAIL import: ${describe(error)}`);
    process.exitCode = 1;
  }
}

await main();
