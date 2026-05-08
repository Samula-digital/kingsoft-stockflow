function normalizeCompactLabel(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function matchesAny(value, options) {
  const normalizedValue = normalizeCompactLabel(value);
  return options.some((option) => normalizeCompactLabel(option) === normalizedValue);
}

export const WORKBOOK_PACK_CONVERSION_RULES = [
  {
    id: "beers-crate-to-bottle",
    label: "Beer crate cost to bottle cost",
    itemNames: ["BEERS"],
    workbookUoms: ["crt", "crate", "crates", "crtn", "carton", "cartons"],
    itemUoms: ["btl", "btls", "botl", "bottl", "bottle", "bottles"],
    packSize: 25,
    unitCostThreshold: 10000,
    note:
      "The workbook sometimes records beer in crates while the app tracks bottles. " +
      "Crate prices above the threshold are divided by 25 bottles.",
  },
];

export function resolveWorkbookPackRule({ itemLabel = "", workbookUom = "", item = null } = {}) {
  const itemName = itemLabel || item?.name || "";
  const itemUom = item?.uom ?? "";

  return (
    WORKBOOK_PACK_CONVERSION_RULES.find(
      (rule) =>
        matchesAny(itemName, rule.itemNames) &&
        matchesAny(workbookUom, rule.workbookUoms) &&
        matchesAny(itemUom, rule.itemUoms)
    ) ?? null
  );
}

export function normalizeWorkbookUnitCostForPack(unitCost, context = {}) {
  const packRule = resolveWorkbookPackRule(context);

  if (!packRule || !(unitCost > packRule.unitCostThreshold)) {
    return unitCost;
  }

  return Number((unitCost / packRule.packSize).toFixed(2));
}

export function normalizeWorkbookLevelForPack(value, context = {}) {
  const packRule = resolveWorkbookPackRule(context);

  if (!packRule || !(value > 0)) {
    return value;
  }

  return Number((value * packRule.packSize).toFixed(4));
}
