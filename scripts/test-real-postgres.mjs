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
  const args = ["--filter", "@daymark/api", "run", "test:postgres"];
  // npm_execpath is a .js entry when pnpm runs as a script, but a native
  // executable (pnpm.exe) in other installs - Node cannot execute that, so
  // hand the native entry its own process instead.
  const entryIsJs = /\.(c|m)?js$/.test(pnpmEntry);
  const result = entryIsJs
    ? spawnSync(process.execPath, [pnpmEntry, ...args], {
        stdio: "inherit",
        env: process.env,
      })
    : spawnSync(pnpmEntry, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
