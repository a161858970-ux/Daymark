import { spawnSync } from "node:child_process";

if (!process.env.REAL_DATABASE_URL) {
  process.stderr.write(
    "REAL_DATABASE_URL is required; use a disposable PostgreSQL database.\n",
  );
  process.exitCode = 1;
} else {
  const pnpmEntry = process.env.npm_execpath;
  if (!pnpmEntry)
    throw new Error("Run this verification through pnpm test:postgres");
  const result = spawnSync(
    process.execPath,
    [pnpmEntry, "--filter", "@course-manager/api", "run", "test:postgres"],
    { stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
