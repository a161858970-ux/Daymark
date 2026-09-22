import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const compilerPath = fileURLToPath(
  new URL("../../../node_modules/typescript/bin/tsc", import.meta.url),
);
const children = [
  spawn(
    process.execPath,
    [compilerPath, "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"],
    {
      cwd,
      stdio: "inherit",
    },
  ),
  spawn(process.execPath, ["--watch", "dist/main.js"], {
    cwd,
    stdio: "inherit",
  }),
];

let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  for (const child of children) if (!child.killed) child.kill();
}
for (const child of children) {
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code) => {
    if (closing) return;
    process.exitCode = code ?? 1;
    stop();
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
