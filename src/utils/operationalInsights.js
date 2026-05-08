import { shouldShowOperationalItemRow } from "./calculations";

export const workflowGuides = [
  {
    title: "Stores daily routine",
    points: [
      "Receive stock with the supplier or delivery reference before it is issued out.",
      "Issue stock only against a requisition so finance can trace department consumption.",
      "Use adjustments only after a count, breakage check, or correction that needs explanation.",
    ],
  },
  {
    title: "Finance review routine",
    points: [
      "Check negative stock and adjustment lines before accepting a daily or period close.",
      "Compare department issues with major operational areas like Kitchen, HK, Club, and Coffee Bar.",
      "Export the finance view after the storekeeper confirms the day is complete.",
    ],
  },
  {
    title: "Control rules that matter most",
    points: [
      "Keep one clean item master per item and UOM to avoid split balances.",
      "Keep Main Store active and let operational departments consume through OUT movements.",
      "Set adjustable minimum and maximum levels on key items so the system can warn before shortages or overstock.",
      "Count fast-moving and high-risk items regularly so adjustments stay low.",
    ],
  },
];

export const improvementRoadmap = [
  "Review and tune minimum and maximum stock levels as real consumption patterns become clear.",
  "Add supplier and purchase references to connect receipts with procurement records.",
  "Add approval for adjustments above a chosen threshold so large corrections are controlled.",
  "Add user audit logs and backend sync for a real multi-user online deployment.",
];

export function buildDailySupportPlan({ metrics, stockRows, financeEmail, role = "admin" }) {
  const visibleRows = (stockRows ?? []).filter(shouldShowOperationalItemRow);
  const activeRows = visibleRows.filter((row) => row.isActive !== false);
  const negativeRows = activeRows.filter((row) => row.stockOnHand < 0);
  const belowMinRows = activeRows.filter((row) => row.belowMinStock);
  const zeroRows = activeRows.filter((row) => row.stockOnHand === 0);
  const missingCostRows = activeRows.filter(
    (row) => row.unitCost == null || row.unitCost === ""
  );

  const needsImmediateControl = negativeRows.length > 0;
  const needsSetupWork = missingCostRows.length > 0 || !financeEmail;
  const needsRestockAttention = belowMinRows.length > 0 || zeroRows.length > 0;
  const normalizedRole = String(role ?? "admin").trim().toLowerCase() || "admin";

  const roleLabel =
    normalizedRole === "store"
      ? "Storekeeper briefing"
      : normalizedRole === "finance"
        ? "Finance briefing"
        : "Admin briefing";

  const rolePlans = {
    store: {
      headline: needsImmediateControl
        ? "Storekeeper should start with stock corrections before new issue work."
        : needsRestockAttention
          ? "Storekeeper can continue movement work, but stock pressure needs attention early."
          : "The store desk looks ready for today's movement work.",
      summary: needsImmediateControl
        ? `${negativeRows.length} item(s) are below zero, so the store team should reconcile those before relying on new issues.`
        : needsRestockAttention
          ? `${belowMinRows.length} item(s) are below minimum and ${zeroRows.length} are at zero, so the storekeeper should check replenishment pressure early.`
          : `${metrics.todayLines} movement line(s) are already on record today and no major store-control blockers are showing right now.`,
      steps: [
        needsImmediateControl
          ? "Reconcile negative stock first and confirm no receipt, issue, or correction was missed."
          : "Review today's movement entry first so receipts and issues start from a clean stock position.",
        needsRestockAttention
          ? "Check below-minimum and zero-stock items next so the team knows what to restock or protect."
          : "Check stock balances next to confirm nothing important is quietly running out.",
        "Once movement entry is clean, continue with normal requisition and receiving work.",
      ],
      shortcuts: [
        {
          moduleId: "entry",
          label: "Open Movement Desk",
          detail: `${metrics.todayLines} movement line(s) recorded today`,
          tone: "info",
        },
        {
          moduleId: "stock",
          label: needsImmediateControl ? "Fix Stock First" : "Review Stock",
          detail: needsImmediateControl
            ? `${negativeRows.length} negative item(s) need attention`
            : `${metrics.belowMinItems + metrics.aboveMaxItems + metrics.negativeItems} item(s) need review`,
          tone: needsImmediateControl ? "warning" : "info",
        },
        {
          moduleId: "department",
          label: "Check Department Use",
          detail: `${metrics.departmentsWithIssuesToday ?? 0} department(s) issued today`,
          tone: "info",
        },
      ],
    },
    finance: {
      headline: needsImmediateControl
        ? "Do not trust the closing value until stock exceptions are cleared."
        : needsSetupWork
          ? "Finance can review today, but value trust still depends on a few setup fixes."
          : "Finance reports look ready for review.",
      summary: needsImmediateControl
        ? `${negativeRows.length} item(s) are below zero, so closing stock and issue value should be reviewed carefully before reporting.`
        : needsSetupWork
          ? `${missingCostRows.length} active item(s) still need cost or finance setup before stock value is fully reliable.`
          : `${metrics.todayLines} movement line(s) are on record today and there are no obvious finance blockers in the current stock position.`,
      steps: [
        needsImmediateControl
          ? "Check negative stock and adjustment lines first before trusting the period close."
          : "Open the finance view after confirming today's movement entry is reasonably complete.",
        missingCostRows.length
          ? `Follow up the ${missingCostRows.length} active item(s) missing unit cost so value reports stop understating stock.`
          : "Check category and issue totals next to confirm the pattern makes operational sense.",
        !financeEmail
          ? "Set the finance email and export setup before depending on regular sharing routines."
          : "Then export or share the report only after stores confirm the day is complete.",
      ],
      shortcuts: [
        {
          moduleId: "finance",
          label: "Review Finance",
          detail: needsSetupWork ? "Use after setup gaps are cleared" : "Ready for finance review",
          tone: needsSetupWork ? "warning" : "success",
        },
        {
          moduleId: "history",
          label: "Check Audit Trail",
          detail: `${metrics.todayAdjLines ?? 0} adjustment line(s) today`,
          tone: metrics.todayAdjLines > 0 ? "warning" : "info",
        },
        {
          moduleId: "stock",
          label: "Review Stock Exceptions",
          detail: `${metrics.belowMinItems + metrics.aboveMaxItems + metrics.negativeItems} item(s) need review`,
          tone: needsImmediateControl ? "warning" : "info",
        },
      ],
    },
    admin: {
      headline: needsImmediateControl
        ? "Start with stock corrections before anything else."
        : needsSetupWork
          ? "The day is workable, but a few setup gaps still need attention."
          : needsRestockAttention
            ? "Operations are stable, but replenishment needs a quick review."
            : "The system looks settled enough for normal store and finance work.",
      summary: needsImmediateControl
        ? `${negativeRows.length} item(s) are below zero, so receipts/issues should be checked before finance relies on today's position.`
        : needsSetupWork
          ? `${missingCostRows.length} active item(s) still need unit cost or finance setup before value reports are fully trustworthy.`
          : needsRestockAttention
            ? `${belowMinRows.length} item(s) are below minimum and ${zeroRows.length} are at zero, so restock review should happen early.`
            : `${metrics.todayLines} movement line(s) are on record today and there are no major stock-control blockers showing right now.`,
      steps: [
        needsImmediateControl
          ? "Review negative stock first and confirm no receipt, issue, or adjustment was missed."
          : "Review today's movement entry first so the working day starts from a clean stock position.",
        missingCostRows.length
          ? `Fill in missing unit cost on ${missingCostRows.length} active item(s) before finance depends on stock value.`
          : needsRestockAttention
            ? "Check below-minimum and zero-stock items next so replenishment decisions are not delayed."
            : "Check stock balances next to confirm no important item is quietly drifting out of control.",
        !financeEmail
          ? "Set the finance email and sharing setup before the team depends on the export workflow."
          : "Open Finance Pack only after stores are comfortable that movement entry is complete.",
      ],
      shortcuts: [
        {
          moduleId: "stock",
          label: needsImmediateControl ? "Fix Stock First" : "Review Stock",
          detail: needsImmediateControl
            ? `${negativeRows.length} negative item(s) need attention`
            : `${metrics.belowMinItems + metrics.aboveMaxItems + metrics.negativeItems} item(s) need review`,
          tone: needsImmediateControl ? "warning" : "info",
        },
        {
          moduleId: "entry",
          label: "Open Movement Desk",
          detail: `${metrics.todayLines} movement line(s) recorded today`,
          tone: "info",
        },
        {
          moduleId: "finance",
          label: "Review Finance",
          detail: needsSetupWork ? "Use after setup gaps are cleared" : "Ready for finance review",
          tone: needsSetupWork ? "warning" : "success",
        },
      ],
    },
  };

  const selectedPlan = rolePlans[normalizedRole] ?? rolePlans.admin;

  return {
    roleLabel,
    headline: selectedPlan.headline,
    summary: selectedPlan.summary,
    steps: selectedPlan.steps,
    shortcuts: selectedPlan.shortcuts,
  };
}

export function buildOperationalInsights({
  items,
  stockRows,
  movements,
  financeEmail,
}) {
  const activeItems = items.filter((item) => item.isActive !== false);
  const visibleStockRows = stockRows.filter(shouldShowOperationalItemRow);
  const activeVisibleStockRows = visibleStockRows.filter((row) => row.isActive !== false);
  const negativeCount = activeVisibleStockRows.filter((row) => row.stockOnHand < 0).length;
  const zeroStockCount = activeVisibleStockRows.filter((row) => row.stockOnHand === 0).length;
  const adjustmentCount = movements.filter((movement) => movement.type === "ADJ").length;
  const itemsWithoutMovement = activeVisibleStockRows.filter((row) => !row.lastMovementDate).length;
  const itemsWithoutOpening = activeItems.filter(
    (item) => Number(item.openingBalance) === 0
  ).length;
  const belowMinCount = activeVisibleStockRows.filter((row) => row.belowMinStock).length;
  const aboveMaxCount = activeVisibleStockRows.filter((row) => row.aboveMaxStock).length;
  const itemsWithoutMinMax = activeItems.filter(
    (item) => item.minStock == null && item.maxStock == null
  ).length;
  const itemsWithoutCost = activeItems.filter(
    (item) => item.unitCost == null || item.unitCost === ""
  ).length;

  const insights = [];

  if (!movements.length) {
    insights.push({
      tone: "info",
      title: "Build the movement history first",
      message:
        "Load opening balances and start daily movement entry before finance relies on the reports.",
    });
  }

  if (negativeCount > 0) {
    insights.push({
      tone: "danger",
      title: `${negativeCount} item(s) are below zero`,
      message:
        "Review those items in Stock On Hand and History before period close. Negative balances usually point to missed receipts, delayed requisitions, or unrecorded adjustments.",
    });
  } else if (zeroStockCount > 0) {
    insights.push({
      tone: "warning",
      title: `${zeroStockCount} item(s) are at zero`,
      message:
        "Zero stock items may be genuine depletion or a sign that replenishment planning is needed.",
    });
  }

  if (adjustmentCount > 0) {
    insights.push({
      tone: adjustmentCount >= 10 ? "warning" : "info",
      title: `${adjustmentCount} adjustment line(s) recorded`,
      message:
        "Adjustments should stay low. If they keep growing, strengthen stock counts, receiving discipline, and requisition control.",
    });
  }

  if (belowMinCount > 0) {
    insights.push({
      tone: "warning",
      title: `${belowMinCount} item(s) are below minimum stock`,
      message:
        "Those items need replenishment review or closer issue control before they turn into stock-outs.",
    });
  }

  if (aboveMaxCount > 0) {
    insights.push({
      tone: "info",
      title: `${aboveMaxCount} item(s) are above maximum stock`,
      message:
        "Above-maximum balances can signal over-purchasing, slow movement, or receipt timing that needs review.",
    });
  }

  if (itemsWithoutCost > 0) {
    insights.push({
      tone: "warning",
      title: `${itemsWithoutCost} active item(s) have no unit cost`,
      message:
        "Finance value reports will stay incomplete for those items until a unit cost is entered from Admin or through an import update.",
    });
  }

  if (itemsWithoutMovement > 0) {
    insights.push({
      tone: "info",
      title: `${itemsWithoutMovement} item(s) have no movement yet`,
      message:
        "That may be fine for slow-moving items, but it can also reveal items that still need opening balances or historical data.",
    });
  }

  if (itemsWithoutOpening > 0) {
    insights.push({
      tone: "warning",
      title: `${itemsWithoutOpening} item(s) still show zero opening`,
      message:
        "Where possible, import or confirm official opening balances so on-hand reports start from a trusted base.",
    });
  }

  if (itemsWithoutMinMax > 0) {
    insights.push({
      tone: "info",
      title: `${itemsWithoutMinMax} item(s) still have no min/max levels`,
      message:
        "Set adjustable minimum and maximum levels on important items so the system can warn earlier and support better purchasing decisions.",
    });
  }

  if (!financeEmail) {
    insights.push({
      tone: "info",
      title: "Finance email is not set",
      message:
        "Add a finance email in Admin settings so export and sharing workflows are ready when the team starts using the system daily.",
    });
  }

  return insights.slice(0, 6);
}
