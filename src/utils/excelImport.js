import * as XLSX from "../vendor/xlsx.js";
import { normalizeItemCategory } from "../data/itemCategories.js";
import {
  normalizeWorkbookLevelForPack,
  normalizeWorkbookUnitCostForPack,
} from "./workbookPackRules.js";

function normalizeLabel(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeCompactLabel(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeHeaderToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isAllSelection(value) {
  return !String(value ?? "").trim() || String(value ?? "").trim().toLowerCase() === "all";
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseNumericCell(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return 0;

  const numericValue = Number(normalized);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function resolveWorkbookUnitCost(unitCost, stockValue, closingQty) {
  if (unitCost > 0) return unitCost;
  if (stockValue > 0 && closingQty > 0) {
    return Number((stockValue / closingQty).toFixed(2));
  }

  return null;
}

function normalizeWorkbookLevels(minimumValue, maximumValue, requiredValue) {
  const minStock = minimumValue > 0 ? minimumValue : null;
  const maxStockRaw = maximumValue > 0 ? maximumValue : null;
  const requiredStock = requiredValue > 0 ? requiredValue : null;

  if (minStock !== null && maxStockRaw !== null && maxStockRaw < minStock) {
    return {
      minStock,
      maxStock: Math.max(minStock, requiredStock ?? maxStockRaw),
      requiredStock,
      normalizedMaxFrom: maxStockRaw,
    };
  }

  return {
    minStock,
    maxStock: maxStockRaw,
    requiredStock,
    normalizedMaxFrom: null,
  };
}

export function parseTemplateDate(sheetName) {
  const match = String(sheetName ?? "").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return "";

  const [, day, month, year] = match;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildItemLookup(items) {
  const lookup = new Map();
  const nameCounts = new Map();
  const compactNameCounts = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const nameKey = normalizeLabel(item.name);
    const codeKey = normalizeLabel(item.code);
    const compactNameKey = normalizeCompactLabel(item.name);
    const compactCodeKey = normalizeCompactLabel(item.code);
    const uomKey = normalizeLabel(item.uom);
    const compactUomKey = normalizeCompactLabel(item.uom);

    if (nameKey) {
      nameCounts.set(nameKey, (nameCounts.get(nameKey) ?? 0) + 1);
    }
    if (compactNameKey) {
      compactNameCounts.set(compactNameKey, (compactNameCounts.get(compactNameKey) ?? 0) + 1);
    }

    const keys = [
      nameKey,
      codeKey,
      compactNameKey,
      compactCodeKey,
      normalizeLabel(`${item.name} ${item.uom}`),
      normalizeCompactLabel(`${item.name} ${item.uom}`),
      normalizeLabel(`${item.name}${item.uom}`),
      normalizeCompactLabel(`${item.name}${item.uom}`),
      normalizeLabel(`${item.code} ${item.uom}`),
      normalizeCompactLabel(`${item.code} ${item.uom}`),
      uomKey && nameKey ? `${nameKey}|${uomKey}` : "",
      compactUomKey && compactNameKey ? `${compactNameKey}|${compactUomKey}` : "",
    ];

    for (const key of keys) {
      if (key) lookup.set(key, item);
    }
  }

  return { lookup, nameCounts, compactNameCounts };
}

function buildWorkbookItemCode(name, uom, usedCodes) {
  const baseSeed = slugify(`${name}-${uom}`) || slugify(name) || "item";
  const baseCode = `WB-${baseSeed.replace(/-/g, "").toUpperCase().slice(0, 16)}`;
  let candidate = baseCode;
  let suffix = 2;

  while (usedCodes.has(candidate)) {
    const suffixText = String(suffix);
    candidate = `${baseCode.slice(0, Math.max(3, 16 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }

  usedCodes.add(candidate);
  return candidate;
}

function createWorkbookItemResolver(items) {
  const existingItems = Array.isArray(items) ? items : [];
  const { lookup, nameCounts, compactNameCounts } = buildItemLookup(existingItems);
  const usedCodes = new Set(
    existingItems
      .map((item) => String(item.code ?? item.id ?? "").trim().toUpperCase())
      .filter(Boolean)
  );
  const generatedItems = new Map();

  return function resolveWorkbookItem(itemLabel, uom = "", category = "") {
    const normalizedLabel = normalizeLabel(itemLabel);
    const compactLabel = normalizeCompactLabel(itemLabel);
    const normalizedUom = normalizeLabel(uom);
    const compactUom = normalizeCompactLabel(uom);

    const generatedKey = `${compactLabel}|${compactUom}`;
    if (generatedItems.has(generatedKey)) {
      return generatedItems.get(generatedKey) ?? null;
    }

    const isAmbiguousByName =
      normalizedLabel && !normalizedUom && nameCounts.get(normalizedLabel) > 1;
    const isAmbiguousByCompactName =
      compactLabel && !compactUom && compactNameCounts.get(compactLabel) > 1;

    const matchedItem =
      (normalizedUom && normalizedLabel
        ? lookup.get(`${normalizedLabel}|${normalizedUom}`)
        : null) ||
      (compactUom && compactLabel ? lookup.get(`${compactLabel}|${compactUom}`) : null) ||
      (normalizedUom ? lookup.get(normalizeLabel(`${itemLabel} ${uom}`)) : null) ||
      (compactUom ? lookup.get(normalizeCompactLabel(`${itemLabel} ${uom}`)) : null) ||
      (normalizedLabel && !normalizedUom && !isAmbiguousByName
        ? lookup.get(normalizedLabel)
        : null) ||
      (compactLabel && !compactUom && !isAmbiguousByCompactName
        ? lookup.get(compactLabel)
        : null) ||
      null;

    if (matchedItem) {
      return {
        ...matchedItem,
        workbookGenerated: false,
        importAction: "update",
      };
    }

    if (!generatedKey) return null;

    const isAmbiguousName = !normalizedUom && normalizedLabel && nameCounts.get(normalizedLabel) > 1;
    const isAmbiguousCompactName = !compactUom && compactLabel && compactNameCounts.get(compactLabel) > 1;
    if (isAmbiguousName || isAmbiguousCompactName) {
      return null;
    }

    const code = buildWorkbookItemCode(itemLabel, uom, usedCodes);
    const generatedItem = {
      id: code,
      code,
      name: String(itemLabel ?? "").trim(),
      uom: String(uom ?? "").trim() || "EA",
      category: normalizeItemCategory(category, "Others"),
      workbookGenerated: true,
      importAction: "new",
    };
    generatedItems.set(generatedKey, generatedItem);

    const keys = [
      normalizedLabel,
      compactLabel,
      normalizeLabel(`${itemLabel} ${uom}`),
      normalizeCompactLabel(`${itemLabel} ${uom}`),
      normalizedUom && normalizedLabel ? `${normalizedLabel}|${normalizedUom}` : "",
      compactUom && compactLabel ? `${compactLabel}|${compactUom}` : "",
    ];

    for (const key of keys) {
      if (key) lookup.set(key, generatedItem);
    }

    return generatedItems.get(generatedKey) ?? null;
  };
}

function isTemplateHeaderRow(row) {
  const rowTokens = Array.from({ length: 8 }, (_, index) =>
    normalizeHeaderToken(row[index])
  );

  const looksLikeUom = rowTokens[1] === "uom";
  const looksLikeOpening = ["", "openingstock", "opening"].includes(rowTokens[2]);
  const looksLikeReceived = ["recievedstock", "receivedstock"].includes(rowTokens[3]);
  const looksLikeTotalStock = rowTokens[4] === "totalstock";
  const looksLikeIssued = rowTokens[5] === "issuedstock";
  const looksLikeClosing = ["clossingstock", "closingstock"].includes(rowTokens[6]);
  const looksLikeUnit = rowTokens[7] === "unit";

  return (
    looksLikeUom &&
    looksLikeOpening &&
    looksLikeTotalStock &&
    looksLikeReceived &&
    (looksLikeIssued || looksLikeClosing || looksLikeUnit)
  );
}

function normalizeCategoryName(value) {
  const normalizedValue = normalizeLabel(value);
  if (!normalizedValue) return "";
  if (normalizedValue === "item name" || /^\d+$/.test(normalizedValue)) {
    return "Cold Room Items";
  }

  return normalizeItemCategory(value, "");
}

function getCategoryFromHeaderRow(row) {
  if (!isTemplateHeaderRow(row)) return "";
  return normalizeCategoryName(row[0]);
}

function isTemplateTotalRow(row) {
  return normalizeLabel(row[7]) === "total" || normalizeLabel(row[0]) === "total";
}

function hasStockValues(row) {
  return [2, 3, 4, 5, 6].some((index) => String(row[index] ?? "").trim() !== "");
}

function createImportRef(prefix, date, rowIndex, itemCode) {
  return [prefix, date.replace(/-/g, ""), String(rowIndex).padStart(4, "0"), slugify(itemCode).toUpperCase()]
    .filter(Boolean)
    .join("-");
}

function getDepartmentStartNumber(departmentId, startNumbers) {
  const startValue =
    startNumbers instanceof Map
      ? startNumbers.get(departmentId)
      : startNumbers?.[departmentId];
  const numericValue = Number(startValue);

  return Number.isFinite(numericValue) && numericValue > 0 ? Math.trunc(numericValue) : 1;
}

export function assignWorkbookIssueRequisitionNumbers(movementRows, options = {}) {
  const departmentStartNumbers = options.departmentStartNumbers ?? {};
  const shouldOverrideExisting = options.overrideExisting !== false;
  const nextPageByDepartment = new Map();
  const pageByGroup = new Map();
  const assignedPageByIndex = new Map();

  const issueEntries = (movementRows ?? [])
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row?.type === "OUT" && String(row.departmentId ?? "").trim())
    .sort((left, right) => {
      const dateCompare = String(left.row.date ?? "").localeCompare(String(right.row.date ?? ""));
      if (dateCompare !== 0) return dateCompare;

      const departmentCompare = String(left.row.departmentId ?? "").localeCompare(
        String(right.row.departmentId ?? "")
      );
      if (departmentCompare !== 0) return departmentCompare;

      return Number(left.row.sourceRow ?? left.index) - Number(right.row.sourceRow ?? right.index);
    });

  for (const { row, index } of issueEntries) {
    if (!shouldOverrideExisting && String(row.requisitionNumber ?? "").trim()) {
      continue;
    }

    const departmentId = String(row.departmentId ?? "").trim();
    const groupKey = `${row.date}|${departmentId}`;

    if (!pageByGroup.has(groupKey)) {
      const nextPage =
        nextPageByDepartment.get(departmentId) ??
        getDepartmentStartNumber(departmentId, departmentStartNumbers);
      pageByGroup.set(groupKey, String(nextPage));
      nextPageByDepartment.set(departmentId, nextPage + 1);
    }

    assignedPageByIndex.set(index, pageByGroup.get(groupKey));
  }

  return (movementRows ?? []).map((row, index) => {
    const requisitionNumber = assignedPageByIndex.get(index);
    if (!requisitionNumber) return row;

    return {
      ...row,
      requisitionNumber,
      inferredRequisitionNumber: true,
    };
  });
}

function resolveWorkbookIssueDepartmentId(category, options = {}) {
  const normalizedCategory = normalizeCategoryName(category);
  const categoryMap =
    options.issueDepartmentMap && typeof options.issueDepartmentMap === "object"
      ? options.issueDepartmentMap
      : {};

  return (
    categoryMap[normalizedCategory] ||
    categoryMap[String(category ?? "").trim()] ||
    options.issueDepartmentId ||
    ""
  );
}

export function parseDailyStoresSheetRows(rows, sheetName, items, options = {}) {
  const date = parseTemplateDate(sheetName);
  const itemLookupData = buildItemLookup(items);
  const itemLookup = itemLookupData.lookup;
  const nameCounts = itemLookupData.nameCounts;
  const compactNameCounts = itemLookupData.compactNameCounts;
  const resolveWorkbookItem =
    typeof options.resolveWorkbookItem === "function"
      ? options.resolveWorkbookItem
      : createWorkbookItemResolver(items);
  const openingRows = [];
  const movements = [];
  const unmatchedRows = [];
  const warnings = [];
  const reconciliationRows = [];
  const matchedItems = new Set();
  let currentCategory = normalizeCategoryName(options.defaultCategory ?? "Cold Room Items");

  if (!date) {
    warnings.push(`Sheet "${sheetName}" was skipped because its name is not a date like 1.1.2026.`);
    return {
      sheetName,
      date: "",
      openingRows,
      movements,
      unmatchedRows,
      warnings,
      matchedCount: 0,
    };
  }

  rows.forEach((row, index) => {
    if (!Array.isArray(row) || !row.length) return;
    const headerCategory = getCategoryFromHeaderRow(row);
    if (headerCategory) {
      currentCategory = headerCategory;
      return;
    }
    if (isTemplateHeaderRow(row) || isTemplateTotalRow(row)) return;

    const itemLabel = String(row[0] ?? "").trim();
    if (!itemLabel || !hasStockValues(row)) return;

    const normalizedLabel = normalizeLabel(itemLabel);
    const compactLabel = normalizeCompactLabel(itemLabel);
    const uomValue = String(row[1] ?? "").trim();
    const canMatchByLabelOnly = Boolean(
      uomValue ||
      (normalizedLabel && nameCounts.get(normalizedLabel) === 1 &&
        compactLabel && compactNameCounts.get(compactLabel) === 1)
    );

    const directMatch = canMatchByLabelOnly
      ? itemLookup.get(normalizedLabel) ?? itemLookup.get(compactLabel)
      : null;

    const item =
      directMatch ??
      resolveWorkbookItem(itemLabel, uomValue, currentCategory) ??
      null;
    if (!item) {
      unmatchedRows.push({
        rowNumber: index + 1,
        itemLabel,
        uom: String(row[1] ?? "").trim(),
        category: currentCategory,
      });
      return;
    }

    matchedItems.add(item.id);

    const openingBalance = parseNumericCell(row[2]);
    const receivedQty = parseNumericCell(row[3]);
    const issuedQty = parseNumericCell(row[5]);
    const closingQty = parseNumericCell(row[6]);
    const unitCost = parseNumericCell(row[7]);
    const sourceStockValue = parseNumericCell(row[8]);
    const packContext = { itemLabel, workbookUom: uomValue, item };
    const maxStock = normalizeWorkbookLevelForPack(parseNumericCell(row[9]), packContext);
    const minStock = normalizeWorkbookLevelForPack(parseNumericCell(row[10]), packContext);
    const requiredStock = normalizeWorkbookLevelForPack(parseNumericCell(row[11]), packContext);
    const normalizedLevels = normalizeWorkbookLevels(minStock, maxStock, requiredStock);
    const resolvedUnitCost = normalizeWorkbookUnitCostForPack(
      resolveWorkbookUnitCost(unitCost, sourceStockValue, closingQty),
      packContext
    );
    const expectedClosing = openingBalance + receivedQty - issuedQty;
    const variance = Number((closingQty - expectedClosing).toFixed(4));
    const importSource = {
      sourceType: "excel-daily-template",
      sourceFile: options.fileName ?? "",
      sourceSheet: sheetName,
      sourceRow: index + 1,
    };

    if (normalizedLevels.normalizedMaxFrom !== null) {
      warnings.push(
        `${sheetName} row ${index + 1} (${item.name}) had maximum stock below minimum stock. ` +
          `Maximum was raised from ${normalizedLevels.normalizedMaxFrom} to ${normalizedLevels.maxStock} for import.`
      );
    }

    openingRows.push({
      itemId: item.id,
      code: item.code,
      name: item.name,
      uom: item.uom,
      category: currentCategory,
      openingBalance,
      unitCost: resolvedUnitCost,
      sourceStockValue,
      minStock: normalizedLevels.minStock,
      maxStock: normalizedLevels.maxStock,
      requiredStock: normalizedLevels.requiredStock,
      workbookGenerated: Boolean(item.workbookGenerated),
      importAction: item.importAction ?? "update",
      sourceDate: date,
      sourceSheet: sheetName,
      sourceRow: index + 1,
    });

    if (receivedQty > 0) {
      movements.push({
        date,
        type: "IN",
        departmentId: options.receiveDepartmentId ?? "",
        category: currentCategory,
        itemId: item.id,
        quantity: receivedQty,
        unitCost: resolvedUnitCost,
        adjustmentMode: "INCREASE",
        requisitionNumber: "",
        referenceNumber: createImportRef("IMP-IN", date, index + 1, item.code),
        notes: `Imported received stock from ${sheetName}.`,
        enteredBy: options.enteredBy ?? "Excel Import",
        ...importSource,
      });
    }

    if (issuedQty > 0) {
      movements.push({
        date,
        type: "OUT",
        departmentId: resolveWorkbookIssueDepartmentId(currentCategory, options),
        category: currentCategory,
        itemId: item.id,
        quantity: issuedQty,
        adjustmentMode: "INCREASE",
        requisitionNumber: createImportRef("IMP-OUT", date, index + 1, item.code),
        referenceNumber: "",
        notes: `Imported issued stock from ${sheetName}.`,
        enteredBy: options.enteredBy ?? "Excel Import",
        ...importSource,
      });
    }

    if (variance !== 0) {
      movements.push({
        date,
        type: "ADJ",
        departmentId: options.receiveDepartmentId ?? "",
        category: currentCategory,
        itemId: item.id,
        quantity: Math.abs(variance),
        adjustmentMode: variance < 0 ? "DECREASE" : "INCREASE",
        requisitionNumber: "",
        referenceNumber: createImportRef("IMP-ADJ", date, index + 1, item.code),
        notes: `Imported reconciliation to match closing stock on ${sheetName}.`,
        enteredBy: options.enteredBy ?? "Excel Import",
        ...importSource,
      });
      reconciliationRows.push({
        date,
        sheetName,
        rowNumber: index + 1,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        variance,
      });
    }
  });

  return {
    sheetName,
    date,
    openingRows,
    movements,
    unmatchedRows,
    warnings,
    reconciliationRows,
    matchedCount: matchedItems.size,
  };
}

function mergeWorkbookItemProfile(existing, incoming) {
  if (!existing) return incoming;

  const incomingIsNewer = incoming.sourceDate >= existing.sourceDate;
  const latest = incomingIsNewer ? incoming : existing;
  const fallback = incomingIsNewer ? existing : incoming;

  return {
    ...latest,
    category: latest.category || fallback.category || "",
    openingBalance: latest.openingBalance,
    unitCost: latest.unitCost ?? fallback.unitCost ?? null,
    sourceStockValue:
      latest.sourceStockValue > 0 ? latest.sourceStockValue : fallback.sourceStockValue,
    minStock: latest.minStock ?? fallback.minStock ?? null,
    maxStock: latest.maxStock ?? fallback.maxStock ?? null,
    requiredStock: latest.requiredStock ?? fallback.requiredStock ?? null,
    workbookGenerated: Boolean(latest.workbookGenerated || fallback.workbookGenerated),
    importAction:
      latest.importAction === "new" || fallback.importAction === "new" ? "new" : "update",
  };
}

function calculateCoveragePercent(coveredCount, totalCount) {
  if (!totalCount) return 0;
  return Math.round((coveredCount / totalCount) * 100);
}

function buildFilteredSheetSummaries(
  preview,
  openingSnapshots,
  movementRows,
  unmatchedRows,
  reconciliationRows
) {
  const openingMap = new Map(openingSnapshots.map((snapshot) => [snapshot.date, snapshot.rows ?? []]));
  const movementMap = new Map();
  const unmatchedMap = new Map();
  const reconciliationMap = new Map();

  for (const row of movementRows ?? []) {
    const list = movementMap.get(row.date) ?? [];
    list.push(row);
    movementMap.set(row.date, list);
  }

  for (const row of unmatchedRows ?? []) {
    const list = unmatchedMap.get(row.date) ?? [];
    list.push(row);
    unmatchedMap.set(row.date, list);
  }

  for (const row of reconciliationRows ?? []) {
    const list = reconciliationMap.get(row.date) ?? [];
    list.push(row);
    reconciliationMap.set(row.date, list);
  }

  return (preview?.sheetSummaries ?? [])
    .map((summary) => {
      const openingRows = openingMap.get(summary.date) ?? [];
      const movementRowsForDate = movementMap.get(summary.date) ?? [];
      const unmatchedRowsForDate = unmatchedMap.get(summary.date) ?? [];
      const reconciliationRowsForDate = reconciliationMap.get(summary.date) ?? [];
      const matchedItems = new Set([
        ...openingRows.map((row) => row.itemId),
        ...movementRowsForDate.map((row) => row.itemId),
      ]);

      if (
        !openingRows.length &&
        !movementRowsForDate.length &&
        !unmatchedRowsForDate.length &&
        !reconciliationRowsForDate.length
      ) {
        return null;
      }

      return {
        ...summary,
        matchedCount: matchedItems.size,
        openingCount: openingRows.length,
        movementCount: movementRowsForDate.length,
        unmatchedCount: unmatchedRowsForDate.length,
        reconciliationCount: reconciliationRowsForDate.length,
      };
    })
    .filter(Boolean);
}

function buildWorkbookReportPlan({
  id,
  label,
  description,
  tone,
  statusLabel,
  focusReports,
  notes,
  recommendedChoices,
  recommendedOpeningDate,
}) {
  return {
    id,
    label,
    description,
    tone,
    statusLabel,
    focusReports,
    notes,
    recommendedChoices,
    recommendedOpeningDate,
  };
}

function buildWorkbookReportInsight(preview) {
  const sheetSummaries = preview?.sheetSummaries ?? [];
  const openingSnapshots = preview?.openingSnapshots ?? [];
  const movementRows = preview?.movementRows ?? [];
  const itemProfileRows = preview?.itemProfileRows ?? [];
  const unmatchedRows = preview?.unmatchedRows ?? [];
  const reconciliationRows = preview?.reconciliationRows ?? [];
  const firstOpeningSnapshot = openingSnapshots[0] ?? null;
  const firstOpeningRows = firstOpeningSnapshot?.rows ?? [];
  const receiptRows = movementRows.filter((row) => row.type === "IN");
  const issueRows = movementRows.filter((row) => row.type === "OUT");
  const adjustmentRows = movementRows.filter((row) => row.type === "ADJ");
  const itemCostedCount = itemProfileRows.filter((row) => Number(row.unitCost) > 0).length;
  const openingCostedCount = firstOpeningRows.filter((row) => Number(row.unitCost) > 0).length;
  const receiptCostedCount = receiptRows.filter((row) => Number(row.unitCost) > 0).length;
  const newItemCount = itemProfileRows.filter((row) => row.importAction === "new").length;
  const itemsWithLevelsCount = itemProfileRows.filter(
    (row) => row.minStock !== null || row.maxStock !== null
  ).length;
  const itemCostCoveragePercent = calculateCoveragePercent(itemCostedCount, itemProfileRows.length);
  const openingCostCoveragePercent = calculateCoveragePercent(openingCostedCount, firstOpeningRows.length);
  const receiptCostCoveragePercent = calculateCoveragePercent(receiptCostedCount, receiptRows.length);
  const levelCoveragePercent = calculateCoveragePercent(itemsWithLevelsCount, itemProfileRows.length);
  const supportedReports = [
    openingSnapshots.length && itemProfileRows.length ? "Stock Position" : null,
    openingSnapshots.length && itemProfileRows.length ? "By Category" : null,
    receiptRows.length ? "Received" : null,
    issueRows.length ? "Issued" : null,
    movementRows.length ? "Item Movement" : null,
    sheetSummaries.length > 1 ? "Comparison" : null,
    adjustmentRows.length ? "Adjustments / Reconciliation" : null,
  ].filter(Boolean);
  const notes = [];
  const financePlanNotes = [];
  const movementPlanNotes = [];
  const stockPlanNotes = [];

  if (!sheetSummaries.length) {
    notes.push("No dated daily sheets were found in the selected workbook window.");
  }
  if (!openingSnapshots.length) {
    notes.push("No opening snapshot is available in this workbook window yet.");
  }
  if (!movementRows.length) {
    notes.push("This workbook window has no movement lines, so reports will only reflect balances and levels.");
  }
  if (newItemCount > 0) {
    notes.push(`${newItemCount} workbook item profiles are not yet in the frontend master and will be added during import.`);
  }
  if (receiptRows.length && receiptCostedCount < receiptRows.length) {
    notes.push(
      `${receiptRows.length - receiptCostedCount} receipt lines do not carry direct cost, so finance math will rely on opening or running average cost where available.`
    );
  }
  if (reconciliationRows.length) {
    notes.push(
      `${reconciliationRows.length} closing differences will be imported as adjustment lines so the app matches the workbook math.`
    );
  }
  if (unmatchedRows.length) {
    notes.push(`${unmatchedRows.length} workbook rows still could not be matched or prepared for import.`);
  }

  if (!itemProfileRows.length) {
    financePlanNotes.push("Item profiles are missing, so costs, categories, and levels will not feed finance correctly.");
    stockPlanNotes.push("Item profiles are missing, so the workbook cannot set category, UOM, cost, or level controls yet.");
  }
  if (!openingSnapshots.length) {
    financePlanNotes.push("An opening balance day is needed for clean period reporting.");
    stockPlanNotes.push("Select a workbook window with an opening day so stock balances can start correctly.");
  }
  if (!movementRows.length) {
    financePlanNotes.push("This window has no movement lines, so received, issued, and comparison reports will stay empty.");
    movementPlanNotes.push("This window has no receipt, issue, or adjustment lines to load into history.");
  }
  if (receiptRows.length && receiptCostCoveragePercent < 100) {
    financePlanNotes.push(
      `${receiptRows.length - receiptCostedCount} receipt lines have no direct cost, so finance value will fall back to opening or running average cost where possible.`
    );
  }
  if (newItemCount > 0) {
    movementPlanNotes.push(
      `${newItemCount} workbook-only items will be added automatically so their movement lines can reflect in reports.`
    );
  }
  if (unmatchedRows.length) {
    financePlanNotes.push(`${unmatchedRows.length} workbook rows still need review before you can trust a full finance report.`);
    movementPlanNotes.push(`${unmatchedRows.length} workbook rows still need review before you trust every movement line.`);
    stockPlanNotes.push(`${unmatchedRows.length} workbook rows still need review before you trust every balance or level.`);
  }
  if (reconciliationRows.length) {
    financePlanNotes.push(
      `${reconciliationRows.length} closing differences will come in as adjustment lines so frontend closing stock matches the workbook.`
    );
  }
  if (itemsWithLevelsCount < itemProfileRows.length) {
    stockPlanNotes.push(
      `${itemProfileRows.length - itemsWithLevelsCount} items do not carry minimum or maximum levels in this workbook window.`
    );
  }

  const financeTone =
    !itemProfileRows.length || !openingSnapshots.length
      ? "danger"
      : unmatchedRows.length
        ? "danger"
        : !movementRows.length || receiptCostCoveragePercent < 100 || reconciliationRows.length
          ? "warning"
          : "success";
  const financeStatusLabel =
    financeTone === "danger"
      ? "Needs workbook fixes"
      : financeTone === "warning"
        ? "Ready with checks"
        : "Ready for finance";

  const movementTone = !movementRows.length ? "danger" : unmatchedRows.length ? "warning" : "success";
  const movementStatusLabel =
    movementTone === "danger"
      ? "No movements found"
      : movementTone === "warning"
        ? "Ready with row checks"
        : "Ready for history";

  const stockTone =
    !itemProfileRows.length || !openingSnapshots.length
      ? "danger"
      : unmatchedRows.length || itemsWithLevelsCount < itemProfileRows.length
        ? "warning"
        : "success";
  const stockStatusLabel =
    stockTone === "danger"
      ? "Needs opening or item setup"
      : stockTone === "warning"
        ? "Ready with level checks"
        : "Ready for balances";

  const reportPlans = [
    buildWorkbookReportPlan({
      id: "finance",
      label: "Finance reporting",
      description: "Best for month-end or period reporting where finance needs values, movements, and comparisons together.",
      tone: financeTone,
      statusLabel: financeStatusLabel,
      focusReports: supportedReports.filter((report) =>
        ["Stock Position", "By Category", "Received", "Issued", "Item Movement", "Comparison"].includes(report)
      ),
      notes: financePlanNotes,
      recommendedChoices: {
        includeWorkbookItems: itemProfileRows.length > 0,
        includeWorkbookOpenings: openingSnapshots.length > 0,
        includeWorkbookMovements: movementRows.length > 0,
      },
      recommendedOpeningDate: firstOpeningSnapshot?.date ?? "",
    }),
    buildWorkbookReportPlan({
      id: "movement",
      label: "Movement tracking",
      description: "Use this when you mainly need Audit Trail, Department Use, and item movement reports from the workbook.",
      tone: movementTone,
      statusLabel: movementStatusLabel,
      focusReports: supportedReports.filter((report) =>
        ["Received", "Issued", "Item Movement", "Adjustments / Reconciliation"].includes(report)
      ),
      notes: movementPlanNotes,
      recommendedChoices: {
        includeWorkbookItems: itemProfileRows.length > 0,
        includeWorkbookOpenings: false,
        includeWorkbookMovements: movementRows.length > 0,
      },
      recommendedOpeningDate: firstOpeningSnapshot?.date ?? "",
    }),
    buildWorkbookReportPlan({
      id: "stock",
      label: "Stock balances and levels",
      description: "Best when you need opening stock, unit cost, categories, and min/max levels to feed stock position reports.",
      tone: stockTone,
      statusLabel: stockStatusLabel,
      focusReports: supportedReports.filter((report) =>
        ["Stock Position", "By Category", "Adjustments / Reconciliation"].includes(report)
      ),
      notes: stockPlanNotes,
      recommendedChoices: {
        includeWorkbookItems: itemProfileRows.length > 0,
        includeWorkbookOpenings: openingSnapshots.length > 0,
        includeWorkbookMovements: movementRows.length > 0,
      },
      recommendedOpeningDate: firstOpeningSnapshot?.date ?? "",
    }),
  ];

  return {
    openingDateSuggestion: firstOpeningSnapshot?.date ?? "",
    dateFrom: preview?.selectedDateFrom ?? sheetSummaries[0]?.date ?? "",
    dateTo: preview?.selectedDateTo ?? sheetSummaries.at(-1)?.date ?? "",
    sheetCount: sheetSummaries.length,
    movementLineCount: movementRows.length,
    receiptLineCount: receiptRows.length,
    issueLineCount: issueRows.length,
    adjustmentLineCount: adjustmentRows.length,
    openingRowCount: firstOpeningRows.length,
    itemProfileCount: itemProfileRows.length,
    newItemCount,
    itemsWithLevelsCount,
    itemCostedCount,
    openingCostedCount,
    receiptCostedCount,
    itemCostCoveragePercent,
    openingCostCoveragePercent,
    receiptCostCoveragePercent,
    levelCoveragePercent,
    unmatchedCount: unmatchedRows.length,
    reconciliationCount: reconciliationRows.length,
    supportedReports,
    readyReportCount: supportedReports.length,
    reportReady:
      Boolean(sheetSummaries.length) &&
      Boolean(itemProfileRows.length) &&
      Boolean(openingSnapshots.length) &&
      unmatchedRows.length === 0,
    recommendedImportChoices: {
      includeWorkbookItems: itemProfileRows.length > 0,
      includeWorkbookOpenings: openingSnapshots.length > 0,
      includeWorkbookMovements: movementRows.length > 0,
    },
    reportPlans,
    notes,
  };
}

export function parseDailyStoresWorkbook(workbook, items, options = {}) {
  const XLSX = options.xlsx;
  const sheetSummaries = [];
  const openingSnapshots = [];
  const movementRows = [];
  const warnings = [];
  const unmatchedRows = [];
  const reconciliationRows = [];
  const latestItemProfiles = new Map();
  const itemLookupData = buildItemLookup(items);
  const resolveWorkbookItem = createWorkbookItemResolver(items);
  const existingNameCounts = itemLookupData.nameCounts;
  const existingCompactNameCounts = itemLookupData.compactNameCounts;

  if (!XLSX) {
    throw new Error("An XLSX implementation must be provided.");
  }

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    const parsed = parseDailyStoresSheetRows(rows, sheetName, items, {
      ...options,
      resolveWorkbookItem,
    });
    if (!parsed.date) continue;

    sheetSummaries.push({
      sheetName: parsed.sheetName,
      date: parsed.date,
      matchedCount: parsed.matchedCount,
      openingCount: parsed.openingRows.length,
      movementCount: parsed.movements.length,
      unmatchedCount: parsed.unmatchedRows.length,
      reconciliationCount: parsed.reconciliationRows.length,
    });

    openingSnapshots.push({
      date: parsed.date,
      sheetName: parsed.sheetName,
      rows: parsed.openingRows,
    });

    for (const row of parsed.openingRows) {
      latestItemProfiles.set(
        row.itemId,
        mergeWorkbookItemProfile(latestItemProfiles.get(row.itemId), row)
      );
    }

    movementRows.push(...parsed.movements);
    warnings.push(...parsed.warnings);
    reconciliationRows.push(...parsed.reconciliationRows);
    unmatchedRows.push(
      ...parsed.unmatchedRows.map((row) => ({
        ...row,
        sheetName: parsed.sheetName,
        date: parsed.date,
      }))
    );
  }

  openingSnapshots.sort((left, right) => left.date.localeCompare(right.date));
  sheetSummaries.sort((left, right) => left.date.localeCompare(right.date));
  movementRows.sort((left, right) => left.date.localeCompare(right.date));
  reconciliationRows.sort((left, right) => {
    const dateCompare = left.date.localeCompare(right.date);
    if (dateCompare !== 0) return dateCompare;
    return left.rowNumber - right.rowNumber;
  });
  const dailyRequisitionMovementRows =
    options.assignDailyRequisitionNumbers === false
      ? movementRows
      : assignWorkbookIssueRequisitionNumbers(movementRows, {
          departmentStartNumbers: options.departmentRequisitionStartNumbers,
          overrideExisting: true,
        });

  return {
    workbookName: options.fileName ?? "",
    sheetSummaries,
    openingSnapshots,
    movementRows: dailyRequisitionMovementRows,
    itemProfileRows: Array.from(latestItemProfiles.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
    warnings,
    reconciliationRows,
    unmatchedRows,
    availableDates: openingSnapshots.map((snapshot) => snapshot.date),
    reportInsight: buildWorkbookReportInsight({
      sheetSummaries,
      openingSnapshots,
      movementRows: dailyRequisitionMovementRows,
      itemProfileRows: Array.from(latestItemProfiles.values()),
      unmatchedRows,
      reconciliationRows,
    }),
  };
}

export function filterWorkbookPreviewByDateRange(preview, dateFrom = "", dateTo = "") {
  if (!preview) return null;

  const availableDates = [...(preview.availableDates ?? [])].sort((left, right) =>
    left.localeCompare(right)
  );
  const effectiveFrom = dateFrom || availableDates[0] || "";
  const effectiveTo = dateTo || availableDates.at(-1) || "";
  const rangeStart = effectiveFrom && effectiveTo && effectiveFrom > effectiveTo ? effectiveTo : effectiveFrom;
  const rangeEnd = effectiveFrom && effectiveTo && effectiveFrom > effectiveTo ? effectiveFrom : effectiveTo;
  const isInRange = (date) => {
    if (!date) return false;
    if (rangeStart && date < rangeStart) return false;
    if (rangeEnd && date > rangeEnd) return false;
    return true;
  };

  const openingSnapshots = (preview.openingSnapshots ?? []).filter((entry) => isInRange(entry.date));
  const sheetSummaries = (preview.sheetSummaries ?? []).filter((entry) => isInRange(entry.date));
  const movementRows = (preview.movementRows ?? []).filter((entry) => isInRange(entry.date));
  const unmatchedRows = (preview.unmatchedRows ?? []).filter((entry) => isInRange(entry.date));
  const reconciliationRows = (preview.reconciliationRows ?? []).filter((entry) => isInRange(entry.date));
  const latestItemProfiles = new Map();

  for (const snapshot of openingSnapshots) {
    for (const row of snapshot.rows ?? []) {
      latestItemProfiles.set(
        row.itemId,
        mergeWorkbookItemProfile(latestItemProfiles.get(row.itemId), row)
      );
    }
  }

  return {
    ...preview,
    sheetSummaries,
    openingSnapshots,
    movementRows,
    unmatchedRows,
    reconciliationRows,
    itemProfileRows: Array.from(latestItemProfiles.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
    availableDates: openingSnapshots.map((snapshot) => snapshot.date),
    selectedDateFrom: rangeStart,
    selectedDateTo: rangeEnd,
    reportInsight: buildWorkbookReportInsight({
      ...preview,
      sheetSummaries,
      openingSnapshots,
      movementRows,
      unmatchedRows,
      reconciliationRows,
      itemProfileRows: Array.from(latestItemProfiles.values()),
      selectedDateFrom: rangeStart,
      selectedDateTo: rangeEnd,
    }),
  };
}

export function filterWorkbookPreviewByScope(
  preview,
  { category = "all", itemIds = [] } = {}
) {
  if (!preview) return null;

  const categoryFilter = String(category ?? "").trim();
  const selectedItemIds = new Set(
    (Array.isArray(itemIds) ? itemIds : []).map((itemId) => String(itemId ?? "").trim()).filter(Boolean)
  );

  const matchesCategory = (value) =>
    isAllSelection(categoryFilter) || normalizeLabel(value) === normalizeLabel(categoryFilter);

  const itemProfileRows = (preview.itemProfileRows ?? []).filter((row) => {
    if (!matchesCategory(row.category)) return false;
    if (selectedItemIds.size && !selectedItemIds.has(row.itemId)) return false;
    return true;
  });

  const allowedItemIds = new Set(itemProfileRows.map((row) => row.itemId));
  const openingSnapshots = (preview.openingSnapshots ?? [])
    .map((snapshot) => ({
      ...snapshot,
      rows: (snapshot.rows ?? []).filter((row) => allowedItemIds.has(row.itemId)),
    }))
    .filter((snapshot) => snapshot.rows.length);
  const movementRows = (preview.movementRows ?? []).filter((row) => allowedItemIds.has(row.itemId));
  const reconciliationRows = (preview.reconciliationRows ?? []).filter((row) =>
    allowedItemIds.has(row.itemId)
  );
  const unmatchedRows = selectedItemIds.size
    ? []
    : (preview.unmatchedRows ?? []).filter((row) => matchesCategory(row.category));
  const sheetSummaries = buildFilteredSheetSummaries(
    preview,
    openingSnapshots,
    movementRows,
    unmatchedRows,
    reconciliationRows
  );

  return {
    ...preview,
    sheetSummaries,
    openingSnapshots,
    movementRows,
    itemProfileRows,
    unmatchedRows,
    reconciliationRows,
    availableDates: openingSnapshots.map((snapshot) => snapshot.date),
    selectedCategory: categoryFilter || "all",
    selectedItemIds: Array.from(selectedItemIds),
    reportInsight: buildWorkbookReportInsight({
      ...preview,
      sheetSummaries,
      openingSnapshots,
      movementRows,
      itemProfileRows,
      unmatchedRows,
      reconciliationRows,
      selectedDateFrom: preview.selectedDateFrom,
      selectedDateTo: preview.selectedDateTo,
    }),
  };
}

export function readWorkbookSheetRows(workbook, xlsxModule, preferredSheetName = "") {
  const sheetName = preferredSheetName || workbook?.SheetNames?.[0] || "";
  if (!sheetName) {
    return {
      sheetName: "",
      rows: [],
    };
  }

  const worksheet = workbook.Sheets[sheetName];
  const rows = xlsxModule.utils.sheet_to_json(worksheet, {
    raw: false,
    defval: "",
  });

  return {
    sheetName,
    rows,
  };
}

export async function loadWorkbookFromFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
  });

  return { workbook, xlsxModule: XLSX };
}
