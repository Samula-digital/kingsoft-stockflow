import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = resolve(rootDir, "node_modules", "vite", "bin", "vite.js");

const childProcesses = [
  spawn(process.execPath, [resolve(rootDir, "server", "server.js"), "--dev"], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      HOST: process.env.HOST || "127.0.0.1",
      PORT: process.env.API_PORT || "4000",
    },
  }),
  spawn(process.execPath, [viteBin], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      HOST: process.env.HOST || "127.0.0.1",
      VITE_API_PORT: process.env.API_PORT || "4000",
    },
  }),
];

function shutdown(exitCode = 0) {
  for (const childProcess of childProcesses) {
    if (!childProcess.killed) {
      childProcess.kill("SIGTERM");
    }
  }

  process.exit(exitCode);
}

for (const childProcess of childProcesses) {
  childProcess.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown(code);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
