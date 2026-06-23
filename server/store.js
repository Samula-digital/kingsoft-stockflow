import * as fileStore from "./store.file.js";
import * as postgresStore from "./store.postgres.js";

const usePostgres = postgresStore.isPostgresEnabled();

function select(methodName) {
  return usePostgres ? postgresStore[methodName] : fileStore[methodName];
}

export function isDatabaseBackedStoreEnabled() {
  return usePostgres;
}

export async function getStoreDiagnostics(options = {}) {
  const postgres = await postgresStore.getPostgresDiagnostics(options);

  return {
    kind: usePostgres ? "postgres" : "file",
    postgres,
  };
}

export async function getAppStateRecord() {
  return select("getAppStateRecord")();
}

export async function saveAppState(state) {
  return select("saveAppState")(state);
}

export async function runTransaction(callback) {
  return select("runTransaction")(callback);
}

export async function mutateAppState(mutator) {
  return select("mutateAppState")(mutator);
}

export async function hasUsers() {
  return select("hasUsers")();
}

export async function findUserByEmail(email) {
  return select("findUserByEmail")(email);
}

export async function findUserById(userId) {
  return select("findUserById")(userId);
}

export async function findUserAuthById(userId) {
  return select("findUserAuthById")(userId);
}

export async function listUsers() {
  return select("listUsers")();
}

export async function createUserAccount(userInput, options = {}) {
  return select("createUserAccount")(userInput, options);
}

export async function updateUserStatus(userId, payload) {
  return select("updateUserStatus")(userId, payload);
}

export async function recordUserSignIn(userId) {
  return select("recordUserSignIn")(userId);
}

export async function createSessionRecord(payload) {
  return select("createSessionRecord")(payload);
}

export async function deleteSessionRecord(tokenHash) {
  return select("deleteSessionRecord")(tokenHash);
}

export async function deleteSessionsForUser(userId, options = {}) {
  return select("deleteSessionsForUser")(userId, options);
}

export async function updateUserPassword(userId, payload) {
  return select("updateUserPassword")(userId, payload);
}

export async function purgeExpiredSessions() {
  return select("purgeExpiredSessions")();
}

export async function findSessionUser(tokenHash) {
  return select("findSessionUser")(tokenHash);
}

export function getDatabasePath() {
  return select("getDatabasePath")();
}
