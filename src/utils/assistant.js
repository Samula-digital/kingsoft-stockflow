import { STANDARD_ITEM_CATEGORIES } from "../data/itemCategories.js";
import {
  formatDateRange,
  formatNumber,
  normalizeSearchValue,
  searchItemRecords,
} from "./formatters.js";

function createAction(label, type, payload = {}) {
  return {
    label,
    type,
    ...payload,
  };
}

function createModuleAction(label, moduleId) {
  return createAction(label, "open_module", { moduleId });
}

function createStockAction(label, payload = {}) {
  return createAction(label, "open_stock_view", { moduleId: "stock", ...payload });
}

function createAdminSectionAction(label, sectionId, payload = {}) {
  return createAction(label, "open_admin_section", {
    moduleId: "admin",
    sectionId,
    ...payload,
  });
}

function createEntryAction(label, payload = {}) {
  return createAction(label, "start_entry", { moduleId: "entry", ...payload });
}

function createFinanceAction(label, payload = {}) {
  return createAction(label, "open_finance_view", { moduleId: "finance", ...payload });
}

function createSaveEntryAction(label, payload = {}) {
  return createAction(label, "save_entry", payload);
}

function createCreateItemAction(label, payload = {}) {
  return createAction(label, "create_item", payload);
}

function createUpdateItemLevelsAction(label, payload = {}) {
  return createAction(label, "update_item_levels", payload);
}

function createCreateDepartmentAction(label, payload = {}) {
  return createAction(label, "create_department", payload);
}

function createCreateAccountAction(label, payload = {}) {
  return createAction(label, "create_account", payload);
}

function createApproveAccountAction(label, payload = {}) {
  return createAction(label, "approve_account", payload);
}

function createRejectAccountAction(label, payload = {}) {
  return createAction(label, "reject_account", payload);
}

function createSettingsAction(label, payload = {}) {
  return createAction(label, "update_settings", payload);
}

function filterAllowedActions(actions, context) {
  const allowedModuleIds = Array.isArray(context.availableModuleIds)
    ? context.availableModuleIds
    : [];
  return allowedModuleIds.length
    ? actions.filter((action) => !action.moduleId || allowedModuleIds.includes(action.moduleId))
    : actions;
}

function finalizeReply(text, actions, context, options = {}) {
  const filteredActions = filterAllowedActions(actions, context);
  const autoRunAction = options.autoRunAction
    ? filterAllowedActions([options.autoRunAction], context)[0] ?? null
    : null;
  return {
    text,
    actions: filteredActions,
    autoRunAction,
  };
}

function limitRows(rows, limit = 4) {
  return rows.slice(0, limit);
}

function formatItemList(rows, limit = 4) {
  return limitRows(rows, limit)
    .map((row) => `${row.name} (${row.code})`)
    .join(", ");
}

function formatDepartmentList(rows, limit = 4) {
  return limitRows(rows, limit)
    .map((row) => `${row.name} (${formatNumber(row.totalQty)})`)
    .join(", ");
}

function formatNameList(rows, key = "name", limit = 4) {
  return limitRows(rows, limit)
    .map((row) => row[key])
    .join(", ");
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findDepartmentMatch(query, context) {
  const normalizedQuery = normalizeSearchValue(query);
  const departments = [...(context.departments ?? [])].sort(
    (left, right) =>
      normalizeSearchValue(right.name).length - normalizeSearchValue(left.name).length
  );

  return (
    departments.find((department) => {
      const name = normalizeSearchValue(department.name);
      const code = normalizeSearchValue(department.code);

      return normalizedQuery.includes(name) || (code && normalizedQuery.includes(code));
    }) ?? null
  );
}

function extractQuantity(query) {
  const patterns = [
    /\b(?:qty|quantity)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i,
    /\b(?:issue|receive|adjust|add|reduce|decrease|increase)\s+(\d+(?:\.\d+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) return match[1];
  }

  return "";
}

function extractDocumentNumber(query, type) {
  const pattern =
    type === "OUT"
      ? /\b(?:requisition|req)(?:\s*(?:no|number|page|#))?\s*[:\-]?\s*([a-z0-9/-]+)/i
      : /\b(?:reference|ref)(?:\s*(?:no|number|#))?\s*[:\-]?\s*([a-z0-9/-]+)/i;

  return query.match(pattern)?.[1] ?? "";
}

function extractAdjustmentMode(query) {
  const normalizedQuery = normalizeSearchValue(query);

  if (
    normalizedQuery.includes("reduce") ||
    normalizedQuery.includes("decrease") ||
    normalizedQuery.includes("down")
  ) {
    return "DECREASE";
  }

  return "INCREASE";
}

function extractEmail(query) {
  return query.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? "";
}

function extractPassword(query) {
  return query.match(/\b(?:password|pass)\s*[:\-]?\s*([^\s,;]+)/i)?.[1] ?? "";
}

function extractRole(query, fallback = "stores") {
  const normalizedQuery = normalizeSearchValue(query);
  if (normalizedQuery.includes("finance")) return "finance";
  if (normalizedQuery.includes("admin")) return "admin";
  if (normalizedQuery.includes("store")) return "stores";
  return fallback;
}

function extractCode(query) {
  return query.match(/\bcode\s*[:\-]?\s*([a-z0-9-]+)/i)?.[1]?.toUpperCase() ?? "";
}

function extractUom(query) {
  return query.match(/\b(?:uom|unit)\s*[:\-]?\s*([a-zA-Z]+)/i)?.[1]?.toUpperCase() ?? "";
}

function extractNumberByLabel(query, labels = []) {
  for (const label of labels) {
    const pattern = new RegExp(`\\b${label}\\s*[:\\-]?\\s*(-?\\d+(?:\\.\\d+)?)`, "i");
    const match = query.match(pattern);
    if (match) return match[1];
  }

  return "";
}

function extractCategory(query, context) {
  const categories = Array.from(
    new Set(
      [
        ...(context.stockRows ?? []).map((row) => String(row.category ?? "").trim()),
        ...STANDARD_ITEM_CATEGORIES,
      ].filter(Boolean)
    )
  ).sort((left, right) => right.length - left.length);

  const normalizedQuery = normalizeSearchValue(query);
  const directMatch = categories.find((category) =>
    normalizedQuery.includes(normalizeSearchValue(category))
  );

  if (directMatch) return directMatch;

  const labeledMatch = query.match(
    /\b(?:category|under|group)\s*[:\-]?\s*([a-z][a-z/& ,.-]+)/i
  )?.[1];

  return labeledMatch ? labeledMatch.trim() : "";
}

function extractName(query, pattern) {
  return query.match(pattern)?.[1]?.trim() ?? "";
}

function wantsImmediateExecution(query) {
  return /\b(save|record|capture|create|add|post|submit|approve|reject|set|update)\b/i.test(
    query
  );
}

function buildMovementItemQuery(query, department, quantity, documentNumber) {
  let cleaned = ` ${query} `;

  if (department?.name) {
    cleaned = cleaned.replace(new RegExp(escapeRegExp(department.name), "ig"), " ");
  }

  if (department?.code) {
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegExp(department.code)}\\b`, "ig"), " ");
  }

  if (documentNumber) {
    cleaned = cleaned.replace(new RegExp(escapeRegExp(documentNumber), "ig"), " ");
  }

  if (quantity) {
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegExp(quantity)}\\b`, "g"), " ");
  }

  cleaned = cleaned.replace(
    /\b(?:issue|issued|receive|received|adjust|adjustment|add|reduce|decrease|increase|stock|req|requisition|ref|reference|page|number|qty|quantity|to|into|for|with|please|start|open|show|me|line)\b/gi,
    " "
  );

  return cleaned.replace(/\s+/g, " ").trim();
}

function findItemMatch(query, context) {
  return searchItemRecords(context.stockRows ?? [], query, { limit: 1 })[0] ?? null;
}

function findUserMatch(query, context) {
  const normalizedQuery = normalizeSearchValue(query);
  return (
    (context.users ?? []).find((user) => {
      const email = normalizeSearchValue(user.email);
      const name = normalizeSearchValue(user.name);
      return normalizedQuery.includes(email) || (name && normalizedQuery.includes(name));
    }) ?? null
  );
}

function canManageAdmin(context) {
  return context.currentUser?.role === "admin" && context.availableModuleIds?.includes("admin");
}

function findMovementItemMatch(query, context, department, quantity, documentNumber) {
  const cleanedQuery = buildMovementItemQuery(query, department, quantity, documentNumber);

  return findItemMatch(cleanedQuery, context) ?? findItemMatch(query, context);
}

function buildStockAttentionReply(context) {
  const negativeItems = context.stockRows.filter((row) => row.stockOnHand < 0);
  const belowMinItems = context.stockRows.filter((row) => row.belowMinStock);
  const zeroItems = context.stockRows.filter((row) => row.stockOnHand === 0);
  const aboveMaxItems = context.stockRows.filter((row) => row.aboveMaxStock);

  const lines = [
    `Here's the stock picture right now: ${formatNumber(zeroItems.length)} at zero, ${formatNumber(
      belowMinItems.length
    )} below minimum, ${formatNumber(aboveMaxItems.length)} above maximum, and ${formatNumber(
      negativeItems.length
    )} negative.`,
  ];

  if (zeroItems.length) {
    lines.push(`The zero-stock items leading the list are ${formatItemList(zeroItems)}.`);
  } else if (belowMinItems.length) {
    lines.push(`The items sitting below minimum are ${formatItemList(belowMinItems)}.`);
  } else if (aboveMaxItems.length) {
    lines.push(`The main overstocked items are ${formatItemList(aboveMaxItems)}.`);
  } else {
    lines.push("Nothing urgent is jumping out from stock controls at the moment.");
  }

  return finalizeReply(
    lines.join("\n"),
    [
      createStockAction("Show Zero Stock", { statusFilter: "zero" }),
      createStockAction("Open Negative Stock", { statusFilter: "negative" }),
      createStockAction("Open Below Minimum", { statusFilter: "below-min" }),
      createModuleAction("Open Item Ledger", "stock"),
    ],
    context
  );
}

function getActiveStockRows(context) {
  return (context.stockRows ?? []).filter((row) => row.isActive !== false);
}

function buildOperationalReadinessReply(context) {
  const activeRows = getActiveStockRows(context);
  const negativeItems = activeRows.filter((row) => row.stockOnHand < 0);
  const zeroItems = activeRows.filter((row) => row.stockOnHand === 0);
  const belowMinItems = activeRows.filter((row) => row.belowMinStock);
  const missingCostItems = activeRows.filter(
    (row) => row.unitCost === null || row.unitCost === undefined
  );
  const missingLevelItems = activeRows.filter(
    (row) => row.minStock === null && row.maxStock === null
  );
  const reviewItems = activeRows.filter(
    (row) => row.stockOnHand < 0 || row.belowMinStock || row.aboveMaxStock
  );

  const reportReady =
    !negativeItems.length && !missingCostItems.length && !missingLevelItems.length;

  const lines = [
    reportReady
      ? "From an operating point of view, the system looks ready for shared daily use and finance reporting."
      : "From an operating point of view, the system is usable, but there are still a few things worth fixing before you fully trust every report.",
    `Right now I can see ${formatNumber(reviewItems.length)} stock exception(s), ${formatNumber(
      missingCostItems.length
    )} active item(s) missing cost, and ${formatNumber(
      missingLevelItems.length
    )} active item(s) without min/max levels.`,
    negativeItems.length
      ? `The biggest launch blocker is negative stock on ${formatItemList(negativeItems)}.`
      : zeroItems.length
        ? `The main operational pressure is zero stock on ${formatItemList(zeroItems)}.`
        : "There is no negative stock blocking daily work right now.",
  ];

  return finalizeReply(
    lines.join("\n"),
    [
      createStockAction("Show Stock Attention", { statusFilter: "attention" }),
      createStockAction("Open Negative Stock", { statusFilter: "negative" }),
      createAdminSectionAction("Open Items", "items"),
      createFinanceAction("Open Finance Pack", { period: context.financePeriod || "daily" }),
    ],
    context
  );
}

function buildRestockReply(context) {
  const financeRows = context.financeRows ?? [];
  const priorityRows = financeRows
    .filter((row) => Number(row.requiredQty) > 0 || row.closing <= 0 || row.belowMinStock)
    .sort(
      (left, right) =>
        Number(right.requiredQty ?? 0) - Number(left.requiredQty ?? 0) ||
        Number(left.closing ?? 0) - Number(right.closing ?? 0)
    )
    .slice(0, 5);

  if (!priorityRows.length) {
    return finalizeReply(
      "Nothing is standing out as an urgent restock item right now. The current stock position does not show refill pressure.",
      [
        createFinanceAction("Open Finance Pack", { reportMode: "stock" }),
        createStockAction("Open Item Ledger", { statusFilter: "all" }),
      ],
      context
    );
  }

  const lines = [
    "If you want the quickest restock priorities, I would start with these items:",
    ...priorityRows.map((row, index) => {
      const needed = Number(row.requiredQty ?? 0);
      const shortageLabel = needed > 0 ? `${formatNumber(needed)} needed` : "check urgently";
      return `${index + 1}. ${row.name} (${row.code}) - closing ${formatNumber(
        row.closing
      )} ${row.uom}, ${shortageLabel}.`;
    }),
    "That list is based on zero stock, below-minimum stock, and required refill quantity.",
  ];

  return finalizeReply(
    lines.join("\n"),
    [
      createFinanceAction("Open Stock Position Report", { reportMode: "stock" }),
      createStockAction("Open Below Minimum", { statusFilter: "below-min" }),
      createStockAction("Show Zero Stock", { statusFilter: "zero" }),
    ],
    context
  );
}

function buildCostChangeReply(context) {
  const costedRows = getActiveStockRows(context).filter(
    (row) => row.unitCost !== null && row.unitCost !== undefined
  );

  const exampleRow = costedRows[0] ?? null;
  const exampleText = exampleRow
    ? ` For example, if ${exampleRow.name} already has stock at one average cost and you receive more at another price, the system now uses weighted average cost so the new closing value stays fair.`
    : "";

  return finalizeReply(
    [
      "When a new receipt comes in at a different unit cost, the right approach is weighted average cost.",
      "That means the system does not overwrite the old price blindly. It combines the existing stock value and the new receipt value, then calculates one new running average cost.",
      `This helps finance keep a more realistic stock value and prevents sudden report distortion.${exampleText}`,
      "If you want, I can prepare a receipt and the system will project the new average cost before you save.",
    ].join("\n"),
    [
      createEntryAction("Prepare Receipt", { entryType: "IN" }),
      createFinanceAction("Open Finance Pack", { reportMode: "stock" }),
    ],
    context
  );
}

function buildStartWorkReply(context) {
  const activeRows = getActiveStockRows(context);
  const negativeItems = activeRows.filter((row) => row.stockOnHand < 0);
  const missingCostItems = activeRows.filter(
    (row) => row.unitCost === null || row.unitCost === undefined
  );
  const belowMinItems = activeRows.filter((row) => row.belowMinStock);

  const priorities = [];

  if (negativeItems.length) {
    priorities.push(
      `1. Clear the negative stock items first: ${formatItemList(negativeItems)}.`
    );
  } else {
    priorities.push("1. Review today's receipts, issues, and adjustments so the day starts from clean movements.");
  }

  if (missingCostItems.length) {
    priorities.push(
      `2. Fill in missing unit cost on ${formatNumber(missingCostItems.length)} active item(s) so finance values stay trustworthy.`
    );
  } else if (belowMinItems.length) {
    priorities.push(
      `2. Review below-minimum items next so stores can restock before shortages spread.`
    );
  } else {
    priorities.push("2. Review stock balances and confirm nothing important is sitting at zero or below minimum.");
  }

  priorities.push("3. Then open Finance Pack and review the closing value only after movement entry looks complete.");

  return finalizeReply(
    [
      "If I were helping the team start work right now, this is the order I would use:",
      ...priorities,
      "That order keeps operations first, then data quality, then finance review.",
    ].join("\n"),
    [
      createModuleAction("Open Store Desk", "entry"),
      createStockAction("Show Stock Attention", { statusFilter: "attention" }),
      createFinanceAction("Open Finance Pack", { period: context.financePeriod || "daily" }),
    ],
    context
  );
}

function buildFixIssuesReply(context) {
  const activeRows = getActiveStockRows(context);
  const negativeItems = activeRows.filter((row) => row.stockOnHand < 0);
  const zeroItems = activeRows.filter((row) => row.stockOnHand === 0);
  const missingCostItems = activeRows.filter(
    (row) => row.unitCost === null || row.unitCost === undefined
  );
  const missingLevelItems = activeRows.filter(
    (row) => row.minStock === null && row.maxStock === null
  );

  const lines = ["The cleanest way to fix the current issues is:"];

  if (negativeItems.length) {
    lines.push(`1. Reconcile negative stock first by checking missed receipts, late issues, or correction adjustments for ${formatItemList(negativeItems)}.`);
  }

  if (missingCostItems.length) {
    lines.push(`2. Add unit cost to the ${formatNumber(missingCostItems.length)} active item(s) missing cost so finance reports stop undervaluing stock.`);
  }

  if (missingLevelItems.length) {
    lines.push(`3. Set min and max levels on the ${formatNumber(missingLevelItems.length)} active item(s) still missing control limits.`);
  }

  if (zeroItems.length && !negativeItems.length) {
    lines.push(`4. Review the zero-stock items to decide whether they need restocking or are genuinely exhausted.`);
  }

  if (lines.length === 1) {
    lines.push("There are no obvious data-quality blockers right now. The next good step is a normal finance review.");
  }

  return finalizeReply(
    lines.join("\n"),
    [
      createStockAction("Open Stock Attention", { statusFilter: "attention" }),
      createAdminSectionAction("Open Items", "items"),
      createFinanceAction("Open Finance Pack", { period: context.financePeriod || "daily" }),
    ],
    context
  );
}

function buildFinanceReply(context, period = "") {
  const totals = context.financeRows.reduce(
    (accumulator, row) => ({
      opening: accumulator.opening + row.opening,
      inQty: accumulator.inQty + row.inQty,
      availableQty: accumulator.availableQty + (row.availableQty ?? row.opening + row.inQty + row.adjQty),
      outQty: accumulator.outQty + row.outQty,
      adjQty: accumulator.adjQty + row.adjQty,
      closing: accumulator.closing + row.closing,
      requiredQty: accumulator.requiredQty + (row.requiredQty ?? 0),
      stockValue: accumulator.stockValue + (row.stockValue ?? 0),
    }),
    {
      opening: 0,
      inQty: 0,
      availableQty: 0,
      outQty: 0,
      adjQty: 0,
      closing: 0,
      requiredQty: 0,
      stockValue: 0,
    }
  );

  const requestedPeriod =
    period || (context.activeTab === "finance" ? context.financePeriod ?? "" : "");

  return finalizeReply(
    [
      `The finance report is currently covering ${formatDateRange(
        context.financeRange.startDate,
        context.financeRange.endDate
      )}.`,
      `So far that means opening ${formatNumber(totals.opening)}, received ${formatNumber(
        totals.inQty
      )}, available ${formatNumber(
        totals.availableQty
      )}, issued ${formatNumber(
        totals.outQty
      )}, adjustments ${formatNumber(totals.adjQty)}, closing ${formatNumber(
        totals.closing
      )}, required ${formatNumber(
        totals.requiredQty
      )}, and stock value ${formatNumber(totals.stockValue)}.`,
      requestedPeriod
        ? `If you want, I can take you straight into the ${requestedPeriod} view.`
        : "If you want, I can open the daily, weekly, monthly, or custom finance view next.",
    ].join("\n"),
    [
      createFinanceAction("Open Daily Finance Report", { period: "daily" }),
      createFinanceAction("Open Weekly Finance Report", { period: "weekly" }),
      createFinanceAction("Open Monthly Finance Report", { period: "monthly" }),
    ],
    context
  );
}

function buildDepartmentReply(context) {
  if (!context.departmentRows.length) {
    return finalizeReply(
      "There are no department issue lines on the selected date yet.",
      [createModuleAction("Open Department Use", "department")],
      context
    );
  }

  return finalizeReply(
    [
      `For ${context.departmentDate}, the main issuing departments are ${formatDepartmentList(
        context.departmentRows
      )}.`,
      "Open Department Use if you want to see the requisition pages and the exact item lines.",
    ].join("\n"),
    [createModuleAction("Open Department Use", "department")],
    context
  );
}

function buildItemReply(query, context) {
  const match = findItemMatch(query, context);
  if (!match) return null;

  const status =
    match.stockOnHand < 0
      ? "Negative"
      : match.belowMinStock
        ? "Below minimum"
        : match.aboveMaxStock
          ? "Above maximum"
          : match.stockOnHand === 0
            ? "Zero stock"
            : "Healthy";

  return finalizeReply(
    [
      `${match.name} (${match.code}) is sitting at ${formatNumber(match.stockOnHand)} ${match.uom}.`,
      `Opening is ${formatNumber(match.openingBalance)}, minimum is ${
        match.minStock === null ? "-" : formatNumber(match.minStock)
      }, and maximum is ${match.maxStock === null ? "-" : formatNumber(match.maxStock)}.`,
      `Right now the status is ${status.toLowerCase()}.`,
      "If you want, I can open the item in stock or get an issue, receipt, or adjustment ready for it.",
    ].join("\n"),
    [
      createStockAction("Open This Item In Stock", {
        search: match.code,
        statusFilter: "all",
      }),
      createEntryAction("Prepare Issue", { entryType: "OUT", itemId: match.id }),
      createEntryAction("Prepare Receipt", { entryType: "IN", itemId: match.id }),
      createEntryAction("Prepare Adjustment", {
        entryType: "ADJ",
        itemId: match.id,
        adjustmentMode: "INCREASE",
      }),
    ],
    context
  );
}

function buildImportReply(context) {
  return finalizeReply(
    [
      "Use Imports when you want to bring in the daily stores movement workbook or a clean setup file.",
      "That workbook flow is now built around the real template: one dated sheet per day, then item rows with opening stock, received stock, issued stock, closing stock, unit cost, stock value, and stock levels.",
      "After upload, narrow the workbook window to the dates you want. The app analyses that window, tells you which report views it can support, and gives one-click plans for finance, movement tracking, or stock balances.",
      "Workbook-only items can now come in as new items, and closing differences are treated as reconciliation lines instead of hard import failures.",
      "That same Imports area can also export the current frontend data, the active workbook window, and ready-made import templates to Excel.",
      "For a structured item master, use one row per item with columns like item_code, item_name, category, uom, opening_balance, min_stock, max_stock, and is_active.",
    ].join("\n"),
    [
      createAdminSectionAction("Open Imports", "imports"),
      createAdminSectionAction("Open Items", "items"),
      createFinanceAction("Open Finance Pack", { view: "stock_position" }),
    ],
    context
  );
}

function buildMovementTemplateReply(type, context) {
  const movementHelp = {
    IN: "I can open Store Desk ready for a receipt. You'll just review the store, item, quantity, reference, and save.",
    OUT: "I can open Store Desk ready for an issue. You'll review the department, requisition page, item line, and then save it.",
    ADJ: "I can open Store Desk ready for an adjustment. You'll review the item, count difference, direction, reference, and save.",
  };

  const actionLabel =
    type === "OUT" ? "Start Issue" : type === "IN" ? "Start Receipt" : "Start Adjustment";

  return finalizeReply(
    movementHelp[type],
    [
      createEntryAction(actionLabel, {
        entryType: type,
        adjustmentMode: type === "ADJ" ? "INCREASE" : undefined,
      }),
    ],
    context
  );
}

function buildMovementPlannerReply(query, type, context) {
  const department = findDepartmentMatch(query, context);
  const quantity = extractQuantity(query);
  const documentNumber = extractDocumentNumber(query, type);
  const item = findMovementItemMatch(query, context, department, quantity, documentNumber);
  const adjustmentMode = type === "ADJ" ? extractAdjustmentMode(query) : undefined;
  const availableQty = Math.max(0, Number(item?.stockOnHand) || 0);
  const requestedQty = Number(quantity);
  const reducesStock = type === "OUT" || (type === "ADJ" && adjustmentMode === "DECREASE");

  const prepared = [];
  const missing = [];

  if (department) prepared.push(`department ${department.name}`);
  else missing.push("department");

  if (item) prepared.push(`item ${item.name}`);
  else missing.push("item");

  if (quantity) prepared.push(`quantity ${quantity}`);
  else missing.push("quantity");

  if (type === "OUT") {
    if (documentNumber) prepared.push(`requisition ${documentNumber}`);
    else missing.push("requisition number");
  } else {
    if (documentNumber) prepared.push(`reference ${documentNumber}`);
    else missing.push("reference number");
  }

  if (type === "ADJ") {
    prepared.push(adjustmentMode === "DECREASE" ? "reduce stock" : "add stock");
  }

  const exceedsAvailable =
    reducesStock &&
    item &&
    quantity &&
    Number.isFinite(requestedQty) &&
    requestedQty > availableQty;
  const shouldSaveNow = wantsImmediateExecution(query) && !missing.length && !exceedsAvailable;

  const typeLabel =
    type === "OUT" ? "issue" : type === "IN" ? "receipt" : "adjustment";

  const replyLines = [
    shouldSaveNow
      ? `I've got enough to save this ${typeLabel}: ${prepared.join(", ")}.`
      : prepared.length
        ? `I can get this ${typeLabel} ready with ${prepared.join(", ")}.`
        : `I can get a ${typeLabel} ready in Store Desk.`,
  ];

  if (missing.length) {
    replyLines.push(`I still need: ${missing.join(", ")}.`);
  }

  if (exceedsAvailable && item) {
    replyLines.push(
      `Only ${formatNumber(availableQty)} ${item.uom} are available for ${item.name} right now, so I won't save the full quantity as requested.`
    );
  }

  replyLines.push(
    shouldSaveNow
      ? "I'll save it now and tell you the result here."
      : "I'll open the movement screen with the details filled in so you can confirm it."
  );

  const payload = {
    entryType: type,
    departmentId: department?.id,
    itemId: item?.id,
    quantity,
    adjustmentMode,
  };

  if (type === "OUT") {
    payload.requisitionNumber = documentNumber;
  } else {
    payload.referenceNumber = documentNumber;
  }

  return finalizeReply(
    replyLines.join("\n"),
    [
      shouldSaveNow
        ? createSaveEntryAction(
            type === "OUT" ? "Record Issue" : type === "IN" ? "Record Receipt" : "Record Adjustment",
            payload
          )
        : createEntryAction(
            type === "OUT" ? "Prepare Issue" : type === "IN" ? "Prepare Receipt" : "Prepare Adjustment",
            payload
          ),
      item
        ? createStockAction("Open This Item In Stock", {
            search: item.code,
            statusFilter: "all",
          })
        : createModuleAction("Open Item Ledger", "stock"),
    ],
    context,
    {
      autoRunAction: shouldSaveNow
        ? createSaveEntryAction(
            type === "OUT" ? "Record Issue" : type === "IN" ? "Record Receipt" : "Record Adjustment",
            payload
          )
        : null,
    }
  );
}

function buildNavigationReply(normalizedQuery, context) {
  const targets = [
    {
      match: ["dashboard", "overview"],
      reply: "Sure, I can take you to the dashboard.",
      actions: [createModuleAction("Open Control Room", "dashboard")],
    },
    {
      match: ["stock movement", "entry", "movement desk"],
      reply: "I can take you straight to Store Desk.",
      actions: [createModuleAction("Open Store Desk", "entry")],
    },
    {
      match: ["stock balances", "stock on hand", "stock page"],
      reply: "I can open Item Ledger for you.",
      actions: [createModuleAction("Open Item Ledger", "stock")],
    },
    {
      match: ["finance", "finance reports", "stock sheet", "daily stock sheet", "report"],
      reply: "I can open Finance Pack.",
      actions: [createModuleAction("Open Finance Pack", "finance")],
    },
    {
      match: ["department issues", "department daily"],
      reply: "I can open Department Use.",
      actions: [createModuleAction("Open Department Use", "department")],
    },
    {
      match: ["history", "movement history"],
      reply: "I can open Audit Trail.",
      actions: [createModuleAction("Open Audit Trail", "history")],
    },
    {
      match: ["imports", "import section"],
      reply: "I can take you to Admin > Imports.",
      actions: [createAdminSectionAction("Open Imports", "imports")],
    },
    {
      match: ["items", "item setup", "item master"],
      reply: "I can open Admin > Items.",
      actions: [createAdminSectionAction("Open Items", "items")],
    },
    {
      match: ["accounts", "users", "approvals"],
      reply: "I can open Admin > Accounts.",
      actions: [createAdminSectionAction("Open Accounts", "accounts")],
    },
  ];

  const matchedTarget = targets.find((target) =>
    target.match.some((keyword) => normalizedQuery.includes(keyword))
  );

  if (!matchedTarget) return null;

  return finalizeReply(matchedTarget.reply, matchedTarget.actions, context);
}

function buildFinanceIntentReply(query, context) {
  const normalizedQuery = normalizeSearchValue(query);
  const period = normalizedQuery.includes("weekly")
    ? "weekly"
    : normalizedQuery.includes("monthly")
      ? "monthly"
      : normalizedQuery.includes("daily")
        ? "daily"
        : "";
  const item = findItemMatch(query, context);
  const category = extractCategory(query, context);
  const reportMode = normalizedQuery.includes("category")
    ? "category-summary"
    : normalizedQuery.includes("received") || normalizedQuery.includes("receipt")
      ? "receipts"
      : normalizedQuery.includes("issued") || normalizedQuery.includes("issue")
        ? "issues"
        : normalizedQuery.includes("loss") ||
            normalizedQuery.includes("spoil") ||
            normalizedQuery.includes("dispose")
          ? "losses"
          : normalizedQuery.includes("compare") ||
              normalizedQuery.includes("previous month") ||
              normalizedQuery.includes("comparison")
            ? "comparison"
            : normalizedQuery.includes("movement")
              ? "item-movement"
              : "stock";

  if (reportMode === "item-movement" && item) {
    return finalizeReply(
      `I can open Item Movement for ${item.name}${period ? ` in the ${period} view` : ""}.`,
      [
        createFinanceAction("Open Item Movement", {
          period,
          reportMode: "item-movement",
          itemId: item.id,
          search: item.code,
        }),
      ],
      context
    );
  }

  if (reportMode === "category-summary" && category) {
    return finalizeReply(
      `I can open the category report for ${category}${period ? ` in the ${period} view` : ""}.`,
      [
        createFinanceAction("Open Category Report", {
          period,
          reportMode: "category-summary",
          search: category,
        }),
      ],
      context
    );
  }

  return buildFinanceReply(context, period);
}

function buildCreateAccountReply(query, context) {
  if (!canManageAdmin(context)) return null;

  const role = extractRole(query, "stores");
  const email = extractEmail(query);
  const password = extractPassword(query);
  const name = extractName(
    query,
    /\b(?:create|add)\s+(?:(?:finance|store|admin)\s+)?(?:account|user)\s+(?:for\s+)?(.+?)(?=\s+(?:email|password|pass|role)\b|$)/i
  );
  const missing = [];
  if (!name) missing.push("name");
  if (!email) missing.push("email");
  if (!password) missing.push("password");

  const action = createCreateAccountAction("Create Account", {
    name,
    email,
    password,
    role,
  });

  return finalizeReply(
    missing.length
      ? `I can create that ${role} account, but I still need ${missing.join(", ")} first.`
      : `That's enough for me to create a ${role} account for ${name}. I'll do it now.`,
    [
      createAdminSectionAction("Open Accounts", "accounts"),
      ...(missing.length ? [] : [action]),
    ],
    context,
    { autoRunAction: missing.length ? null : action }
  );
}

function buildAccountDecisionReply(query, context, decision) {
  if (!canManageAdmin(context)) return null;

  const user = findUserMatch(query, context);
  if (!user) return null;

  const action =
    decision === "approve"
      ? createApproveAccountAction("Approve Account", { userId: user.id })
      : createRejectAccountAction("Reject Account", { userId: user.id });

  return finalizeReply(
    `I found ${user.name} (${user.email}). I'll ${decision} the account now.`,
    [action, createAdminSectionAction("Open Accounts", "accounts")],
    context,
    { autoRunAction: action }
  );
}

function buildCreateDepartmentReply(query, context) {
  if (!canManageAdmin(context)) return null;

  const name = extractName(
    query,
    /\b(?:create|add)\s+department\s+(?:for\s+)?(.+?)(?=\s+(?:code|main\s*store|status|active|inactive)\b|$)/i
  );
  if (!name) return null;

  const code = extractCode(query);
  const isMainStore = /\bmain\s*store\b/i.test(query);
  const isActive = !/\binactive\b/i.test(query);
  const action = createCreateDepartmentAction("Create Department", {
    name,
    code,
    isMainStore,
    isActive,
  });

  return finalizeReply(
    `That's enough for me to create the department ${name}. I'll do it now.`,
    [action, createAdminSectionAction("Open Departments", "departments")],
    context,
    { autoRunAction: action }
  );
}

function buildCreateItemReply(query, context) {
  if (!canManageAdmin(context)) return null;

  const name = extractName(
    query,
    /\b(?:create|add)\s+item\s+(?:called\s+|named\s+)?(.+?)(?=\s+(?:category|uom|code|min|max|opening|cost|price|active|inactive)\b|$)/i
  );
  if (!name) return null;

  const action = createCreateItemAction("Create Item", {
    name,
    code: extractCode(query),
    category: extractCategory(query, context),
    uom: extractUom(query),
    openingBalance: extractNumberByLabel(query, ["opening", "opening balance"]),
    unitCost: extractNumberByLabel(query, ["cost", "unit cost"]),
    sellingPrice: extractNumberByLabel(query, ["price", "selling price"]),
    minStock: extractNumberByLabel(query, ["min", "minimum", "minimum stock"]),
    maxStock: extractNumberByLabel(query, ["max", "maximum", "maximum stock"]),
    isActive: !/\binactive\b/i.test(query),
  });

  return finalizeReply(
    `I'll create ${name} now${action.category ? ` under ${action.category}` : ""}.`,
    [action, createAdminSectionAction("Open Items", "items")],
    context,
    { autoRunAction: action }
  );
}

function buildUpdateLevelsReply(query, context) {
  const item = findItemMatch(query, context);
  if (!item || !canManageAdmin(context)) return null;

  const openingBalance = extractNumberByLabel(query, ["opening", "opening balance"]);
  const minStock = extractNumberByLabel(query, ["min", "minimum", "minimum stock"]);
  const maxStock = extractNumberByLabel(query, ["max", "maximum", "maximum stock"]);

  if (!openingBalance && !minStock && !maxStock) return null;

  const action = createUpdateItemLevelsAction("Update Levels", {
    itemId: item.id,
    openingBalance,
    minStock,
    maxStock,
  });

  return finalizeReply(
    `I'll update the levels for ${item.name} now.`,
    [
      action,
      createStockAction("Open This Item In Stock", { search: item.code, statusFilter: "all" }),
    ],
    context,
    { autoRunAction: action }
  );
}

function buildSettingsReply(query, context) {
  if (!canManageAdmin(context)) return null;

  const financeEmail = extractEmail(query);
  if (!financeEmail || !/\bfinance email\b/i.test(query)) return null;

  const action = createSettingsAction("Update Finance Email", { financeEmail });

  return finalizeReply(
    `I'll update the finance email to ${financeEmail}.`,
    [action, createAdminSectionAction("Open System", "system")],
    context,
    { autoRunAction: action }
  );
}

function buildDefaultReply(context) {
  return finalizeReply(
    [
      "I can help with real day-to-day work here, not just explain screens.",
      "You can talk to me naturally. For example: issue 2 Tea Bags to Kitchen req 12, show this month's issued report, what should I restock first, or is this report-ready.",
      `Right now there are ${formatNumber(context.metrics.todayLines)} movement lines and ${formatNumber(
        context.metrics.belowMinItems + context.metrics.negativeItems
      )} stock exceptions worth checking.`,
    ].join("\n"),
    [
      createEntryAction("Start Issue", { entryType: "OUT" }),
      createEntryAction("Start Receipt", { entryType: "IN" }),
      createStockAction("Show Stock Attention", { statusFilter: "attention" }),
      createFinanceAction("What Needs Restock", { reportMode: "stock" }),
    ],
    context
  );
}

function getAssistantWorkspaceMeta(context) {
  switch (context.activeTab) {
    case "entry":
      return {
        label: "Store Desk",
        quickLabel: "Try this workflow",
        composerHint:
          "Try: issue 2 Tea Bags to Kitchen req 12, receive 5 Sugar ref DN-14, or prepare an adjustment for Rice...",
        prompts: [
          "Issue 2 Tea Bags to Kitchen req 12",
          "Receive 5 Sugar ref DN-14",
          "Prepare adjustment for Rice",
          "Open stock balances for Bath Soap",
          "What should I check before saving this movement?",
          "How do I handle a new receipt at a different cost?",
          "I'm stuck, what should I do first?",
        ],
        welcomeNote:
          "You're in Store Desk, so I can help you prepare issues, receipts, adjustments, and explain what is still missing before save.",
      };
    case "stock":
      return {
        label: "Item Ledger",
        quickLabel: "Stock checks",
        composerHint:
          "Try: show zero stock items, open below minimum items, or prepare a receipt for Sugar...",
        prompts: [
          "Show negative stock items",
          "Show zero stock items",
          "Open below minimum items",
          "Open Bath Soap in stock",
          "Prepare receipt for Tea Bags",
          "What should I restock first?",
          "Help me fix the current stock issues",
        ],
        welcomeNote:
          "You're in Item Ledger, so I can help you spot exceptions, open an item, or move straight into a receipt, issue, or adjustment.",
      };
    case "finance":
      return {
        label: "Finance Pack",
        quickLabel: "Report shortcuts",
        composerHint:
          "Try: show this month's issued report, open category report for Beverages, or compare with the previous period...",
        prompts: [
          "Show this month's finance summary",
          "Open category report for Beverages",
          "Show issued report for this month",
          "Open item movement for Tea Bags",
          "Compare with the previous period",
          "Is this report-ready?",
          "What should I fix before finance relies on this?",
        ],
        welcomeNote:
          "You're in Finance Pack, so I can help you open the right report view, narrow to a category or item, and explain what the numbers mean.",
      };
    case "department":
      return {
        label: "Department Use",
        quickLabel: "Department review",
        composerHint:
          "Try: show today's main issuing departments, open department issues, or review requisition activity for Kitchen...",
        prompts: [
          "Show today's main issuing departments",
          "Open Department Use",
          "What was issued today?",
          "Review Kitchen requisitions",
        ],
        welcomeNote:
          "You're in Department Use, so I can help you review requisition pages and who took what on the selected date.",
      };
    case "history":
      return {
        label: "Audit Trail",
        quickLabel: "Audit actions",
        composerHint:
          "Try: open movement history, show recent issues, or explain the audit trail for deleted lines...",
        prompts: [
          "Open movement history",
          "Show recent issues",
          "Explain the audit trail for deleted lines",
          "Open today's movement history",
        ],
        welcomeNote:
          "You're in Audit Trail, so I can help you trace activity, explain audit events, and find the right lines faster.",
      };
    case "admin":
      return {
        label: "Setup",
        quickLabel: "Setup shortcuts",
        composerHint:
          "Try: open imports, create item Sugar category Dry Foods uom KGS, or create finance account for Jane...",
        prompts: [
          "Open imports",
          "Create item Sugar category Dry Foods uom KGS",
          "Open items",
          "Create finance account for Jane email jane@company.com temporary password StrongPass#2026",
        ],
        welcomeNote:
          "You're in Setup, so I can help with items, departments, accounts, imports, and system settings.",
      };
    default:
      return {
        label: "Control Room",
        quickLabel: "Quick questions",
        composerHint:
          "Try: what needs attention today, show negative stock items, or open imports...",
        prompts: [
          "What needs attention today?",
          "Show negative stock items",
          "Open imports",
          "Show this month's finance summary",
          "What should I restock first?",
          "Is this system report-ready?",
          "Where do I start today?",
        ],
        welcomeNote:
          "You're on the overview, so I can help you spot what needs attention and jump into the right module quickly.",
      };
  }
}

export function buildAssistantWelcome(context) {
  const workspace = getAssistantWorkspaceMeta(context);
  return [
    `I'm your Stock Flow assistant for ${context.companyName}.`,
    workspace.welcomeNote,
    "Talk to me the way you'd talk to a teammate. I can answer questions, open the right screen, prepare movements, and handle simple tasks when you give me enough detail.",
  ].join("\n");
}

export function buildAssistantStarterPrompts(context) {
  const workspace = getAssistantWorkspaceMeta(context);
  const prompts = [...workspace.prompts];

  if (canManageAdmin(context)) {
    prompts.push(
      "Create finance account for Jane email jane@company.com temporary password StrongPass#2026"
    );
  }

  if (
    context.activeTab !== "stock" &&
    context.stockRows.some((row) => row.stockOnHand < 0)
  ) {
    prompts.unshift("Show negative stock items");
  }

  return Array.from(new Set(prompts)).slice(0, 6);
}

export function buildAssistantComposerHint(context) {
  return getAssistantWorkspaceMeta(context).composerHint;
}

export function buildAssistantQuickLabel(context) {
  return getAssistantWorkspaceMeta(context).quickLabel;
}

export function getAssistantReply(message, context) {
  const query = String(message ?? "").trim();
  const normalizedQuery = normalizeSearchValue(query);

  if (!query) {
    return buildDefaultReply(context);
  }

  if (
    normalizedQuery === "help" ||
    normalizedQuery.includes("what can you do") ||
    normalizedQuery.includes("how can you help")
  ) {
    return buildDefaultReply(context);
  }

  if (
    normalizedQuery.includes("go online") ||
    normalizedQuery.includes("publish") ||
    normalizedQuery.includes("report ready") ||
    normalizedQuery.includes("report-ready") ||
    normalizedQuery.includes("ready to use") ||
    normalizedQuery.includes("ready for finance") ||
    normalizedQuery.includes("data quality") ||
    normalizedQuery.includes("what needs fixing") ||
    normalizedQuery.includes("how ready") ||
    normalizedQuery.includes("is this ready")
  ) {
    return buildOperationalReadinessReply(context);
  }

  if (
    normalizedQuery.includes("where do i start") ||
    normalizedQuery.includes("what should i do first") ||
    normalizedQuery.includes("start work") ||
    normalizedQuery.includes("begin work") ||
    normalizedQuery.includes("today plan") ||
    normalizedQuery.includes("i am stuck") ||
    normalizedQuery.includes("im stuck")
  ) {
    return buildStartWorkReply(context);
  }

  if (
    normalizedQuery.includes("help me fix") ||
    normalizedQuery.includes("how do i fix") ||
    normalizedQuery.includes("fix the issues") ||
    normalizedQuery.includes("fix current issues") ||
    normalizedQuery.includes("what should i fix before finance")
  ) {
    return buildFixIssuesReply(context);
  }

  if (
    normalizedQuery.includes("restock") ||
    normalizedQuery.includes("reorder") ||
    normalizedQuery.includes("replenish") ||
    normalizedQuery.includes("what should i buy") ||
    normalizedQuery.includes("what should i order")
  ) {
    return buildRestockReply(context);
  }

  if (
    normalizedQuery.includes("weighted average") ||
    normalizedQuery.includes("different cost") ||
    normalizedQuery.includes("cost change") ||
    normalizedQuery.includes("unit cost change")
  ) {
    return buildCostChangeReply(context);
  }

  if (
    /\b(?:create|add)\s+(?:(?:finance|store|admin)\s+)?(?:account|user)\b/i.test(query)
  ) {
    const accountReply = buildCreateAccountReply(query, context);
    if (accountReply) return accountReply;
  }

  if (/\bapprove\b/i.test(query)) {
    const approveReply = buildAccountDecisionReply(query, context, "approve");
    if (approveReply) return approveReply;
  }

  if (/\breject\b/i.test(query)) {
    const rejectReply = buildAccountDecisionReply(query, context, "reject");
    if (rejectReply) return rejectReply;
  }

  if (/\b(?:create|add)\s+department\b/i.test(query)) {
    const departmentReply = buildCreateDepartmentReply(query, context);
    if (departmentReply) return departmentReply;
  }

  if (/\b(?:create|add)\s+item\b/i.test(query)) {
    const itemCreationReply = buildCreateItemReply(query, context);
    if (itemCreationReply) return itemCreationReply;
  }

  if (
    /\b(?:set|update)\b/i.test(query) &&
    (normalizedQuery.includes("min") ||
      normalizedQuery.includes("max") ||
      normalizedQuery.includes("opening"))
  ) {
    const levelReply = buildUpdateLevelsReply(query, context);
    if (levelReply) return levelReply;
  }

  if (normalizedQuery.includes("finance email")) {
    const settingsReply = buildSettingsReply(query, context);
    if (settingsReply) return settingsReply;
  }

  if (
    normalizedQuery.includes("open ") ||
    normalizedQuery.includes("go to ") ||
    normalizedQuery.includes("take me to ") ||
    normalizedQuery.includes("show me ")
  ) {
    const navigationReply = buildNavigationReply(normalizedQuery, context);
    if (navigationReply) return navigationReply;
  }

  if (
    normalizedQuery.includes("attention") ||
    normalizedQuery.includes("warning") ||
    normalizedQuery.includes("negative") ||
    normalizedQuery.includes("below min") ||
    normalizedQuery.includes("low stock")
  ) {
    return buildStockAttentionReply(context);
  }

  if (
    normalizedQuery.includes("import") ||
    normalizedQuery.includes("upload items") ||
    normalizedQuery.includes("item master")
  ) {
    return buildImportReply(context);
  }

  if (
    normalizedQuery.includes("finance") ||
    normalizedQuery.includes("weekly") ||
    normalizedQuery.includes("monthly") ||
    normalizedQuery.includes("report")
  ) {
    return buildFinanceIntentReply(query, context);
  }

  if (normalizedQuery.includes("department")) {
    return buildDepartmentReply(context);
  }

  if (
    normalizedQuery.includes("adjust") ||
    normalizedQuery.includes("count correction")
  ) {
    return normalizedQuery.split(/\s+/).length > 2
      ? buildMovementPlannerReply(query, "ADJ", context)
      : buildMovementTemplateReply("ADJ", context);
  }

  if (
    normalizedQuery.includes("issue") ||
    normalizedQuery.includes("requisition") ||
    normalizedQuery.includes("stock out")
  ) {
    return normalizedQuery.split(/\s+/).length > 2
      ? buildMovementPlannerReply(query, "OUT", context)
      : buildMovementTemplateReply("OUT", context);
  }

  if (
    normalizedQuery.includes("receive") ||
    normalizedQuery.includes("supplier") ||
    normalizedQuery.includes("stock in")
  ) {
    return normalizedQuery.split(/\s+/).length > 2
      ? buildMovementPlannerReply(query, "IN", context)
      : buildMovementTemplateReply("IN", context);
  }

  const itemReply = buildItemReply(query, context);
  if (itemReply) {
    return itemReply;
  }

  return buildDefaultReply(context);
}
