import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "stockflow_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(String(password ?? ""), salt, 64);
  return `scrypt:${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export function verifyPassword(password, passwordHash) {
  const [algorithm, saltHex, hashHex] = String(passwordHash ?? "").split(":");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;

  const derivedKey = scryptSync(String(password ?? ""), Buffer.from(saltHex, "hex"), 64);
  const expectedKey = Buffer.from(hashHex, "hex");

  if (derivedKey.length !== expectedKey.length) return false;
  return timingSafeEqual(derivedKey, expectedKey);
}

export function createSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token) {
  return createHash("sha256").update(String(token ?? "")).digest("hex");
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  const rawHeader = String(cookieHeader ?? "").trim();
  if (!rawHeader) return cookies;

  for (const segment of rawHeader.split(";")) {
    const [name, ...valueParts] = segment.split("=");
    const cookieName = String(name ?? "").trim();
    if (!cookieName) continue;
    cookies[cookieName] = decodeURIComponent(valueParts.join("=").trim());
  }

  return cookies;
}

export function serializeSessionCookie(token, { secure = false } = {}) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function serializeExpiredSessionCookie({ secure = false } = {}) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}
