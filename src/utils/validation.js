import {
  formatNumber,
  normalizeRequisitionNumber,
  normalizeSearchValue,
} from "./formatters.js";
import { validatePasswordStrength } from "./passwordPolicy.js";
import { projectStockAfterEntry } from "./calculations.js";

function isBlank(value) {
  return !String(value ?? "").trim();
}

export function validateMovementEntry(entry, options = {}) {
  const errors = {};
  const warnings = [];
  const quantity = Number(entry.quantity);
  const unitCostRaw = String(entry.unitCost ?? "").trim();
  const unitCost = unitCostRaw ? Number(unitCostRaw) : null;

  if (!entry.date) errors.date = "Date is required.";
  if (!entry.type) errors.type = "Movement type is required.";
  if (!entry.departmentId) errors.departmentId = "Department is required.";
  if (!entry.itemId) errors.itemId = "Item is required.";
  if (!Number.isFinite(quantity) || quantity <= 0) {
    errors.quantity = "Quantity must be greater than 0.";
  }
  if (isBlank(entry.enteredBy)) errors.enteredBy = "Entered by is required.";
  if (entry.type === "OUT" && isBlank(entry.requisitionNumber)) {
    errors.requisitionNumber = "Requisition number is required for OUT movements.";
  }
  if ((entry.type === "IN" || entry.type === "ADJ") && isBlank(entry.referenceNumber)) {
    errors.referenceNumber = "Reference number is required for IN and ADJ movements.";
  }
  if (entry.type === "ADJ" && !entry.adjustmentMode) {
    errors.adjustmentMode = "Select whether the adjustment adds or reduces stock.";
  }
  if (unitCostRaw && (!Number.isFinite(unitCost) || unitCost < 0)) {
    errors.unitCost = "Unit cost must be blank or 0 and above.";
  }

  const normalizedEntry = {
    ...entry,
    quantity: Number.isFinite(quantity) ? Math.abs(quantity) : 0,
    unitCost: Number.isFinite(unitCost) ? unitCost : null,
    requisitionNumber: String(entry.requisitionNumber ?? "").trim(),
    referenceNumber: String(entry.referenceNumber ?? "").trim(),
    notes: String(entry.notes ?? "").trim(),
    enteredBy: String(entry.enteredBy ?? "").trim(),
  };

  if (
    normalizedEntry.type === "OUT" &&
    !errors.requisitionNumber &&
    normalizedEntry.departmentId &&
    normalizedEntry.date
  ) {
    const conflictingMovement = (options.movements ?? []).find((movement) => {
      if (movement.id === options.currentMovementId) return false;
      if (movement.type !== "OUT") return false;
      if (movement.departmentId !== normalizedEntry.departmentId) return false;
      if (
        normalizeRequisitionNumber(movement.requisitionNumber) !==
        normalizeRequisitionNumber(normalizedEntry.requisitionNumber)
      ) {
        return false;
      }

      return movement.date !== normalizedEntry.date;
    });

    if (conflictingMovement) {
      errors.requisitionNumber =
        `This requisition is already used for this department on ${conflictingMovement.date}. ` +
        "Use the same date for all items on that requisition page or enter a different requisition.";
    }
  }

  const hasCurrentStock =
    options.currentStock !== null &&
    options.currentStock !== undefined &&
    options.currentStock !== "" &&
    Number.isFinite(Number(options.currentStock));
  const projectedStock = hasCurrentStock
    ? projectStockAfterEntry(Number(options.currentStock), normalizedEntry)
    : null;

  if (projectedStock !== null && projectedStock < 0) {
    const availableStock = Math.max(0, Number(options.currentStock) || 0);
    errors.quantity = availableStock
      ? `Only ${formatNumber(availableStock)} is available right now. Enter ${formatNumber(availableStock)} or less.`
      : "No stock is available right now. Receive or adjust stock first.";
  }

  const minStock =
    options.minStock === null || options.minStock === undefined || options.minStock === ""
      ? null
      : Number(options.minStock);
  const maxStock =
    options.maxStock === null || options.maxStock === undefined || options.maxStock === ""
      ? null
      : Number(options.maxStock);

  if (projectedStock !== null && Number.isFinite(minStock) && projectedStock < minStock) {
    warnings.push("Projected stock will fall below the minimum level for this item.");
  }

  if (projectedStock !== null && Number.isFinite(maxStock) && projectedStock > maxStock) {
    warnings.push("Projected stock will go above the maximum level for this item.");
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    warnings,
    projectedStock,
    normalizedEntry,
  };
}

export function validateItemForm(form, items, currentItemId = null) {
  const errors = {};
  const code = String(form.code ?? "").trim().toUpperCase();
  const name = String(form.name ?? "").trim();
  const uom = String(form.uom ?? "").trim();
  const category = String(form.category ?? "").trim();
  const openingBalance = Number(form.openingBalance);
  const unitCostRaw = String(form.unitCost ?? "").trim();
  const unitCost = unitCostRaw ? Number(unitCostRaw) : null;
  const sellingPriceRaw = String(form.sellingPrice ?? "").trim();
  const sellingPrice = sellingPriceRaw ? Number(sellingPriceRaw) : null;
  const minStockRaw = String(form.minStock ?? "").trim();
  const maxStockRaw = String(form.maxStock ?? "").trim();
  const minStock = minStockRaw ? Number(minStockRaw) : null;
  const maxStock = maxStockRaw ? Number(maxStockRaw) : null;

  if (!code) errors.code = "Item code is required.";
  if (!name) errors.name = "Item name is required.";
  if (!category) errors.category = "Category is required.";
  if (!uom) errors.uom = "UOM is required.";
  if (!Number.isFinite(openingBalance) || openingBalance < 0) {
    errors.openingBalance = "Opening balance must be 0 or greater.";
  }
  if (unitCostRaw && (!Number.isFinite(unitCost) || unitCost < 0)) {
    errors.unitCost = "Unit cost must be blank or 0 and above.";
  }
  if (sellingPriceRaw && (!Number.isFinite(sellingPrice) || sellingPrice < 0)) {
    errors.sellingPrice = "Selling price must be blank or 0 and above.";
  }
  if (minStockRaw && (!Number.isFinite(minStock) || minStock < 0)) {
    errors.minStock = "Minimum stock must be blank or 0 and above.";
  }
  if (maxStockRaw && (!Number.isFinite(maxStock) || maxStock < 0)) {
    errors.maxStock = "Maximum stock must be blank or 0 and above.";
  }
  if (
    !errors.minStock &&
    !errors.maxStock &&
    minStock !== null &&
    maxStock !== null &&
    maxStock < minStock
  ) {
    errors.maxStock = "Maximum stock must be equal to or greater than minimum stock.";
  }

  const duplicateCode = items.some(
    (item) =>
      item.id !== currentItemId &&
      normalizeSearchValue(item.code) === normalizeSearchValue(code)
  );

  if (duplicateCode) {
    errors.code = "Item code already exists.";
  }

  const duplicateName = items.some(
    (item) =>
      item.id !== currentItemId &&
      normalizeSearchValue(item.name) === normalizeSearchValue(name) &&
      normalizeSearchValue(item.uom) === normalizeSearchValue(uom)
  );

  if (duplicateName) {
    errors.name = "Item name and UOM already exist.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    normalizedItem: {
      code,
      name,
      uom,
      category,
      openingBalance: Number.isFinite(openingBalance) ? openingBalance : 0,
      unitCost: Number.isFinite(unitCost) ? unitCost : null,
      sellingPrice: Number.isFinite(sellingPrice) ? sellingPrice : null,
      minStock: Number.isFinite(minStock) ? minStock : null,
      maxStock: Number.isFinite(maxStock) ? maxStock : null,
      isActive: form.isActive !== false,
    },
  };
}

export function validateDepartmentForm(form, departments, currentDepartmentId = null) {
  const errors = {};
  const code = String(form.code ?? "").trim().toUpperCase();
  const name = String(form.name ?? "").trim();
  const requisitionStartNumber = Number(form.requisitionStartNumber);
  const isMainStore = Boolean(form.isMainStore);
  const isActive = form.isActive !== false;

  if (!code) errors.code = "Department code is required.";
  if (!name) errors.name = "Department name is required.";
  if (!Number.isInteger(requisitionStartNumber) || requisitionStartNumber < 1) {
    errors.requisitionStartNumber = "First requisition page must be 1 or greater.";
  }

  const duplicateCode = departments.some(
    (department) =>
      department.id !== currentDepartmentId &&
      normalizeSearchValue(department.code) === normalizeSearchValue(code)
  );

  if (duplicateCode) {
    errors.code = "Department code already exists.";
  }

  const duplicateName = departments.some(
    (department) =>
      department.id !== currentDepartmentId &&
      normalizeSearchValue(department.name) === normalizeSearchValue(name)
  );

  if (duplicateName) {
    errors.name = "Department name already exists.";
  }

  const hasOtherMainStore = departments.some(
    (department) =>
      department.id !== currentDepartmentId &&
      department.isMainStore &&
      department.isActive !== false
  );

  if (!isMainStore && !hasOtherMainStore) {
    errors.isMainStore = "Keep one active Main Store department in the system.";
  }

  if (!isActive && isMainStore) {
    errors.isActive = "The Main Store department must stay active.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    normalizedDepartment: {
      code,
      name,
      requisitionStartNumber: Number.isInteger(requisitionStartNumber)
        ? requisitionStartNumber
        : 1,
      isMainStore,
      isActive,
    },
  };
}

export function validateUserAccountForm(form, users, currentUserId = null, options = {}) {
  const errors = {};
  const name = String(form.name ?? "").trim();
  const emailCheck = validateEmailAddress(form.email, { allowBlank: false });
  const passwordCheck = validatePasswordStrength(form.password, {
    allowBlank: options.passwordRequired === false,
  });
  const role = String(form.role ?? "store").trim().toLowerCase() || "store";
  const passwordRequired = options.passwordRequired !== false;
  const allowedRoles = ["store", "finance", "admin"];

  if (!name) errors.name = "Full name is required.";
  if (!emailCheck.isValid) errors.email = emailCheck.error;
  if (!allowedRoles.includes(role)) {
    errors.role = "Select a valid role.";
  }

  if (!passwordCheck.isValid && (passwordRequired || passwordCheck.password)) {
    errors.password = passwordCheck.error;
  }

  const duplicateEmail = users.some(
    (user) =>
      user.id !== currentUserId &&
      normalizeSearchValue(user.email) === normalizeSearchValue(emailCheck.email)
  );

  if (duplicateEmail) {
    errors.email = "An account with that email already exists.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    normalizedUser: {
      name,
      email: emailCheck.email.toLowerCase(),
      password: passwordCheck.password,
      role,
    },
  };
}

export function validateEmailAddress(value, { allowBlank = true } = {}) {
  const email = String(value ?? "").trim();
  if (!email) {
    return {
      isValid: allowBlank,
      email: "",
      error: allowBlank ? "" : "Email address is required.",
    };
  }

  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  return {
    isValid,
    email,
    error: isValid ? "" : "Enter a valid email address.",
  };
}
