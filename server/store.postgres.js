import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { normalizeAppState, createInitialAppState } from "./appState.js";
import { getRawStoreSnapshot } from "./store.file.js";

const { Pool } = pg;

const serverDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const rootDir = resolve(serverDir, "..");
const schemaPath = resolve(rootDir, "database", "postgresql-schema.sql");
const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
const databaseSslMode = String(process.env.DATABASE_SSL ?? "").trim().toLowerCase();

const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl:
        databaseSslMode === "disable"
          ? false
          : databaseSslMode === "require"
            ? { rejectUnauthorized: false }
            : databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")
              ? false
              : { rejectUnauthorized: false },
    })
  : null;

let initPromise = null;

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

function toIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function toDateOnly(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function rowToState(configRow, departmentRows, itemRows, movementRows, auditEventRows, auditChangeRows) {
  const auditEventsByMovementId = new Map();
  const changesByEventId = new Map();

  for (const changeRow of auditChangeRows) {
    const existing = changesByEventId.get(changeRow.event_id) ?? [];
    existing.push({
      field: String(changeRow.field_name ?? "").trim(),
      before: String(changeRow.before_value ?? "").trim(),
      after: String(changeRow.after_value ?? "").trim(),
    });
    changesByEventId.set(changeRow.event_id, existing);
  }

  for (const eventRow of auditEventRows) {
    const existing = auditEventsByMovementId.get(eventRow.movement_id) ?? [];
    existing.push({
      action: String(eventRow.action ?? "").trim(),
      at: toIso(eventRow.event_at),
      by: String(eventRow.event_by ?? "").trim(),
      summary: String(eventRow.summary ?? "").trim(),
      changes: changesByEventId.get(eventRow.id) ?? [],
    });
    auditEventsByMovementId.set(eventRow.movement_id, existing);
  }

  return normalizeAppState({
    version: Number(configRow?.state_version) || 1,
    productName: String(configRow?.product_name ?? "").trim(),
    hotelName: String(configRow?.hotel_name ?? "").trim(),
    brandLogoUrl: String(configRow?.brand_logo_url ?? "").trim(),
    brandAccentColor: String(configRow?.brand_accent_color ?? "").trim(),
    brandSidebarColor: String(configRow?.brand_sidebar_color ?? "").trim(),
    financeEmail: String(configRow?.finance_email ?? "").trim(),
    asOfDate: toDateOnly(configRow?.as_of_date),
    nextRequisitionNumber: Number(configRow?.next_requisition_number) || 1,
    departments: departmentRows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      requisitionStartNumber: Number(row.requisition_start_number) || 1,
      isMainStore: Boolean(row.is_main_store),
      isActive: Boolean(row.is_active),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    })),
    items: itemRows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      category: String(row.category ?? "").trim(),
      uom: row.uom,
      openingBalance: Number(row.opening_balance) || 0,
      unitCost: row.unit_cost === null ? null : Number(row.unit_cost),
      sellingPrice: row.selling_price === null ? null : Number(row.selling_price),
      minStock: row.min_stock === null ? null : Number(row.min_stock),
      maxStock: row.max_stock === null ? null : Number(row.max_stock),
      isActive: Boolean(row.is_active),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    })),
    movements: movementRows.map((row) => ({
      id: row.id,
      date: toDateOnly(row.movement_date),
      type: row.movement_type,
      departmentId: row.department_id,
      itemId: row.item_id,
      quantity: Number(row.quantity) || 0,
      unitCost: row.unit_cost === null ? null : Number(row.unit_cost),
      adjustmentMode: row.adjustment_mode,
      requisitionNumber: String(row.requisition_number ?? "").trim(),
      referenceNumber: String(row.reference_number ?? "").trim(),
      notes: String(row.notes ?? "").trim(),
      enteredBy: String(row.entered_by ?? "").trim(),
      sourceType: String(row.source_type ?? "").trim(),
      sourceFile: String(row.source_file ?? "").trim(),
      sourceSheet: String(row.source_sheet ?? "").trim(),
      sourceRow: row.source_row,
      workbookCategory: String(row.workbook_category ?? "").trim(),
      departmentMappingVersion: String(row.department_mapping_version ?? "").trim(),
      importSignature: String(row.import_signature ?? "").trim(),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      createdBy: String(row.created_by ?? "").trim(),
      updatedBy: String(row.updated_by ?? "").trim(),
      deletedAt: toIso(row.deleted_at),
      deletedBy: String(row.deleted_by ?? "").trim(),
      deletedReason: String(row.deleted_reason ?? "").trim(),
      auditTrail:
        (auditEventsByMovementId.get(row.id) ?? []).sort(
          (left, right) => String(left.at).localeCompare(String(right.at))
        ),
    })),
  });
}

function mapUserRow(row, { includePasswordHash = false } = {}) {
  if (!row) return null;

  const normalized = normalizeUserRecord({
    ...row,
    passwordHash: row.password_hash,
    approvedAt: toIso(row.approved_at),
    lastSignedInAt: toIso(row.last_signed_in_at),
    createdAt: toIso(row.created_at),
  });

  const mapped = mapUserForPublic(normalized);

  return includePasswordHash
    ? {
        ...mapped,
        passwordHash: String(row.password_hash ?? "").trim(),
      }
    : mapped;
}

async function getAppStateRecordWithClient(client) {
  const [configResult, departmentsResult, itemsResult, movementsResult, auditEventsResult, auditChangesResult] =
    await Promise.all([
      client.query("SELECT * FROM app_configuration WHERE id = 1"),
      client.query("SELECT * FROM departments ORDER BY name ASC"),
      client.query("SELECT * FROM items ORDER BY name ASC"),
      client.query("SELECT * FROM movements ORDER BY movement_date DESC, created_at DESC NULLS LAST, id DESC"),
      client.query("SELECT * FROM movement_audit_events ORDER BY movement_id ASC, event_order ASC"),
      client.query("SELECT * FROM movement_audit_changes ORDER BY event_id ASC, id ASC"),
    ]);

  const configRow = configResult.rows[0];
  const state = rowToState(
    configRow,
    departmentsResult.rows,
    itemsResult.rows,
    movementsResult.rows,
    auditEventsResult.rows,
    auditChangesResult.rows
  );

  return {
    state,
    updatedAt: toIso(configRow?.updated_at) ?? new Date().toISOString(),
  };
}

async function getUserRowById(client, userId) {
  const result = await client.query("SELECT * FROM users WHERE id = $1 LIMIT 1", [userId]);
  return result.rows[0] ?? null;
}

async function getUserRowByEmail(client, email) {
  const result = await client.query("SELECT * FROM users WHERE email = $1 LIMIT 1", [
    String(email ?? "").trim().toLowerCase(),
  ]);
  return result.rows[0] ?? null;
}

async function initializePostgresStore() {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!initPromise) {
    initPromise = (async () => {
      const client = await pool.connect();

      try {
        await client.query(readFileSync(schemaPath, "utf8"));
        const existing = await client.query("SELECT id FROM app_configuration WHERE id = 1");

        if (!existing.rowCount) {
          const fileSnapshot = getRawStoreSnapshot();

          if (fileSnapshot.hasMeaningfulData) {
            await seedFromFileStore(fileSnapshot.store, client);
          } else {
            const initialState = createInitialAppState();
            await saveAppState(initialState, client);
          }
        }
      } finally {
        client.release();
      }
    })();
  }

  await initPromise;
}

async function withClient(callback) {
  await initializePostgresStore();
  const client = await pool.connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

async function withTransaction(callback, externalClient = null) {
  if (externalClient) {
    return callback(externalClient);
  }

  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function seedFromFileStore(store, client) {
  const rawState = normalizeAppState(store?.appState?.state ?? createInitialAppState());
  const rawUsers = Array.isArray(store?.users) ? store.users.map(normalizeUserRecord).filter(Boolean) : [];
  const rawSessions = Array.isArray(store?.sessions)
    ? store.sessions.map(normalizeSessionRecord).filter(Boolean)
    : [];

  await saveAppState(rawState, client);

  if (store?.appState?.updatedAt) {
    await client.query("UPDATE app_configuration SET updated_at = $1 WHERE id = 1", [
      String(store.appState.updatedAt).trim(),
    ]);
  }

  for (const user of rawUsers) {
    await client.query(
      `INSERT INTO users
        (id, name, email, password_hash, role, status, created_at, approved_at, approved_by, last_signed_in_at, force_password_reset)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        user.id,
        user.name,
        user.email,
        user.passwordHash,
        user.role,
        user.status,
        user.createdAt,
        user.approvedAt,
        user.approvedBy,
        user.lastSignedInAt,
        user.forcePasswordReset,
      ]
    );
  }

  for (const session of rawSessions) {
    await client.query(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [session.tokenHash, session.userId, session.createdAt, session.expiresAt]
    );
  }
}

export async function getAppStateRecord() {
  return withClient((client) => getAppStateRecordWithClient(client));
}

export async function saveAppState(state, existingClient = null) {
  const now = new Date().toISOString();
  const normalizedState = normalizeAppState(state);

  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO app_configuration
        (id, state_version, product_name, hotel_name, brand_logo_url, brand_accent_color, brand_sidebar_color, finance_email, as_of_date, next_requisition_number, created_at, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE((SELECT created_at FROM app_configuration WHERE id = 1), $10::timestamptz), $10)
       ON CONFLICT (id) DO UPDATE SET
         state_version = EXCLUDED.state_version,
         product_name = EXCLUDED.product_name,
         hotel_name = EXCLUDED.hotel_name,
         brand_logo_url = EXCLUDED.brand_logo_url,
         brand_accent_color = EXCLUDED.brand_accent_color,
         brand_sidebar_color = EXCLUDED.brand_sidebar_color,
         finance_email = EXCLUDED.finance_email,
         as_of_date = EXCLUDED.as_of_date,
         next_requisition_number = EXCLUDED.next_requisition_number,
         updated_at = EXCLUDED.updated_at`,
      [
        normalizedState.version,
        normalizedState.productName,
        normalizedState.hotelName,
        normalizedState.brandLogoUrl,
        normalizedState.brandAccentColor,
        normalizedState.brandSidebarColor,
        normalizedState.financeEmail,
        normalizedState.asOfDate,
        normalizedState.nextRequisitionNumber,
        now,
      ]
    );

    await client.query("DELETE FROM movement_audit_changes");
    await client.query("DELETE FROM movement_audit_events");
    await client.query("DELETE FROM movements");
    await client.query("DELETE FROM items");
    await client.query("DELETE FROM departments");

    for (const department of normalizedState.departments) {
      await client.query(
        `INSERT INTO departments
          (id, code, name, requisition_start_number, is_main_store, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          department.id,
          department.code,
          department.name,
          department.requisitionStartNumber,
          department.isMainStore,
          department.isActive !== false,
          department.createdAt,
          department.updatedAt,
        ]
      );
    }

    for (const item of normalizedState.items) {
      await client.query(
        `INSERT INTO items
          (id, code, name, category, uom, opening_balance, unit_cost, selling_price, min_stock, max_stock, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          item.id,
          item.code,
          item.name,
          item.category ?? "",
          item.uom,
          item.openingBalance ?? 0,
          item.unitCost,
          item.sellingPrice,
          item.minStock,
          item.maxStock,
          item.isActive !== false,
          item.createdAt,
          item.updatedAt,
        ]
      );
    }

    for (const movement of normalizedState.movements) {
      await client.query(
        `INSERT INTO movements
          (id, movement_date, movement_type, department_id, item_id, quantity, unit_cost, adjustment_mode, requisition_number, reference_number, notes, entered_by, source_type, source_file, source_sheet, source_row, workbook_category, department_mapping_version, import_signature, created_at, updated_at, created_by, updated_by, deleted_at, deleted_by, deleted_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
        [
          movement.id,
          movement.date,
          movement.type,
          movement.departmentId,
          movement.itemId,
          movement.quantity,
          movement.unitCost,
          movement.adjustmentMode,
          movement.requisitionNumber ?? "",
          movement.referenceNumber ?? "",
          movement.notes ?? "",
          movement.enteredBy ?? "",
          movement.sourceType ?? "manual",
          movement.sourceFile ?? "",
          movement.sourceSheet ?? "",
          movement.sourceRow,
          movement.workbookCategory ?? "",
          movement.departmentMappingVersion ?? "",
          movement.importSignature ?? "",
          movement.createdAt,
          movement.updatedAt,
          movement.createdBy ?? "",
          movement.updatedBy ?? "",
          movement.deletedAt,
          movement.deletedBy ?? "",
          movement.deletedReason ?? "",
        ]
      );

      const auditTrail = Array.isArray(movement.auditTrail) ? movement.auditTrail : [];

      for (let index = 0; index < auditTrail.length; index += 1) {
        const event = auditTrail[index];
        const eventResult = await client.query(
          `INSERT INTO movement_audit_events
            (movement_id, event_order, action, event_at, event_by, summary)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            movement.id,
            index + 1,
            event.action ?? "update",
            event.at ?? now,
            event.by ?? "",
            event.summary ?? "",
          ]
        );
        const eventId = eventResult.rows[0]?.id;
        const changes = Array.isArray(event.changes) ? event.changes : [];

        for (const change of changes) {
          await client.query(
            `INSERT INTO movement_audit_changes
              (event_id, field_name, before_value, after_value)
             VALUES ($1, $2, $3, $4)`,
            [
              eventId,
              change.field ?? "",
              change.before ?? "",
              change.after ?? "",
            ]
          );
        }
      }
    }

    return {
      state: normalizedState,
      updatedAt: now,
    };
  }, existingClient);
}

export async function runTransaction(callback) {
  return withTransaction(async (client) => callback(client));
}

export async function mutateAppState(mutator) {
  return withTransaction(async (client) => {
    const { state } = await getAppStateRecordWithClient(client);
    const result = mutator(structuredClone(state));
    const nextState = result?.nextState ?? state;
    const saved = await saveAppState(nextState, client);

    return {
      ...result,
      state: saved.state,
      lastSavedAt: saved.updatedAt,
    };
  });
}

export async function hasUsers() {
  return withClient(async (client) => {
    const result = await client.query("SELECT COUNT(*)::int AS count FROM users");
    return Number(result.rows[0]?.count) > 0;
  });
}

export async function findUserByEmail(email) {
  return withClient(async (client) => {
    const match = await getUserRowByEmail(client, email);
    return mapUserRow(match, { includePasswordHash: true });
  });
}

export async function findUserById(userId) {
  return withClient(async (client) => {
    const match = await getUserRowById(client, userId);
    return mapUserRow(match);
  });
}

export async function findUserAuthById(userId) {
  return withClient(async (client) => {
    const user = await getUserRowById(client, userId);
    return mapUserRow(user, { includePasswordHash: true });
  });
}

export async function listUsers() {
  return withClient(async (client) => {
    const result = await client.query("SELECT * FROM users ORDER BY name ASC, email ASC");
    return result.rows.map((user) => mapUserRow(user));
  });
}

export async function createUserAccount(
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

  return withTransaction(async (client) => {
    if (options.requireNoExistingUsers) {
      const existingCount = await client.query("SELECT COUNT(*)::int AS count FROM users");
      if (Number(existingCount.rows[0]?.count) > 0) {
        throw new Error("The first admin has already been created. Sign in instead.");
      }
    }

    const existing = await client.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [
      normalizedEmail,
    ]);
    if (existing.rowCount) {
      throw new Error("An account with that email already exists.");
    }

    await client.query(
      `INSERT INTO users
        (id, name, email, password_hash, role, status, created_at, approved_at, approved_by, force_password_reset)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        name,
        normalizedEmail,
        passwordHash,
        role,
        status,
        new Date().toISOString(),
        approvedAt,
        approvedBy,
        forcePasswordReset,
      ]
    );

    return mapUserRow(await getUserRowById(client, id));
  });
}

export async function updateUserStatus(userId, { status, role, approvedAt, approvedBy }) {
  return withTransaction(async (client) => {
    const existing = await client.query("SELECT id FROM users WHERE id = $1 LIMIT 1", [userId]);
    if (!existing.rowCount) {
      throw new Error("User account not found.");
    }

    await client.query(
      `UPDATE users
       SET status = $2, role = $3, approved_at = $4, approved_by = $5
       WHERE id = $1`,
      [userId, status, role, approvedAt, approvedBy]
    );

    if (status !== "approved") {
      await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    }

    return mapUserRow(await getUserRowById(client, userId));
  });
}

export async function recordUserSignIn(userId) {
  return withClient((client) =>
    client.query("UPDATE users SET last_signed_in_at = $2 WHERE id = $1", [
      userId,
      new Date().toISOString(),
    ])
  );
}

export async function createSessionRecord({ tokenHash, userId, expiresAt }) {
  return withTransaction(async (client) => {
    await client.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    await client.query(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tokenHash, userId, new Date().toISOString(), expiresAt]
    );
  });
}

export async function deleteSessionRecord(tokenHash) {
  if (!tokenHash) return;
  return withClient((client) =>
    client.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash])
  );
}

export async function deleteSessionsForUser(userId, { exceptTokenHash = "" } = {}) {
  if (!userId) return;
  return withClient((client) =>
    client.query(
      "DELETE FROM sessions WHERE user_id = $1 AND ($2 = '' OR token_hash <> $2)",
      [userId, exceptTokenHash]
    )
  );
}

export async function updateUserPassword(userId, { passwordHash, forcePasswordReset = false }) {
  return withTransaction(async (client) => {
    const existing = await client.query("SELECT id FROM users WHERE id = $1 LIMIT 1", [userId]);
    if (!existing.rowCount) {
      throw new Error("User account not found.");
    }

    await client.query(
      `UPDATE users
       SET password_hash = $2, force_password_reset = $3
       WHERE id = $1`,
      [userId, String(passwordHash ?? "").trim(), Boolean(forcePasswordReset)]
    );
    await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);

    return mapUserRow(await getUserRowById(client, userId));
  });
}

export async function purgeExpiredSessions() {
  return withClient((client) =>
    client.query("DELETE FROM sessions WHERE expires_at <= $1", [new Date().toISOString()])
  );
}

export async function findSessionUser(tokenHash) {
  if (!tokenHash) return null;

  await purgeExpiredSessions();

  return withClient(async (client) => {
    const result = await client.query(
      `SELECT users.*
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > $2
       LIMIT 1`,
      [tokenHash, new Date().toISOString()]
    );
    return mapUserRow(result.rows[0], { includePasswordHash: true });
  });
}

export function getDatabasePath() {
  return databaseUrl || "";
}

export function isPostgresEnabled() {
  return Boolean(pool);
}
