const SHARED_SERVER_MESSAGE =
  "The shared Stock Flow server could not be reached. Start the app with `npm run dev` for local work or `npm run start` after build. If you opened the HTML file directly or deployed only the frontend, sign-in will fail.";

async function requestJson(path, { method = "GET", body } = {}) {
  let response;

  try {
    response = await fetch(path, {
      method,
      credentials: "include",
      headers:
        body === undefined
          ? undefined
          : {
              "Content-Type": "application/json",
            },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message
        ? `${SHARED_SERVER_MESSAGE} (${error.message})`
        : SHARED_SERVER_MESSAGE
    );
  }

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
  const expectsJson = contentType.includes("application/json");

  if (!expectsJson) {
    throw new Error(
      response.ok
        ? SHARED_SERVER_MESSAGE
        : `${SHARED_SERVER_MESSAGE} (status ${response.status})`
    );
  }

  if (!response.ok || payload?.ok === false || payload === null) {
    throw new Error(
      payload?.error || `The request failed with status ${response.status}.`
    );
  }

  return payload ?? { ok: true };
}

export async function fetchDeploymentStatus() {
  let response;

  try {
    response = await fetch("/api/status", {
      credentials: "include",
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message
        ? `${SHARED_SERVER_MESSAGE} (${error.message})`
        : SHARED_SERVER_MESSAGE
    );
  }

  const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new Error(
      response.ok
        ? SHARED_SERVER_MESSAGE
        : `${SHARED_SERVER_MESSAGE} (status ${response.status})`
    );
  }

  const payload = await response.json();
  return payload ?? { ok: false, status: "unknown" };
}

export function fetchBootstrap() {
  return requestJson("/api/bootstrap");
}

export function bootstrapAdmin(body) {
  return requestJson("/api/auth/bootstrap-admin", {
    method: "POST",
    body,
  });
}

export function signIn(body) {
  return requestJson("/api/auth/login", {
    method: "POST",
    body,
  });
}

export function signOut() {
  return requestJson("/api/auth/logout", {
    method: "POST",
  });
}

export function fetchCurrentUser() {
  return requestJson("/api/auth/me");
}

export function requestAccess(body) {
  return requestJson("/api/auth/request-access", {
    method: "POST",
    body,
  });
}

export function changePassword(body) {
  return requestJson("/api/auth/change-password", {
    method: "POST",
    body,
  });
}

export function createUser(body) {
  return requestJson("/api/users", {
    method: "POST",
    body,
  });
}

export function approveUser(userId, body = {}) {
  return requestJson(`/api/users/${encodeURIComponent(userId)}/approve`, {
    method: "POST",
    body,
  });
}

export function rejectUser(userId) {
  return requestJson(`/api/users/${encodeURIComponent(userId)}/reject`, {
    method: "POST",
    body: {},
  });
}

export function resetUserPassword(userId, body) {
  return requestJson(`/api/users/${encodeURIComponent(userId)}/reset-password`, {
    method: "POST",
    body,
  });
}

export function saveSettings(body) {
  return requestJson("/api/settings", {
    method: "POST",
    body,
  });
}

export function createItem(body) {
  return requestJson("/api/items", {
    method: "POST",
    body,
  });
}

export function updateItem(itemId, body) {
  return requestJson(`/api/items/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    body,
  });
}

export function createDepartment(body) {
  return requestJson("/api/departments", {
    method: "POST",
    body,
  });
}

export function updateDepartment(departmentId, body) {
  return requestJson(`/api/departments/${encodeURIComponent(departmentId)}`, {
    method: "PUT",
    body,
  });
}

export function createMovement(body) {
  return requestJson("/api/movements", {
    method: "POST",
    body,
  });
}

export function updateMovement(movementId, body) {
  return requestJson(`/api/movements/${encodeURIComponent(movementId)}`, {
    method: "PUT",
    body,
  });
}

export function deleteMovement(movementId, body = {}) {
  return requestJson(`/api/movements/${encodeURIComponent(movementId)}`, {
    method: "DELETE",
    body,
  });
}

export function importItems(body) {
  return requestJson("/api/imports/items", {
    method: "POST",
    body,
  });
}

export function importDepartments(body) {
  return requestJson("/api/imports/departments", {
    method: "POST",
    body,
  });
}

export function importMovements(body) {
  return requestJson("/api/imports/movements", {
    method: "POST",
    body,
  });
}

export function applyOpeningBalances(body) {
  return requestJson("/api/imports/opening-balances", {
    method: "POST",
    body,
  });
}

export function importFullWorkbook(body) {
  return requestJson("/api/imports/full-workbook", {
    method: "POST",
    body,
  });
}
