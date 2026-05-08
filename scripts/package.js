import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialAppState } from "../server/appState.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = resolve(rootDir, "release");
const packageDir = resolve(releaseRoot, "stockflow-online");

function ensureCleanDir(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function copyIfExists(sourceRelativePath) {
  const sourcePath = resolve(rootDir, sourceRelativePath);
  if (!existsSync(sourcePath)) return;
  cpSync(sourcePath, resolve(packageDir, sourceRelativePath), {
    recursive: true,
  });
}

// Ensure the portable JSON-backed shared store exists before packaging so
// deployments on Node 20 hosts do not depend on node:sqlite support.
await import(resolve(rootDir, "server/store.js"));

ensureCleanDir(packageDir);

[
  "app.js",
  "app.cjs",
  "dist",
  "server",
  "src",
  "public",
  "package.json",
  "package-lock.json",
  "README.md",
  "vite.config.js",
  "index.html",
].forEach(copyIfExists);

const packageDataDir = resolve(packageDir, "data");
mkdirSync(packageDataDir, { recursive: true });

writeFileSync(
  resolve(packageDataDir, "kingsoft-stockflow.json"),
  JSON.stringify(
    {
      appState: {
        state: createInitialAppState(),
        updatedAt: new Date().toISOString(),
      },
      users: [],
      sessions: [],
    },
    null,
    2
  ),
  "utf8"
);

// The deployment path now uses the JSON-backed shared store for Node 20 host
// compatibility, so exclude legacy SQLite artifacts from the packaged bundle.
[
  resolve(packageDir, "data", "kingsoft-stockflow.sqlite"),
  resolve(packageDir, "data", "kingsoft-stockflow.sqlite-shm"),
  resolve(packageDir, "data", "kingsoft-stockflow.sqlite-wal"),
].forEach((path) => {
  rmSync(path, { force: true });
});

writeFileSync(
  resolve(packageDir, "DEPLOY.md"),
  `# Stock Flow Deploy Bundle

This package is prepared for a shared online deployment and installable app rollout.

## Start

\`\`\`bash
npm install
npm run start
\`\`\`

The shared app will run on port \`4000\` by default.

## cPanel Node.js App

If your cPanel Node.js setup expects a root-level startup file, use \`app.cjs\` first.
If your host accepts ES module startup files directly, \`app.js\` also works.

## Native-like App

Open the deployed URL in Chrome, Edge, or another PWA-capable browser, then choose \`Install App\`.

## Notes

- This bundle starts with a clean shared JSON store inside \`data/kingsoft-stockflow.json\`.
- If you are moving an existing live site, copy your real \`data/\` folder over after deployment instead of using the clean starter file.
- Use HTTPS for internet-facing deployment so login cookies and install prompts work properly.
- Keep regular backups of the \`data/\` folder.
`,
  "utf8"
);

console.log(`Release bundle created at ${packageDir}`);
