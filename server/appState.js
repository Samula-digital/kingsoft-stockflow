import {
  createSeedState,
  DEFAULT_STARTER_OPENING_BALANCE,
  STATE_VERSION,
} from "../src/data/seedState.js";
import {
  getSeedItemCategory,
  isSeedCategoryHeader,
  normalizeItemCategory,
  resolvePreferredItemCategory,
} from "../src/data/itemCategories.js";
import {
  DEFAULT_BRAND_ACCENT_COLOR,
  DEFAULT_BRAND_LOGO_URL,
  DEFAULT_BRAND_SIDEBAR_COLOR,
  normalizeHexColor,
} from "../src/utils/branding.js";
import {
  createDepartmentId,
  createEntityId,
  createItemCode,
  sortByName,
} from "../src/utils/formatters.js";
import { calculateStockRows } from "../src/utils/calculations.js";
import {
  validateDepartmentForm,
  validateItemForm,
  validateMovementEntry,
} from "../src/utils/validation.js";
import {
  resolveWorkbookIssueDepartmentIdByCategory,
  WORKBOOK_ISSUE_DEPARTMENT_MAPPING_VERSION,
} from "../src/utils/workbookDepartments.js";

const seedState = createSeedState();
const seededDepartmentOrder = new Map(
  seedState.departments.map((department, index) => [department.id, index])
);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toOptionalNumber(value, fallback = null) {
  const rawValue = normalizeText(value);
  if (!rawValue) return fallback;

  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function sortDepartmentsForDisplay(departments) {
  return [...departments].sort((left, right) => {
    const leftOrder = seededDepartmentOrder.get(left.id);
    const rightOrder = seededDepartmentOrder.get(right.id);
    const leftHasSeedOrder = Number.isInteger(leftOrder);
    const rightHasSeedOrder = Number.isInteger(rightOrder);

    if (leftHasSeedOrder && rightHasSeedOrder) {
      return leftOrder - rightOrder;
    }

    if (leftHasSeedOrder) return -1;
    if (rightHasSeedOrder) return 1;

    return String(left.name ?? "").localeCompare(String(right.name ?? ""));
  });
}

function normalizeDepartments(rawDepartments) {
  const sourceDepartments = Array.isArray(rawDepartments) && rawDepartments.length
    ? rawDepartments
    : seedState.departments;

  const normalizedDepartments = sourceDepartments
    .map((department, index) => {
      if (!department || typeof department !== "object") return null;

      const name = normalizeText(department.name);
      if (!name) return null;

      return {
        id: normalizeText(department.id) || createDepartmentId(name, index),
        code:
          normalizeText(department.code).toUpperCase() ||
          `DPT-${String(index + 1).padStart(2, "0")}`,
        name,
        requisitionStartNumber: Math.max(
          1,
          Math.trunc(toNumber(department.requisitionStartNumber, 1))
        ),
        isMainStore: Boolean(department.isMainStore ?? name === "Main Store"),
        isActive: department.isActive !== false,
        createdAt: department.createdAt ?? null,
        updatedAt: department.updatedAt ?? null,
      };
    })
    .filter(Boolean);

  if (!normalizedDepartments.some((department) => department.isMainStore && department.isActive !== false)) {
    const mainStoreIndex = normalizedDepartments.findIndex(
      (department) => normalizeLower(department.name) === "main store"
    );

    if (mainStoreIndex >= 0) {
      normalizedDepartments[mainStoreIndex] = {
        ...normalizedDepartments[mainStoreIndex],
        isMainStore: true,
        isActive: true,
      };
    }
  }

  return sortDepartmentsForDisplay(normalizedDepartments);
}

function normalizeItems(rawItems, options = {}) {
  const sourceItems = Array.isArray(rawItems) ? rawItems : seedState.items;
  const shouldUseStarterOpeningBalance = options.useStarterOpeningBalance === true;

  return sortByName(
    sourceItems
      .map((item, index) => {
        if (!item || typeof item !== "object") return null;

        const name = normalizeText(item.name);
        const code = normalizeText(item.code ?? item.id).toUpperCase();
        const uom = normalizeText(item.uom);
        if (!name || !code || !uom || isSeedCategoryHeader(name)) return null;

        return {
          id: normalizeText(item.id) || code || `ITEM-${index + 1}`,
          code,
          name,
          uom,
          category: resolvePreferredItemCategory(
            name,
            item.category ?? getSeedItemCategory(name)
          ),
          openingBalance: toNumber(
            item.openingBalance,
            shouldUseStarterOpeningBalance ? DEFAULT_STARTER_OPENING_BALANCE : 0
          ),
          unitCost: toOptionalNumber(item.unitCost, null),
          sellingPrice: toOptionalNumber(item.sellingPrice, null),
          minStock: toOptionalNumber(item.minStock, null),
          maxStock: toOptionalNumber(item.maxStock, null),
          isActive: item.isActive !== false,
          createdAt: item.createdAt ?? null,
          updatedAt: item.updatedAt ?? null,
        };
      })
      .filter(Boolean)
  );
}

function resolveDepartmentId(value, departments) {
  const rawValue = normalizeText(value);
  if (!rawValue) return departments[0]?.id ?? "";

  return (
    departments.find((department) => department.id === rawValue)?.id ||
    departments.find((department) => normalizeLower(department.name) === normalizeLower(rawValue))
      ?.id ||
    departments[0]?.id ||
    ""
  );
}

const MOVEMENT_AUDIT_FIELDS = [
  "date",
  "type",
  "adjustmentMode",
  "departmentId",
  "itemId",
  "quantity",
  "unitCost",
  "requisitionNumber",
  "referenceNumber",
  "notes",
];

function normalizeAuditChanges(rawChanges) {
  if (!Array.isArray(rawChanges)) return [];

  return rawChanges
    .map((change) => {
      if (!change || typeof change !== "object") return null;

      return {
        field: normalizeText(change.field),
        before:
          change.before === null || change.before === undefined
            ? ""
            : String(change.before).trim(),
        after:
          change.after === null || change.after === undefined
            ? ""
            : String(change.after).trim(),
      };
    })
    .filter((change) => change?.field);
}

function buildMovementAuditEvent({
  action,
  actorName,
  timestamp,
  summary,
  changes = [],
}) {
  return {
    action: normalizeText(action).toLowerCase() || "update",
    at: normalizeText(timestamp) || new Date().toISOString(),
    by: normalizeText(actorName) || "System",
    summary: normalizeText(summary),
    changes: normalizeAuditChanges(changes),
  };
}

function normalizeMovementAuditTrail(rawAuditTrail, movementRecord) {
  const normalizedAuditTrail = Array.isArray(rawAuditTrail)
    ? rawAuditTrail
        .map((event) => {
          if (!event || typeof event !== "object") return null;

          return buildMovementAuditEvent({
            action: event.action,
            actorName: event.by ?? event.actorName,
            timestamp: event.at ?? event.timestamp,
            summary: event.summary,
            changes: event.changes,
          });
        })
        .filter(Boolean)
    : [];

  if (normalizedAuditTrail.length) {
    return normalizedAuditTrail;
  }

  return [
    buildMovementAuditEvent({
      action: "create",
      actorName:
        movementRecord.createdBy || movementRecord.enteredBy || movementRecord.updatedBy || "System",
      timestamp: movementRecord.createdAt || movementRecord.updatedAt,
      summary: "Movement created.",
    }),
  ];
}

function buildMovementComparableSnapshot(movement) {
  return {
    date: normalizeText(movement.date),
    type: normalizeText(movement.type).toUpperCase(),
    adjustmentMode:
      normalizeText(movement.adjustmentMode).toUpperCase() || "INCREASE",
    departmentId: normalizeText(movement.departmentId),
    itemId: normalizeText(movement.itemId),
    quantity: toNumber(movement.quantity, 0),
    unitCost: toOptionalNumber(movement.unitCost, null),
    requisitionNumber: normalizeText(movement.requisitionNumber),
    referenceNumber: normalizeText(movement.referenceNumber),
    notes: normalizeText(movement.notes),
  };
}

function buildMovementChangeSet(previousMovement, nextMovement) {
  const previousSnapshot = buildMovementComparableSnapshot(previousMovement);
  const nextSnapshot = buildMovementComparableSnapshot(nextMovement);

  return MOVEMENT_AUDIT_FIELDS.flatMap((field) => {
    const previousValue =
      previousSnapshot[field] === null || previousSnapshot[field] === undefined
        ? ""
        : String(previousSnapshot[field]).trim();
    const nextValue =
      nextSnapshot[field] === null || nextSnapshot[field] === undefined
        ? ""
        : String(nextSnapshot[field]).trim();

    if (previousValue === nextValue) {
      return [];
    }

    return [
      {
        field,
        before: previousValue,
        after: nextValue,
      },
    ];
  });
}

function normalizeMovements(rawMovements, departments, items = []) {
  if (!Array.isArray(rawMovements)) return [];

  const itemCategoryById = new Map(
    (Array.isArray(items) ? items : []).map((item) => [item.id, item.category])
  );

  return rawMovements
    .map((movement) => {
      if (!movement || typeof movement !== "object") return null;

      const type = normalizeText(movement.type).toUpperCase();
      if (!["IN", "OUT", "ADJ"].includes(type)) return null;

      const quantity = Math.abs(toNumber(movement.quantity, 0));
      if (quantity <= 0) return null;

      const legacyAdjustmentMode =
        type === "ADJ" && normalizeText(movement.adjustmentMode).toUpperCase() === "DECREASE"
          ? "DECREASE"
          : "INCREASE";
      const itemId = normalizeText(movement.itemId);
      const workbookCategory = normalizeText(movement.workbookCategory) ||
        normalizeText(itemCategoryById.get(itemId));
      const isLegacyWorkbookIssueImport =
        type === "OUT" &&
        normalizeLower(movement.sourceType) === "excel-daily-template" &&
        !normalizeText(movement.departmentMappingVersion);
      const repairedWorkbookDepartmentId = isLegacyWorkbookIssueImport
        ? resolveWorkbookIssueDepartmentIdByCategory(workbookCategory, departments, {
            fallbackDepartmentId: "",
          })
        : "";
      const departmentId =
        repairedWorkbookDepartmentId ||
        resolveDepartmentId(movement.departmentId ?? movement.department, departments);

      const normalizedMovement = {
        id: normalizeText(movement.id) || createEntityId("MOV"),
        date: normalizeText(movement.date),
        type,
        departmentId,
        itemId,
        quantity,
        unitCost: toOptionalNumber(movement.unitCost, null),
        adjustmentMode: type === "ADJ" ? legacyAdjustmentMode : "INCREASE",
        requisitionNumber: type === "OUT" ? normalizeText(movement.requisitionNumber) : "",
        referenceNumber:
          type === "IN" || type === "ADJ" ? normalizeText(movement.referenceNumber) : "",
        notes: normalizeText(movement.notes),
        enteredBy: normalizeText(movement.enteredBy),
        sourceType: normalizeText(movement.sourceType),
        sourceFile: normalizeText(movement.sourceFile),
        sourceSheet: normalizeText(movement.sourceSheet),
        sourceRow: movement.sourceRow ?? null,
        workbookCategory,
        departmentMappingVersion:
          normalizeText(movement.departmentMappingVersion) ||
          (repairedWorkbookDepartmentId ? WORKBOOK_ISSUE_DEPARTMENT_MAPPING_VERSION : ""),
        createdAt: movement.createdAt ?? null,
        updatedAt: movement.updatedAt ?? null,
        createdBy: normalizeText(movement.createdBy) || normalizeText(movement.enteredBy),
        updatedBy:
          normalizeText(movement.updatedBy) ||
          normalizeText(movement.createdBy) ||
          normalizeText(movement.enteredBy),
        deletedAt: movement.deletedAt ? normalizeText(movement.deletedAt) : null,
        deletedBy: movement.deletedBy ? normalizeText(movement.deletedBy) : "",
        deletedReason: movement.deletedReason ? normalizeText(movement.deletedReason) : "",
      };

      return {
        ...normalizedMovement,
        importSignature: buildImportSignature(normalizedMovement),
        auditTrail: normalizeMovementAuditTrail(movement.auditTrail, normalizedMovement),
      };
    })
    .filter((movement) => movement && movement.date && movement.itemId)
    .sort((left, right) => {
      const dateCompare = String(right.date).localeCompare(String(left.date));
      if (dateCompare !== 0) return dateCompare;
      return String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
    });
}

function normalizeStateBase(rawState) {
  if (!rawState || typeof rawState !== "object") {
    return createInitialAppState();
  }

  const departments = normalizeDepartments(rawState.departments);
  const starterOpeningBalances = new Set(
    Array.isArray(rawState.items)
      ? rawState.items.map((item) => toNumber(item?.openingBalance, 0))
      : []
  );
  const useStarterOpeningBalance =
    Array.isArray(rawState.items) &&
    rawState.items.length > 0 &&
    (!Array.isArray(rawState.movements) || rawState.movements.length === 0) &&
    starterOpeningBalances.size === 1 &&
    [0, 10, DEFAULT_STARTER_OPENING_BALANCE].includes(
      Array.from(starterOpeningBalances)[0]
    );
  const items = normalizeItems(rawState.items, {
    useStarterOpeningBalance,
  });

  return {
    version: STATE_VERSION,
    productName: normalizeText(rawState.productName) || seedState.productName,
    hotelName: normalizeText(rawState.hotelName) || seedState.hotelName,
    brandLogoUrl:
      rawState.brandLogoUrl === undefined || rawState.brandLogoUrl === null
        ? DEFAULT_BRAND_LOGO_URL
        : normalizeText(rawState.brandLogoUrl),
    brandAccentColor: normalizeHexColor(
      rawState.brandAccentColor,
      DEFAULT_BRAND_ACCENT_COLOR
    ),
    brandSidebarColor: normalizeHexColor(
      rawState.brandSidebarColor,
      DEFAULT_BRAND_SIDEBAR_COLOR
    ),
    financeEmail: normalizeText(rawState.financeEmail),
    asOfDate: normalizeText(rawState.asOfDate) || seedState.asOfDate,
    nextRequisitionNumber: Math.max(1, toNumber(rawState.nextRequisitionNumber, 1)),
    departments,
    items,
    movements: normalizeMovements(rawState.movements, departments, items),
  };
}

function buildMovementRecord(movementInput, options = {}) {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const type = normalizeText(movementInput.type).toUpperCase();
  const quantity = Math.abs(Number(movementInput.quantity));
  const actorName =
    normalizeText(options.actorName) ||
    normalizeText(movementInput.enteredBy) ||
    "System";
  const enteredBy =
    normalizeText(options.enteredBy) ||
    normalizeText(movementInput.enteredBy) ||
    actorName;

  const movementRecord = {
    id: options.id ?? createEntityId("MOV"),
    date: normalizeText(movementInput.date),
    type,
    departmentId: normalizeText(movementInput.departmentId),
    itemId: normalizeText(movementInput.itemId),
    quantity: Number.isFinite(quantity) ? quantity : 0,
    unitCost: toOptionalNumber(movementInput.unitCost, null),
    adjustmentMode:
      type === "ADJ" && normalizeText(movementInput.adjustmentMode).toUpperCase() === "DECREASE"
        ? "DECREASE"
        : "INCREASE",
    requisitionNumber: type === "OUT" ? normalizeText(movementInput.requisitionNumber) : "",
    referenceNumber:
      type === "IN" || type === "ADJ" ? normalizeText(movementInput.referenceNumber) : "",
    notes: normalizeText(movementInput.notes),
    enteredBy,
    sourceType: normalizeText(movementInput.sourceType) || "manual",
    sourceFile: normalizeText(movementInput.sourceFile),
    sourceSheet: normalizeText(movementInput.sourceSheet),
    sourceRow: movementInput.sourceRow ?? null,
    workbookCategory: normalizeText(movementInput.workbookCategory),
    departmentMappingVersion: normalizeText(movementInput.departmentMappingVersion),
    createdAt: options.createdAt ?? timestamp,
    updatedAt: timestamp,
    createdBy: options.createdBy ?? actorName,
    updatedBy: actorName,
    deletedAt: options.deletedAt ?? null,
    deletedBy: normalizeText(options.deletedBy),
    deletedReason: normalizeText(options.deletedReason),
    auditTrail: Array.isArray(options.auditTrail) ? options.auditTrail : [],
  };

  return {
    ...movementRecord,
    importSignature: normalizeText(options.importSignature) || buildImportSignature(movementRecord),
  };
}

function getFirstValidationError(errors) {
  return Object.values(errors ?? {}).find(Boolean) || "The record is not valid.";
}

function ensureItemExists(itemId, items, contextLabel) {
  if (!items.some((item) => item.id === normalizeText(itemId))) {
    throw new Error(`${contextLabel}: item could not be matched in the current item master.`);
  }
}

function ensureDepartmentExists(departmentId, departments, contextLabel) {
  if (!departments.some((department) => department.id === normalizeText(departmentId))) {
    throw new Error(`${contextLabel}: department could not be matched in the current department list.`);
  }
}

function validateItemInputAgainstState(state, itemInput, itemId = null, contextLabel = "Item") {
  const validation = validateItemForm(itemInput, state.items, itemId);
  if (!validation.isValid) {
    throw new Error(`${contextLabel}: ${getFirstValidationError(validation.errors)}`);
  }

  return validation.normalizedItem;
}

function validateDepartmentInputAgainstState(
  state,
  departmentInput,
  departmentId = null,
  contextLabel = "Department"
) {
  const validation = validateDepartmentForm(departmentInput, state.departments, departmentId);
  if (!validation.isValid) {
    throw new Error(`${contextLabel}: ${getFirstValidationError(validation.errors)}`);
  }

  return validation.normalizedDepartment;
}

function validateMovementInputAgainstState(
  state,
  movementInput,
  { currentMovementId = null, enforceStockAvailability = true, contextLabel = "Movement" } = {}
) {
  const normalizedItemId = normalizeText(movementInput.itemId);
  const selectedItem = state.items.find((item) => item.id === normalizedItemId);

  ensureItemExists(movementInput.itemId, state.items, contextLabel);
  ensureDepartmentExists(movementInput.departmentId, state.departments, contextLabel);

  const selectedStockRow = enforceStockAvailability
    ? calculateStockRows(
        state.items,
        currentMovementId
          ? state.movements.filter((movement) => movement.id !== currentMovementId)
          : state.movements
      ).find((row) => row.id === normalizedItemId)
    : selectedItem;

  const validation = validateMovementEntry(movementInput, {
    movements: state.movements,
    currentMovementId,
    currentStock: enforceStockAvailability ? selectedStockRow?.stockOnHand ?? 0 : null,
    minStock: selectedStockRow?.minStock ?? null,
    maxStock: selectedStockRow?.maxStock ?? null,
  });

  if (!validation.isValid) {
    throw new Error(`${contextLabel}: ${getFirstValidationError(validation.errors)}`);
  }

  return validation.normalizedEntry;
}

function buildImportSignature(movementInput) {
  const type = normalizeText(movementInput.type).toUpperCase();
  const quantity = Math.abs(Number(movementInput.quantity));
  const documentNumber =
    type === "OUT"
      ? normalizeLower(movementInput.requisitionNumber)
      : normalizeLower(movementInput.referenceNumber);

  return [
    normalizeText(movementInput.date),
    type,
    normalizeText(movementInput.departmentId),
    normalizeText(movementInput.itemId),
    Number.isFinite(quantity) ? quantity : 0,
    toOptionalNumber(movementInput.unitCost, null) ?? "",
    type === "ADJ" ? normalizeText(movementInput.adjustmentMode).toUpperCase() : "",
    documentNumber,
    normalizeLower(movementInput.sourceType),
    normalizeLower(movementInput.sourceFile),
    normalizeLower(movementInput.sourceSheet),
    movementInput.sourceRow ?? "",
  ].join("|");
}

export function createInitialAppState() {
  return normalizeStateBase({
    ...seedState,
    users: [],
    currentUserId: "",
  });
}

export function normalizeAppState(rawState) {
  return normalizeStateBase(rawState);
}

export function saveMovementInState(state, movementInput, options = {}) {
  const timestamp = new Date().toISOString();
  const normalizedEntry = validateMovementInputAgainstState(state, movementInput, {
    contextLabel: "Stock movement",
  });
  const actorName =
    normalizeText(options.actorName) ||
    normalizeText(normalizedEntry.enteredBy) ||
    "System";
  const movementRecord = buildMovementRecord({ ...movementInput, ...normalizedEntry }, {
    timestamp,
    actorName,
    enteredBy: actorName,
    auditTrail: [
      buildMovementAuditEvent({
        action: "create",
        actorName,
        timestamp,
        summary: "Movement created.",
      }),
    ],
  });

  return {
    nextState: normalizeAppState({
      ...state,
      movements: [movementRecord, ...state.movements],
    }),
    movement: movementRecord,
  };
}

export function applyOpeningBalancesInState(state, rows, options = {}) {
  const timestamp = new Date().toISOString();
  for (const row of rows ?? []) {
    ensureItemExists(row.itemId, state.items, "Opening balance import");

    const openingBalance = toNumber(row.openingBalance, NaN);
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      throw new Error("Opening balance import: opening balance must be 0 or greater.");
    }

    const unitCost = toOptionalNumber(row.unitCost, null);
    if (unitCost !== null && unitCost < 0) {
      throw new Error("Opening balance import: unit cost must be blank or 0 and above.");
    }
  }

  const balanceMap = new Map(
    (rows ?? []).map((row) => [
      normalizeText(row.itemId),
      {
        category: normalizeText(row.category),
        openingBalance: toNumber(row.openingBalance, 0),
        unitCost: toOptionalNumber(row.unitCost, null),
      },
    ])
  );

  const nextState = {
    ...state,
    asOfDate: normalizeText(options.asOfDate) || state.asOfDate,
    items: state.items.map((item) => {
      const row = balanceMap.get(item.id);
      if (!row) return item;

      return {
        ...item,
        category: normalizeItemCategory(
          row.category || item.category || getSeedItemCategory(item.name)
        ),
        openingBalance: row.openingBalance,
        unitCost: row.unitCost !== null ? row.unitCost : item.unitCost ?? null,
        updatedAt: timestamp,
      };
    }),
  };

  return {
    nextState: normalizeAppState(nextState),
    updatedCount: balanceMap.size,
  };
}

export function importMovementsInState(state, movementInputs, options = {}) {
  const timestamp = new Date().toISOString();
  const preparedMovements = [];
  let workingState = {
    ...state,
    movements: options.mode === "replace" ? [] : [...state.movements],
  };
  const existingSignatures = new Set(
    workingState.movements
      .map((movement) => normalizeText(movement.importSignature))
      .filter(Boolean)
  );
  const batchSignatures = new Set();
  let skippedCount = 0;

  const sortedMovementInputs = [...(movementInputs ?? [])]
    .map((movementInput, index) => ({ movementInput, index }))
    .sort((left, right) => {
      const dateCompare = String(left.movementInput.date ?? "").localeCompare(
        String(right.movementInput.date ?? "")
      );
      if (dateCompare !== 0) return dateCompare;
      return left.index - right.index;
    });

  for (const { movementInput } of sortedMovementInputs) {
    const importSignature = buildImportSignature(movementInput);
    if (options.mode !== "replace" && importSignature) {
      if (existingSignatures.has(importSignature) || batchSignatures.has(importSignature)) {
        skippedCount += 1;
        continue;
      }
      batchSignatures.add(importSignature);
    }

    const normalizedEntry = validateMovementInputAgainstState(workingState, movementInput, {
      enforceStockAvailability: false,
      contextLabel: "Movement import",
    });
    const actorName =
      normalizeText(options.actorName) ||
      normalizeText(normalizedEntry.enteredBy) ||
      "System";

    const preparedMovement = buildMovementRecord({ ...movementInput, ...normalizedEntry }, {
      timestamp,
      actorName,
      enteredBy: normalizeText(normalizedEntry.enteredBy) || actorName,
      importSignature,
    });
    preparedMovements.push(
      preparedMovement
    );
    workingState = {
      ...workingState,
      movements: [preparedMovement, ...workingState.movements],
    };
  }

  const nextMovements =
    options.mode === "replace"
      ? preparedMovements
      : [...preparedMovements, ...state.movements];

  return {
    nextState: normalizeAppState({
      ...state,
      movements: nextMovements,
    }),
    importedCount: preparedMovements.length,
    skippedCount,
  };
}

export function importItemMasterInState(state, itemInputs) {
  const timestamp = new Date().toISOString();
  let importedCount = 0;
  const nextItems = [...state.items];
  let currentItemsById = new Map();
  let currentItemsByCode = new Map();
  let currentItemsByNameUom = new Map();
  let currentItemsByName = new Map();

  function rebuildItemLookups() {
    currentItemsById = new Map(nextItems.map((item) => [item.id, item]));
    currentItemsByCode = new Map(
      nextItems.map((item) => [normalizeLower(item.code), item])
    );
    currentItemsByNameUom = new Map(
      nextItems.map((item) => [
        `${normalizeLower(item.name)}|${normalizeLower(item.uom)}`,
        item,
      ])
    );
    currentItemsByName = new Map();

    for (const item of nextItems) {
      const nameKey = normalizeLower(item.name);
      if (!nameKey) continue;
      const matches = currentItemsByName.get(nameKey) ?? [];
      matches.push(item);
      currentItemsByName.set(nameKey, matches);
    }
  }

  function syncItemLookups(item) {
    rebuildItemLookups();
  }

  function createNextItemCode() {
    let code = createItemCode(nextItems);
    while (currentItemsByCode.has(normalizeLower(code))) {
      code = createItemCode([...nextItems, { code }]);
    }
    return code;
  }

  function findCurrentItemByName(name, uom) {
    const nameKey = normalizeLower(name);
    if (!nameKey) return null;

    const exactNameUomMatch = currentItemsByNameUom.get(
      `${nameKey}|${normalizeLower(uom)}`
    );
    if (exactNameUomMatch) return exactNameUomMatch;
    if (normalizeLower(uom)) return null;

    const nameMatches = currentItemsByName.get(nameKey) ?? [];
    return nameMatches.length === 1 ? nameMatches[0] : null;
  }

  rebuildItemLookups();

  for (const itemInput of itemInputs ?? []) {
    const inputCode = normalizeText(itemInput.code).toUpperCase();
    const name = normalizeText(itemInput.name);
    const uom = normalizeText(itemInput.uom);
    const matchedItem =
      (itemInput.itemId && currentItemsById.get(normalizeText(itemInput.itemId))) ||
      currentItemsByCode.get(normalizeLower(inputCode)) ||
      findCurrentItemByName(name, uom) ||
      null;
    const code = inputCode || matchedItem?.code || createNextItemCode();

    if (matchedItem) {
      const desiredCode = code || matchedItem.code;
      const desiredName = name || matchedItem.name;
      const conflictingCodeItem = nextItems.find(
        (item) =>
          item.id !== matchedItem.id &&
          normalizeLower(item.code) === normalizeLower(desiredCode)
      );
      const conflictingNameItem = nextItems.find(
        (item) =>
          item.id !== matchedItem.id &&
          normalizeLower(item.name) === normalizeLower(desiredName)
      );
      const normalizedItem = validateItemInputAgainstState(
        { ...state, items: nextItems },
        {
          code: conflictingCodeItem ? matchedItem.code : desiredCode,
          name: conflictingNameItem ? matchedItem.name : desiredName,
          uom: uom || matchedItem.uom,
          category: normalizeItemCategory(
            itemInput.category ?? matchedItem.category ?? getSeedItemCategory(name)
          ),
          openingBalance: toNumber(itemInput.openingBalance, matchedItem.openingBalance ?? 0),
          unitCost:
            itemInput.unitCost === null || itemInput.unitCost === undefined || itemInput.unitCost === ""
              ? matchedItem.unitCost ?? null
              : toOptionalNumber(itemInput.unitCost, null),
          sellingPrice:
            itemInput.sellingPrice === null ||
            itemInput.sellingPrice === undefined ||
            itemInput.sellingPrice === ""
              ? matchedItem.sellingPrice ?? null
              : toOptionalNumber(itemInput.sellingPrice, null),
          minStock: toOptionalNumber(itemInput.minStock, matchedItem.minStock ?? null),
          maxStock: toOptionalNumber(itemInput.maxStock, matchedItem.maxStock ?? null),
          isActive: itemInput.isActive !== false,
        },
        matchedItem.id,
        `Item import ${code || name}`
      );

      const updatedItem = {
        ...matchedItem,
        ...normalizedItem,
        updatedAt: timestamp,
      };

      const index = nextItems.findIndex((item) => item.id === matchedItem.id);
      if (index >= 0) {
        nextItems[index] = updatedItem;
        syncItemLookups(updatedItem);
        importedCount += 1;
      }
      continue;
    }

    const normalizedItem = validateItemInputAgainstState(
      { ...state, items: nextItems },
      {
        code,
        name,
        uom,
        category: normalizeItemCategory(itemInput.category ?? getSeedItemCategory(name)),
        openingBalance: toNumber(itemInput.openingBalance, 0),
        unitCost: toOptionalNumber(itemInput.unitCost, null),
        sellingPrice: toOptionalNumber(itemInput.sellingPrice, null),
        minStock: toOptionalNumber(itemInput.minStock, null),
        maxStock: toOptionalNumber(itemInput.maxStock, null),
        isActive: itemInput.isActive !== false,
      },
      null,
      `Item import ${code || name}`
    );

    nextItems.push({
      id: code || createEntityId("ITEM"),
      ...normalizedItem,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    syncItemLookups(nextItems.at(-1));
    importedCount += 1;
  }

  return {
    nextState: normalizeAppState({
      ...state,
      items: sortByName(nextItems),
    }),
    importedCount,
  };
}

function retireMissingWorkbookItemsInState(state, workbookItemRows) {
  const workbookItemIds = new Set(
    (workbookItemRows ?? [])
      .map((row) => normalizeText(row?.itemId))
      .filter(Boolean)
  );

  if (!workbookItemIds.size) {
    return {
      nextState: state,
      retiredCount: 0,
    };
  }

  const itemIdsWithHistory = new Set(
    (state.movements ?? [])
      .map((movement) => normalizeText(movement?.itemId))
      .filter(Boolean)
  );
  const timestamp = new Date().toISOString();
  let retiredCount = 0;

  const nextItems = state.items.map((item) => {
    if (workbookItemIds.has(item.id)) return item;
    if (itemIdsWithHistory.has(item.id)) return item;

    const hasWorkbookManagedDetail =
      toNumber(item.openingBalance) !== 0 ||
      toOptionalNumber(item.unitCost, null) !== null ||
      toOptionalNumber(item.minStock, null) !== null ||
      toOptionalNumber(item.maxStock, null) !== null ||
      item.isActive !== false;

    if (!hasWorkbookManagedDetail) return item;

    retiredCount += 1;

    return {
      ...item,
      openingBalance: 0,
      unitCost: null,
      minStock: null,
      maxStock: null,
      isActive: false,
      updatedAt: timestamp,
    };
  });

  return {
    nextState: retiredCount
      ? normalizeAppState({
          ...state,
          items: sortByName(nextItems),
        })
      : state,
    retiredCount,
  };
}

export function importDepartmentsInState(state, departmentInputs) {
  const timestamp = new Date().toISOString();
  let importedCount = 0;
  let nextDepartments = [...state.departments];

  for (const departmentInput of departmentInputs ?? []) {
    const matchedDepartment =
      nextDepartments.find((department) => department.id === normalizeText(departmentInput.departmentId)) ||
      nextDepartments.find(
        (department) =>
          normalizeLower(department.code) === normalizeLower(departmentInput.code) ||
          normalizeLower(department.name) === normalizeLower(departmentInput.name)
      ) ||
      null;

    const savedDepartment = matchedDepartment
      ? {
          ...matchedDepartment,
          ...validateDepartmentInputAgainstState(
            { ...state, departments: nextDepartments },
            {
              code: normalizeText(departmentInput.code).toUpperCase() || matchedDepartment.code,
              name: normalizeText(departmentInput.name) || matchedDepartment.name,
              requisitionStartNumber: Math.max(
                1,
                Math.trunc(
                  toNumber(
                    departmentInput.requisitionStartNumber,
                    matchedDepartment.requisitionStartNumber ?? 1
                  )
                )
              ),
              isMainStore: Boolean(departmentInput.isMainStore),
              isActive: departmentInput.isActive !== false,
            },
            matchedDepartment.id,
            `Department import ${departmentInput.name || departmentInput.code}`
          ),
          updatedAt: timestamp,
        }
      : {
          id: createDepartmentId(
            normalizeText(departmentInput.name),
            nextDepartments.length
          ),
          ...validateDepartmentInputAgainstState(
            { ...state, departments: nextDepartments },
            {
              code: normalizeText(departmentInput.code).toUpperCase(),
              name: normalizeText(departmentInput.name),
              requisitionStartNumber: Math.max(
                1,
                Math.trunc(toNumber(departmentInput.requisitionStartNumber, 1))
              ),
              isMainStore: Boolean(departmentInput.isMainStore),
              isActive: departmentInput.isActive !== false,
            },
            null,
            `Department import ${departmentInput.name || departmentInput.code}`
          ),
          createdAt: timestamp,
          updatedAt: timestamp,
        };

    if (matchedDepartment) {
      nextDepartments = nextDepartments.map((department) =>
        department.id === matchedDepartment.id ? savedDepartment : department
      );
    } else {
      nextDepartments = [...nextDepartments, savedDepartment];
    }

    importedCount += 1;
  }

  if ((departmentInputs ?? []).some((department) => department.isMainStore)) {
    nextDepartments = nextDepartments.map((department) => {
      const importedMainStore =
        (departmentInputs ?? []).find(
          (row) =>
            row.isMainStore &&
            (normalizeText(row.departmentId)
              ? department.id === normalizeText(row.departmentId)
              : normalizeLower(department.name) === normalizeLower(row.name))
        ) ?? null;

      return {
        ...department,
        isMainStore: Boolean(importedMainStore),
      };
    });
  }

  return {
    nextState: normalizeAppState({
      ...state,
      departments: sortDepartmentsForDisplay(nextDepartments),
    }),
    importedCount,
  };
}

export function saveItemInState(state, itemInput, itemId = null) {
  const timestamp = new Date().toISOString();
  const normalizedItem = validateItemInputAgainstState(
    state,
    itemInput,
    itemId,
    itemId ? "Item update" : "New item"
  );
  const existingItem = itemId
    ? state.items.find((item) => item.id === itemId) ?? {
        id: "",
      }
    : null;

  if (itemId && !existingItem?.id) {
    throw new Error("Item update: item was not found.");
  }

  const savedItem = itemId
    ? {
        ...existingItem,
        ...normalizedItem,
        createdAt: existingItem.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
    : {
        id: createEntityId("ITEM"),
        ...normalizedItem,
        isActive: normalizedItem.isActive !== false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

  const nextItems = itemId
    ? state.items.map((item) => (item.id === itemId ? savedItem : item))
    : [...state.items, savedItem];

  return {
    nextState: normalizeAppState({
      ...state,
      items: sortByName(nextItems),
    }),
    item: savedItem,
  };
}

export function saveDepartmentInState(state, departmentInput, departmentId = null) {
  const timestamp = new Date().toISOString();
  const normalizedDepartment = validateDepartmentInputAgainstState(
    state,
    departmentInput,
    departmentId,
    departmentId ? "Department update" : "New department"
  );
  const savedDepartment = departmentId
    ? {
        ...(state.departments.find((department) => department.id === departmentId) ?? {
          id: "",
        }),
        ...normalizedDepartment,
        updatedAt: timestamp,
      }
    : {
        id: createDepartmentId(normalizedDepartment.name, state.departments.length),
        ...normalizedDepartment,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

  if (departmentId && !savedDepartment.id) {
    throw new Error("Department update: department was not found.");
  }

  const nextDepartments = departmentId
    ? state.departments.map((department) =>
        department.id === departmentId ? savedDepartment : department
      )
    : [...state.departments, savedDepartment];

  return {
    nextState: normalizeAppState({
      ...state,
      departments: sortDepartmentsForDisplay(
        nextDepartments.map((department) => ({
          ...department,
          isMainStore: savedDepartment.isMainStore
            ? department.id === savedDepartment.id
            : department.isMainStore,
        }))
      ),
    }),
    department: savedDepartment,
  };
}

export function updateMovementInState(state, movementId, movementInput, options = {}) {
  const timestamp = new Date().toISOString();
  const existingMovement = state.movements.find((movement) => movement.id === movementId);
  if (!existingMovement) {
    throw new Error("Movement update: movement was not found.");
  }
  if (existingMovement.deletedAt) {
    throw new Error("Movement update: deleted movements are locked for audit.");
  }

  const normalizedEntry = validateMovementInputAgainstState(state, movementInput, {
    currentMovementId: movementId,
    contextLabel: "Movement update",
  });
  const actorName =
    normalizeText(options.actorName) ||
    normalizeText(normalizedEntry.enteredBy) ||
    normalizeText(existingMovement.enteredBy) ||
    "System";
  const candidateMovement = buildMovementRecord(
    { ...existingMovement, ...movementInput, ...normalizedEntry },
    {
    id: movementId,
    timestamp,
    createdAt: existingMovement.createdAt ?? timestamp,
    actorName,
    enteredBy: normalizeText(existingMovement.enteredBy) || actorName,
    createdBy: existingMovement.createdBy ?? existingMovement.enteredBy ?? actorName,
    auditTrail: existingMovement.auditTrail ?? [],
    }
  );
  const changes = buildMovementChangeSet(existingMovement, candidateMovement);
  if (!changes.length) {
    return {
      nextState: state,
      movement: existingMovement,
    };
  }

  let updatedMovement = null;

  const nextMovements = state.movements.map((movement) => {
    if (movement.id !== movementId) return movement;

    updatedMovement = {
      ...candidateMovement,
      auditTrail: [
        ...(Array.isArray(existingMovement.auditTrail) ? existingMovement.auditTrail : []),
        buildMovementAuditEvent({
          action: "update",
          actorName,
          timestamp,
          summary: `Movement updated. ${changes.length} field(s) changed.`,
          changes,
        }),
      ],
    };

    return updatedMovement;
  });

  return {
    nextState: normalizeAppState({
      ...state,
      movements: nextMovements,
    }),
    movement: updatedMovement,
  };
}

export function deleteMovementInState(state, movementId, options = {}) {
  const movement = state.movements.find((entry) => entry.id === movementId);
  if (!movement) {
    throw new Error("Movement delete: movement was not found.");
  }
  if (movement.deletedAt) {
    throw new Error("Movement delete: movement is already marked deleted.");
  }

  const reason = normalizeText(options.reason);
  if (!reason) {
    throw new Error("Movement delete: a delete reason is required for audit.");
  }

  const timestamp = new Date().toISOString();
  const actorName =
    normalizeText(options.actorName) ||
    normalizeText(movement.enteredBy) ||
    "System";
  const deletedMovement = {
    ...movement,
    updatedAt: timestamp,
    updatedBy: actorName,
    deletedAt: timestamp,
    deletedBy: actorName,
    deletedReason: reason,
    auditTrail: [
      ...(Array.isArray(movement.auditTrail) ? movement.auditTrail : []),
      buildMovementAuditEvent({
        action: "delete",
        actorName,
        timestamp,
        summary: `Movement marked deleted. Reason: ${reason}`,
      }),
    ],
  };

  return {
    nextState: normalizeAppState({
      ...state,
      movements: state.movements.map((entry) =>
        entry.id === movementId ? deletedMovement : entry
      ),
    }),
    movement: deletedMovement,
  };
}

export function updateSettingsInState(state, patch) {
  return {
    nextState: normalizeAppState({
      ...state,
      ...("productName" in patch ? { productName: normalizeText(patch.productName) } : {}),
      ...("hotelName" in patch ? { hotelName: normalizeText(patch.hotelName) } : {}),
      ...("brandLogoUrl" in patch ? { brandLogoUrl: normalizeText(patch.brandLogoUrl) } : {}),
      ...("brandAccentColor" in patch
        ? { brandAccentColor: normalizeHexColor(patch.brandAccentColor) }
        : {}),
      ...("brandSidebarColor" in patch
        ? { brandSidebarColor: normalizeHexColor(patch.brandSidebarColor) }
        : {}),
      ...("asOfDate" in patch ? { asOfDate: normalizeText(patch.asOfDate) } : {}),
      ...("financeEmail" in patch ? { financeEmail: normalizeText(patch.financeEmail) } : {}),
    }),
  };
}

export function importFullWorkbookInState(
  state,
  {
    itemRows = [],
    openingRows = [],
    asOfDate = "",
    movementRows = [],
    movementMode = "append",
    retireMissingWorkbookItems = false,
  }
) {
  const itemImport = importItemMasterInState(state, itemRows);
  const openingImport = applyOpeningBalancesInState(itemImport.nextState, openingRows, {
    asOfDate,
  });
  const movementImport = importMovementsInState(openingImport.nextState, movementRows, {
    mode: movementMode,
  });
  const retirement = retireMissingWorkbookItems
    ? retireMissingWorkbookItemsInState(movementImport.nextState, itemRows)
    : {
        nextState: movementImport.nextState,
        retiredCount: 0,
      };

  return {
    nextState: retirement.nextState,
    itemCount: itemImport.importedCount,
    openingCount: openingImport.updatedCount,
    movementCount: movementImport.importedCount,
    skippedMovementCount: movementImport.skippedCount,
    retiredItemCount: retirement.retiredCount,
  };
}
