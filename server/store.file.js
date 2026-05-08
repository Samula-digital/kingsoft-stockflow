import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAppState, createInitialAppState } from "./appState.js";

const serverDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(serverDir, "..");
const dataDir = process.env.STOCKFLOW_DATA_DIR
  ? resolve(process.env.STOCKFLOW_DATA_DIR)
  : resolve(rootDir, "data");
const storePath = resolve(dataDir, "kingsoft-stockflow.json");

mkdirSync(dataDir, { recursive: true });

function createInitialStore() {
  const now = new Date().toISOString();

  return {
    appState: {
      state: createInitialAppState(),
      updatedAt: now,
    },
    users: [],
    sessions: [],
  };
}

function normalizeUserRecord(user) {
  if (!user || typeof user !== "object") return null;

  return {
    id: String(user.id ?? "").trim(),
    name: String(user.name ?? "").trim(),
    email: String(user.email ?? "").trim().toLowerCase(),
    passwordHash: String(user.passwordHash ?? "").trim(),
    role: String(user.role ?? "finance").trim().toLowerCase() || "finance",
    status: String(user.status ?? "pending").trim().toLowerCase() || "pending",
    createdAt: String(user.createdAt ?? "").trim() || new Date().toISOString(),
    approvedAt: user.approvedAt ? String(user.approvedAt).trim() : null,
    approvedBy: String(user.approvedBy ?? "").trim(),
    lastSignedInAt: user.lastSignedInAt ? String(user.lastSignedInAt).trim() : null,
    forcePasswordReset: Boolean(user.forcePasswordReset),
  };
}

function normalizeSessionRecord(session) {
  if (!session || typeof session !== "object") return null;

  return {
    tokenHash: String(session.tokenHash ?? "").trim(),
    userId: String(session.userId ?? "").trim(),
    createdAt: String(session.createdAt ?? "").trim() || new Date().toISOString(),
    expiresAt: String(session.expiresAt ?? "").trim(),
  };
}

function normalizeStorePayload(payload) {
  const fallback = createInitialStore();
  const appStateSource =
    payload?.appState && typeof payload.appState === "object" ? payload.appState : fallback.appState;

  return {
    appState: {
      state: normalizeAppState(appStateSource.state ?? createInitialAppState()),
      updatedAt:
        String(appStateSource.updatedAt ?? "").trim() || fallback.appState.updatedAt,
    },
    users: Array.isArray(payload?.users)
      ? payload.users.map(normalizeUserRecord).filter(Boolean)
      : [],
    sessions: Array.isArray(payload?.sessions)
      ? payload.sessions.map(normalizeSessionRecord).filter(Boolean)
      : [],
  };
}

function writeStoreFile(payload) {
  const normalized = normalizeStorePayload(payload);
  const tempPath = `${storePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(normalized, null, 2), "utf8");
  renameSync(tempPath, storePath);
  return normalized;
}

function archiveCorruptStoreFile() {
  if (!existsSync(storePath)) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(dataDir, `kingsoft-stockflow.corrupt-${timestamp}.json`);

  try {
    renameSync(storePath, backupPath);
  } catch {
    // Best effort only. If archiving fails, continue with recovery.
  }
}

function ensureStoreFile() {
  if (existsSync(storePath)) {
    return;
  }

  writeStoreFile(createInitialStore());
}

ensureStoreFile();

function readStoreFile() {
  if (!existsSync(storePath)) {
    return writeStoreFile(createInitialStore());
  }

  try {
    return normalizeStorePayload(JSON.parse(readFileSync(storePath, "utf8")));
  } catch {
    archiveCorruptStoreFile();
    return writeStoreFile(createInitialStore());
  }
}

function hasMeaningfulStoreData(store) {
  if (!store || typeof store !== "object") return false;

  return Boolean(
    store.users?.length ||
      store.sessions?.length ||
      store.appState?.state?.items?.length ||
      store.appState?.state?.departments?.length ||
      store.appState?.state?.movements?.length
  );
}

function updateStore(mutator) {
  const current = readStoreFile();
  const next = mutator(structuredClone(current)) ?? current;
  return writeStoreFile(next);
}

function mapUserForPublic(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    approvedAt: user.approvedAt,
    approvedBy: user.approvedBy ?? "",
    lastSignedInAt: user.lastSignedInAt ?? null,
    forcePasswordReset: Boolean(user.forcePasswordReset),
  };
}

export function getAppStateRecord() {
  const store = readStoreFile();

  return {
    state: store.appState.state,
    updatedAt: store.appState.updatedAt,
  };
}

export function saveAppState(state) {
  const now = new Date().toISOString();
  const store = updateStore((draft) => {
    draft.appState = {
      state: normalizeAppState(state),
      updatedAt: now,
    };
    return draft;
  });

  return {
    state: store.appState.state,
    updatedAt: store.appState.updatedAt,
  };
}

export function runTransaction(callback) {
  return callback();
}

export function mutateAppState(mutator) {
  const { state } = getAppStateRecord();
  const result = mutator(structuredClone(state));
  const nextState = result?.nextState ?? state;
  const saved = saveAppState(nextState);

  return {
    ...result,
    state: saved.state,
    lastSavedAt: saved.updatedAt,
  };
}

export function hasUsers() {
  return readStoreFile().users.length > 0;
}

export function findUserByEmail(email) {
  const match = readStoreFile().users.find(
    (user) => user.email === String(email ?? "").trim().toLowerCase()
  );

  if (!match) return null;

  return {
    ...mapUserForPublic(match),
    passwordHash: match.passwordHash,
  };
}

export function findUserById(userId) {
  return mapUserForPublic(readStoreFile().users.find((user) => user.id === userId));
}

export function findUserAuthById(userId) {
  const user = readStoreFile().users.find((entry) => entry.id === userId);
  if (!user) return null;

  return {
    ...mapUserForPublic(user),
    passwordHash: user.passwordHash,
  };
}

export function listUsers() {
  return readStoreFile()
    .users.slice()
    .sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (nameCompare !== 0) return nameCompare;
      return a.email.localeCompare(b.email, undefined, { sensitivity: "base" });
    })
    .map(mapUserForPublic);
}

export function createUserAccount(
  {
    id,
    name,
    email,
    passwordHash,
    role,
    status,
    approvedAt = null,
    approvedBy = "",
    forcePasswordReset = false,
  },
  options = {}
) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();

  const store = updateStore((draft) => {
    if (options.requireNoExistingUsers && draft.users.length > 0) {
      throw new Error("The first admin has already been created. Sign in instead.");
    }

    if (draft.users.some((user) => user.email === normalizedEmail)) {
      throw new Error("An account with that email already exists.");
    }

    draft.users.push(
      normalizeUserRecord({
        id,
        name,
        email: normalizedEmail,
        passwordHash,
        role,
        status,
        createdAt: new Date().toISOString(),
        approvedAt,
        approvedBy,
        forcePasswordReset,
      })
    );

    return draft;
  });

  return mapUserForPublic(store.users.find((user) => user.id === id));
}

export function updateUserStatus(userId, { status, role, approvedAt, approvedBy }) {
  const store = updateStore((draft) => {
    const user = draft.users.find((entry) => entry.id === userId);
    if (!user) {
      throw new Error("User account not found.");
    }

    user.status = status;
    user.role = role;
    user.approvedAt = approvedAt;
    user.approvedBy = approvedBy;

    if (status !== "approved") {
      draft.sessions = draft.sessions.filter((session) => session.userId !== userId);
    }

    return draft;
  });

  return mapUserForPublic(store.users.find((user) => user.id === userId));
}

export function recordUserSignIn(userId) {
  updateStore((draft) => {
    const user = draft.users.find((entry) => entry.id === userId);
    if (user) {
      user.lastSignedInAt = new Date().toISOString();
    }
    return draft;
  });
}

export function createSessionRecord({ tokenHash, userId, expiresAt }) {
  updateStore((draft) => {
    draft.sessions = draft.sessions.filter((session) => session.tokenHash !== tokenHash);
    draft.sessions.push(
      normalizeSessionRecord({
        tokenHash,
        userId,
        createdAt: new Date().toISOString(),
        expiresAt,
      })
    );
    return draft;
  });
}

export function deleteSessionRecord(tokenHash) {
  if (!tokenHash) return;

  updateStore((draft) => {
    draft.sessions = draft.sessions.filter((session) => session.tokenHash !== tokenHash);
    return draft;
  });
}

export function deleteSessionsForUser(userId, { exceptTokenHash = "" } = {}) {
  if (!userId) return;

  updateStore((draft) => {
    draft.sessions = draft.sessions.filter(
      (session) => session.userId !== userId || session.tokenHash === exceptTokenHash
    );
    return draft;
  });
}

export function updateUserPassword(userId, { passwordHash, forcePasswordReset = false }) {
  const store = updateStore((draft) => {
    const user = draft.users.find((entry) => entry.id === userId);
    if (!user) {
      throw new Error("User account not found.");
    }

    user.passwordHash = String(passwordHash ?? "").trim();
    user.forcePasswordReset = Boolean(forcePasswordReset);
    draft.sessions = draft.sessions.filter((session) => session.userId !== userId);
    return draft;
  });

  return mapUserForPublic(store.users.find((user) => user.id === userId));
}

export function purgeExpiredSessions() {
  const now = new Date().toISOString();

  updateStore((draft) => {
    draft.sessions = draft.sessions.filter((session) => session.expiresAt > now);
    return draft;
  });
}

export function findSessionUser(tokenHash) {
  if (!tokenHash) return null;

  const now = new Date().toISOString();
  const store = readStoreFile();
  const activeSessions = store.sessions.filter((session) => session.expiresAt > now);

  if (activeSessions.length !== store.sessions.length) {
    updateStore((draft) => {
      draft.sessions = draft.sessions.filter((session) => session.expiresAt > now);
      return draft;
    });
  }

  const session = activeSessions.find((entry) => entry.tokenHash === tokenHash);
  if (!session) return null;

  const user = store.users.find((entry) => entry.id === session.userId);
  if (!user) return null;

  return {
    ...mapUserForPublic(user),
    passwordHash: user.passwordHash,
  };
}

export function getDatabasePath() {
  return storePath;
}

export function getRawStoreSnapshot() {
  const store = readStoreFile();

  return {
    store: structuredClone(store),
    path: storePath,
    hasMeaningfulData: hasMeaningfulStoreData(store),
  };
}
