const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");

const DESKTOP_PORT = Number(process.env.STOCKFLOW_DESKTOP_PORT || 4310);
const APP_URL = `http://127.0.0.1:${DESKTOP_PORT}`;
const SERVER_URL = `${APP_URL}/api/health`;

let mainWindow = null;
let serverModule = null;

function requestSingleInstance() {
  const hasLock = app.requestSingleInstanceLock();

  if (!hasLock) {
    app.quit();
    return false;
  }

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  return true;
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Health check failed with status ${response.statusCode}.`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("Health check did not return valid JSON."));
        }
      });
    });

    request.on("error", reject);
    request.end();
  });
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await httpGetJson(SERVER_URL);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error("The Stock Flow desktop server did not start in time.");
}

async function startBackend() {
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  process.env.PORT = String(process.env.PORT || DESKTOP_PORT);
  process.env.STOCKFLOW_DESKTOP_APP = "1";
  process.env.STOCKFLOW_DATA_DIR =
    process.env.STOCKFLOW_DATA_DIR || path.join(app.getPath("userData"), "data");

  const serverEntry = pathToFileURL(path.join(__dirname, "..", "server", "server.js")).href;
  serverModule = await import(serverEntry);

  if (serverModule?.serverReady) {
    await serverModule.serverReady;
  }

  await waitForServer();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f4f6f9",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const normalizedUrl = String(url ?? "").trim();
    const isInternalPreviewWindow =
      !normalizedUrl ||
      normalizedUrl === "about:blank" ||
      normalizedUrl.startsWith(APP_URL);

    if (isInternalPreviewWindow) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1200,
          height: 900,
          minWidth: 900,
          minHeight: 680,
          autoHideMenuBar: true,
          backgroundColor: "#ffffff",
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }

    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(APP_URL);
}

async function bootstrapDesktop() {
  try {
    await startBackend();
    createWindow();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The desktop app could not start the local Stock Flow server.";

    dialog.showErrorBox("Stock Flow could not start", message);
    app.quit();
  }
}

if (requestSingleInstance()) {
  app.whenReady().then(bootstrapDesktop);

  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) {
      createWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    if (serverModule?.server?.close) {
      try {
        serverModule.server.close();
      } catch {
        // Best-effort shutdown for the embedded local server.
      }
    }
  });
}
