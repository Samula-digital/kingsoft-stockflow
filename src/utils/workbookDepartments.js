import { STANDARD_ITEM_CATEGORIES } from "../data/itemCategories.js";

export const WORKBOOK_ISSUE_DEPARTMENT_MAPPING_VERSION = "category-v1";

export function normalizeDepartmentMatchValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findDepartmentIdByKeywords(departments, keywords) {
  const normalizedKeywords = (Array.isArray(keywords) ? keywords : [])
    .map((keyword) => normalizeDepartmentMatchValue(keyword))
    .filter(Boolean);
  if (!normalizedKeywords.length) return "";

  return (
    (Array.isArray(departments) ? departments : []).find((department) => {
      const haystack = normalizeDepartmentMatchValue(department.name);
      return normalizedKeywords.some(
        (keyword) => haystack.includes(keyword) || keyword.includes(haystack)
      );
    })?.id ?? ""
  );
}

export function buildWorkbookIssueDepartmentMap(departments) {
  const kitchenDepartmentId =
    findDepartmentIdByKeywords(departments, ["kitchen", "restaurant", "chef"]) || "";
  const housekeepingDepartmentId =
    findDepartmentIdByKeywords(departments, ["housekeeping", "house keeping", "hk", "laundry"]) ||
    "";
  const beverageDepartmentId =
    findDepartmentIdByKeywords(departments, ["beverages", "beverage", "bar", "coffee bar"]) ||
    findDepartmentIdByKeywords(departments, ["club"]) ||
    "";
  const adminDepartmentId =
    findDepartmentIdByKeywords(departments, [
      "admin",
      "front office",
      "office",
      "accounts",
      "reception",
    ]) || "";
  const maintenanceDepartmentId =
    findDepartmentIdByKeywords(departments, [
      "maintenance",
      "maintain",
      "engineering",
      "electrical",
      "repair",
    ]) || "";

  return {
    "Cold Room Items": kitchenDepartmentId,
    "Dry Foods": kitchenDepartmentId,
    "Fresh Foods and Fruits": kitchenDepartmentId,
    "House Hold": housekeepingDepartmentId,
    Beverages: beverageDepartmentId,
    Stationary: adminDepartmentId,
    "Admin Stationary": adminDepartmentId,
    "Maintenance and Electrical": maintenanceDepartmentId,
    Others: "",
  };
}

export function hydrateWorkbookIssueDepartmentMap(currentMap, departments) {
  const inferredMap = buildWorkbookIssueDepartmentMap(departments);
  const validDepartmentIds = new Set(
    (Array.isArray(departments) ? departments : []).map((department) => department.id)
  );
  const nextMap = {};

  for (const category of STANDARD_ITEM_CATEGORIES) {
    const currentValue = String(currentMap?.[category] ?? "").trim();
    nextMap[category] =
      currentValue && validDepartmentIds.has(currentValue)
        ? currentValue
        : inferredMap[category] || "";
  }

  return nextMap;
}

export function resolveWorkbookIssueDepartmentIdByCategory(
  category,
  departments,
  { explicitMap = {}, fallbackDepartmentId = "" } = {}
) {
  const normalizedCategory = String(category ?? "").trim();
  const hydratedMap = explicitMap && typeof explicitMap === "object" ? explicitMap : {};
  const inferredDepartmentId = buildWorkbookIssueDepartmentMap(departments)[normalizedCategory] || "";

  return (
    hydratedMap[normalizedCategory] ||
    inferredDepartmentId ||
    String(fallbackDepartmentId ?? "").trim() ||
    ""
  );
}
