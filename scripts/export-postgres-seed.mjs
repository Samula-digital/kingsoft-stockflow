import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultInputPath = resolve(rootDir, "data", "kingsoft-stockflow.json");
const defaultOutputPath = resolve(rootDir, "database", "postgresql-seed.sql");

function parseArgs(argv) {
  const args = {
    input: defaultInputPath,
    output: defaultOutputPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--input") {
      args.input = resolve(argv[index + 1] ?? defaultInputPath);
      index += 1;
      continue;
    }

    if (value === "--output") {
      args.output = resolve(argv[index + 1] ?? defaultOutputPath);
      index += 1;
    }
  }

  return args;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function escapeSqlString(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function sqlText(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${escapeSqlString(value)}'`;
}

function sqlNumeric(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? String(numericValue) : "NULL";
}

function sqlInteger(value, fallback = 0) {
  const numericValue = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(numericValue) ? String(numericValue) : String(fallback);
}

function sqlBoolean(value) {
  return value ? "TRUE" : "FALSE";
}

function sqlDate(value) {
  if (!value) return "NULL";
  return sqlText(String(value).slice(0, 10));
}

function sqlTimestamp(value) {
  if (!value) return "NULL";
  return sqlText(value);
}

function buildInsert(tableName, columns, rows) {
  if (!rows.length) return "";

  const values = rows
    .map(
      (row) =>
        `(${columns
          .map((column) => row[column])
          .join(", ")})`
    )
    .join(",\n");

  return `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES\n${values};\n`;
}

function normalizeStorePayload(payload) {
  return {
    appState: payload?.appState ?? {},
    users: Array.isArray(payload?.users) ? payload.users : [],
    sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
  };
}

function buildSql(payload) {
  const normalized = normalizeStorePayload(payload);
  const state = normalized.appState?.state ?? {};
  const now = normalized.appState?.updatedAt ?? new Date().toISOString();

  const configurationRows = [
    {
      id: "1",
      state_version: sqlInteger(state.version, 1),
      product_name: sqlText(state.productName ?? ""),
      hotel_name: sqlText(state.hotelName ?? ""),
      brand_logo_url: sqlText(state.brandLogoUrl ?? ""),
      brand_accent_color: sqlText(state.brandAccentColor ?? "#1f3b63"),
      brand_sidebar_color: sqlText(state.brandSidebarColor ?? "#1f3b63"),
      finance_email: sqlText(state.financeEmail ?? ""),
      as_of_date: sqlDate(state.asOfDate ?? ""),
      next_requisition_number: sqlInteger(state.nextRequisitionNumber, 1),
      created_at: sqlTimestamp(now),
      updated_at: sqlTimestamp(now),
    },
  ];

  const departmentRows = (Array.isArray(state.departments) ? state.departments : []).map((department) => ({
    id: sqlText(department.id),
    code: sqlText(department.code),
    name: sqlText(department.name),
    requisition_start_number: sqlInteger(department.requisitionStartNumber, 1),
    is_main_store: sqlBoolean(department.isMainStore),
    is_active: sqlBoolean(department.isActive !== false),
    created_at: sqlTimestamp(department.createdAt),
    updated_at: sqlTimestamp(department.updatedAt),
  }));

  const itemRows = (Array.isArray(state.items) ? state.items : []).map((item) => ({
    id: sqlText(item.id),
    code: sqlText(item.code),
    name: sqlText(item.name),
    category: sqlText(item.category ?? ""),
    uom: sqlText(item.uom),
    opening_balance: sqlNumeric(item.openingBalance ?? 0),
    unit_cost: sqlNumeric(item.unitCost),
    selling_price: sqlNumeric(item.sellingPrice),
    min_stock: sqlNumeric(item.minStock),
    max_stock: sqlNumeric(item.maxStock),
    is_active: sqlBoolean(item.isActive !== false),
    created_at: sqlTimestamp(item.createdAt),
    updated_at: sqlTimestamp(item.updatedAt),
  }));

  const userRows = normalized.users.map((user) => ({
    id: sqlText(user.id),
    name: sqlText(user.name),
    email: sqlText(user.email),
    password_hash: sqlText(user.passwordHash),
    role: sqlText(user.role),
    status: sqlText(user.status),
    created_at: sqlTimestamp(user.createdAt),
    approved_at: sqlTimestamp(user.approvedAt),
    approved_by: sqlText(user.approvedBy ?? ""),
    last_signed_in_at: sqlTimestamp(user.lastSignedInAt),
    force_password_reset: sqlBoolean(Boolean(user.forcePasswordReset)),
  }));

  const sessionRows = normalized.sessions.map((session) => ({
    token_hash: sqlText(session.tokenHash),
    user_id: sqlText(session.userId),
    created_at: sqlTimestamp(session.createdAt),
    expires_at: sqlTimestamp(session.expiresAt),
  }));

  const movementRows = [];
  const auditEventRows = [];
  const auditChangeRows = [];

  (Array.isArray(state.movements) ? state.movements : []).forEach((movement) => {
    movementRows.push({
      id: sqlText(movement.id),
      movement_date: sqlDate(movement.date),
      movement_type: sqlText(movement.type),
      department_id: sqlText(movement.departmentId),
      item_id: sqlText(movement.itemId),
      quantity: sqlNumeric(movement.quantity),
      unit_cost: sqlNumeric(movement.unitCost),
      adjustment_mode: sqlText(movement.adjustmentMode || "INCREASE"),
      requisition_number: sqlText(movement.requisitionNumber ?? ""),
      reference_number: sqlText(movement.referenceNumber ?? ""),
      notes: sqlText(movement.notes ?? ""),
      entered_by: sqlText(movement.enteredBy ?? ""),
      source_type: sqlText(movement.sourceType ?? "manual"),
      source_file: sqlText(movement.sourceFile ?? ""),
      source_sheet: sqlText(movement.sourceSheet ?? ""),
      source_row: sqlInteger(movement.sourceRow, 0),
      workbook_category: sqlText(movement.workbookCategory ?? ""),
      department_mapping_version: sqlText(movement.departmentMappingVersion ?? ""),
      import_signature: sqlText(movement.importSignature ?? ""),
      created_at: sqlTimestamp(movement.createdAt),
      updated_at: sqlTimestamp(movement.updatedAt),
      created_by: sqlText(movement.createdBy ?? ""),
      updated_by: sqlText(movement.updatedBy ?? ""),
      deleted_at: sqlTimestamp(movement.deletedAt),
      deleted_by: sqlText(movement.deletedBy ?? ""),
      deleted_reason: sqlText(movement.deletedReason ?? ""),
    });

    const auditTrail = Array.isArray(movement.auditTrail) ? movement.auditTrail : [];
    auditTrail.forEach((event, index) => {
      const eventSyntheticId = `${movement.id}::${index + 1}`;
      auditEventRows.push({
        movement_id: sqlText(movement.id),
        event_order: sqlInteger(index + 1, index + 1),
        action: sqlText(event.action ?? "update"),
        event_at: sqlTimestamp(event.at),
        event_by: sqlText(event.by ?? ""),
        summary: sqlText(event.summary ?? ""),
      });

      const changes = Array.isArray(event.changes) ? event.changes : [];
      changes.forEach((change, changeIndex) => {
        auditChangeRows.push({
          synthetic_event_id: sqlText(eventSyntheticId),
          synthetic_change_order: sqlInteger(changeIndex + 1, changeIndex + 1),
          field_name: sqlText(change.field ?? ""),
          before_value: sqlText(change.before ?? ""),
          after_value: sqlText(change.after ?? ""),
        });
      });
    });
  });

  const sections = [];

  sections.push("-- PostgreSQL seed export for Kingsoft Stock Flow");
  sections.push(`-- Source file: ${defaultInputPath}`);
  sections.push(`-- Generated at: ${new Date().toISOString()}`);
  sections.push("");
  sections.push("BEGIN;");
  sections.push("");
  sections.push(
    "TRUNCATE movement_audit_changes, movement_audit_events, sessions, movements, users, items, departments, app_configuration RESTART IDENTITY CASCADE;"
  );
  sections.push("");

  sections.push(
    buildInsert(
      "app_configuration",
      [
        "id",
        "state_version",
        "product_name",
        "hotel_name",
        "brand_logo_url",
        "brand_accent_color",
        "brand_sidebar_color",
        "finance_email",
        "as_of_date",
        "next_requisition_number",
        "created_at",
        "updated_at",
      ],
      configurationRows
    )
  );

  sections.push(
    buildInsert(
      "departments",
      [
        "id",
        "code",
        "name",
        "requisition_start_number",
        "is_main_store",
        "is_active",
        "created_at",
        "updated_at",
      ],
      departmentRows
    )
  );

  sections.push(
    buildInsert(
      "items",
      [
        "id",
        "code",
        "name",
        "category",
        "uom",
        "opening_balance",
        "unit_cost",
        "selling_price",
        "min_stock",
        "max_stock",
        "is_active",
        "created_at",
        "updated_at",
      ],
      itemRows
    )
  );

  sections.push(
    buildInsert(
      "users",
      [
        "id",
        "name",
        "email",
        "password_hash",
        "role",
        "status",
        "created_at",
        "approved_at",
        "approved_by",
        "last_signed_in_at",
        "force_password_reset",
      ],
      userRows
    )
  );

  sections.push(
    buildInsert(
      "sessions",
      ["token_hash", "user_id", "created_at", "expires_at"],
      sessionRows
    )
  );

  sections.push(
    buildInsert(
      "movements",
      [
        "id",
        "movement_date",
        "movement_type",
        "department_id",
        "item_id",
        "quantity",
        "unit_cost",
        "adjustment_mode",
        "requisition_number",
        "reference_number",
        "notes",
        "entered_by",
        "source_type",
        "source_file",
        "source_sheet",
        "source_row",
        "workbook_category",
        "department_mapping_version",
        "import_signature",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "deleted_at",
        "deleted_by",
        "deleted_reason",
      ],
      movementRows
    )
  );

  sections.push(
    buildInsert(
      "movement_audit_events",
      ["movement_id", "event_order", "action", "event_at", "event_by", "summary"],
      auditEventRows
    )
  );

  sections.push(`
INSERT INTO movement_audit_changes (event_id, field_name, before_value, after_value)
SELECT
  events.id,
  changes.field_name,
  changes.before_value,
  changes.after_value
FROM (
  VALUES
${auditChangeRows.length
    ? auditChangeRows
        .map(
          (row) =>
            `    (${row.synthetic_event_id}, ${row.synthetic_change_order}, ${row.field_name}, ${row.before_value}, ${row.after_value})`
        )
        .join(",\n")
    : "    ('', 0, '', '', '')"}
) AS changes(synthetic_event_id, synthetic_change_order, field_name, before_value, after_value)
JOIN movement_audit_events events
  ON changes.synthetic_event_id = (events.movement_id || '::' || events.event_order::TEXT)
${auditChangeRows.length ? "" : "WHERE FALSE"}
;
`);

  sections.push("COMMIT;");
  sections.push("");

  return sections.join("\n");
}

function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  const payload = readJsonFile(input);
  const sql = buildSql(payload);

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, sql, "utf8");

  console.log(`PostgreSQL seed export written to ${output}`);
}

main();
