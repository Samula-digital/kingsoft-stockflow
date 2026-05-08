import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const port = process.env.PORT || "4000";

function runCommand(command, args, env = process.env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const childProcess = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      env,
    });

    childProcess.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}.`));
    });

    childProcess.on("error", rejectPromise);
  });
}

async function startLanServer() {
  console.log("Building Stock Flow for LAN use...");
  await runCommand(npmCommand, ["run", "build"]);

  console.log("");
  console.log("Starting Stock Flow on the local network...");
  console.log(`The host machine should stay on while others use http://<host-ip>:${port}`);
  console.log("If Windows asks about firewall access, allow Node.js on the private network.");
  console.log("");

  const serverProcess = spawn(process.execPath, [resolve(rootDir, "server", "server.js")], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      HOST: "0.0.0.0",
      PORT: port,
    },
  });

  const shutdown = () => {
    if (!serverProcess.killed) {
      serverProcess.kill("SIGTERM");
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  serverProcess.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  serverProcess.on("error", (error) => {
    console.error("Stock Flow LAN mode could not start:", error.message);
    process.exit(1);
  });
}

startLanServer().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
