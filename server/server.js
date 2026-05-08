import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BRAND_ACCENT_COLOR,
  DEFAULT_BRAND_SIDEBAR_COLOR,
  getBrandInitials,
  normalizeHexColor,
} from "../src/utils/branding.js";
import { createEntityId } from "../src/utils/formatters.js";
import { validatePasswordStrength } from "../src/utils/passwordPolicy.js";
import {
  applyOpeningBalancesInState,
  createInitialAppState,
  deleteMovementInState,
  importDepartmentsInState,
  importFullWorkbookInState,
  importItemMasterInState,
  importMovementsInState,
  saveDepartmentInState,
  saveItemInState,
  saveMovementInState,
  updateMovementInState,
  updateSettingsInState,
} from "./appState.js";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  verifyPassword,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "./auth.js";
import { createPublicBootstrapState } from "./publicState.js";
import { shouldUseSecureCookies } from "./requestSecurity.js";
import {
  createSessionRecord,
  createUserAccount,
  deleteSessionRecord,
  findSessionUser,
  findUserAuthById,
  findUserByEmail,
  getAppStateRecord,
  hasUsers,
  listUsers,
  mutateAppState,
  recordUserSignIn,
  updateUserPassword,
  updateUserStatus,
} from "./store.js";

const serverDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const rootDir = resolve(serverDir, "..");
const distDir = resolve(rootDir, "dist");
const isPreviewMode = process.argv.includes("--preview");
const isDevMode = process.argv.includes("--dev");
const port = Number(process.env.PORT) || (isPreviewMode ? 4173 : 4000);
const host = String(process.env.HOST || "").trim() || undefined;
const isDesktopApp = process.env.STOCKFLOW_DESKTOP_APP === "1";
const secureCookieOverride =
  process.env.STOCKFLOW_SECURE_COOKIES ?? process.env.COOKIE_SECURE ?? "";
const AUTH_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const AUTH_ATTEMPT_LOCK_MS = 15 * 60 * 1000;
const AUTH_ATTEMPT_MAX_FAILURES = 6;
const authAttemptMap = new Map();

const baseSecurityHeaders = {
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; connect-src 'self' ws: wss:; font-src 'self' data: https: http:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const rolePermissions = {
  admin: {
    canEnterMovements: true,
    canCreateItems: true,
    canEditMovementHistory: true,
    canDeleteMovementHistory: true,
    canEditSystem: true,
  },
  store: {
    canEnterMovements: true,
    canCreateItems: true,
    canEditMovementHistory: true,
    canDeleteMovementHistory: true,
    canEditSystem: false,
  },
  finance: {
    canEnterMovements: false,
    canCreateItems: false,
    canEditMovementHistory: false,
    canDeleteMovementHistory: false,
    canEditSystem: false,
  },
};

function validateEmailAddress(value, { allowBlank = true } = {}) {
  const email = String(value ?? "").trim();
  if (!email) {
    return {
      isValid: allowBlank,
      email: "",
      error: allowBlank ? "" : "Email address is required.",
    };
  }

  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  return {
    isValid,
    email,
    error: isValid ? "" : "Enter a valid email address.",
  };
}

function getRolePermissions(role) {
  return rolePermissions[role] ?? rolePermissions.finance;
}

function readJsonBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let totalLength = 0;

    request.on("data", (chunk) => {
      totalLength += chunk.length;
      if (totalLength > 25 * 1024 * 1024) {
        rejectPromise(createHttpError("Request body is too large.", 413));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      if (!chunks.length) {
        resolvePromise({});
        return;
      }

      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolvePromise(parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        rejectPromise(createHttpError("The request body was not valid JSON.", 400));
      }
    });

    request.on("error", rejectPromise);
  });
}

function writeJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...baseSecurityHeaders,
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function writeText(response, statusCode, body, contentType, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    ...baseSecurityHeaders,
    ...headers,
  });
  response.end(body);
}

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function notFound(response) {
  writeJson(response, 404, {
    ok: false,
    error: "Not found.",
  });
}

function listLanAddresses() {
  const interfaces = networkInterfaces();
  const addresses = [];

  for (const interfaceEntries of Object.values(interfaces)) {
    for (const entry of interfaceEntries ?? []) {
      if (!entry || entry.internal) continue;
      if (entry.family !== "IPv4") continue;
      addresses.push(entry.address);
    }
  }

  return [...new Set(addresses)];
}

function normalizeRoute(pathname) {
  return String(pathname ?? "").split("?")[0] || "/";
}

function validatePassword(value) {
  return validatePasswordStrength(value);
}

function validateRole(value, allowAdmin = true) {
  const role = String(value ?? "store").trim().toLowerCase() || "store";
  const allowedRoles = allowAdmin ? ["store", "finance", "admin"] : ["store", "finance"];

  return {
    isValid: allowedRoles.includes(role),
    role,
  };
}

async function getCurrentUser(request) {
  const cookies = parseCookies(request.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  if (!sessionToken) return null;

  const user = await findSessionUser(hashSessionToken(sessionToken));
  if (!user || user.status !== "approved") {
    return null;
  }

  return user;
}

function getRequestIp(request) {
  const forwardedFor = String(request.headers["x-forwarded-for"] ?? "")
    .split(",")[0]
    .trim();

  return forwardedFor || request.socket.remoteAddress || "unknown";
}

function buildAuthAttemptKey(kind, request, identifier = "") {
  const normalizedIdentifier = String(identifier ?? "").trim().toLowerCase();
  return `${kind}|${getRequestIp(request)}|${normalizedIdentifier}`;
}

function pruneAuthAttemptEntry(key, now = Date.now()) {
  const entry = authAttemptMap.get(key);
  if (!entry) return null;

  if (entry.lockedUntil && entry.lockedUntil > now) {
    return entry;
  }

  const freshFailures = entry.failures.filter((timestamp) => now - timestamp <= AUTH_ATTEMPT_WINDOW_MS);

  if (!freshFailures.length) {
    authAttemptMap.delete(key);
    return null;
  }

  const nextEntry = {
    failures: freshFailures,
    lockedUntil: entry.lockedUntil && entry.lockedUntil > now ? entry.lockedUntil : 0,
  };
  authAttemptMap.set(key, nextEntry);
  return nextEntry;
}

function assertAuthAttemptAllowed(key, actionLabel = "Too many attempts") {
  const now = Date.now();
  const entry = pruneAuthAttemptEntry(key, now);

  if (!entry?.lockedUntil || entry.lockedUntil <= now) {
    return;
  }

  const retryMinutes = Math.max(1, Math.ceil((entry.lockedUntil - now) / 60000));
  throw createHttpError(`${actionLabel}. Try again in ${retryMinutes} minute(s).`, 429);
}

function recordAuthFailure(key) {
  const now = Date.now();
  const entry = pruneAuthAttemptEntry(key, now) ?? {
    failures: [],
    lockedUntil: 0,
  };

  const failures = [...entry.failures, now].filter(
    (timestamp) => now - timestamp <= AUTH_ATTEMPT_WINDOW_MS
  );
  const lockedUntil =
    failures.length >= AUTH_ATTEMPT_MAX_FAILURES ? now + AUTH_ATTEMPT_LOCK_MS : entry.lockedUntil;

  authAttemptMap.set(key, {
    failures,
    lockedUntil,
  });
}

function clearAuthFailures(key) {
  authAttemptMap.delete(key);
}

async function buildSnapshot(currentUser = null) {
  const { state, updatedAt } = await getAppStateRecord();
  const safeCurrentUser = currentUser?.id ? await findUserAuthById(currentUser.id) : null;
  const approvedCurrentUser =
    safeCurrentUser && safeCurrentUser.status === "approved"
      ? {
          id: safeCurrentUser.id,
          name: safeCurrentUser.name,
          email: safeCurrentUser.email,
          role: safeCurrentUser.role,
          status: safeCurrentUser.status,
          createdAt: safeCurrentUser.createdAt,
          approvedAt: safeCurrentUser.approvedAt,
          approvedBy: safeCurrentUser.approvedBy,
          lastSignedInAt: safeCurrentUser.lastSignedInAt,
          forcePasswordReset: safeCurrentUser.forcePasswordReset,
        }
      : null;

  return {
    ok: true,
    requiresBootstrap: !(await hasUsers()),
    state: approvedCurrentUser ? state : createPublicBootstrapState(state),
    currentUser: approvedCurrentUser,
    users: approvedCurrentUser?.role === "admin" ? await listUsers() : [],
    lastSavedAt: updatedAt,
  };
}

function buildSessionCookieOptions(request) {
  return {
    secure: shouldUseSecureCookies(request, {
      isDevMode,
      isDesktopApp,
      override: secureCookieOverride,
    }),
  };
}

function requireSignedIn(currentUser, response) {
  if (currentUser) return true;

  writeJson(response, 401, {
    ok: false,
    error: "Sign in to continue.",
  });
  return false;
}

function requireAdmin(currentUser, response) {
  if (!requireSignedIn(currentUser, response)) return false;
  if (currentUser.role === "admin") return true;

  writeJson(response, 403, {
    ok: false,
    error: "Admin access is required for this action.",
  });
  return false;
}

function requireItemCreator(currentUser, response) {
  if (!requireSignedIn(currentUser, response)) return false;
  if (getRolePermissions(currentUser.role).canCreateItems) return true;

  writeJson(response, 403, {
    ok: false,
    error: "Your account cannot create new items.",
  });
  return false;
}

function parseUserIdFromPath(pathname, actionSuffix) {
  const prefix = "/api/users/";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(actionSuffix)) {
    return "";
  }

  return decodeURIComponent(pathname.slice(prefix.length, pathname.length - actionSuffix.length));
}

function getMimeType(filePath) {
  const extension = extname(filePath).toLowerCase();

  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".json": "application/json; charset=utf-8",
      ".ico": "image/x-icon",
    }[extension] || "application/octet-stream"
  );
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function getBrandSnapshot() {
  const { state } = await getAppStateRecord();

  return {
    productName: String(state?.productName ?? "Stock Flow").trim() || "Stock Flow",
    hotelName: String(state?.hotelName ?? "Stock Flow").trim() || "Stock Flow",
    accentColor: normalizeHexColor(state?.brandAccentColor, DEFAULT_BRAND_ACCENT_COLOR),
    sidebarColor: normalizeHexColor(state?.brandSidebarColor, DEFAULT_BRAND_SIDEBAR_COLOR),
  };
}

async function buildManifestPayload() {
  const brand = await getBrandSnapshot();
  const shortName = brand.productName.slice(0, 28) || "Stock Flow";

  return {
    name: `${brand.hotelName} - ${brand.productName}`,
    short_name: shortName,
    description:
      `${brand.productName} for stores, stock movement control, and finance reporting.`,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f4f6f9",
    theme_color: brand.sidebarColor,
    icons: [
      {
        src: "/app-icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/app-maskable.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Stock Movement",
        short_name: "Movement",
        url: "/?view=entry",
      },
      {
        name: "Finance Reports",
        short_name: "Reports",
        url: "/?view=finance",
      },
    ],
  };
}

async function buildPwaIconSvg({ maskable = false } = {}) {
  const brand = await getBrandSnapshot();
  const initials = escapeXml(getBrandInitials(brand.hotelName));
  const title = escapeXml(brand.hotelName);
  const subtitle = escapeXml(brand.productName.slice(0, 26));
  const outerInset = maskable ? 48 : 28;
  const innerInset = maskable ? 86 : 58;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${subtitle}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${brand.sidebarColor}" />
      <stop offset="100%" stop-color="${brand.accentColor}" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${maskable ? 140 : 112}" fill="url(#bg)" />
  <rect x="${outerInset}" y="${outerInset}" width="${512 - outerInset * 2}" height="${512 - outerInset * 2}" rx="${maskable ? 112 : 92}" fill="#ffffff" fill-opacity="0.12" />
  <rect x="${innerInset}" y="${innerInset}" width="${512 - innerInset * 2}" height="${512 - innerInset * 2}" rx="${maskable ? 80 : 64}" fill="#ffffff" />
  <text x="256" y="248" text-anchor="middle" font-family="Avenir Next, Segoe UI, Arial, sans-serif" font-size="148" font-weight="800" fill="${brand.sidebarColor}">${initials}</text>
  <text x="256" y="324" text-anchor="middle" font-family="Avenir Next, Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="${brand.accentColor}" letter-spacing="4">STOCK FLOW</text>
</svg>`;
}

async function serveManifest(response) {
  writeText(
    response,
    200,
    JSON.stringify(await buildManifestPayload(), null, 2),
    "application/manifest+json; charset=utf-8",
    {
      "Cache-Control": "no-cache",
    }
  );
}

async function servePwaIcon(response, options = {}) {
  writeText(
    response,
    200,
    await buildPwaIconSvg(options),
    "image/svg+xml; charset=utf-8",
    {
      "Cache-Control": "no-cache",
    }
  );
}

function serveStatic(pathname, response) {
  if (!existsSync(distDir)) {
    response.writeHead(503, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...baseSecurityHeaders,
    });
    response.end("The app has not been built yet. Run npm run build first.");
    return;
  }

  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(distDir, safePath));
  const requestedExtension = extname(relativePath).toLowerCase();

  if (filePath.startsWith(distDir) && existsSync(filePath) && statSync(filePath).isFile()) {
    response.writeHead(200, {
      "Content-Type": getMimeType(filePath),
      "Cache-Control": requestedExtension === ".html" ? "no-cache" : "public, max-age=0, must-revalidate",
      ...baseSecurityHeaders,
    });
    response.end(readFileSync(filePath));
    return;
  }

  // Missing built assets should return a real 404 so deployment issues are visible
  // instead of falling back to index.html and rendering a blank page.
  if (requestedExtension) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...baseSecurityHeaders,
    });
    response.end(`Static file not found: ${relativePath}`);
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    ...baseSecurityHeaders,
  });
  response.end(readFileSync(join(distDir, "index.html")));
}

async function handleBootstrap(response, currentUser) {
  writeJson(response, 200, await buildSnapshot(currentUser));
}

async function handleBootstrapAdmin(request, response) {
  const throttleKey = buildAuthAttemptKey("bootstrap-admin", request);
  assertAuthAttemptAllowed(throttleKey, "Too many setup attempts");

  if (await hasUsers()) {
    writeJson(response, 400, {
      ok: false,
      error: "The first admin has already been created. Sign in instead.",
    });
    return;
  }

  const body = await readJsonBody(request);
  const name = String(body.name ?? "").trim();
  const emailCheck = validateEmailAddress(body.email, { allowBlank: false });
  const passwordCheck = validatePassword(body.password);

  if (!name || !emailCheck.isValid || !passwordCheck.isValid) {
    recordAuthFailure(throttleKey);
    writeJson(response, 400, {
      ok: false,
      error:
        !name
          ? "Full name is required."
          : emailCheck.error || passwordCheck.error,
    });
    return;
  }

  const user = await createUserAccount({
    id: createEntityId("USER"),
    name,
    email: emailCheck.email.toLowerCase(),
    passwordHash: hashPassword(passwordCheck.password),
    role: "admin",
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvedBy: "System Setup",
  }, { requireNoExistingUsers: true });

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await createSessionRecord({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    expiresAt,
  });
  await recordUserSignIn(user.id);
  clearAuthFailures(throttleKey);

  writeJson(
    response,
    200,
    await buildSnapshot(user),
    {
      "Set-Cookie": serializeSessionCookie(token, buildSessionCookieOptions(request)),
    }
  );
}

async function handleSignIn(request, response) {
  const body = await readJsonBody(request);
  const email = String(body.email ?? "").trim().toLowerCase();
  const throttleKey = buildAuthAttemptKey("signin", request, email);
  assertAuthAttemptAllowed(throttleKey, "Too many sign-in attempts");

  if (!(await hasUsers())) {
    writeJson(response, 400, {
      ok: false,
      error: "Create the first admin account before signing in.",
    });
    return;
  }

  const password = String(body.password ?? "").trim();
  const user = await findUserByEmail(email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    recordAuthFailure(throttleKey);
    writeJson(response, 401, {
      ok: false,
      error: "Email or password is incorrect.",
    });
    return;
  }

  clearAuthFailures(throttleKey);

  if (user.status === "pending") {
    writeJson(response, 403, {
      ok: false,
      error: "Your account is pending admin approval.",
    });
    return;
  }

  if (user.status !== "approved") {
    writeJson(response, 403, {
      ok: false,
      error: "Your account is not active.",
    });
    return;
  }

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await createSessionRecord({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    expiresAt,
  });
  await recordUserSignIn(user.id);

  writeJson(
    response,
    200,
    await buildSnapshot(user),
    {
      "Set-Cookie": serializeSessionCookie(token, buildSessionCookieOptions(request)),
    }
  );
}

async function handleSignOut(request, response) {
  const cookies = parseCookies(request.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  if (sessionToken) {
    await deleteSessionRecord(hashSessionToken(sessionToken));
  }

  writeJson(
    response,
    200,
    await buildSnapshot(null),
    {
      "Set-Cookie": serializeExpiredSessionCookie(buildSessionCookieOptions(request)),
    }
  );
}

async function handleRequestAccess(request, response) {
  const body = await readJsonBody(request);
  const throttleKey = buildAuthAttemptKey("request-access", request, body.email);
  assertAuthAttemptAllowed(throttleKey, "Too many account requests");

  if (!(await hasUsers())) {
    writeJson(response, 400, {
      ok: false,
      error: "Set up the first admin account before requesting access.",
    });
    return;
  }

  const name = String(body.name ?? "").trim();
  const emailCheck = validateEmailAddress(body.email, { allowBlank: false });
  const passwordCheck = validatePassword(body.password);
  const roleCheck = validateRole(body.role, false);

  if (!name || !emailCheck.isValid || !passwordCheck.isValid || !roleCheck.isValid) {
    recordAuthFailure(throttleKey);
    writeJson(response, 400, {
      ok: false,
      error:
        !name
          ? "Full name is required."
          : emailCheck.error || passwordCheck.error || "Select a valid role.",
    });
    return;
  }

  if (await findUserByEmail(emailCheck.email)) {
    recordAuthFailure(throttleKey);
    writeJson(response, 400, {
      ok: false,
      error: "An account with that email already exists.",
    });
    return;
  }

  await createUserAccount({
    id: createEntityId("USER"),
    name,
    email: emailCheck.email.toLowerCase(),
    passwordHash: hashPassword(passwordCheck.password),
    role: roleCheck.role,
    status: "pending",
  });

  writeJson(response, 200, {
    ok: true,
    message: "Account request created. It now needs admin approval before sign-in.",
  });
  clearAuthFailures(throttleKey);
}

async function handleCreateUser(request, response, currentUser) {
  if (!requireAdmin(currentUser, response)) return;

  const body = await readJsonBody(request);
  const name = String(body.name ?? "").trim();
  const emailCheck = validateEmailAddress(body.email, { allowBlank: false });
  const passwordCheck = validatePassword(body.password);
  const roleCheck = validateRole(body.role, true);

  if (!name || !emailCheck.isValid || !passwordCheck.isValid || !roleCheck.isValid) {
    writeJson(response, 400, {
      ok: false,
      error:
        !name
          ? "Full name is required."
          : emailCheck.error || passwordCheck.error || "Select a valid role.",
    });
    return;
  }

  if (await findUserByEmail(emailCheck.email)) {
    writeJson(response, 400, {
      ok: false,
      error: "An account with that email already exists.",
    });
    return;
  }

  await createUserAccount({
    id: createEntityId("USER"),
    name,
    email: emailCheck.email.toLowerCase(),
    passwordHash: hashPassword(passwordCheck.password),
    role: roleCheck.role,
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvedBy: currentUser.name,
    forcePasswordReset: body.forcePasswordReset !== false,
  });

  writeJson(response, 200, await buildSnapshot(currentUser));
}

async function handleChangePassword(request, response, currentUser) {
  if (!requireSignedIn(currentUser, response)) return;

  const body = await readJsonBody(request);
  const currentPassword = String(body.currentPassword ?? "").trim();
  const nextPasswordCheck = validatePassword(body.newPassword);
  const confirmPassword = String(body.confirmPassword ?? "").trim();
  const user = await findUserAuthById(currentUser.id);

  if (!user) {
    writeJson(response, 404, {
      ok: false,
      error: "Your account was not found.",
    });
    return;
  }

  if (!currentPassword) {
    writeJson(response, 400, {
      ok: false,
      error: "Enter your current password.",
    });
    return;
  }

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    writeJson(response, 400, {
      ok: false,
      error: "Current password is incorrect.",
    });
    return;
  }

  if (!nextPasswordCheck.isValid) {
    writeJson(response, 400, {
      ok: false,
      error: nextPasswordCheck.error,
    });
    return;
  }

  if (nextPasswordCheck.password !== confirmPassword) {
    writeJson(response, 400, {
      ok: false,
      error: "New password and confirmation do not match.",
    });
    return;
  }

  if (verifyPassword(nextPasswordCheck.password, user.passwordHash)) {
    writeJson(response, 400, {
      ok: false,
      error: "Choose a different password from the current one.",
    });
    return;
  }

  await updateUserPassword(currentUser.id, {
    passwordHash: hashPassword(nextPasswordCheck.password),
    forcePasswordReset: false,
  });

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await createSessionRecord({
    tokenHash: hashSessionToken(token),
    userId: currentUser.id,
    expiresAt,
  });
  await recordUserSignIn(currentUser.id);

  writeJson(
    response,
    200,
    {
      ...(await buildSnapshot(currentUser)),
      message: "Password updated successfully.",
    },
    {
      "Set-Cookie": serializeSessionCookie(token, buildSessionCookieOptions(request)),
    }
  );
}

async function handleResetUserPassword(request, response, currentUser, pathname) {
  if (!requireAdmin(currentUser, response)) return;

  const userId = parseUserIdFromPath(pathname, "/reset-password");
  if (!userId) {
    notFound(response);
    return;
  }

  if (userId === currentUser.id) {
    writeJson(response, 400, {
      ok: false,
      error: "Use Change Password for your own account.",
    });
    return;
  }

  const body = await readJsonBody(request);
  const passwordCheck = validatePassword(body.password);
  if (!passwordCheck.isValid) {
    writeJson(response, 400, {
      ok: false,
      error: passwordCheck.error,
    });
    return;
  }

  const existingUser = await findUserAuthById(userId);
  if (!existingUser) {
    writeJson(response, 404, {
      ok: false,
      error: "The account was not found.",
    });
    return;
  }

  await updateUserPassword(userId, {
    passwordHash: hashPassword(passwordCheck.password),
    forcePasswordReset: true,
  });

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    message: `${existingUser.name}'s password was reset. They must change it after sign-in.`,
  });
}

async function handleApproveUser(request, response, currentUser, pathname) {
  if (!requireAdmin(currentUser, response)) return;

  const userId = parseUserIdFromPath(pathname, "/approve");
  if (!userId) {
    notFound(response);
    return;
  }

  const body = await readJsonBody(request);
  const roleCheck = validateRole(body.role ?? "store", true);
  if (!roleCheck.isValid) {
    writeJson(response, 400, {
      ok: false,
      error: "Select a valid role.",
    });
    return;
  }

  await updateUserStatus(userId, {
    status: "approved",
    role: roleCheck.role,
    approvedAt: new Date().toISOString(),
    approvedBy: currentUser.name,
  });

  writeJson(response, 200, await buildSnapshot(currentUser));
}

async function handleRejectUser(request, response, currentUser, pathname) {
  if (!requireAdmin(currentUser, response)) return;

  const userId = parseUserIdFromPath(pathname, "/reject");
  if (!userId) {
    notFound(response);
    return;
  }

  const existingUser = await findUserAuthById(userId);
  if (!existingUser) {
    writeJson(response, 404, {
      ok: false,
      error: "The account was not found.",
    });
    return;
  }

  await updateUserStatus(userId, {
    status: "rejected",
    role: existingUser.role,
    approvedAt: new Date().toISOString(),
    approvedBy: currentUser.name,
  });

  writeJson(response, 200, await buildSnapshot(currentUser));
}

async function handleSaveSettings(request, response, currentUser) {
  if (!requireAdmin(currentUser, response)) return;

  const body = await readJsonBody(request);
  const result = await mutateAppState((state) =>
    updateSettingsInState(state, body)
  );

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
  });
}

async function handleSaveItem(request, response, currentUser, itemId = null) {
  if (itemId) {
    if (!requireAdmin(currentUser, response)) return;
  } else if (!requireItemCreator(currentUser, response)) {
    return;
  }

  const body = await readJsonBody(request);
  const result = await mutateAppState((state) =>
    saveItemInState(state, body, itemId)
  );

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
    item: result.item,
  });
}

async function handleSaveDepartment(request, response, currentUser, departmentId = null) {
  if (!requireAdmin(currentUser, response)) return;

  const body = await readJsonBody(request);
  const result = await mutateAppState((state) =>
    saveDepartmentInState(state, body, departmentId)
  );

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
    department: result.department,
  });
}

async function handleSaveMovement(request, response, currentUser) {
  if (!requireSignedIn(currentUser, response)) return;
  if (!getRolePermissions(currentUser.role).canEnterMovements) {
    writeJson(response, 403, {
      ok: false,
      error: "Your account cannot enter stock movements.",
    });
    return;
  }

  const body = await readJsonBody(request);
  const result = await mutateAppState((state) =>
    saveMovementInState(state, {
      ...body,
      enteredBy: currentUser?.name || currentUser?.email || body.enteredBy,
    }, {
      actorName: currentUser?.name || currentUser?.email || body.enteredBy,
    })
  );

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
    movement: result.movement,
  });
}

async function handleUpdateMovement(request, response, currentUser, pathname) {
  if (!requireSignedIn(currentUser, response)) return;
  if (!getRolePermissions(currentUser.role).canEditMovementHistory) {
    writeJson(response, 403, {
      ok: false,
      error: "Your account cannot edit movement history.",
    });
    return;
  }

  const movementId = decodeURIComponent(pathname.slice("/api/movements/".length));
  const body = await readJsonBody(request);
  const result = await mutateAppState((state) =>
    updateMovementInState(state, movementId, body, {
      actorName: currentUser?.name || currentUser?.email || body.enteredBy,
    })
  );

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
    movement: result.movement,
  });
}

async function handleDeleteMovement(request, response, currentUser, pathname) {
  if (!requireSignedIn(currentUser, response)) return;
  if (!getRolePermissions(currentUser.role).canDeleteMovementHistory) {
    writeJson(response, 403, {
      ok: false,
      error: "Your account cannot delete movement history.",
    });
    return;
  }

  const movementId = decodeURIComponent(pathname.slice("/api/movements/".length));
  const body = await readJsonBody(request);
  const result = await mutateAppState((state) =>
    deleteMovementInState(state, movementId, {
      actorName: currentUser?.name || currentUser?.email,
      reason: body.reason,
    })
  );

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
    movement: result.movement,
  });
}

async function handleImportItems(request, response, currentUser) {
  if (!requireAdmin(currentUser, response)) return;
  const body = await readJsonBody(request);
  const result = await mutateAppState((state) =>
    importItemMasterInState(state, body.rows ?? [])
  );

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
    importedCount: result.importedCount,
  });
}

async function handleImportDepartments(request, response, currentUser) {
  if (!requireAdmin(currentUser, response)) return;
  const body = await readJsonBody(request);
  const result = await mutateAppState((state) =>
    importDepartmentsInState(state, body.rows ?? [])
  );

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
    importedCount: result.importedCount,
  });
}

async function handleImportMovements(request, response, currentUser) {
  if (!requireAdmin(currentUser, response)) return;
  const body = await readJsonBody(request);
  const result = await mutateAppState((state) =>
    importMovementsInState(state, body.rows ?? [], {
      mode: body.mode ?? "append",
    })
  );

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
    importedCount: result.importedCount,
    skippedCount: result.skippedCount,
  });
}

async function handleApplyOpeningBalances(request, response, currentUser) {
  if (!requireAdmin(currentUser, response)) return;
  const body = await readJsonBody(request);
  const result = await mutateAppState((state) =>
    applyOpeningBalancesInState(state, body.rows ?? [], {
      asOfDate: body.asOfDate,
    })
  );

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
    updatedCount: result.updatedCount,
  });
}

async function handleImportFullWorkbook(request, response, currentUser) {
  if (!requireAdmin(currentUser, response)) return;
  const body = await readJsonBody(request);
  const result = await mutateAppState((state) =>
    importFullWorkbookInState(state, {
      itemRows: body.itemRows ?? [],
      openingRows: body.openingRows ?? [],
      asOfDate: body.asOfDate ?? "",
      movementRows: body.movementRows ?? [],
      movementMode: body.movementMode ?? "append",
      retireMissingWorkbookItems: body.retireMissingWorkbookItems === true,
    })
  );

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
    itemCount: result.itemCount,
    openingCount: result.openingCount,
    movementCount: result.movementCount,
    skippedMovementCount: result.skippedMovementCount,
    retiredItemCount: result.retiredItemCount,
  });
}

async function handleResetData(request, response, currentUser) {
  if (!requireAdmin(currentUser, response)) return;

  const allowReset = process.env.STOCKFLOW_ALLOW_RESET === "1" || isDevMode;
  if (!allowReset) {
    writeJson(response, 403, {
      ok: false,
      error:
        "Data reset is disabled. Set STOCKFLOW_ALLOW_RESET=1 or run in dev mode to enable it.",
    });
    return;
  }

  const body = await readJsonBody(request);
  // require an explicit confirmation to avoid accidents
  if (String(body.confirm ?? "").trim() !== "RESET") {
    writeJson(response, 400, {
      ok: false,
      error: 'To reset app data send JSON { "confirm": "RESET" }',
    });
    return;
  }

  const result = await mutateAppState(() => ({ nextState: createInitialAppState() }));

  writeJson(response, 200, {
    ...(await buildSnapshot(currentUser)),
    lastSavedAt: result.lastSavedAt,
    message: "App state reset to initial state. User accounts were preserved.",
  });
}

const server = createServer(async (request, response) => {
  try {
    const pathname = normalizeRoute(request.url);
    const currentUser = await getCurrentUser(request);

    if (request.method === "GET" && pathname === "/manifest.webmanifest") {
      await serveManifest(response);
      return;
    }

    if (request.method === "GET" && pathname === "/app-icon.svg") {
      await servePwaIcon(response, { maskable: false });
      return;
    }

    if (request.method === "GET" && pathname === "/app-maskable.svg") {
      await servePwaIcon(response, { maskable: true });
      return;
    }

    if (request.method === "GET" && pathname === "/api/health") {
      writeJson(response, 200, {
        ok: true,
        requiresBootstrap: !(await hasUsers()),
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/bootstrap") {
      await handleBootstrap(response, currentUser);
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/bootstrap-admin") {
      await handleBootstrapAdmin(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/signin") {
      await handleSignIn(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/signout") {
      await handleSignOut(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/request-access") {
      await handleRequestAccess(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/change-password") {
      await handleChangePassword(request, response, currentUser);
      return;
    }

    if (request.method === "POST" && pathname === "/api/users") {
      await handleCreateUser(request, response, currentUser);
      return;
    }

    if (request.method === "POST" && pathname.startsWith("/api/users/") && pathname.endsWith("/approve")) {
      await handleApproveUser(request, response, currentUser, pathname);
      return;
    }

    if (request.method === "POST" && pathname.startsWith("/api/users/") && pathname.endsWith("/reject")) {
      await handleRejectUser(request, response, currentUser, pathname);
      return;
    }

    if (
      request.method === "POST" &&
      pathname.startsWith("/api/users/") &&
      pathname.endsWith("/reset-password")
    ) {
      await handleResetUserPassword(request, response, currentUser, pathname);
      return;
    }

    if (request.method === "POST" && pathname === "/api/settings") {
      await handleSaveSettings(request, response, currentUser);
      return;
    }

    if (request.method === "POST" && pathname === "/api/items") {
      await handleSaveItem(request, response, currentUser, null);
      return;
    }

    if (request.method === "PUT" && pathname.startsWith("/api/items/")) {
      await handleSaveItem(
        request,
        response,
        currentUser,
        decodeURIComponent(pathname.slice("/api/items/".length))
      );
      return;
    }

    if (request.method === "POST" && pathname === "/api/departments") {
      await handleSaveDepartment(request, response, currentUser, null);
      return;
    }

    if (request.method === "PUT" && pathname.startsWith("/api/departments/")) {
      await handleSaveDepartment(
        request,
        response,
        currentUser,
        decodeURIComponent(pathname.slice("/api/departments/".length))
      );
      return;
    }

    if (request.method === "POST" && pathname === "/api/movements") {
      await handleSaveMovement(request, response, currentUser);
      return;
    }

    if (request.method === "PUT" && pathname.startsWith("/api/movements/")) {
      await handleUpdateMovement(request, response, currentUser, pathname);
      return;
    }

    if (request.method === "DELETE" && pathname.startsWith("/api/movements/")) {
      await handleDeleteMovement(request, response, currentUser, pathname);
      return;
    }

    if (request.method === "POST" && pathname === "/api/imports/items") {
      await handleImportItems(request, response, currentUser);
      return;
    }

    if (request.method === "POST" && pathname === "/api/imports/departments") {
      await handleImportDepartments(request, response, currentUser);
      return;
    }

    if (request.method === "POST" && pathname === "/api/imports/movements") {
      await handleImportMovements(request, response, currentUser);
      return;
    }

    if (request.method === "POST" && pathname === "/api/imports/opening-balances") {
      await handleApplyOpeningBalances(request, response, currentUser);
      return;
    }

    if (request.method === "POST" && pathname === "/api/imports/full-workbook") {
      await handleImportFullWorkbook(request, response, currentUser);
      return;
    }

    if (request.method === "POST" && pathname === "/api/system/reset-data") {
      await handleResetData(request, response, currentUser);
      return;
    }

    if (pathname.startsWith("/api/")) {
      notFound(response);
      return;
    }

    serveStatic(pathname, response);
  } catch (error) {
    console.error("Stock Flow server error:", error);
    writeJson(response, error?.statusCode ?? 500, {
      ok: false,
      error: error instanceof Error ? error.message : "The server could not complete this request.",
    });
  }
});

const serverReady = new Promise((resolveServer) => {
  server.listen(port, host, () => {
    const modeSuffix = isPreviewMode ? " (preview)" : "";
    const logUrls = [];

    if (!host || host === "127.0.0.1" || host === "::1") {
      logUrls.push(`http://localhost:${port}`);
    } else if (host === "0.0.0.0" || host === "::") {
      logUrls.push(`http://localhost:${port}`);
      for (const address of listLanAddresses()) {
        logUrls.push(`http://${address}:${port}`);
      }
    } else {
      logUrls.push(`http://${host}:${port}`);
    }

    console.log(`Stock Flow server running${modeSuffix}`);
    for (const url of logUrls) {
      console.log(`  ${url}`);
    }
    resolveServer(server);
  });
});

export { server, serverReady };
