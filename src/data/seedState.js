import { defaultDepartmentNames, importedItemTuples } from "./itemMaster.js";
import { normalizeItemCategory } from "./itemCategories.js";
import {
  DEFAULT_COMPANY_NAME,
  DEFAULT_BRAND_ACCENT_COLOR,
  DEFAULT_BRAND_LOGO_URL,
  DEFAULT_PRODUCT_NAME,
  DEFAULT_BRAND_SIDEBAR_COLOR,
} from "../utils/branding.js";
import { createDepartmentId } from "../utils/formatters.js";

export const STATE_VERSION = 6;
export const DEFAULT_AS_OF_DATE = "2026-03-01";
export const DEFAULT_STARTER_OPENING_BALANCE = 20;

export function createDepartmentRecord(name, index) {
  return {
    id: createDepartmentId(name, index),
    code: `DPT-${String(index + 1).padStart(2, "0")}`,
    name,
    requisitionStartNumber: 1,
    isActive: true,
    isMainStore: name === "Main Store",
  };
}

export function createItemRecord(tuple, index) {
  const code = `ITM-${String(index + 1).padStart(3, "0")}`;
  const tupleName = Array.isArray(tuple) ? tuple[0] : tuple?.name;
  const tupleUom = Array.isArray(tuple) ? tuple[1] : tuple?.uom;
  const tupleCategory = Array.isArray(tuple) ? tuple[2] : tuple?.category;

  return {
    id: code,
    code,
    name: tupleName,
    uom: tupleUom,
    category: normalizeItemCategory(tupleCategory),
    openingBalance: DEFAULT_STARTER_OPENING_BALANCE,
    unitCost: null,
    sellingPrice: null,
    minStock: null,
    maxStock: null,
    isActive: true,
    createdAt: null,
    updatedAt: null,
  };
}

export function createSeedState() {
  return {
    version: STATE_VERSION,
    productName: DEFAULT_PRODUCT_NAME,
    hotelName: DEFAULT_COMPANY_NAME,
    brandLogoUrl: DEFAULT_BRAND_LOGO_URL,
    brandAccentColor: DEFAULT_BRAND_ACCENT_COLOR,
    brandSidebarColor: DEFAULT_BRAND_SIDEBAR_COLOR,
    financeEmail: "",
    asOfDate: DEFAULT_AS_OF_DATE,
    nextRequisitionNumber: 1,
    currentUserId: "",
    users: [],
    items: importedItemTuples.map(createItemRecord),
    departments: defaultDepartmentNames.map(createDepartmentRecord),
    movements: [],
  };
}

export function getDefaultDepartmentId(departments, movementType = "OUT") {
  if (!departments.length) return "";

  const mainStoreId = departments.find((department) => department.isMainStore)?.id ?? departments[0].id;
  if (movementType === "OUT") {
    return departments.find((department) => !department.isMainStore)?.id ?? mainStoreId;
  }

  return mainStoreId;
}
