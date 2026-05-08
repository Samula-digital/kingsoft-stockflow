import {
  formatNumber,
  getMovementReference,
  normalizeRequisitionNumber,
  normalizeSearchValue,
} from "./formatters.js";

function toNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function calculateStockValue(quantity, unitCost) {
  const normalizedUnitCost = toOptionalNumber(unitCost);
  if (normalizedUnitCost === null) return null;
  return Number((toNumber(quantity) * normalizedUnitCost).toFixed(2));
}

export function isMovementDeleted(movement) {
  return Boolean(String(movement?.deletedAt ?? "").trim());
}

export function filterActiveMovements(movements) {
  return (movements ?? []).filter((movement) => !isMovementDeleted(movement));
}

function isMovementInRange(movement, range) {
  if (isMovementDeleted(movement)) return false;

  const startDate = range?.startDate ?? "";
  const endDate = range?.endDate ?? startDate;

  if (!startDate || !endDate) return false;

  return movement.date >= startDate && movement.date <= endDate;
}

function buildItemMap(items) {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function buildDepartmentMap(departments) {
  return Object.fromEntries(departments.map((department) => [department.id, department]));
}

function calculateMovementValue(quantity, unitCost) {
  return calculateStockValue(Math.abs(toNumber(quantity)), unitCost);
}

function getStartingUnitCost(item) {
  return toOptionalNumber(item?.baseUnitCost ?? item?.unitCost);
}

function sortMovementsChronologically(movements) {
  return [...filterActiveMovements(movements)].sort((left, right) => {
    const dateCompare = String(left.date ?? "").localeCompare(String(right.date ?? ""));
    if (dateCompare !== 0) return dateCompare;

    const createdCompare = String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
    if (createdCompare !== 0) return createdCompare;

    return String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
}

export function projectWeightedAverageCost(
  currentQuantity,
  currentUnitCost,
  receivedQuantity,
  receivedUnitCost
) {
  const normalizedCurrentQuantity = Math.max(0, toNumber(currentQuantity));
  const normalizedReceivedQuantity = Math.max(0, toNumber(receivedQuantity));
  const normalizedCurrentUnitCost = toOptionalNumber(currentUnitCost);
  const normalizedReceivedUnitCost = toOptionalNumber(receivedUnitCost);

  if (!normalizedReceivedQuantity) {
    return normalizedCurrentUnitCost;
  }

  if (normalizedReceivedUnitCost === null) {
    return normalizedCurrentUnitCost;
  }

  if (normalizedCurrentQuantity <= 0) {
    return normalizedReceivedUnitCost;
  }

  if (normalizedCurrentUnitCost === null) {
    return null;
  }

  const totalValue =
    normalizedCurrentQuantity * normalizedCurrentUnitCost +
    normalizedReceivedQuantity * normalizedReceivedUnitCost;
  const totalQuantity = normalizedCurrentQuantity + normalizedReceivedQuantity;

  if (!totalQuantity) return normalizedCurrentUnitCost;

  return Number((totalValue / totalQuantity).toFixed(2));
}

function buildCostLedger(items, movements, options = {}) {
  const throughDate = String(options.throughDate ?? "").trim();
  const itemStateMap = new Map(
    items.map((item) => [
      item.id,
      {
        averageUnitCost: getStartingUnitCost(item),
        lastPurchaseCost: toOptionalNumber(item?.lastPurchaseCost),
        quantity: toNumber(item.openingBalance),
      },
    ])
  );
  const movementCostById = new Map();

  for (const movement of sortMovementsChronologically(movements)) {
    if (throughDate && String(movement.date ?? "") > throughDate) {
      break;
    }

    const state =
      itemStateMap.get(movement.itemId) ?? {
        averageUnitCost: null,
        lastPurchaseCost: null,
        quantity: 0,
      };
    const quantity = Math.abs(toNumber(movement.quantity));
    const explicitUnitCost = toOptionalNumber(movement.unitCost);
    const currentAverageUnitCost = toOptionalNumber(state.averageUnitCost);

    if (movement.type === "IN") {
      const appliedReceiptCost = explicitUnitCost ?? currentAverageUnitCost;
      movementCostById.set(movement.id, appliedReceiptCost);

      state.averageUnitCost = projectWeightedAverageCost(
        state.quantity,
        currentAverageUnitCost,
        quantity,
        appliedReceiptCost
      );
      state.quantity += quantity;

      if (explicitUnitCost !== null) {
        state.lastPurchaseCost = explicitUnitCost;
      }

      itemStateMap.set(movement.itemId, state);
      continue;
    }

    const movementUnitCost = explicitUnitCost ?? currentAverageUnitCost;
    movementCostById.set(movement.id, movementUnitCost);

    if (movement.type === "OUT") {
      state.quantity -= quantity;
    } else if (movement.adjustmentMode === "DECREASE") {
      state.quantity -= quantity;
    } else {
      state.quantity += quantity;
    }

    itemStateMap.set(movement.itemId, state);
  }

  return {
    itemCostById: itemStateMap,
    movementCostById,
  };
}

function getMovementResolvedUnitCost(movement, movementCostById, item) {
  if (movementCostById?.has(movement.id)) {
    return movementCostById.get(movement.id);
  }

  const explicitUnitCost = toOptionalNumber(movement?.unitCost);
  if (explicitUnitCost !== null) return explicitUnitCost;

  return getStartingUnitCost(item);
}

function resolveItemCategory(item) {
  return String(item?.category ?? "").trim() || "Others";
}

function addQuantityToUomTotals(totals, uom, quantity) {
  const key = String(uom ?? "-").trim() || "-";
  totals[key] = toNumber(totals[key]) + Math.abs(toNumber(quantity));
}

function getComparableRequisitionKey(movement) {
  return normalizeRequisitionNumber(movement.requisitionNumber) || movement.id;
}

function formatUomTotals(totals) {
  const entries = Object.entries(totals ?? {}).filter(([, quantity]) => toNumber(quantity) > 0);

  if (!entries.length) return "-";

  return entries
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([uom, quantity]) => `${formatNumber(quantity)} ${uom}`)
    .join(" | ");
}

export function shouldShowOperationalItemRow(row) {
  if (!row) return false;
  if (row.isActive !== false) return true;

  return (
    toNumber(row.stockOnHand ?? row.closing ?? 0) !== 0 ||
    toNumber(row.opening ?? row.openingBalance ?? 0) !== 0 ||
    toNumber(row.inQty) !== 0 ||
    toNumber(row.outQty) !== 0 ||
    toNumber(row.adjQty) !== 0 ||
    toNumber(row.lineCount) !== 0 ||
    Boolean(row.lastMovementDate)
  );
}

export function classifyLossReason(notes = "") {
  const normalizedNotes = normalizeSearchValue(notes);

  if (!normalizedNotes) return "Stock Reduction";
  if (
    /spoil|spoilt|expired|expire|rot|stale/.test(normalizedNotes)
  ) {
    return "Spoilt / Expired";
  }
  if (
    /dispose|disposed|dump|waste|damag|damage|broken|breakage/.test(normalizedNotes)
  ) {
    return "Disposed / Damaged";
  }
  if (/loss|missing|shortage|shrink/.test(normalizedNotes)) {
    return "Loss / Shortage";
  }

  return "Stock Reduction";
}

function formatDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDateValue(dateValue, amount) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + amount);
  return formatDateValue(date);
}

function emptyLedger() {
  return {
    inQty: 0,
    outQty: 0,
    adjQty: 0,
    netMovement: 0,
    lineCount: 0,
    lastMovementDate: "",
  };
}

export function getSignedMovementQuantity(movement) {
  const quantity = Math.abs(toNumber(movement.quantity));

  if (movement.type === "OUT") return -quantity;
  if (movement.type === "ADJ") {
    return movement.adjustmentMode === "DECREASE" ? -quantity : quantity;
  }

  return quantity;
}

export function getMovementBreakdown(movement) {
  const quantity = Math.abs(toNumber(movement.quantity));

  if (movement.type === "IN") {
    return { inQty: quantity, outQty: 0, adjQty: 0 };
  }

  if (movement.type === "OUT") {
    return { inQty: 0, outQty: quantity, adjQty: 0 };
  }

  return {
    inQty: 0,
    outQty: 0,
    adjQty: movement.adjustmentMode === "DECREASE" ? -quantity : quantity,
  };
}

export function calculateItemStock(item, movements) {
  const activeMovements = filterActiveMovements(movements);
  let inQty = 0;
  let outQty = 0;
  let adjQty = 0;
  let lastMovementDate = "";

  for (const movement of activeMovements) {
    if (movement.itemId !== item.id) continue;

    const breakdown = getMovementBreakdown(movement);
    inQty += breakdown.inQty;
    outQty += breakdown.outQty;
    adjQty += breakdown.adjQty;

    if (!lastMovementDate || movement.date > lastMovementDate) {
      lastMovementDate = movement.date;
    }
  }

  const openingBalance = toNumber(item.openingBalance);
  const stockOnHand = openingBalance + inQty - outQty + adjQty;

  return {
    inQty,
    outQty,
    adjQty,
    stockOnHand,
    lastMovementDate,
  };
}

export function calculateStockRows(items, movements) {
  const { itemCostById } = buildCostLedger(items, movements);

  return items.map((item) => {
    const summary = calculateItemStock(item, movements);
    const costState = itemCostById.get(item.id) ?? {
      averageUnitCost: getStartingUnitCost(item),
      lastPurchaseCost: toOptionalNumber(item?.lastPurchaseCost),
    };
    const unitCost = toOptionalNumber(costState.averageUnitCost);
    const minStock = toOptionalNumber(item.minStock);
    const maxStock = toOptionalNumber(item.maxStock);
    const belowMinStock = minStock !== null && summary.stockOnHand < minStock;
    const aboveMaxStock = maxStock !== null && summary.stockOnHand > maxStock;
    const stockValue = calculateStockValue(summary.stockOnHand, unitCost);
    const status =
      summary.stockOnHand < 0
        ? "negative"
        : summary.stockOnHand === 0
          ? "zero"
          : belowMinStock
            ? "below-min"
            : aboveMaxStock
              ? "above-max"
              : "healthy";

    return {
      ...item,
      ...summary,
      baseUnitCost: getStartingUnitCost(item),
      unitCost,
      lastPurchaseCost: toOptionalNumber(costState.lastPurchaseCost),
      stockValue,
      minStock,
      maxStock,
      belowMinStock,
      aboveMaxStock,
      hasMinStock: minStock !== null,
      hasMaxStock: maxStock !== null,
      status,
    };
  });
}

export function calculateFinanceDailyRows(items, movements, selectedDate) {
  return calculateFinancePeriodRows(items, movements, {
    startDate: selectedDate,
    endDate: selectedDate,
  });
}

export function calculateFinancePeriodRows(items, movements, range) {
  const activeMovements = filterActiveMovements(movements);
  const startDate = range?.startDate ?? "";
  const endDate = range?.endDate ?? startDate;
  const { itemCostById } = buildCostLedger(items, activeMovements, { throughDate: endDate });

  return items.map((item) => {
    let opening = toNumber(item.openingBalance);
    let inQty = 0;
    let outQty = 0;
    let adjQty = 0;
    let lineCount = 0;

    for (const movement of activeMovements) {
      if (movement.itemId !== item.id) continue;

      if (movement.date < startDate) {
        opening += getSignedMovementQuantity(movement);
        continue;
      }

      if (movement.date > endDate) continue;

      const breakdown = getMovementBreakdown(movement);
      inQty += breakdown.inQty;
      outQty += breakdown.outQty;
      adjQty += breakdown.adjQty;
      lineCount += 1;
    }

    const costState = itemCostById.get(item.id) ?? {
      averageUnitCost: getStartingUnitCost(item),
      lastPurchaseCost: toOptionalNumber(item?.lastPurchaseCost),
    };
    const unitCost = toOptionalNumber(costState.averageUnitCost);
    const minStock = toOptionalNumber(item.minStock);
    const maxStock = toOptionalNumber(item.maxStock);
    const availableQty = opening + inQty + adjQty;
    const closing = availableQty - outQty;
    const stockValue = calculateStockValue(closing, unitCost);
    const belowMinStock = minStock !== null && closing < minStock;
    const aboveMaxStock = maxStock !== null && closing > maxStock;
    const requiredQty =
      closing <= 0 || belowMinStock
        ? Math.max(0, toNumber(maxStock ?? minStock) - closing)
        : 0;
    const needsReview = closing <= 0 || belowMinStock || aboveMaxStock;

    return {
      ...item,
      baseUnitCost: getStartingUnitCost(item),
      unitCost,
      lastPurchaseCost: toOptionalNumber(costState.lastPurchaseCost),
      minStock,
      maxStock,
      opening,
      inQty,
      outQty,
      adjQty,
      availableQty,
      closing,
      lineCount,
      netMovement: inQty - outQty + adjQty,
      hasActivity: lineCount > 0,
      negative: closing < 0,
      belowMinStock,
      aboveMaxStock,
      requiredQty,
      needsReview,
      stockValue,
    };
  });
}

export function calculatePeriodMovementSummary(items, movements, range) {
  const itemMap = buildItemMap(items);
  const { movementCostById } = buildCostLedger(items, movements);
  const summary = {
    receivedQty: 0,
    issuedQty: 0,
    lossQty: 0,
    increaseAdjustQty: 0,
    decreaseAdjustQty: 0,
    receivedValue: 0,
    issuedValue: 0,
    lossValue: 0,
    lineCount: 0,
    receiptLines: 0,
    issueLines: 0,
    lossLines: 0,
    receiptMissingCostLines: 0,
    issueMissingCostLines: 0,
    lossMissingCostLines: 0,
  };

  for (const movement of movements) {
    if (!isMovementInRange(movement, range)) continue;

    const item = itemMap[movement.itemId];
    const quantity = Math.abs(toNumber(movement.quantity));
    const movementUnitCost = getMovementResolvedUnitCost(movement, movementCostById, item);
    const movementValue = calculateMovementValue(quantity, movementUnitCost);

    summary.lineCount += 1;

    if (movement.type === "IN") {
      summary.receivedQty += quantity;
      summary.receivedValue += movementValue ?? 0;
      summary.receiptLines += 1;
      summary.receiptMissingCostLines += movementValue === null ? 1 : 0;
      continue;
    }

    if (movement.type === "OUT") {
      summary.issuedQty += quantity;
      summary.issuedValue += movementValue ?? 0;
      summary.issueLines += 1;
      summary.issueMissingCostLines += movementValue === null ? 1 : 0;
      continue;
    }

    if (movement.adjustmentMode === "DECREASE") {
      summary.lossQty += quantity;
      summary.decreaseAdjustQty += quantity;
      summary.lossValue += movementValue ?? 0;
      summary.lossLines += 1;
      summary.lossMissingCostLines += movementValue === null ? 1 : 0;
      continue;
    }

    summary.increaseAdjustQty += quantity;
  }

  return summary;
}

export function calculateReceiptReportRows(items, movements, range) {
  const itemMap = buildItemMap(items);
  const { movementCostById } = buildCostLedger(items, movements);
  const receiptMap = new Map();

  for (const movement of movements) {
    if (movement.type !== "IN" || !isMovementInRange(movement, range)) continue;

    const item = itemMap[movement.itemId];
    if (!item) continue;

    const movementUnitCost = getMovementResolvedUnitCost(movement, movementCostById, item);
    const movementValue = calculateMovementValue(movement.quantity, movementUnitCost);
    const existing = receiptMap.get(movement.itemId);
    if (existing) {
      existing.receivedQty += Math.abs(toNumber(movement.quantity));
      existing.receivedValue += movementValue ?? 0;
      existing.lineCount += 1;
      existing.missingCostLines += movementValue === null ? 1 : 0;
      existing.unitCostSamples.add(movementUnitCost);
      existing.referenceNumbers.add(movement.referenceNumber || movement.id);
      continue;
    }

    receiptMap.set(movement.itemId, {
      id: movement.itemId,
      itemCode: item.code,
      itemName: item.name,
      category: resolveItemCategory(item),
      uom: item.uom,
      receivedQty: Math.abs(toNumber(movement.quantity)),
      receivedValue: movementValue ?? 0,
      lineCount: 1,
      missingCostLines: movementValue === null ? 1 : 0,
      unitCostSamples: new Set([movementUnitCost]),
      referenceNumbers: new Set([movement.referenceNumber || movement.id]),
    });
  }

  return Array.from(receiptMap.values())
    .map((row) => ({
      ...row,
      averageUnitCost:
        row.receivedQty > 0 && row.receivedValue > 0
          ? Number((row.receivedValue / row.receivedQty).toFixed(2))
          : null,
      referenceCount: row.referenceNumbers.size,
    }))
    .sort((left, right) => right.receivedQty - left.receivedQty || left.itemName.localeCompare(right.itemName));
}

export function calculateIssueDepartmentReportRows(departments, items, movements, range) {
  const departmentMap = buildDepartmentMap(departments);
  const itemMap = buildItemMap(items);
  const { movementCostById } = buildCostLedger(items, movements);
  const issueMap = new Map();

  for (const movement of movements) {
    if (movement.type !== "OUT" || !isMovementInRange(movement, range)) continue;

    const department = departmentMap[movement.departmentId];
    if (!department) continue;

    const item = itemMap[movement.itemId];
    const movementUnitCost = getMovementResolvedUnitCost(movement, movementCostById, item);
    const movementValue = calculateMovementValue(movement.quantity, movementUnitCost);
    const existing = issueMap.get(department.id);

    if (existing) {
      existing.issuedQty += Math.abs(toNumber(movement.quantity));
      existing.issuedValue += movementValue ?? 0;
      existing.lineCount += 1;
      existing.missingCostLines += movementValue === null ? 1 : 0;
      existing.itemIds.add(movement.itemId);
      existing.requisitionNumbers.add(getComparableRequisitionKey(movement));
      addQuantityToUomTotals(existing.uomTotals, item?.uom, movement.quantity);
      continue;
    }

    issueMap.set(department.id, {
      id: department.id,
      departmentName: department.name,
      issuedQty: Math.abs(toNumber(movement.quantity)),
      issuedValue: movementValue ?? 0,
      lineCount: 1,
      missingCostLines: movementValue === null ? 1 : 0,
      itemIds: new Set([movement.itemId]),
      requisitionNumbers: new Set([getComparableRequisitionKey(movement)]),
      uomTotals: {
        [String(item?.uom ?? "-").trim() || "-"]: Math.abs(toNumber(movement.quantity)),
      },
    });
  }

  return Array.from(issueMap.values())
    .map((row) => ({
      ...row,
      uniqueItems: row.itemIds.size,
      requisitionCount: row.requisitionNumbers.size,
      quantityMix: formatUomTotals(row.uomTotals),
    }))
    .sort((left, right) => right.issuedQty - left.issuedQty || left.departmentName.localeCompare(right.departmentName));
}

export function calculateIssueDepartmentItemRows(items, movements, range, departmentId) {
  if (!departmentId) return [];

  const itemMap = buildItemMap(items);
  const { movementCostById } = buildCostLedger(items, movements);
  const issueItemMap = new Map();

  for (const movement of movements) {
    if (
      movement.type !== "OUT" ||
      movement.departmentId !== departmentId ||
      !isMovementInRange(movement, range)
    ) {
      continue;
    }

    const item = itemMap[movement.itemId];
    if (!item) continue;

    const movementUnitCost = getMovementResolvedUnitCost(movement, movementCostById, item);
    const movementValue = calculateMovementValue(movement.quantity, movementUnitCost);
    const existing = issueItemMap.get(item.id);
    if (existing) {
      existing.issuedQty += Math.abs(toNumber(movement.quantity));
      existing.issuedValue += movementValue ?? 0;
      existing.lineCount += 1;
      existing.missingCostLines += movementValue === null ? 1 : 0;
      existing.requisitionNumbers.add(getComparableRequisitionKey(movement));
      continue;
    }

    issueItemMap.set(item.id, {
      id: item.id,
      itemCode: item.code,
      itemName: item.name,
      uom: item.uom,
      issuedQty: Math.abs(toNumber(movement.quantity)),
      issuedValue: movementValue ?? 0,
      lineCount: 1,
      missingCostLines: movementValue === null ? 1 : 0,
      requisitionNumbers: new Set([getComparableRequisitionKey(movement)]),
    });
  }

  return Array.from(issueItemMap.values())
    .map((row) => ({
      ...row,
      requisitionCount: row.requisitionNumbers.size,
    }))
    .sort((left, right) => right.issuedQty - left.issuedQty || left.itemName.localeCompare(right.itemName));
}

export function calculateIssueDepartmentBreakdownRows(
  departments,
  items,
  movements,
  range,
  departmentIds = []
) {
  const allowedDepartmentIds = new Set(
    (departmentIds ?? []).filter((departmentId) => String(departmentId).trim())
  );
  const includeAllDepartments = allowedDepartmentIds.size === 0;
  const departmentMap = buildDepartmentMap(departments);
  const itemMap = buildItemMap(items);
  const { movementCostById } = buildCostLedger(items, movements);
  const breakdownMap = new Map();

  for (const movement of movements) {
    if (movement.type !== "OUT" || !isMovementInRange(movement, range)) continue;
    if (!includeAllDepartments && !allowedDepartmentIds.has(movement.departmentId)) continue;

    const department = departmentMap[movement.departmentId];
    const item = itemMap[movement.itemId];
    if (!item) continue;

    const key = `${movement.departmentId}:${movement.itemId}`;
    const movementUnitCost = getMovementResolvedUnitCost(movement, movementCostById, item);
    const movementValue = calculateMovementValue(movement.quantity, movementUnitCost);
    const existing = breakdownMap.get(key);

    if (existing) {
      existing.issuedQty += Math.abs(toNumber(movement.quantity));
      existing.issuedValue += movementValue ?? 0;
      existing.lineCount += 1;
      existing.missingCostLines += movementValue === null ? 1 : 0;
      existing.requisitionNumbers.add(getComparableRequisitionKey(movement));
      continue;
    }

    breakdownMap.set(key, {
      id: key,
      departmentId: movement.departmentId,
      departmentName: department?.name ?? movement.departmentId,
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      category: resolveItemCategory(item),
      uom: item.uom,
      issuedQty: Math.abs(toNumber(movement.quantity)),
      issuedValue: movementValue ?? 0,
      lineCount: 1,
      missingCostLines: movementValue === null ? 1 : 0,
      requisitionNumbers: new Set([getComparableRequisitionKey(movement)]),
    });
  }

  return Array.from(breakdownMap.values())
    .map((row) => ({
      ...row,
      requisitionCount: row.requisitionNumbers.size,
    }))
    .sort(
      (left, right) =>
        left.departmentName.localeCompare(right.departmentName) ||
        right.issuedQty - left.issuedQty ||
        left.itemName.localeCompare(right.itemName)
    );
}

export function calculateItemMovementDepartmentRows(items, departments, movements, range, itemId) {
  if (!itemId) return [];

  const departmentMap = buildDepartmentMap(departments);
  const itemMap = buildItemMap(items);
  const targetItem = itemMap[itemId];
  const { movementCostById } = buildCostLedger(items, movements);
  const departmentRows = new Map();

  for (const movement of movements) {
    if (movement.itemId !== itemId || !isMovementInRange(movement, range)) continue;

    const departmentName = departmentMap[movement.departmentId]?.name ?? movement.departmentId ?? "-";
    const breakdown = getMovementBreakdown(movement);
    const movementUnitCost = getMovementResolvedUnitCost(
      movement,
      movementCostById,
      targetItem
    );
    const movementValue = calculateMovementValue(movement.quantity, movementUnitCost);
    const reference = getMovementReference(movement) || movement.id;
    const existing = departmentRows.get(departmentName);

    if (existing) {
      existing.inQty += breakdown.inQty;
      existing.outQty += breakdown.outQty;
      existing.adjQty += breakdown.adjQty;
      existing.netQty += getSignedMovementQuantity(movement);
      existing.lineCount += 1;
      existing.missingCostLines += movementValue === null ? 1 : 0;
      existing.movementValue += movementValue ?? 0;
      existing.references.add(reference);

      if (!existing.lastMovementDate || movement.date > existing.lastMovementDate) {
        existing.lastMovementDate = movement.date;
      }

      continue;
    }

    departmentRows.set(departmentName, {
      id: `${itemId}:${departmentName}`,
      departmentId: movement.departmentId,
      departmentName,
      inQty: breakdown.inQty,
      outQty: breakdown.outQty,
      adjQty: breakdown.adjQty,
      netQty: getSignedMovementQuantity(movement),
      lineCount: 1,
      missingCostLines: movementValue === null ? 1 : 0,
      movementValue: movementValue ?? 0,
      lastMovementDate: movement.date,
      references: new Set([reference]),
    });
  }

  return Array.from(departmentRows.values())
    .map((row) => ({
      ...row,
      referenceCount: row.references.size,
    }))
    .sort(
      (left, right) =>
        right.lineCount - left.lineCount ||
        right.netQty - left.netQty ||
        left.departmentName.localeCompare(right.departmentName)
    );
}

export function calculateItemMovementLineRows(items, departments, movements, range, itemId) {
  if (!itemId) return [];

  const departmentMap = buildDepartmentMap(departments);
  const itemMap = buildItemMap(items);
  const targetItem = itemMap[itemId];
  const { movementCostById } = buildCostLedger(items, movements);

  return movements
    .filter((movement) => movement.itemId === itemId && isMovementInRange(movement, range))
    .map((movement) => {
      const movementUnitCost = getMovementResolvedUnitCost(
        movement,
        movementCostById,
        targetItem
      );
      const movementValue = calculateMovementValue(movement.quantity, movementUnitCost);

      return {
        id: movement.id,
        date: movement.date,
        departmentName: departmentMap[movement.departmentId]?.name ?? movement.departmentId ?? "-",
        type: movement.type,
        adjustmentMode: movement.adjustmentMode,
        documentNumber: getMovementReference(movement) || movement.id,
        quantity: Math.abs(toNumber(movement.quantity)),
        effectQty: getSignedMovementQuantity(movement),
        unitCost: movementUnitCost,
        movementValue: movementValue ?? 0,
        missingCostLines: movementValue === null ? 1 : 0,
        notes: movement.notes || "-",
      };
    })
    .sort((left, right) => {
      if (left.date !== right.date) {
        return left.date.localeCompare(right.date);
      }

      return left.documentNumber.localeCompare(right.documentNumber);
    });
}

export function calculateLossReportRows(items, departments, movements, range) {
  const itemMap = buildItemMap(items);
  const departmentMap = buildDepartmentMap(departments);
  const { movementCostById } = buildCostLedger(items, movements);
  const lossMap = new Map();

  for (const movement of movements) {
    if (
      movement.type !== "ADJ" ||
      movement.adjustmentMode !== "DECREASE" ||
      !isMovementInRange(movement, range)
    ) {
      continue;
    }

    const item = itemMap[movement.itemId];
    if (!item) continue;

    const category = classifyLossReason(movement.notes);
    const key = `${movement.itemId}:${category}`;
    const movementUnitCost = getMovementResolvedUnitCost(movement, movementCostById, item);
    const movementValue = calculateMovementValue(movement.quantity, movementUnitCost);
    const existing = lossMap.get(key);

    if (existing) {
      existing.lossQty += Math.abs(toNumber(movement.quantity));
      existing.lossValue += movementValue ?? 0;
      existing.lineCount += 1;
      existing.missingCostLines += movementValue === null ? 1 : 0;
      existing.noteSamples.add(movement.notes || "");
      continue;
    }

    lossMap.set(key, {
      id: key,
      itemCode: item.code,
      itemName: item.name,
      itemCategory: resolveItemCategory(item),
      uom: item.uom,
      category,
      departmentName: departmentMap[movement.departmentId]?.name ?? "-",
      lossQty: Math.abs(toNumber(movement.quantity)),
      lossValue: movementValue ?? 0,
      lineCount: 1,
      missingCostLines: movementValue === null ? 1 : 0,
      noteSamples: new Set([movement.notes || ""]),
    });
  }

  return Array.from(lossMap.values())
    .map((row) => ({
      ...row,
      notes:
        Array.from(row.noteSamples)
          .filter(Boolean)
          .slice(0, 2)
          .join(" | ") || "-",
    }))
    .sort((left, right) => right.lossQty - left.lossQty || left.itemName.localeCompare(right.itemName));
}

export function calculateFinanceCategoryRows(items, movements, range) {
  const financeRows = calculateFinancePeriodRows(items, movements, range);
  const categoryMap = new Map();

  financeRows.forEach((row) => {
    const category = resolveItemCategory(row);
    const existing = categoryMap.get(category);

    if (existing) {
      existing.itemCount += 1;
      existing.opening += row.opening;
      existing.inQty += row.inQty;
      existing.adjQty += row.adjQty;
      existing.availableQty += row.availableQty;
      existing.outQty += row.outQty;
      existing.closing += row.closing;
      existing.requiredQty += row.requiredQty;
      existing.stockValue += row.stockValue ?? 0;
      existing.lineCount += row.lineCount;
      existing.movedItems += row.hasActivity ? 1 : 0;
      existing.reviewItems += row.needsReview ? 1 : 0;
      existing.missingCostItems += row.stockValue === null ? 1 : 0;
      return;
    }

    categoryMap.set(category, {
      id: category,
      category,
      itemCount: 1,
      opening: row.opening,
      inQty: row.inQty,
      adjQty: row.adjQty,
      availableQty: row.availableQty,
      outQty: row.outQty,
      closing: row.closing,
      requiredQty: row.requiredQty,
      stockValue: row.stockValue ?? 0,
      lineCount: row.lineCount,
      movedItems: row.hasActivity ? 1 : 0,
      reviewItems: row.needsReview ? 1 : 0,
      missingCostItems: row.stockValue === null ? 1 : 0,
    });
  });

  return Array.from(categoryMap.values()).sort(
    (left, right) =>
      right.stockValue - left.stockValue ||
      right.closing - left.closing ||
      left.category.localeCompare(right.category)
  );
}

export function calculateFinanceCategoryItemRows(items, movements, range, category = "") {
  const normalizedCategory = String(category ?? "").trim();

  return calculateFinancePeriodRows(items, movements, range)
    .map((row) => ({
      ...row,
      category: resolveItemCategory(row),
      missingCost: row.stockValue === null,
    }))
    .filter((row) => !normalizedCategory || row.category === normalizedCategory)
    .sort(
      (left, right) =>
        (right.stockValue ?? -1) - (left.stockValue ?? -1) ||
        right.closing - left.closing ||
        left.name.localeCompare(right.name)
    );
}

export function calculateDepartmentDailyRows(departments, items, movements, selectedDate) {
  const activeMovements = filterActiveMovements(movements);
  const itemMap = Object.fromEntries(items.map((item) => [item.id, item]));

  return departments.map((department) => {
    const lines = activeMovements.filter(
      (movement) =>
        movement.type === "OUT" &&
        movement.departmentId === department.id &&
        movement.date === selectedDate
    );

    const uniqueItems = new Set(lines.map((line) => line.itemId)).size;
    const topItems = lines
      .slice(0, 3)
      .map((line) => itemMap[line.itemId]?.name ?? line.itemId)
      .join(", ");

    return {
      ...department,
      lineCount: lines.length,
      uniqueItems,
      totalQty: lines.reduce((sum, line) => sum + Math.abs(toNumber(line.quantity)), 0),
      topItems: topItems || "-",
    };
  });
}

export function calculateDashboardMetrics({ items, movements, stockRows, selectedDate }) {
  const activeMovements = filterActiveMovements(movements);
  const dailyMovements = activeMovements.filter((movement) => movement.date === selectedDate);
  const dailyIssues = dailyMovements.filter((movement) => movement.type === "OUT");
  const visibleStockRows = stockRows.filter(shouldShowOperationalItemRow);

  return {
    totalItems: visibleStockRows.length,
    totalMovements: activeMovements.length,
    negativeItems: visibleStockRows.filter((row) => row.stockOnHand < 0).length,
    zeroItems: visibleStockRows.filter((row) => row.stockOnHand === 0).length,
    healthyItems: visibleStockRows.filter(
      (row) => row.stockOnHand > 0 && !row.belowMinStock && !row.aboveMaxStock
    ).length,
    belowMinItems: visibleStockRows.filter((row) => row.belowMinStock).length,
    aboveMaxItems: visibleStockRows.filter((row) => row.aboveMaxStock).length,
    itemsWithMinMax: visibleStockRows.filter((row) => row.hasMinStock || row.hasMaxStock).length,
    todayLines: activeMovements.filter((movement) => movement.date === selectedDate).length,
    todayInLines: dailyMovements.filter((movement) => movement.type === "IN").length,
    todayOutLines: dailyIssues.length,
    todayAdjLines: dailyMovements.filter((movement) => movement.type === "ADJ").length,
    departmentsWithIssuesToday: new Set(dailyIssues.map((movement) => movement.departmentId)).size,
    totalIn: activeMovements
      .filter((movement) => movement.type === "IN")
      .reduce((sum, movement) => sum + Math.abs(toNumber(movement.quantity)), 0),
    totalOut: activeMovements
      .filter((movement) => movement.type === "OUT")
      .reduce((sum, movement) => sum + Math.abs(toNumber(movement.quantity)), 0),
  };
}

export function calculateMovementTrend(movements, endDate, days = 7) {
  if (!endDate || !Number.isFinite(days) || days <= 0) return [];
  const activeMovements = filterActiveMovements(movements);

  const dates = Array.from({ length: days }, (_, index) =>
    shiftDateValue(endDate, index - (days - 1))
  ).filter(Boolean);

  return dates.map((date) => {
    const dayMovements = activeMovements.filter((movement) => movement.date === date);

    return {
      date,
      lineCount: dayMovements.length,
      inLines: dayMovements.filter((movement) => movement.type === "IN").length,
      outLines: dayMovements.filter((movement) => movement.type === "OUT").length,
      adjLines: dayMovements.filter((movement) => movement.type === "ADJ").length,
    };
  });
}

export function buildItemSummary(item, movements) {
  if (!item) {
    return {
      openingBalance: 0,
      inQty: 0,
      outQty: 0,
      adjQty: 0,
      stockOnHand: 0,
      lastMovementDate: "",
      unitCost: null,
      lastPurchaseCost: null,
    };
  }

  const { itemCostById } = buildCostLedger([item], movements);
  const costState = itemCostById.get(item.id) ?? {
    averageUnitCost: getStartingUnitCost(item),
    lastPurchaseCost: toOptionalNumber(item?.lastPurchaseCost),
  };

  return {
    openingBalance: toNumber(item.openingBalance),
    ...calculateItemStock(item, movements),
    unitCost: toOptionalNumber(costState.averageUnitCost),
    lastPurchaseCost: toOptionalNumber(costState.lastPurchaseCost),
  };
}

export function projectStockAfterEntry(currentStock, entry) {
  const quantity = Math.abs(toNumber(entry.quantity));
  if (!quantity) return toNumber(currentStock);

  if (entry.type === "OUT") return toNumber(currentStock) - quantity;
  if (entry.type === "ADJ") {
    return entry.adjustmentMode === "DECREASE"
      ? toNumber(currentStock) - quantity
      : toNumber(currentStock) + quantity;
  }

  return toNumber(currentStock) + quantity;
}

export function enrichMovements(movements, itemMap, departmentMap) {
  return movements.map((movement) => ({
    ...movement,
    itemCode: itemMap[movement.itemId]?.code ?? movement.itemId,
    itemName: itemMap[movement.itemId]?.name ?? movement.itemId,
    itemUom: itemMap[movement.itemId]?.uom ?? "-",
    departmentName: departmentMap[movement.departmentId]?.name ?? movement.departmentId,
    reference: getMovementReference(movement),
    signedQuantity: getSignedMovementQuantity(movement),
    createdBy: String(movement.createdBy ?? movement.enteredBy ?? "").trim(),
    updatedBy: String(movement.updatedBy ?? movement.enteredBy ?? "").trim(),
    deletedBy: String(movement.deletedBy ?? "").trim(),
    deletedReason: String(movement.deletedReason ?? "").trim(),
    deletedAt: String(movement.deletedAt ?? "").trim(),
    isDeleted: isMovementDeleted(movement),
    statusLabel: isMovementDeleted(movement) ? "Deleted" : "Active",
    auditTrail: Array.isArray(movement.auditTrail) ? movement.auditTrail : [],
  }));
}

export function filterHistoryRows(rows, filters) {
  const query = normalizeSearchValue(filters.search);

  return rows.filter((row) => {
    if (filters.type && row.type !== filters.type) return false;
    if (filters.departmentId && row.departmentId !== filters.departmentId) return false;
    if (filters.fromDate && row.date < filters.fromDate) return false;
    if (filters.toDate && row.date > filters.toDate) return false;
    if (filters.status === "active" && row.isDeleted) return false;
    if (filters.status === "deleted" && !row.isDeleted) return false;

    if (!query) return true;

    const haystack = [
      row.itemCode,
      row.itemName,
      row.departmentName,
      row.reference,
      row.notes,
      row.enteredBy,
      row.statusLabel,
      row.deletedBy,
      row.deletedReason,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}
