import { getSeedItemCategory, normalizeItemCategory } from "../data/itemCategories.js";
import { createDepartmentId, createItemCode, normalizeSearchValue } from "./formatters.js";

export const itemMasterTemplateColumns = [
  "item_code",
  "item_name",
  "category",
  "uom",
  "opening_balance",
  "unit_cost",
  "selling_price",
  "min_stock",
  "max_stock",
  "is_active",
];

export const openingBalanceTemplateColumns = [
  "item_code",
  "item_name",
  "uom",
  "opening_balance",
  "unit_cost",
];

export const movementImportTemplateColumns = [
  "date",
  "movement_type",
  "department",
  "item_code",
  "item_name",
  "quantity",
  "unit_cost",
  "reference_number",
  "requisition_number",
  "adjustment_mode",
  "notes",
  "entered_by",
];

export const departmentImportTemplateColumns = [
  "department_code",
  "department_name",
  "requisition_start_number",
  "is_main_store",
  "is_active",
];

function pick(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

function findItemsByName(items, nameValue) {
  const name = normalizeSearchValue(nameValue);
  if (!name) return [];

  return items.filter((item) => normalizeSearchValue(item.name) === name);
}

function findItem(items, codeValue, nameValue, uomValue = "") {
  const code = normalizeSearchValue(codeValue);
  const normalizedUom = normalizeSearchValue(uomValue);
  const codeMatch =
    items.find((item) => code && normalizeSearchValue(item.code) === code) || null;

  if (codeMatch) return codeMatch;

  const nameMatches = findItemsByName(items, nameValue);
  if (!nameMatches.length) return null;
  if (normalizedUom) {
    return (
      nameMatches.find((item) => normalizeSearchValue(item.uom) === normalizedUom) || null
    );
  }

  return nameMatches.length === 1 ? nameMatches[0] : null;
}

function findItemMatches(items, codeValue, nameValue, uomValue = "") {
  const code = normalizeSearchValue(codeValue);
  const normalizedUom = normalizeSearchValue(uomValue);
  const codeMatch =
    items.find((item) => code && normalizeSearchValue(item.code) === code) || null;
  const nameMatches = findItemsByName(items, nameValue);
  const nameMatch = normalizedUom
    ? nameMatches.find((item) => normalizeSearchValue(item.uom) === normalizedUom) || null
    : nameMatches.length === 1
      ? nameMatches[0]
      : null;
  const ambiguousNameMatch = !normalizedUom && nameMatches.length > 1;

  return {
    codeMatch,
    nameMatch,
    ambiguousNameMatch,
  };
}

function findDepartment(departments, value) {
  const lookup = normalizeSearchValue(value);
  if (!lookup) return null;

  return (
    departments.find((department) => normalizeSearchValue(department.id) === lookup) ||
    departments.find((department) => normalizeSearchValue(department.name) === lookup) ||
    departments.find((department) => department.id === createDepartmentId(value)) ||
    null
  );
}

function parseOptionalNumber(value) {
  const rawValue = String(value ?? "").replace(/,/g, "").trim();
  if (!rawValue) {
    return {
      value: null,
      isBlank: true,
      isValid: true,
    };
  }

  const numericValue = Number(rawValue);

  return {
    value: Number.isFinite(numericValue) ? numericValue : null,
    isBlank: false,
    isValid: Number.isFinite(numericValue),
  };
}

function parseBooleanFlag(value, fallback = true) {
  const normalizedValue = normalizeSearchValue(value);
  if (!normalizedValue) return { value: fallback, isValid: true };

  if (["true", "yes", "y", "1", "active"].includes(normalizedValue)) {
    return { value: true, isValid: true };
  }

  if (["false", "no", "n", "0", "inactive"].includes(normalizedValue)) {
    return { value: false, isValid: true };
  }

  return {
    value: fallback,
    isValid: false,
  };
}

function createNextImportItemCode(items, usedCodes) {
  let code = createItemCode([
    ...(items ?? []),
    ...Array.from(usedCodes).map((usedCode) => ({ code: usedCode })),
  ]);

  while (usedCodes.has(normalizeSearchValue(code))) {
    code = createItemCode([
      ...(items ?? []),
      ...Array.from(usedCodes).map((usedCode) => ({ code: usedCode })),
      { code },
    ]);
  }

  return code;
}

export function prepareItemMasterImportRows(rows, items) {
  const mappedRows = [];
  const errors = [];
  const warnings = [];
  const seenCodes = new Set();
  const seenNameUoms = new Set();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const code = String(
      pick(row, ["item_code", "code", "itemCode", "Item Code", "ITEM CODE"])
    )
      .trim()
      .toUpperCase();
    const name = String(
      pick(row, ["item_name", "name", "itemName", "Item Name", "ITEM NAME"])
    ).trim();
    const category = normalizeItemCategory(
      pick(row, ["category", "item_category", "itemCategory", "Category", "ITEM CATEGORY"]),
      ""
    );
    const uom = String(pick(row, ["uom", "UOM", "unit", "Unit"])).trim().toUpperCase();
    const openingBalanceValue = parseOptionalNumber(
      pick(row, ["opening_balance", "openingBalance", "opening", "Opening Balance"])
    );
    const unitCostValue = parseOptionalNumber(
      pick(row, ["unit_cost", "unitCost", "unit price", "Unit Cost", "Unit Price"])
    );
    const sellingPriceValue = parseOptionalNumber(
      pick(row, [
        "selling_price",
        "sellingPrice",
        "price",
        "sale_price",
        "Selling Price",
        "Price",
      ])
    );
    const minStockValue = parseOptionalNumber(
      pick(row, ["min_stock", "minStock", "minimum_stock", "Minimum Stock", "Min Stock"])
    );
    const maxStockValue = parseOptionalNumber(
      pick(row, ["max_stock", "maxStock", "maximum_stock", "Maximum Stock", "Max Stock"])
    );
    const activeFlagValue = parseBooleanFlag(
      pick(row, ["is_active", "isActive", "status", "Status", "active"])
    );
    const normalizedNameUom = `${normalizeSearchValue(name)}|${normalizeSearchValue(uom)}`;

    if (!name) {
      errors.push(`Row ${rowNumber}: item name is required.`);
      return;
    }

    if (!uom) {
      errors.push(`Row ${rowNumber}: UOM is required.`);
      return;
    }

    if (seenNameUoms.has(normalizedNameUom)) {
      errors.push(`Row ${rowNumber}: item name and UOM are duplicated in this file.`);
      return;
    }

    if (!openingBalanceValue.isValid || (openingBalanceValue.value ?? 0) < 0) {
      errors.push(`Row ${rowNumber}: opening balance must be 0 or greater.`);
      return;
    }
    if (!unitCostValue.isValid || (unitCostValue.value !== null && unitCostValue.value < 0)) {
      errors.push(`Row ${rowNumber}: unit cost must be blank or 0 and above.`);
      return;
    }
    if (
      !sellingPriceValue.isValid ||
      (sellingPriceValue.value !== null && sellingPriceValue.value < 0)
    ) {
      errors.push(`Row ${rowNumber}: selling price must be blank or 0 and above.`);
      return;
    }

    if (!minStockValue.isValid || (minStockValue.value !== null && minStockValue.value < 0)) {
      errors.push(`Row ${rowNumber}: minimum stock must be blank or 0 and above.`);
      return;
    }

    if (!maxStockValue.isValid || (maxStockValue.value !== null && maxStockValue.value < 0)) {
      errors.push(`Row ${rowNumber}: maximum stock must be blank or 0 and above.`);
      return;
    }

    if (
      minStockValue.value !== null &&
      maxStockValue.value !== null &&
      maxStockValue.value < minStockValue.value
    ) {
      errors.push(
        `Row ${rowNumber}: maximum stock must be equal to or greater than minimum stock.`
      );
      return;
    }

    if (!activeFlagValue.isValid) {
      errors.push(
        `Row ${rowNumber}: status must be active/inactive, yes/no, true/false, or 1/0.`
      );
      return;
    }

    const { codeMatch, nameMatch, ambiguousNameMatch } = findItemMatches(items, code, name, uom);
    const matchedItem = codeMatch ?? nameMatch ?? null;
    const resolvedCode = code || matchedItem?.code || createNextImportItemCode(items, seenCodes);
    const normalizedCode = normalizeSearchValue(resolvedCode);

    if (seenCodes.has(normalizedCode)) {
      errors.push(`Row ${rowNumber}: item code is duplicated in this file.`);
      return;
    }

    if (!codeMatch && ambiguousNameMatch) {
      errors.push(
        `Row ${rowNumber}: item name matches more than one existing item. Add the correct UOM or item code.`
      );
      return;
    }

    if (codeMatch && nameMatch && codeMatch.id !== nameMatch.id) {
      errors.push(
        `Row ${rowNumber}: code and name match different existing items. Fix the row before importing.`
      );
      return;
    }

    seenCodes.add(normalizedCode);
    seenNameUoms.add(normalizedNameUom);

    if (!code && !matchedItem) {
      warnings.push(`Row ${rowNumber}: item code was blank, so ${resolvedCode} was generated.`);
    }

    if (!matchedItem && (minStockValue.value !== null || maxStockValue.value !== null)) {
      warnings.push(
        `Row ${rowNumber}: ${name} will be added as a new item with imported stock limits.`
      );
    }

    mappedRows.push({
      itemId: matchedItem?.id ?? null,
      code: resolvedCode,
      name,
      category: category || matchedItem?.category || getSeedItemCategory(name),
      uom,
      openingBalance: openingBalanceValue.value ?? 0,
      unitCost: unitCostValue.value,
      sellingPrice: sellingPriceValue.value,
      minStock: minStockValue.value,
      maxStock: maxStockValue.value,
      isActive: activeFlagValue.value,
      importAction: matchedItem ? "update" : "new",
    });
  });

  return {
    mappedRows,
    errors,
    warnings,
    updateCount: mappedRows.filter((row) => row.importAction === "update").length,
    newCount: mappedRows.filter((row) => row.importAction === "new").length,
  };
}

export function prepareOpeningBalanceImportRows(rows, items) {
  const mappedRows = [];
  const errors = [];

  rows.forEach((row, index) => {
    const code = pick(row, ["item_code", "code", "itemCode", "Item Code"]);
    const name = pick(row, ["item_name", "name", "itemName", "Item Name"]);
    const uom = pick(row, ["uom", "UOM", "unit", "Unit"]);
    const openingBalance = Number(
      pick(row, ["opening_balance", "openingBalance", "opening", "Opening Balance"])
    );
    const unitCostValue = parseOptionalNumber(
      pick(row, ["unit_cost", "unitCost", "unit price", "Unit Cost", "Unit Price"])
    );
    const item = findItem(items, code, name, uom);

    if (!item) {
      errors.push(
        `Row ${index + 1}: item could not be matched. Check the code, name, and UOM.`
      );
      return;
    }

    if (!Number.isFinite(openingBalance)) {
      errors.push(`Row ${index + 1}: opening balance is not numeric.`);
      return;
    }
    if (!unitCostValue.isValid || (unitCostValue.value !== null && unitCostValue.value < 0)) {
      errors.push(`Row ${index + 1}: unit cost must be blank or 0 and above.`);
      return;
    }

    mappedRows.push({
      itemId: item.id,
      openingBalance,
      unitCost: unitCostValue.value,
    });
  });

  return { mappedRows, errors };
}

export function prepareDepartmentImportRows(rows, departments) {
  const mappedRows = [];
  const errors = [];
  const seenCodes = new Set();
  const seenNames = new Set();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const code = String(
      pick(row, ["department_code", "code", "departmentCode", "Department Code"])
    )
      .trim()
      .toUpperCase();
    const name = String(
      pick(row, ["department_name", "name", "departmentName", "Department Name"])
    ).trim();
    const isMainStoreValue = parseBooleanFlag(
      pick(row, ["is_main_store", "isMainStore", "main_store", "Main Store"]),
      false
    );
    const requisitionStartValue = parseOptionalNumber(
      pick(row, [
        "requisition_start_number",
        "requisitionStartNumber",
        "first_requisition_page",
        "First Requisition Page",
      ])
    );
    const activeFlagValue = parseBooleanFlag(
      pick(row, ["is_active", "isActive", "status", "Status", "active"])
    );
    const normalizedCode = normalizeSearchValue(code);
    const normalizedName = normalizeSearchValue(name);

    if (!code) {
      errors.push(`Row ${rowNumber}: department code is required.`);
      return;
    }

    if (!name) {
      errors.push(`Row ${rowNumber}: department name is required.`);
      return;
    }

    if (seenCodes.has(normalizedCode)) {
      errors.push(`Row ${rowNumber}: department code is duplicated in this file.`);
      return;
    }

    if (seenNames.has(normalizedName)) {
      errors.push(`Row ${rowNumber}: department name is duplicated in this file.`);
      return;
    }

    if (!isMainStoreValue.isValid) {
      errors.push(`Row ${rowNumber}: main store must be yes/no, true/false, or 1/0.`);
      return;
    }

    if (
      !requisitionStartValue.isValid ||
      (requisitionStartValue.value !== null &&
        (!Number.isInteger(requisitionStartValue.value) || requisitionStartValue.value < 1))
    ) {
      errors.push(`Row ${rowNumber}: first requisition page must be a whole number from 1.`);
      return;
    }

    if (!activeFlagValue.isValid) {
      errors.push(
        `Row ${rowNumber}: status must be active/inactive, yes/no, true/false, or 1/0.`
      );
      return;
    }

    seenCodes.add(normalizedCode);
    seenNames.add(normalizedName);

    const matchedDepartment =
      departments.find(
        (department) =>
          normalizeSearchValue(department.code) === normalizedCode ||
          normalizeSearchValue(department.name) === normalizedName
      ) ?? null;

    mappedRows.push({
      departmentId: matchedDepartment?.id ?? null,
      code,
      name,
      requisitionStartNumber:
        requisitionStartValue.value ??
        matchedDepartment?.requisitionStartNumber ??
        1,
      isMainStore: isMainStoreValue.value,
      isActive: activeFlagValue.value,
      importAction: matchedDepartment ? "update" : "new",
    });
  });

  const mainStoreCount = mappedRows.filter(
    (row) => row.isMainStore && row.isActive !== false
  ).length;

  if (mainStoreCount > 1) {
    errors.push("Only one active Main Store department can be imported at a time.");
  }

  return {
    mappedRows,
    errors,
    updateCount: mappedRows.filter((row) => row.importAction === "update").length,
    newCount: mappedRows.filter((row) => row.importAction === "new").length,
  };
}

export function prepareHistoricalMovementImportRows(rows, items, departments) {
  const mappedRows = [];
  const errors = [];

  rows.forEach((row, index) => {
    const date = String(pick(row, ["date", "Date"])).trim();
    const type = String(pick(row, ["movement_type", "type", "Movement Type"])).trim().toUpperCase();
    const departmentValue = pick(row, ["department", "Department"]);
    const code = pick(row, ["item_code", "code", "itemCode", "Item Code"]);
    const name = pick(row, ["item_name", "name", "itemName", "Item Name"]);
    const uom = pick(row, ["uom", "UOM", "unit", "Unit"]);
    const quantityValue = Number(pick(row, ["quantity", "qty", "Quantity"]));
    const unitCostValue = parseOptionalNumber(
      pick(row, ["unit_cost", "unitCost", "unit price", "Unit Cost", "Unit Price"])
    );
    const adjustmentModeValue = String(
      pick(row, ["adjustment_mode", "adjustmentMode", "Adjustment Mode"])
    )
      .trim()
      .toUpperCase();

    const item = findItem(items, code, name, uom);
    const department = findDepartment(departments, departmentValue);

    if (!date) {
      errors.push(`Row ${index + 1}: date is required.`);
      return;
    }
    if (!["IN", "OUT", "ADJ"].includes(type)) {
      errors.push(`Row ${index + 1}: movement type must be IN, OUT, or ADJ.`);
      return;
    }
    if (!item) {
      errors.push(
        `Row ${index + 1}: item could not be matched. Check the code, name, and UOM.`
      );
      return;
    }
    if (!department) {
      errors.push(`Row ${index + 1}: department could not be matched.`);
      return;
    }
    if (!Number.isFinite(quantityValue) || quantityValue === 0) {
      errors.push(`Row ${index + 1}: quantity must be numeric and non-zero.`);
      return;
    }
    if (!unitCostValue.isValid || (unitCostValue.value !== null && unitCostValue.value < 0)) {
      errors.push(`Row ${index + 1}: unit cost must be blank or 0 and above.`);
      return;
    }

    const adjustmentMode =
      type === "ADJ"
        ? quantityValue < 0
          ? "DECREASE"
          : adjustmentModeValue === "DECREASE"
            ? "DECREASE"
            : "INCREASE"
        : "INCREASE";

    mappedRows.push({
      date,
      type,
      departmentId: department.id,
      itemId: item.id,
      quantity: Math.abs(quantityValue),
      unitCost: unitCostValue.value,
      requisitionNumber:
        type === "OUT"
          ? String(pick(row, ["requisition_number", "requisitionNo", "Requisition Number"])).trim()
          : "",
      referenceNumber:
        type === "IN" || type === "ADJ"
          ? String(pick(row, ["reference_number", "referenceNo", "Reference Number"])).trim()
          : "",
      adjustmentMode,
      notes: String(pick(row, ["notes", "Notes"])).trim(),
      enteredBy: String(pick(row, ["entered_by", "enteredBy", "Entered By"])).trim() || "Imported",
    });
  });

  return { mappedRows, errors };
}
