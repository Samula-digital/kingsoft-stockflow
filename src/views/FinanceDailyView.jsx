import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import StatusPill from "../components/StatusPill";
import { STANDARD_ITEM_CATEGORIES } from "../data/itemCategories";
import {
  calculateFinanceCategoryRows,
  calculateFinanceCategoryItemRows,
  calculateFinancePeriodRows,
  calculateIssueDepartmentBreakdownRows,
  calculateIssueDepartmentReportRows,
  calculateItemMovementDepartmentRows,
  calculateItemMovementLineRows,
  calculateLossReportRows,
  calculatePeriodMovementSummary,
  calculateReceiptReportRows,
  shouldShowOperationalItemRow,
} from "../utils/calculations";
import { getPreviousFinancePeriodRange } from "../utils/dateRanges";
import {
  downloadCsv,
  downloadWorkbook,
  openEmailDraft,
  openPrintReport,
} from "../utils/export";
import {
  formatDate,
  formatDateRange,
  formatMovementType,
  formatNumber,
  normalizeSearchValue,
  searchItemRecords,
} from "../utils/formatters";

const reportModes = [
  {
    id: "stock",
    label: "Stock Position",
    description: "Closing stock and value.",
  },
  {
    id: "category-summary",
    label: "By Category",
    description: "Category totals and items.",
  },
  {
    id: "receipts",
    label: "Received",
    description: "Stock received.",
  },
  {
    id: "issues",
    label: "Issued",
    description: "Stock issued.",
  },
  {
    id: "item-movement",
    label: "Item Movement",
    description: "One item timeline.",
  },
  {
    id: "losses",
    label: "Spoilt / Disposal",
    description: "Spoilage and disposal.",
  },
  {
    id: "comparison",
    label: "Comparison",
    description: "Compare this period with the previous one.",
  },
];

function buildTotals(rows) {
  return rows.reduce(
    (accumulator, row) => ({
      opening: accumulator.opening + row.opening,
      inQty: accumulator.inQty + row.inQty,
      availableQty: accumulator.availableQty + row.availableQty,
      outQty: accumulator.outQty + row.outQty,
      adjQty: accumulator.adjQty + row.adjQty,
      closing: accumulator.closing + row.closing,
      stockValue: accumulator.stockValue + (row.stockValue ?? 0),
      lineCount: accumulator.lineCount + row.lineCount,
      reviewCount: accumulator.reviewCount + (row.needsReview ? 1 : 0),
      movedItems: accumulator.movedItems + (row.hasActivity ? 1 : 0),
      requiredQty: accumulator.requiredQty + row.requiredQty,
      missingCostItems: accumulator.missingCostItems + (row.stockValue === null ? 1 : 0),
    }),
    {
      opening: 0,
      inQty: 0,
      availableQty: 0,
      outQty: 0,
      adjQty: 0,
      closing: 0,
      stockValue: 0,
      lineCount: 0,
      reviewCount: 0,
      movedItems: 0,
      requiredQty: 0,
      missingCostItems: 0,
    }
  );
}

function getStatusMeta(row) {
  if (row.negative) {
    return { tone: "danger", label: "Negative closing" };
  }

  if (row.closing === 0) {
    return { tone: "warning", label: "Zero closing" };
  }

  if (row.belowMinStock) {
    return { tone: "warning", label: "Below minimum" };
  }

  if (row.aboveMaxStock) {
    return { tone: "info", label: "Above maximum" };
  }

  if (row.hasActivity) {
    return { tone: "success", label: "Moved in period" };
  }

  return { tone: "info", label: "No movement" };
}

function formatOptionalNumber(value) {
  return value === null || value === undefined ? "-" : formatNumber(value);
}

function formatSignedNumber(value) {
  const numericValue = Number(value) || 0;
  if (numericValue > 0) {
    return `+${formatNumber(numericValue)}`;
  }

  return formatNumber(numericValue);
}

function formatDelta(value) {
  const numericValue = Number(value) || 0;
  if (!numericValue) return "0";

  return `${numericValue > 0 ? "+" : ""}${formatNumber(numericValue)}`;
}

function formatValueWithCoverage(value, missingCostLines = 0) {
  const numericValue = Number(value) || 0;

  if (missingCostLines > 0 && numericValue <= 0) {
    return "Cost missing";
  }

  if (missingCostLines > 0) {
    return `${formatNumber(numericValue)}*`;
  }

  return formatNumber(numericValue);
}

function formatQuantityMixForSummary(value) {
  const text = String(value ?? "").trim();
  return !text || text === "-" ? "0" : text;
}

function buildQuantityEntries(rows, getUom, getQuantity) {
  const totals = new Map();

  rows.forEach((row) => {
    const uom = String(getUom(row) ?? "-").trim() || "-";
    const quantity = Math.abs(Number(getQuantity(row)) || 0);

    if (!quantity) return;
    totals.set(uom, (totals.get(uom) ?? 0) + quantity);
  });

  return Array.from(totals.entries())
    .map(([uom, quantity]) => ({ uom, quantity }))
    .sort((left, right) => right.quantity - left.quantity || left.uom.localeCompare(right.uom));
}

function formatQuantityEntries(entries) {
  if (!entries.length) return "-";

  return entries
    .map((entry) => `${formatNumber(entry.quantity)} ${entry.uom}`)
    .join(" | ");
}

function summarizeQuantityEntries(entries, limit = 3) {
  if (!entries.length) {
    return "No movement in this view.";
  }

  const summary = entries
    .slice(0, limit)
    .map((entry) => `${formatNumber(entry.quantity)} ${entry.uom}`)
    .join(" • ");
  const remainingCount = entries.length - limit;

  return remainingCount > 0 ? `${summary} • +${formatNumber(remainingCount)} more` : summary;
}

function formatQuantityGroupCount(entries) {
  const count = entries.length;
  return `${formatNumber(count)} UOM group${count === 1 ? "" : "s"}`;
}

function buildValueCoverageNote(totalItems, missingCostItems, fallbackNote) {
  const normalizedTotal = Math.max(0, Number(totalItems) || 0);
  const normalizedMissing = Math.max(0, Number(missingCostItems) || 0);

  if (!normalizedMissing) {
    return fallbackNote;
  }

  const valuedItems = Math.max(0, normalizedTotal - normalizedMissing);
  return `Based on ${formatNumber(valuedItems)} costed item(s). ${formatNumber(
    normalizedMissing
  )} item(s) are excluded until cost is set.`;
}

function sumRows(rows, selector) {
  return rows.reduce((sum, row) => sum + (Number(selector(row)) || 0), 0);
}

function buildQuantityMix(rows, getUom, getQuantity) {
  return formatQuantityEntries(buildQuantityEntries(rows, getUom, getQuantity));
}

function summarizeSelection(labels, noun) {
  if (!labels.length) return `No ${noun} selected.`;
  if (labels.length === 1) return `${labels[0]} selected.`;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]} selected.`;
  return `${formatNumber(labels.length)} ${noun} selected.`;
}

function matchesQuery(values, query) {
  if (!query) return true;

  return values.some((value) => normalizeSearchValue(value).includes(query));
}

function buildComparisonRows({ currentTotals, previousTotals, currentSummary, previousSummary }) {
  return [
    {
      id: "stock-value",
      label: "Outstanding Stock Value",
      current: currentTotals.stockValue,
      previous: previousTotals.stockValue,
      change: currentTotals.stockValue - previousTotals.stockValue,
      changeTone: currentTotals.stockValue >= previousTotals.stockValue ? "info" : "warning",
    },
    {
      id: "receipt-lines",
      label: "Receipt Lines",
      current: currentSummary.receiptLines,
      previous: previousSummary.receiptLines,
      change: currentSummary.receiptLines - previousSummary.receiptLines,
      changeTone:
        currentSummary.receiptLines >= previousSummary.receiptLines ? "info" : "warning",
    },
    {
      id: "received-value",
      label: "Received Value",
      current: currentSummary.receivedValue,
      previous: previousSummary.receivedValue,
      change: currentSummary.receivedValue - previousSummary.receivedValue,
      changeTone: currentSummary.receivedValue >= previousSummary.receivedValue ? "info" : "warning",
    },
    {
      id: "issue-lines",
      label: "Issue Lines",
      current: currentSummary.issueLines,
      previous: previousSummary.issueLines,
      change: currentSummary.issueLines - previousSummary.issueLines,
      changeTone:
        currentSummary.issueLines >= previousSummary.issueLines ? "info" : "warning",
    },
    {
      id: "issued-value",
      label: "Issued Value",
      current: currentSummary.issuedValue,
      previous: previousSummary.issuedValue,
      change: currentSummary.issuedValue - previousSummary.issuedValue,
      changeTone: currentSummary.issuedValue >= previousSummary.issuedValue ? "info" : "warning",
    },
    {
      id: "loss-lines",
      label: "Spoilt / Disposal Lines",
      current: currentSummary.lossLines,
      previous: previousSummary.lossLines,
      change: currentSummary.lossLines - previousSummary.lossLines,
      changeTone:
        currentSummary.lossLines <= previousSummary.lossLines ? "success" : "danger",
    },
    {
      id: "loss-value",
      label: "Spoilt / Disposal Value",
      current: currentSummary.lossValue,
      previous: previousSummary.lossValue,
      change: currentSummary.lossValue - previousSummary.lossValue,
      changeTone: currentSummary.lossValue <= previousSummary.lossValue ? "success" : "danger",
    },
    {
      id: "review-items",
      label: "Items Needing Review",
      current: currentTotals.reviewCount,
      previous: previousTotals.reviewCount,
      change: currentTotals.reviewCount - previousTotals.reviewCount,
      changeTone: currentTotals.reviewCount <= previousTotals.reviewCount ? "success" : "warning",
    },
  ];
}

function buildExportLabel(range) {
  return range.startDate === range.endDate
    ? range.startDate
    : `${range.startDate}-to-${range.endDate}`;
}

export default function FinanceDailyView({
  items,
  departments,
  movements,
  filters,
  range,
  rows,
  hotelName,
  productName,
  brandLogoUrl,
  brandAccentColor,
  brandSidebarColor,
  defaultEmail,
  currentUser,
  onFilterChange,
  onPeriodChange,
  onShiftPeriod,
}) {
  const [reportMode, setReportMode] = useState("stock");
  const [search, setSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [stockFilterMode, setStockFilterMode] = useState("all");
  const [stockTableMode, setStockTableMode] = useState("sheet");
  const [selectedItemId, setSelectedItemId] = useState(rows[0]?.id ?? "");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [selectedIssueDepartmentIds, setSelectedIssueDepartmentIds] = useState([]);
  const [showIssueDepartmentPicker, setShowIssueDepartmentPicker] = useState(false);
  const [selectedMovementItemId, setSelectedMovementItemId] = useState("");
  const deferredSearch = useDeferredValue(search);
  const normalizedQuery = normalizeSearchValue(deferredSearch);
  const companyLabel = String(hotelName ?? "").trim() || "Stock Flow";
  const systemLabel = String(productName ?? "").trim() || "Stock Flow";
  const preparedByLabel =
    String(currentUser?.name ?? "").trim() ||
    String(currentUser?.email ?? "").trim() ||
    "Current user";

  useEffect(() => {
    setSearch("");
    setItemSearch("");
    setSelectedCategoryFilter("");
    setActiveCategory("");
    setShowIssueDepartmentPicker(false);
  }, [reportMode]);

  const itemMovementSelectableRows = useMemo(
    () => rows.filter((row) => row.hasActivity),
    [rows]
  );

  useEffect(() => {
    if (!itemMovementSelectableRows.some((row) => row.id === selectedMovementItemId)) {
      setSelectedMovementItemId(itemMovementSelectableRows[0]?.id ?? "");
    }
  }, [itemMovementSelectableRows, selectedMovementItemId]);

  const previousRange = useMemo(
    () => getPreviousFinancePeriodRange(range),
    [range.endDate, range.period, range.startDate]
  );

  const previousRows = useMemo(
    () => calculateFinancePeriodRows(items, movements, previousRange),
    [items, movements, previousRange.endDate, previousRange.startDate]
  );

  const overallTotals = useMemo(() => buildTotals(rows), [rows]);
  const previousTotals = useMemo(() => buildTotals(previousRows), [previousRows]);

  const periodSummary = useMemo(
    () => calculatePeriodMovementSummary(items, movements, range),
    [items, movements, range.endDate, range.startDate]
  );

  const previousSummary = useMemo(
    () => calculatePeriodMovementSummary(items, movements, previousRange),
    [items, movements, previousRange.endDate, previousRange.startDate]
  );

  const filteredStockRows = useMemo(() => {
    return rows.filter((row) => {
      if (!shouldShowOperationalItemRow(row)) return false;
      if (stockFilterMode === "outstanding" && row.closing <= 0) return false;
      if (stockFilterMode === "action" && !row.needsReview) return false;

      return matchesQuery([row.code, row.name, row.uom], normalizedQuery);
    });
  }, [normalizedQuery, rows, stockFilterMode]);

  useEffect(() => {
    if (!filteredStockRows.some((row) => row.id === selectedItemId)) {
      setSelectedItemId(filteredStockRows[0]?.id ?? "");
    }
  }, [filteredStockRows, selectedItemId]);

  const selectedRow = filteredStockRows.find((row) => row.id === selectedItemId) ?? null;
  const visibleStockTotals = useMemo(() => buildTotals(filteredStockRows), [filteredStockRows]);
  const hasSubsetView = filteredStockRows.length !== rows.length;

  const receiptRows = useMemo(
    () => calculateReceiptReportRows(items, movements, range),
    [items, movements, range.endDate, range.startDate]
  );

  const filteredReceiptRows = useMemo(
    () =>
      receiptRows.filter((row) =>
        matchesQuery([row.itemCode, row.itemName, row.category, row.uom], normalizedQuery)
      ),
    [normalizedQuery, receiptRows]
  );

  const issueRows = useMemo(
    () => calculateIssueDepartmentReportRows(departments, items, movements, range),
    [departments, items, movements, range.endDate, range.startDate]
  );

  const issueBreakdownRows = useMemo(
    () => calculateIssueDepartmentBreakdownRows(departments, items, movements, range),
    [departments, items, movements, range.endDate, range.startDate]
  );

  const periodReportCards = useMemo(() => {
    const operationalRows = rows.filter(shouldShowOperationalItemRow);
    const outstandingRows = operationalRows.filter((row) => Number(row.closing) > 0);
    const outstandingValue = sumRows(outstandingRows, (row) => row.stockValue);
    const topDepartment = issueRows[0]?.departmentName ?? "";

    return [
      {
        label: "Stock Value",
        value: formatNumber(overallTotals.stockValue),
        note: "closing value",
      },
      {
        label: "Outstanding Stock",
        value: `${formatNumber(outstandingRows.length)} items`,
        note: `${formatNumber(outstandingValue)} value`,
        compact: true,
      },
      {
        label: "Received",
        value: formatNumber(periodSummary.receivedValue),
        note: `${formatNumber(periodSummary.receiptLines)} line(s)`,
      },
      {
        label: "Issued",
        value: formatNumber(periodSummary.issuedValue),
        note: `${formatNumber(periodSummary.issueLines)} line(s)`,
      },
      {
        label: "Departments",
        value: formatNumber(issueRows.length),
        note: topDepartment ? `top: ${topDepartment}` : "no issues",
        compact: true,
      },
    ];
  }, [issueRows, overallTotals.stockValue, periodSummary, rows]);

  const issueSearchBreakdownRows = useMemo(
    () =>
      issueBreakdownRows.filter((row) =>
        matchesQuery(
          [row.departmentName, row.itemCode, row.itemName, row.category, row.uom],
          normalizedQuery
        )
      ),
    [issueBreakdownRows, normalizedQuery]
  );

  const issueSearchDepartmentIds = useMemo(
    () => new Set(issueSearchBreakdownRows.map((row) => row.departmentId)),
    [issueSearchBreakdownRows]
  );

  const filteredIssueRows = useMemo(
    () =>
      issueRows.filter(
        (row) =>
          matchesQuery([row.departmentName], normalizedQuery) ||
          issueSearchDepartmentIds.has(row.id)
      ),
    [issueRows, issueSearchDepartmentIds, normalizedQuery]
  );

  useEffect(() => {
    setSelectedIssueDepartmentIds((currentIds) => {
      const validIds = issueRows.map((row) => row.id);
      const remainingIds = currentIds.filter((id) => validIds.includes(id));

      if (remainingIds.length) return remainingIds;
      return validIds;
    });
  }, [issueRows]);

  const selectedIssueRows = useMemo(
    () => issueRows.filter((row) => selectedIssueDepartmentIds.includes(row.id)),
    [issueRows, selectedIssueDepartmentIds]
  );

  const filteredIssueBreakdownRows = useMemo(
    () => {
      if (!selectedIssueDepartmentIds.length) return [];

      return calculateIssueDepartmentBreakdownRows(
        departments,
        items,
        movements,
        range,
        selectedIssueDepartmentIds
      ).filter((row) =>
        matchesQuery(
          [row.departmentName, row.itemCode, row.itemName, row.category, row.uom],
          normalizedQuery
        )
      );
    },
    [
      departments,
      items,
      movements,
      normalizedQuery,
      range.endDate,
      range.startDate,
      selectedIssueDepartmentIds,
    ]
  );

  const issueSelectionLabel = useMemo(() => {
    if (!issueRows.length) {
      return "No departments issued stock in this period.";
    }

    if (!selectedIssueRows.length) {
      return "No departments included. Choose one or more for item detail.";
    }

    if (selectedIssueRows.length === issueRows.length) {
      return "Item detail includes all departments.";
    }

    if (selectedIssueRows.length <= 2) {
      return `Item detail includes ${selectedIssueRows
        .map((row) => row.departmentName)
        .join(" and ")}.`;
    }

    return `Item detail includes ${formatNumber(selectedIssueRows.length)} departments.`;
  }, [issueRows, selectedIssueRows]);

  const lossRows = useMemo(
    () => calculateLossReportRows(items, departments, movements, range),
    [departments, items, movements, range.endDate, range.startDate]
  );

  const filteredLossRows = useMemo(
    () =>
      lossRows.filter((row) =>
        matchesQuery(
          [row.itemCode, row.itemName, row.itemCategory, row.departmentName, row.category, row.notes],
          normalizedQuery
        )
      ),
    [lossRows, normalizedQuery]
  );

  const itemMovementMatches = useMemo(
    () => searchItemRecords(itemMovementSelectableRows, itemSearch, { limit: 8 }),
    [itemMovementSelectableRows, itemSearch]
  );

  useEffect(() => {
    if (
      itemSearch &&
      itemMovementMatches.length &&
      !itemMovementMatches.some((row) => row.id === selectedMovementItemId)
    ) {
      setSelectedMovementItemId(itemMovementMatches[0].id);
    }
  }, [itemMovementMatches, itemSearch, selectedMovementItemId]);

  const selectedMovementItem =
    rows.find((row) => row.id === selectedMovementItemId) ??
    itemMovementSelectableRows.find((row) => row.id === selectedMovementItemId) ??
    null;

  const itemMovementDepartmentRows = useMemo(
    () =>
      calculateItemMovementDepartmentRows(
        items,
        departments,
        movements,
        range,
        selectedMovementItemId
      ),
    [departments, items, movements, range.endDate, range.startDate, selectedMovementItemId]
  );

  const itemMovementLineRows = useMemo(
    () =>
      calculateItemMovementLineRows(items, departments, movements, range, selectedMovementItemId),
    [departments, items, movements, range.endDate, range.startDate, selectedMovementItemId]
  );

  const itemMovementMissingCostLines = useMemo(
    () =>
      itemMovementLineRows.reduce((sum, row) => sum + (row.missingCostLines > 0 ? 1 : 0), 0),
    [itemMovementLineRows]
  );

  const visibleReceiptSummary = useMemo(
    () => ({
      itemCount: filteredReceiptRows.length,
      lineCount: sumRows(filteredReceiptRows, (row) => row.lineCount),
      receivedValue: sumRows(filteredReceiptRows, (row) => row.receivedValue),
      missingCostLines: sumRows(filteredReceiptRows, (row) => row.missingCostLines),
      quantityEntries: buildQuantityEntries(
        filteredReceiptRows,
        (row) => row.uom,
        (row) => row.receivedQty
      ),
      quantityMix: buildQuantityMix(
        filteredReceiptRows,
        (row) => row.uom,
        (row) => row.receivedQty
      ),
    }),
    [filteredReceiptRows]
  );

  const visibleIssueSummary = useMemo(
    () => ({
      departmentCount: filteredIssueRows.length,
      requisitionPages: sumRows(filteredIssueRows, (row) => row.requisitionCount),
      lineCount: sumRows(filteredIssueRows, (row) => row.lineCount),
      issuedValue: sumRows(filteredIssueRows, (row) => row.issuedValue),
      missingCostLines: sumRows(filteredIssueRows, (row) => row.missingCostLines),
      quantityEntries: buildQuantityEntries(
        issueSearchBreakdownRows,
        (row) => row.uom,
        (row) => row.issuedQty
      ),
      quantityMix: buildQuantityMix(
        issueSearchBreakdownRows,
        (row) => row.uom,
        (row) => row.issuedQty
      ),
    }),
    [filteredIssueRows, issueSearchBreakdownRows]
  );

  const visibleLossSummary = useMemo(
    () => ({
      itemCount: filteredLossRows.length,
      lineCount: sumRows(filteredLossRows, (row) => row.lineCount),
      lossValue: sumRows(filteredLossRows, (row) => row.lossValue),
      missingCostLines: sumRows(filteredLossRows, (row) => row.missingCostLines),
      quantityEntries: buildQuantityEntries(
        filteredLossRows,
        (row) => row.uom,
        (row) => row.lossQty
      ),
      quantityMix: buildQuantityMix(filteredLossRows, (row) => row.uom, (row) => row.lossQty),
    }),
    [filteredLossRows]
  );

  const categoryRows = useMemo(
    () => calculateFinanceCategoryRows(items, movements, range),
    [items, movements, range.endDate, range.startDate]
  );

  const visibleStockMovementSummary = useMemo(
    () => ({
      receivedEntries: buildQuantityEntries(filteredStockRows, (row) => row.uom, (row) => row.inQty),
      issuedEntries: buildQuantityEntries(filteredStockRows, (row) => row.uom, (row) => row.outQty),
      closingEntries: buildQuantityEntries(filteredStockRows, (row) => row.uom, (row) => row.closing),
      refillEntries: buildQuantityEntries(filteredStockRows, (row) => row.uom, (row) => row.requiredQty),
      receivedMix: formatQuantityMixForSummary(
        buildQuantityMix(filteredStockRows, (row) => row.uom, (row) => row.inQty)
      ),
      issuedMix: formatQuantityMixForSummary(
        buildQuantityMix(filteredStockRows, (row) => row.uom, (row) => row.outQty)
      ),
    }),
    [filteredStockRows]
  );

  const availableCategoryOptions = useMemo(() => {
    const categorySet = new Set(categoryRows.map((row) => row.category).filter(Boolean));
    const extraOptions = Array.from(categorySet).filter(
      (category) => !STANDARD_ITEM_CATEGORIES.includes(category)
    );

    return [
      ...STANDARD_ITEM_CATEGORIES,
      ...extraOptions.sort((left, right) => left.localeCompare(right)),
    ];
  }, [categoryRows]);

  useEffect(() => {
    if (selectedCategoryFilter && !availableCategoryOptions.includes(selectedCategoryFilter)) {
      setSelectedCategoryFilter("");
    }
  }, [availableCategoryOptions, selectedCategoryFilter]);

  const filteredCategoryRows = useMemo(
    () =>
      categoryRows.filter((row) =>
        (!selectedCategoryFilter || row.category === selectedCategoryFilter) &&
        matchesQuery([row.category], normalizedQuery)
      ),
    [categoryRows, normalizedQuery, selectedCategoryFilter]
  );

  useEffect(() => {
    if (!filteredCategoryRows.length) {
      if (activeCategory) setActiveCategory("");
      return;
    }

    if (!filteredCategoryRows.some((row) => row.category === activeCategory)) {
      setActiveCategory(filteredCategoryRows[0]?.category ?? "");
    }
  }, [activeCategory, filteredCategoryRows]);

  const selectedCategoryRow =
    filteredCategoryRows.find((row) => row.category === activeCategory) ?? filteredCategoryRows[0] ?? null;

  const selectedCategoryName = selectedCategoryRow?.category ?? "";

  const categoryItemRows = useMemo(
    () =>
      selectedCategoryName
        ? calculateFinanceCategoryItemRows(items, movements, range, selectedCategoryName)
        : [],
    [items, movements, range.endDate, range.startDate, selectedCategoryName]
  );

  const visibleCategorySummary = useMemo(
    () => ({
      categoryCount: filteredCategoryRows.length,
      itemCount: sumRows(filteredCategoryRows, (row) => row.itemCount),
      closing: sumRows(filteredCategoryRows, (row) => row.closing),
      stockValue: sumRows(filteredCategoryRows, (row) => row.stockValue),
      reviewItems: sumRows(filteredCategoryRows, (row) => row.reviewItems),
      missingCostItems: sumRows(filteredCategoryRows, (row) => row.missingCostItems),
    }),
    [filteredCategoryRows]
  );

  const selectedCategoryItemSummary = useMemo(
    () => ({
      itemCount: categoryItemRows.length,
      closing: sumRows(categoryItemRows, (row) => row.closing),
      stockValue: sumRows(categoryItemRows, (row) => row.stockValue),
      reviewItems: sumRows(categoryItemRows, (row) => (row.needsReview ? 1 : 0)),
      missingCostItems: sumRows(categoryItemRows, (row) => (row.missingCost ? 1 : 0)),
    }),
    [categoryItemRows]
  );

  const stockHealthSummary = useMemo(
    () => ({
      zeroClosingItems: filteredStockRows.filter((row) => row.closing === 0).length,
      reviewItems: filteredStockRows.filter((row) => row.needsReview).length,
      missingCostItems: filteredStockRows.filter((row) => row.stockValue === null).length,
      refillItems: filteredStockRows.filter((row) => row.requiredQty > 0).length,
      valuedItems: filteredStockRows.filter((row) => row.stockValue !== null).length,
    }),
    [filteredStockRows]
  );

  const comparisonRows = useMemo(
    () =>
      buildComparisonRows({
        currentTotals: overallTotals,
        previousTotals,
        currentSummary: periodSummary,
        previousSummary,
      }),
    [overallTotals, periodSummary, previousSummary, previousTotals]
  );

  const stockSheetColumns = [
    { key: "code", label: "Code" },
    { key: "name", label: "Item" },
    {
      key: "opening",
      label: "Opening",
      align: "right",
      render: (row) => formatNumber(row.opening),
    },
    {
      key: "inQty",
      label: "Received",
      align: "right",
      render: (row) => formatNumber(row.inQty),
    },
    {
      key: "adjQty",
      label: "Adjust",
      align: "right",
      render: (row) => formatSignedNumber(row.adjQty),
    },
    {
      key: "availableQty",
      label: "Before Issue",
      align: "right",
      render: (row) => formatNumber(row.availableQty),
    },
    {
      key: "outQty",
      label: "Issued",
      align: "right",
      render: (row) => formatNumber(row.outQty),
    },
    {
      key: "closing",
      label: "Closing",
      align: "right",
      render: (row) => formatNumber(row.closing),
    },
    {
      key: "requiredQty",
      label: "Refill",
      align: "right",
      render: (row) => formatNumber(row.requiredQty),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => {
        const status = getStatusMeta(row);
        return <StatusPill tone={status.tone}>{status.label}</StatusPill>;
      },
    },
  ];

  const stockFullColumns = [
    ...stockSheetColumns.slice(0, 2),
    { key: "uom", label: "UOM" },
    {
      key: "unitCost",
      label: "Unit Cost",
      align: "right",
      render: (row) => formatOptionalNumber(row.unitCost),
    },
    ...stockSheetColumns.slice(2, 8),
    {
      key: "stockValue",
      label: "Stock Value",
      align: "right",
      render: (row) => formatOptionalNumber(row.stockValue),
    },
    {
      key: "minStock",
      label: "Min",
      align: "right",
      render: (row) => formatOptionalNumber(row.minStock),
    },
    {
      key: "maxStock",
      label: "Max",
      align: "right",
      render: (row) => formatOptionalNumber(row.maxStock),
    },
    {
      key: "lineCount",
      label: "Lines",
      align: "right",
    },
    stockSheetColumns[8],
    stockSheetColumns[9],
  ];

  const categorySummaryColumns = [
    { key: "category", label: "Category" },
    {
      key: "itemCount",
      label: "Items",
      align: "right",
      render: (row) => formatNumber(row.itemCount),
    },
    {
      key: "opening",
      label: "Opening",
      align: "right",
      render: (row) => formatNumber(row.opening),
    },
    {
      key: "inQty",
      label: "Received",
      align: "right",
      render: (row) => formatNumber(row.inQty),
    },
    {
      key: "adjQty",
      label: "Adjust",
      align: "right",
      render: (row) => formatSignedNumber(row.adjQty),
    },
    {
      key: "outQty",
      label: "Issued",
      align: "right",
      render: (row) => formatNumber(row.outQty),
    },
    {
      key: "closing",
      label: "Closing",
      align: "right",
      render: (row) => formatNumber(row.closing),
    },
    {
      key: "stockValue",
      label: "Value",
      align: "right",
      render: (row) => formatValueWithCoverage(row.stockValue, row.missingCostItems),
    },
    {
      key: "reviewItems",
      label: "Review",
      align: "right",
      render: (row) => formatNumber(row.reviewItems),
    },
  ];

  const categoryItemColumns = [
    { key: "code", label: "Code" },
    { key: "name", label: "Item" },
    { key: "uom", label: "UOM" },
    {
      key: "opening",
      label: "Opening",
      align: "right",
      render: (row) => formatNumber(row.opening),
    },
    {
      key: "inQty",
      label: "Received",
      align: "right",
      render: (row) => formatNumber(row.inQty),
    },
    {
      key: "adjQty",
      label: "Adjust",
      align: "right",
      render: (row) => formatSignedNumber(row.adjQty),
    },
    {
      key: "outQty",
      label: "Issued",
      align: "right",
      render: (row) => formatNumber(row.outQty),
    },
    {
      key: "closing",
      label: "Closing",
      align: "right",
      render: (row) => formatNumber(row.closing),
    },
    {
      key: "stockValue",
      label: "Value",
      align: "right",
      render: (row) => formatValueWithCoverage(row.stockValue, row.missingCost ? 1 : 0),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => {
        const status = getStatusMeta(row);
        return <StatusPill tone={status.tone}>{status.label}</StatusPill>;
      },
    },
  ];

  const receiptColumns = [
    { key: "itemCode", label: "Code" },
    { key: "itemName", label: "Item" },
    { key: "category", label: "Category" },
    { key: "uom", label: "UOM" },
    {
      key: "receivedQty",
      label: "Received Qty",
      align: "right",
      render: (row) => formatNumber(row.receivedQty),
    },
    {
      key: "averageUnitCost",
      label: "Avg Cost",
      align: "right",
      render: (row) => formatOptionalNumber(row.averageUnitCost),
    },
    {
      key: "receivedValue",
      label: "Received Value",
      align: "right",
      render: (row) => formatValueWithCoverage(row.receivedValue, row.missingCostLines),
    },
    {
      key: "referenceCount",
      label: "References",
      align: "right",
      render: (row) => formatNumber(row.referenceCount),
    },
    {
      key: "lineCount",
      label: "Lines",
      align: "right",
      render: (row) => formatNumber(row.lineCount),
    },
  ];

  const issueColumns = [
    { key: "departmentName", label: "Department" },
    {
      key: "quantityMix",
      label: "Qty by UOM",
      render: (row) => row.quantityMix,
    },
    {
      key: "issuedValue",
      label: "Issued Value",
      align: "right",
      render: (row) => formatValueWithCoverage(row.issuedValue, row.missingCostLines),
    },
    {
      key: "uniqueItems",
      label: "Items",
      align: "right",
      render: (row) => formatNumber(row.uniqueItems),
    },
    {
      key: "requisitionCount",
      label: "Pages",
      align: "right",
      render: (row) => formatNumber(row.requisitionCount),
    },
    {
      key: "lineCount",
      label: "Lines",
      align: "right",
      render: (row) => formatNumber(row.lineCount),
    },
  ];

  const issueBreakdownColumns = [
    { key: "departmentName", label: "Department" },
    { key: "itemCode", label: "Code" },
    { key: "itemName", label: "Item" },
    { key: "category", label: "Category" },
    { key: "uom", label: "UOM" },
    {
      key: "issuedQty",
      label: "Issued Qty",
      align: "right",
      render: (row) => formatNumber(row.issuedQty),
    },
    {
      key: "issuedValue",
      label: "Issued Value",
      align: "right",
      render: (row) => formatValueWithCoverage(row.issuedValue, row.missingCostLines),
    },
    {
      key: "requisitionCount",
      label: "Pages",
      align: "right",
      render: (row) => formatNumber(row.requisitionCount),
    },
    {
      key: "lineCount",
      label: "Lines",
      align: "right",
      render: (row) => formatNumber(row.lineCount),
    },
  ];

  const itemMovementDepartmentColumns = [
    { key: "departmentName", label: "Department" },
    {
      key: "inQty",
      label: "Received",
      align: "right",
      render: (row) => formatNumber(row.inQty),
    },
    {
      key: "outQty",
      label: "Issued",
      align: "right",
      render: (row) => formatNumber(row.outQty),
    },
    {
      key: "adjQty",
      label: "Adjust",
      align: "right",
      render: (row) => formatSignedNumber(row.adjQty),
    },
    {
      key: "netQty",
      label: "Net Effect",
      align: "right",
      render: (row) => formatSignedNumber(row.netQty),
    },
    {
      key: "unitCost",
      label: "Cost Used",
      align: "right",
      render: (row) => formatOptionalNumber(row.unitCost),
    },
    {
      key: "movementValue",
      label: "Value",
      align: "right",
      render: (row) => formatValueWithCoverage(row.movementValue, row.missingCostLines),
    },
    {
      key: "lineCount",
      label: "Lines",
      align: "right",
      render: (row) => formatNumber(row.lineCount),
    },
    {
      key: "referenceCount",
      label: "Docs",
      align: "right",
      render: (row) => formatNumber(row.referenceCount),
    },
  ];

  const itemMovementLineColumns = [
    {
      key: "date",
      label: "Date",
      render: (row) => formatDate(row.date),
    },
    { key: "departmentName", label: "Department" },
    {
      key: "type",
      label: "Movement",
      render: (row) =>
        row.type === "ADJ"
          ? `${formatMovementType(row.type)} ${row.adjustmentMode === "DECREASE" ? "(-)" : "(+)"}`
          : formatMovementType(row.type),
    },
    { key: "documentNumber", label: "Document" },
    {
      key: "quantity",
      label: "Qty",
      align: "right",
      render: (row) => formatNumber(row.quantity),
    },
    {
      key: "effectQty",
      label: "Effect",
      align: "right",
      render: (row) => formatSignedNumber(row.effectQty),
    },
    {
      key: "movementValue",
      label: "Value",
      align: "right",
      render: (row) => formatValueWithCoverage(row.movementValue, row.missingCostLines),
    },
    { key: "notes", label: "Notes" },
  ];

  const lossColumns = [
    { key: "category", label: "Type" },
    { key: "itemCode", label: "Code" },
    { key: "itemName", label: "Item" },
    { key: "itemCategory", label: "Item Category" },
    { key: "departmentName", label: "Department" },
    {
      key: "lossQty",
      label: "Qty",
      align: "right",
      render: (row) => formatNumber(row.lossQty),
    },
    {
      key: "lossValue",
      label: "Value",
      align: "right",
      render: (row) => formatValueWithCoverage(row.lossValue, row.missingCostLines),
    },
    {
      key: "lineCount",
      label: "Lines",
      align: "right",
      render: (row) => formatNumber(row.lineCount),
    },
    { key: "notes", label: "Notes" },
  ];

  const comparisonColumns = [
    { key: "label", label: "Metric" },
    {
      key: "current",
      label: "Current Period",
      align: "right",
      render: (row) => formatNumber(row.current),
    },
    {
      key: "previous",
      label: "Previous Period",
      align: "right",
      render: (row) => formatNumber(row.previous),
    },
    {
      key: "change",
      label: "Change",
      align: "right",
      render: (row) => (
        <StatusPill tone={row.changeTone}>{formatDelta(row.change)}</StatusPill>
      ),
    },
  ];

  const summaryCards = useMemo(() => {
    if (reportMode === "category-summary") {
      return [
        {
          label: "Categories",
          value: formatNumber(visibleCategorySummary.categoryCount),
          note: "summary rows shown",
        },
        {
          label: "Selected Category",
          value: selectedCategoryName || "Choose category",
          note: selectedCategoryName
            ? "category used for item detail"
            : "pick one to list its items",
          compact: true,
        },
        {
          label: "Items In Category",
          value: formatNumber(selectedCategoryItemSummary.itemCount),
          note: selectedCategoryName
            ? "item rows in selected category"
            : "no category chosen yet",
        },
        {
          label: selectedCategoryName ? "Category Value" : "Stock Value",
          value: formatValueWithCoverage(
            selectedCategoryName
              ? selectedCategoryItemSummary.stockValue
              : visibleCategorySummary.stockValue,
            selectedCategoryName
              ? selectedCategoryItemSummary.missingCostItems
              : visibleCategorySummary.missingCostItems
          ),
          note: selectedCategoryName ? "value for selected category" : "value for this view",
        },
      ];
    }

    if (reportMode === "receipts") {
      return [
        {
          label: "Items Received",
          value: formatNumber(visibleReceiptSummary.itemCount),
          note: "unique item rows",
        },
        {
          label: "Receipt Lines",
          value: formatNumber(visibleReceiptSummary.lineCount),
          note: "IN movements captured",
        },
        {
          label: "Received By UOM",
          value: formatQuantityGroupCount(visibleReceiptSummary.quantityEntries),
          note: summarizeQuantityEntries(visibleReceiptSummary.quantityEntries),
        },
        {
          label: "Received Value",
          value: formatValueWithCoverage(
            visibleReceiptSummary.receivedValue,
            visibleReceiptSummary.missingCostLines
          ),
          note: visibleReceiptSummary.missingCostLines
            ? `${formatNumber(visibleReceiptSummary.missingCostLines)} receipt line(s) have no cost yet.`
            : "receipt amount",
        },
      ];
    }

    if (reportMode === "issues") {
      return [
        {
          label: "Departments",
          value: formatNumber(visibleIssueSummary.departmentCount),
          note: "departments issued stock",
        },
        {
          label: "Requisition Pages",
          value: formatNumber(visibleIssueSummary.requisitionPages),
          note: "issue documents used",
        },
        {
          label: "Issued By UOM",
          value: formatQuantityGroupCount(visibleIssueSummary.quantityEntries),
          note: summarizeQuantityEntries(visibleIssueSummary.quantityEntries),
        },
        {
          label: "Issued Value",
          value: formatValueWithCoverage(
            visibleIssueSummary.issuedValue,
            visibleIssueSummary.missingCostLines
          ),
          note: visibleIssueSummary.missingCostLines
            ? `${formatNumber(visibleIssueSummary.missingCostLines)} issue line(s) have no cost yet.`
            : "issue amount",
        },
      ];
    }

    if (reportMode === "item-movement") {
      return [
        {
          label: "Selected Item",
          value: selectedMovementItem
            ? `${selectedMovementItem.code} • ${
                selectedMovementItem.category || "Others"
              } • ${selectedMovementItem.uom}`
            : "No item",
          note: "item, category, and unit",
          compact: true,
        },
        {
          label: "Closing Qty",
          value: selectedMovementItem ? formatNumber(selectedMovementItem.closing) : "-",
          note: "quantity on hand",
        },
        {
          label: "Departments",
          value: formatNumber(itemMovementDepartmentRows.length),
          note: "departments involved",
        },
        {
          label: "Movement Lines",
          value: formatNumber(itemMovementLineRows.length),
          note: "all matching lines",
        },
      ];
    }

    if (reportMode === "losses") {
      return [
        {
          label: "Loss Lines",
          value: formatNumber(visibleLossSummary.lineCount),
          note: "reduction lines captured",
        },
        {
          label: "Loss Items",
          value: formatNumber(visibleLossSummary.itemCount),
          note: "items affected",
        },
        {
          label: "Loss By UOM",
          value: formatQuantityGroupCount(visibleLossSummary.quantityEntries),
          note: summarizeQuantityEntries(visibleLossSummary.quantityEntries),
        },
        {
          label: "Loss Value",
          value: formatValueWithCoverage(
            visibleLossSummary.lossValue,
            visibleLossSummary.missingCostLines
          ),
          note: visibleLossSummary.missingCostLines
            ? `${formatNumber(visibleLossSummary.missingCostLines)} reduction line(s) have no cost yet.`
            : "reduction amount",
        },
      ];
    }

    if (reportMode === "comparison") {
      return [
        {
          label: "Current Value",
          value: formatNumber(overallTotals.stockValue),
          note: "current closing stock amount",
        },
        {
          label: "Previous Value",
          value: formatNumber(previousTotals.stockValue),
          note: "previous period amount",
        },
        {
          label: "Value Change",
          value: formatDelta(overallTotals.stockValue - previousTotals.stockValue),
          note: "current versus previous",
        },
        {
          label: "Review Items",
          value: `${formatNumber(overallTotals.reviewCount)} vs ${formatNumber(previousTotals.reviewCount)}`,
          note: "current vs previous count",
          compact: true,
        },
      ];
    }

    return [
      {
        label: "Rows In View",
        value: formatNumber(filteredStockRows.length),
        note: hasSubsetView ? "filtered item rows" : "all item rows",
      },
      {
        label: "Received By UOM",
        value: formatQuantityGroupCount(visibleStockMovementSummary.receivedEntries),
        note: summarizeQuantityEntries(visibleStockMovementSummary.receivedEntries),
      },
      {
        label: "Issued By UOM",
        value: formatQuantityGroupCount(visibleStockMovementSummary.issuedEntries),
        note: summarizeQuantityEntries(visibleStockMovementSummary.issuedEntries),
      },
      {
        label: "Stock Value",
        value: formatValueWithCoverage(
          visibleStockTotals.stockValue,
          stockHealthSummary.missingCostItems
        ),
        note: buildValueCoverageNote(
          filteredStockRows.length,
          stockHealthSummary.missingCostItems,
          "closing stock amount"
        ),
      },
    ];
  }, [
    filteredStockRows.length,
    filteredIssueRows,
    filteredLossRows,
    filteredReceiptRows,
    hasSubsetView,
    itemMovementDepartmentRows.length,
    itemMovementLineRows.length,
    overallTotals,
    previousTotals,
    reportMode,
    selectedCategoryItemSummary,
    selectedCategoryName,
    selectedMovementItem,
    stockHealthSummary.missingCostItems,
    visibleIssueSummary,
    visibleLossSummary,
    visibleReceiptSummary,
    visibleCategorySummary,
    visibleStockMovementSummary,
    visibleStockTotals,
  ]);

  const reportSearchPlaceholder =
    reportMode === "stock"
      ? "Search items in this report"
      : reportMode === "category-summary"
        ? "Search item categories"
      : reportMode === "receipts"
        ? "Search received items"
        : reportMode === "issues"
          ? "Search departments or issued items"
          : reportMode === "item-movement"
            ? ""
        : reportMode === "losses"
            ? "Search spoilt, disposed, or shortage lines"
            : "";
  const hasIncompleteCosts =
    (reportMode === "category-summary" &&
      (selectedCategoryName
        ? selectedCategoryItemSummary.missingCostItems > 0
        : visibleCategorySummary.missingCostItems > 0)) ||
    (reportMode === "receipts" && visibleReceiptSummary.missingCostLines > 0) ||
    (reportMode === "issues" && visibleIssueSummary.missingCostLines > 0) ||
    (reportMode === "item-movement" && itemMovementMissingCostLines > 0) ||
    (reportMode === "losses" && visibleLossSummary.missingCostLines > 0);
  const reportModeMeta = reportModes.find((option) => option.id === reportMode) ?? reportModes[0];
  const financeActionGuide = useMemo(() => {
    const blockerParts = [];

    if (reportMode === "stock" && overallTotals.reviewCount > 0) {
      blockerParts.push(
        `${formatNumber(overallTotals.reviewCount)} item(s) still need review before finance should fully trust the stock position`
      );
    }

    if (hasIncompleteCosts) {
      blockerParts.push("some visible lines still have no unit cost");
    }

    const blockerNote = blockerParts.length ? ` Fix first: ${blockerParts.join(" and ")}.` : "";

    if (reportMode === "stock") {
      return {
        title: "Stock left in store",
        nextStep: `Use Needs Review, then export.${blockerNote}`,
        actions: [
          { id: "focus_review", label: "Needs Review" },
          { id: "open_issues", label: "Check Issues", variant: "secondary" },
        ],
      };
    }

    if (reportMode === "category-summary") {
      return {
        title: "One category at a time",
        nextStep: `Pick a category, then export.${blockerNote}`,
        actions: [{ id: "clear_category", label: "Reset Category", variant: "secondary" }],
      };
    }

    if (reportMode === "receipts") {
      return {
        title: "What came into store",
        nextStep: `Check receipts and value.${blockerNote}`,
        actions: [
          { id: "open_stock", label: "Stock Position", variant: "secondary" },
          { id: "open_issues", label: "Check Issues", variant: "secondary" },
        ],
      };
    }

    if (reportMode === "issues") {
      return {
        title: "Which departments took stock",
        nextStep: `Check departments, then item lines.${blockerNote}`,
        actions: [{ id: "clear_issue_departments", label: "Reset Departments", variant: "secondary" }],
      };
    }

    if (reportMode === "item-movement") {
      return {
        title: "Trace one item",
        nextStep: `Choose the item, then review lines.${blockerNote}`,
        actions: [{ id: "clear_item_trace", label: "Change Item", variant: "secondary" }],
      };
    }

    if (reportMode === "losses") {
      return {
        title: "Losses and spoilage",
        nextStep: `Check reductions before closing.${blockerNote}`,
        actions: [
          { id: "open_stock", label: "Stock Position", variant: "secondary" },
          { id: "open_comparison", label: "Compare Periods", variant: "secondary" },
        ],
      };
    }

    return {
      title: "Compare periods",
      nextStep: `Use this after the detailed reports.${blockerNote}`,
      actions: [
        { id: "open_stock", label: "Stock" },
        { id: "open_issues", label: "Issues", variant: "secondary" },
      ],
    };
  }, [hasIncompleteCosts, overallTotals.reviewCount, reportMode]);
  const costCompletenessMessage = hasIncompleteCosts
    ? "Some value figures are still incomplete because one or more lines do not yet have a unit cost."
    : "All visible value figures are based on lines that already have unit cost.";

  function handleFinanceGuideAction(actionId) {
    if (actionId === "focus_review") {
      setReportMode("stock");
      setStockFilterMode("action");
      return;
    }

    if (actionId === "open_stock") {
      setReportMode("stock");
      return;
    }

    if (actionId === "open_issues") {
      setReportMode("issues");
      return;
    }

    if (actionId === "open_comparison") {
      setReportMode("comparison");
      return;
    }

    if (actionId === "clear_category") {
      setSelectedCategoryFilter("");
      setActiveCategory("");
      return;
    }

    if (actionId === "clear_issue_departments") {
      setSelectedIssueDepartmentIds([]);
      setShowIssueDepartmentPicker(false);
      return;
    }

    if (actionId === "clear_item_trace") {
      setSelectedMovementItemId("");
      setItemSearch("");
    }
  }

  const reportInsight = useMemo(() => {
    if (reportMode === "receipts") {
      return {
        title: "Received Stock Summary",
        narrative: `${formatNumber(visibleReceiptSummary.lineCount)} receipt line(s) were captured across ${formatNumber(visibleReceiptSummary.itemCount)} item(s). Quantities stay separated into ${formatQuantityGroupCount(visibleReceiptSummary.quantityEntries).toLowerCase()}.`,
        exportNote: "CSV and PDF export the same received-item rows you can see on screen.",
      };
    }

    if (reportMode === "issues") {
      return {
        title: "Issued Stock Summary",
        narrative: `${formatNumber(visibleIssueSummary.departmentCount)} department(s) took stock over ${formatNumber(visibleIssueSummary.requisitionPages)} requisition page(s). Quantities stay separated into ${formatQuantityGroupCount(visibleIssueSummary.quantityEntries).toLowerCase()}. ${issueSelectionLabel}`,
        exportNote:
          "CSV and PDF include the department summary first, then the item detail for the departments you include.",
      };
    }

    if (reportMode === "item-movement") {
      if (!selectedMovementItem) {
        return {
          title: "Item Movement Summary",
          narrative: "Choose one item to see every department that received, issued, or adjusted it in this period.",
          exportNote: "CSV and PDF will export the department summary and the full movement lines for the selected item.",
        };
      }

      return {
        title: "Item Movement Summary",
        narrative: `${selectedMovementItem.code} - ${selectedMovementItem.name} moved in ${formatNumber(itemMovementLineRows.length)} line(s) across ${formatNumber(itemMovementDepartmentRows.length)} department(s). Closing stock is ${formatNumber(selectedMovementItem.closing)} ${selectedMovementItem.uom}.`,
        exportNote: "CSV and PDF export the same department breakdown and movement lines shown here.",
      };
    }

    if (reportMode === "losses") {
      return {
        title: "Spoilt / Disposal Summary",
        narrative: `${formatNumber(visibleLossSummary.lineCount)} stock-reduction line(s) affected ${formatNumber(visibleLossSummary.itemCount)} item(s). Quantities stay separated into ${formatQuantityGroupCount(visibleLossSummary.quantityEntries).toLowerCase()}.`,
        exportNote: "CSV and PDF export the loss lines with their category, department, and notes.",
      };
    }

    if (reportMode === "comparison") {
      return {
        title: "Period Comparison Summary",
        narrative: `Outstanding stock value is ${formatNumber(overallTotals.stockValue)} this period versus ${formatNumber(previousTotals.stockValue)} in the previous period. Issued value changed by ${formatDelta(periodSummary.issuedValue - previousSummary.issuedValue)}.`,
        exportNote: "CSV and PDF export the metric-by-metric comparison table exactly as shown.",
      };
    }

    if (reportMode === "category-summary") {
      if (!selectedCategoryName) {
        return {
          title: "Category Summary",
          narrative:
            "Choose one category to see the exact items under it, then export or print that narrowed-down list for finance.",
          exportNote:
            "CSV and PDF export the category totals first, then the item detail for the selected category.",
        };
      }

      return {
        title: `${selectedCategoryName} Summary`,
        narrative: `${selectedCategoryName} has ${formatNumber(selectedCategoryItemSummary.itemCount)} item(s) in this period view. Closing quantity is ${formatNumber(selectedCategoryItemSummary.closing)} and closing stock value is ${formatValueWithCoverage(
          selectedCategoryItemSummary.stockValue,
          selectedCategoryItemSummary.missingCostItems
        )}.`,
        exportNote:
          "CSV and PDF export the category totals first, then the full item list for the selected category.",
      };
    }

    return {
      title: "Stock Position Summary",
      narrative: `${formatNumber(filteredStockRows.length)} item(s) are shown in this stock position view. ${formatNumber(stockHealthSummary.zeroClosingItems)} item(s) are at zero closing, ${formatNumber(stockHealthSummary.reviewItems)} need review, and the stock value shown is ${formatValueWithCoverage(visibleStockTotals.stockValue, stockHealthSummary.missingCostItems)}. ${buildValueCoverageNote(filteredStockRows.length, stockHealthSummary.missingCostItems, "closing stock amount")}`,
      exportNote: hasSubsetView
        ? "CSV and PDF export only the filtered rows currently shown on screen."
        : "CSV and PDF export the full stock position for the selected period.",
    };
  }, [
    filteredStockRows.length,
    hasSubsetView,
    issueSelectionLabel,
    itemMovementDepartmentRows.length,
    itemMovementLineRows.length,
    overallTotals.stockValue,
    periodSummary.issuedValue,
    previousSummary.issuedValue,
    previousTotals.stockValue,
    reportMode,
    selectedCategoryItemSummary,
    selectedCategoryName,
    selectedMovementItem,
    visibleIssueSummary,
    visibleLossSummary,
    visibleReceiptSummary,
    stockHealthSummary.reviewItems,
    stockHealthSummary.zeroClosingItems,
    stockHealthSummary.missingCostItems,
    visibleStockTotals,
  ]);

  function handleToggleIssueDepartment(departmentId) {
    setSelectedIssueDepartmentIds((currentIds) => {
      if (currentIds.includes(departmentId)) {
        return currentIds.filter((id) => id !== departmentId);
      }

      return [...currentIds, departmentId];
    });
  }

  function handleSelectAllIssueDepartments() {
    setSelectedIssueDepartmentIds(issueRows.map((row) => row.id));
  }

  function handleClearIssueDepartments() {
    setSelectedIssueDepartmentIds([]);
  }

  async function handleExcelExport() {
    const exportLabel = buildExportLabel(range);

    if (reportMode === "category-summary") {
      await downloadWorkbook(`category-summary-${filters.period}-${exportLabel}.xlsx`, [
        {
          name: "Category Summary",
          rows: [
            [
              "Category",
              "Items",
              "Opening",
              "Received",
              "Adjust",
              "Issued",
              "Closing",
              "Outstanding Value",
              "Review Items",
              "Missing Cost Items",
              "Lines",
            ],
            ...filteredCategoryRows.map((row) => [
              row.category,
              row.itemCount,
              row.opening,
              row.inQty,
              row.adjQty,
              row.outQty,
              row.closing,
              row.stockValue,
              row.reviewItems,
              row.missingCostItems,
              row.lineCount,
            ]),
          ],
        },
        {
          name: selectedCategoryName || "Category Items",
          rows: [
            ["Selected Category", selectedCategoryName || "None"],
            ["Period", formatDateRange(range.startDate, range.endDate)],
            [],
            [
              "Code",
              "Item",
              "UOM",
              "Opening",
              "Received",
              "Adjust",
              "Issued",
              "Closing",
              "Value",
              "Missing Cost",
              "Status",
              "Lines",
            ],
            ...categoryItemRows.map((row) => [
              row.code,
              row.name,
              row.uom,
              row.opening,
              row.inQty,
              row.adjQty,
              row.outQty,
              row.closing,
              row.stockValue,
              row.missingCost ? "Yes" : "No",
              getStatusMeta(row).label,
              row.lineCount,
            ]),
          ],
        },
      ]);
      return;
    }

    if (reportMode === "receipts") {
      await downloadWorkbook(`receipts-report-${filters.period}-${exportLabel}.xlsx`, [
        {
          name: "Receipts",
          rows: [
            ["Period", formatDateRange(range.startDate, range.endDate)],
            [],
            [
              "Code",
              "Item",
              "UOM",
              "Received Qty",
              "Received Value",
              "Avg Cost",
              "Missing Cost Lines",
              "References",
              "Lines",
            ],
            ...filteredReceiptRows.map((row) => [
              row.itemCode,
              row.itemName,
              row.uom,
              row.receivedQty,
              row.receivedValue,
              row.averageUnitCost ?? "",
              row.missingCostLines,
              row.referenceCount,
              row.lineCount,
            ]),
          ],
        },
      ]);
      return;
    }

    if (reportMode === "issues") {
      await downloadWorkbook(`issue-report-${filters.period}-${exportLabel}.xlsx`, [
        {
          name: "Issued By Department",
          rows: [
            ["Period", formatDateRange(range.startDate, range.endDate)],
            [],
            [
              "Department",
              "Qty by UOM",
              "Issued Value",
              "Missing Cost Lines",
              "Items",
              "Requisition Pages",
              "Lines",
            ],
            ...filteredIssueRows.map((row) => [
              row.departmentName,
              row.quantityMix,
              row.issuedValue,
              row.missingCostLines,
              row.uniqueItems,
              row.requisitionCount,
              row.lineCount,
            ]),
          ],
        },
        {
          name: "Issued Item Detail",
          rows: [
            [
              "Included Departments",
              selectedIssueRows.map((row) => row.departmentName).join(" | ") || "None selected",
            ],
            [],
            [
              "Department",
              "Code",
              "Item",
              "UOM",
              "Issued Qty",
              "Issued Value",
              "Missing Cost Lines",
              "Pages",
              "Lines",
            ],
            ...filteredIssueBreakdownRows.map((row) => [
              row.departmentName,
              row.itemCode,
              row.itemName,
              row.uom,
              row.issuedQty,
              row.issuedValue,
              row.missingCostLines,
              row.requisitionCount,
              row.lineCount,
            ]),
          ],
        },
      ]);
      return;
    }

    if (reportMode === "item-movement") {
      await downloadWorkbook(`item-movement-${filters.period}-${exportLabel}.xlsx`, [
        {
          name: "Item Summary",
          rows: [
            ["Selected Item", selectedMovementItem ? `${selectedMovementItem.code} - ${selectedMovementItem.name}` : ""],
            ["Period", formatDateRange(range.startDate, range.endDate)],
            [],
            [
              "Department",
              "Received",
              "Issued",
              "Adjust",
              "Net Effect",
              "Value",
              "Missing Cost Lines",
              "Lines",
              "Docs",
            ],
            ...itemMovementDepartmentRows.map((row) => [
              row.departmentName,
              row.inQty,
              row.outQty,
              row.adjQty,
              row.netQty,
              row.movementValue,
              row.missingCostLines,
              row.lineCount,
              row.referenceCount,
            ]),
          ],
        },
        {
          name: "Movement Lines",
          rows: [
            [
              "Date",
              "Department",
              "Movement",
              "Document",
              "Qty",
              "Effect",
              "Cost Used",
              "Value",
              "Missing Cost Lines",
              "Notes",
            ],
            ...itemMovementLineRows.map((row) => [
              row.date,
              row.departmentName,
              row.type === "ADJ"
                ? `${formatMovementType(row.type)} ${row.adjustmentMode === "DECREASE" ? "(-)" : "(+)"}`
                : formatMovementType(row.type),
              row.documentNumber,
              row.quantity,
              row.effectQty,
              row.unitCost ?? "",
              row.movementValue,
              row.missingCostLines,
              row.notes,
            ]),
          ],
        },
      ]);
      return;
    }

    if (reportMode === "losses") {
      await downloadWorkbook(`loss-report-${filters.period}-${exportLabel}.xlsx`, [
        {
          name: "Spoilt and Disposal",
          rows: [
            ["Period", formatDateRange(range.startDate, range.endDate)],
            [],
            [
              "Type",
              "Code",
              "Item",
              "Department",
              "Qty",
              "Value",
              "Missing Cost Lines",
              "Lines",
              "Notes",
            ],
            ...filteredLossRows.map((row) => [
              row.category,
              row.itemCode,
              row.itemName,
              row.departmentName,
              row.lossQty,
              row.lossValue,
              row.missingCostLines,
              row.lineCount,
              row.notes,
            ]),
          ],
        },
      ]);
      return;
    }

    if (reportMode === "comparison") {
      await downloadWorkbook(`comparison-report-${filters.period}-${exportLabel}.xlsx`, [
        {
          name: "Comparison",
          rows: [
            ["Current Period", formatDateRange(range.startDate, range.endDate)],
            ["Previous Period", formatDateRange(previousRange.startDate, previousRange.endDate)],
            [],
            ["Metric", "Current Period", "Previous Period", "Change"],
            ...comparisonRows.map((row) => [row.label, row.current, row.previous, row.change]),
          ],
        },
      ]);
      return;
    }

    await downloadWorkbook(`stock-position-${filters.period}-${exportLabel}.xlsx`, [
      {
        name: "Stock Position",
        rows: [
          ["Period", formatDateRange(range.startDate, range.endDate)],
          [],
          [
            "Code",
            "Item",
            "UOM",
            "Unit Cost",
            "Opening",
            "Received",
            "Adjust",
            "Before Issue",
            "Issued",
            "Closing",
            "Refill",
            "Stock Value",
            "Min",
            "Max",
            "Lines",
            "Status",
          ],
          ...filteredStockRows.map((row) => {
            const status = getStatusMeta(row);

            return [
              row.code,
              row.name,
              row.uom,
              row.unitCost ?? "",
              row.opening,
              row.inQty,
              row.adjQty,
              row.availableQty,
              row.outQty,
              row.closing,
              row.requiredQty,
              row.stockValue ?? "",
              row.minStock ?? "",
              row.maxStock ?? "",
              row.lineCount,
              status.label,
            ];
          }),
        ],
      },
    ]);
  }

  async function handleMonthlyPackExport() {
    const exportLabel = buildExportLabel(range);
    const periodLabel = formatDateRange(range.startDate, range.endDate);
    const operationalStockRows = rows.filter(shouldShowOperationalItemRow);
    const outstandingRows = operationalStockRows.filter((row) => Number(row.closing) > 0);
    const reviewRows = operationalStockRows.filter(
      (row) => row.needsReview || row.stockValue === null
    );
    const packMissingCostItems = operationalStockRows.filter((row) => row.stockValue === null)
      .length;
    const packMissingCostLines =
      periodSummary.receiptMissingCostLines +
      periodSummary.issueMissingCostLines +
      periodSummary.lossMissingCostLines;
    const packCostComplete = packMissingCostItems === 0 && packMissingCostLines === 0;
    const stockColumns = [
      "Code",
      "Item",
      "Category",
      "UOM",
      "Unit Cost",
      "Opening",
      "Received",
      "Adjust",
      "Before Issue",
      "Issued",
      "Closing",
      "Refill",
      "Stock Value",
      "Min",
      "Max",
      "Status",
      "Lines",
    ];
    const buildStockRow = (row) => [
      row.code,
      row.name,
      row.category,
      row.uom,
      row.unitCost ?? "",
      row.opening,
      row.inQty,
      row.adjQty,
      row.availableQty,
      row.outQty,
      row.closing,
      row.requiredQty,
      row.stockValue ?? "",
      row.minStock ?? "",
      row.maxStock ?? "",
      getStatusMeta(row).label,
      row.lineCount,
    ];

    await downloadWorkbook(`monthly-stockflow-pack-${exportLabel}.xlsx`, [
      {
        name: "Summary",
        rows: [
          ["Company", companyLabel],
          ["System", systemLabel],
          ["Period", periodLabel],
          ["Prepared By", preparedByLabel],
          ["Generated", new Date().toLocaleString()],
          [],
          ["Metric", "Value", "Note"],
          ...periodReportCards.map((card) => [card.label, card.value, card.note ?? ""]),
          [],
          [
            "Cost Check",
            packCostComplete ? "Complete" : "Incomplete",
            packCostComplete
              ? "All exported stock and movement values have cost coverage."
              : `${formatNumber(packMissingCostItems)} stock item(s) and ${formatNumber(
                  packMissingCostLines
                )} movement line(s) need unit cost review.`,
          ],
        ],
      },
      {
        name: "Stock Position",
        rows: [
          ["Period", periodLabel],
          [],
          stockColumns,
          ...operationalStockRows.map(buildStockRow),
        ],
      },
      {
        name: "Outstanding Stock",
        rows: [
          ["Period", periodLabel],
          [],
          stockColumns,
          ...outstandingRows.map(buildStockRow),
        ],
      },
      {
        name: "Needs Review",
        rows: [
          ["Period", periodLabel],
          [],
          stockColumns,
          ...reviewRows.map(buildStockRow),
        ],
      },
      {
        name: "Received",
        rows: [
          ["Period", periodLabel],
          [],
          [
            "Code",
            "Item",
            "Category",
            "UOM",
            "Received Qty",
            "Received Value",
            "Average Cost",
            "Missing Cost Lines",
            "References",
            "Lines",
          ],
          ...receiptRows.map((row) => [
            row.itemCode,
            row.itemName,
            row.category,
            row.uom,
            row.receivedQty,
            row.receivedValue,
            row.averageUnitCost ?? "",
            row.missingCostLines,
            row.referenceCount,
            row.lineCount,
          ]),
        ],
      },
      {
        name: "Issued Departments",
        rows: [
          ["Period", periodLabel],
          [],
          [
            "Department",
            "Qty by UOM",
            "Issued Value",
            "Missing Cost Lines",
            "Items",
            "Requisition Pages",
            "Lines",
          ],
          ...issueRows.map((row) => [
            row.departmentName,
            row.quantityMix,
            row.issuedValue,
            row.missingCostLines,
            row.uniqueItems,
            row.requisitionCount,
            row.lineCount,
          ]),
        ],
      },
      {
        name: "Issued Item Detail",
        rows: [
          ["Period", periodLabel],
          [],
          [
            "Department",
            "Code",
            "Item",
            "Category",
            "UOM",
            "Issued Qty",
            "Issued Value",
            "Missing Cost Lines",
            "Pages",
            "Lines",
          ],
          ...issueBreakdownRows.map((row) => [
            row.departmentName,
            row.itemCode,
            row.itemName,
            row.category,
            row.uom,
            row.issuedQty,
            row.issuedValue,
            row.missingCostLines,
            row.requisitionCount,
            row.lineCount,
          ]),
        ],
      },
      {
        name: "Spoilt Disposal",
        rows: [
          ["Period", periodLabel],
          [],
          [
            "Type",
            "Code",
            "Item",
            "Category",
            "Department",
            "Qty",
            "Value",
            "Missing Cost Lines",
            "Lines",
            "Notes",
          ],
          ...lossRows.map((row) => [
            row.category,
            row.itemCode,
            row.itemName,
            row.itemCategory,
            row.departmentName,
            row.lossQty,
            row.lossValue,
            row.missingCostLines,
            row.lineCount,
            row.notes,
          ]),
        ],
      },
    ]);
  }

  function handleMonthlyPdfPreview() {
    const periodLabel = formatDateRange(range.startDate, range.endDate);
    const operationalStockRows = rows.filter(shouldShowOperationalItemRow);
    const outstandingRows = operationalStockRows.filter((row) => Number(row.closing) > 0);
    const reviewRows = operationalStockRows.filter(
      (row) => row.needsReview || row.stockValue === null
    );
    const packMissingCostItems = operationalStockRows.filter((row) => row.stockValue === null)
      .length;
    const packMissingCostLines =
      periodSummary.receiptMissingCostLines +
      periodSummary.issueMissingCostLines +
      periodSummary.lossMissingCostLines;
    const packCostComplete = packMissingCostItems === 0 && packMissingCostLines === 0;
    const stockColumns = [
      "Code",
      "Item",
      "Category",
      "UOM",
      "Opening",
      "Received",
      "Issued",
      "Closing",
      "Value",
      "Status",
    ];
    const buildStockPrintRow = (row) => [
      row.code,
      row.name,
      row.category,
      row.uom,
      formatNumber(row.opening),
      formatNumber(row.inQty),
      formatNumber(row.outQty),
      formatNumber(row.closing),
      formatOptionalNumber(row.stockValue),
      getStatusMeta(row).label,
    ];

    openPrintReport({
      companyName: companyLabel,
      systemName: systemLabel,
      logoSrc: brandLogoUrl,
      accentColor: brandAccentColor,
      sidebarColor: brandSidebarColor,
      preparedBy: preparedByLabel,
      title: `${companyLabel} Monthly Stock Flow Report`,
      subtitle: `Reporting period: ${periodLabel}.`,
      summary: [
        ...periodReportCards.map((card) => ({
          label: card.label,
          value: card.value,
          note: card.note,
        })),
        {
          label: "Cost Check",
          value: packCostComplete ? "Complete" : "Review",
          note: packCostComplete
            ? "All exported values have cost coverage."
            : `${formatNumber(packMissingCostItems)} stock item(s), ${formatNumber(
                packMissingCostLines
              )} movement line(s) missing cost.`,
        },
      ],
      sections: [
        {
          title: "Issued By Department",
          description:
            "Department-level issue value for the period. This is the main finance view for stock consumed by each department.",
          columns: [
            "Department",
            "Qty by UOM",
            "Issued Value",
            "Missing Cost Lines",
            "Items",
            "Pages",
            "Lines",
          ],
          rows: issueRows.map((row) => [
            row.departmentName,
            row.quantityMix,
            formatValueWithCoverage(row.issuedValue, row.missingCostLines),
            formatNumber(row.missingCostLines),
            formatNumber(row.uniqueItems),
            formatNumber(row.requisitionCount),
            formatNumber(row.lineCount),
          ]),
        },
        {
          title: "Issued Item Detail",
          description:
            "Item detail under each department so finance can trace what made up the department totals.",
          columns: [
            "Department",
            "Code",
            "Item",
            "Category",
            "UOM",
            "Issued Qty",
            "Issued Value",
            "Pages",
          ],
          rows: issueBreakdownRows.map((row) => [
            row.departmentName,
            row.itemCode,
            row.itemName,
            row.category,
            row.uom,
            formatNumber(row.issuedQty),
            formatValueWithCoverage(row.issuedValue, row.missingCostLines),
            formatNumber(row.requisitionCount),
          ]),
        },
        {
          title: "Received Stock",
          description: "Stock received into store during the reporting period.",
          columns: [
            "Code",
            "Item",
            "Category",
            "UOM",
            "Received Qty",
            "Received Value",
            "Avg Cost",
            "Lines",
          ],
          rows: receiptRows.map((row) => [
            row.itemCode,
            row.itemName,
            row.category,
            row.uom,
            formatNumber(row.receivedQty),
            formatValueWithCoverage(row.receivedValue, row.missingCostLines),
            formatOptionalNumber(row.averageUnitCost),
            formatNumber(row.lineCount),
          ]),
        },
        {
          title: "Outstanding Stock",
          description:
            "Items with stock remaining at the end of the period. Value is based on running average cost.",
          columns: stockColumns,
          rows: outstandingRows.map(buildStockPrintRow),
        },
        {
          title: "Needs Review",
          description:
            "Items flagged because closing stock, stock levels, or cost coverage need attention before final sign-off.",
          columns: stockColumns,
          rows: reviewRows.map(buildStockPrintRow),
          emptyMessage: "No stock rows need review for this period.",
        },
      ],
    });
  }

  function handleExport() {
    const exportLabel = buildExportLabel(range);

    if (reportMode === "category-summary") {
      downloadCsv(`category-summary-${filters.period}-${exportLabel}.csv`, [
        [
          "Category",
          "Items",
          "Opening",
          "Received",
          "Adjust",
          "Issued",
          "Closing",
          "Outstanding Value",
          "Review Items",
          "Missing Cost Items",
          "Lines",
        ],
        ...filteredCategoryRows.map((row) => [
          row.category,
          row.itemCount,
          row.opening,
          row.inQty,
          row.adjQty,
          row.outQty,
          row.closing,
          row.stockValue,
          row.reviewItems,
          row.missingCostItems,
          row.lineCount,
        ]),
        [],
        ["Selected Category", selectedCategoryName || "None"],
        [],
        [
          "Code",
          "Item",
          "UOM",
          "Opening",
          "Received",
          "Adjust",
          "Issued",
          "Closing",
          "Value",
          "Missing Cost",
          "Status",
          "Lines",
        ],
        ...categoryItemRows.map((row) => [
          row.code,
          row.name,
          row.uom,
          row.opening,
          row.inQty,
          row.adjQty,
          row.outQty,
          row.closing,
          row.stockValue,
          row.missingCost ? "Yes" : "No",
          getStatusMeta(row).label,
          row.lineCount,
        ]),
      ]);
      return;
    }

    if (reportMode === "receipts") {
      downloadCsv(`receipts-report-${filters.period}-${exportLabel}.csv`, [
        [
          "Code",
          "Item",
          "UOM",
          "Received Qty",
          "Received Value",
          "Missing Cost Lines",
          "References",
          "Lines",
        ],
        ...filteredReceiptRows.map((row) => [
          row.itemCode,
          row.itemName,
          row.uom,
          row.receivedQty,
          row.receivedValue,
          row.missingCostLines,
          row.referenceCount,
          row.lineCount,
        ]),
      ]);
      return;
    }

    if (reportMode === "issues") {
      downloadCsv(`issue-report-${filters.period}-${exportLabel}.csv`, [
        [
          "Department",
          "Qty by UOM",
          "Issued Value",
          "Missing Cost Lines",
          "Items",
          "Requisition Pages",
          "Lines",
        ],
        ...filteredIssueRows.map((row) => [
          row.departmentName,
          row.quantityMix,
          row.issuedValue,
          row.missingCostLines,
          row.uniqueItems,
          row.requisitionCount,
          row.lineCount,
        ]),
        [],
        [
          "Included Departments",
          selectedIssueRows.map((row) => row.departmentName).join(" | ") || "None selected",
        ],
        [
          "Department",
          "Code",
          "Item",
          "UOM",
          "Issued Qty",
          "Issued Value",
          "Missing Cost Lines",
          "Pages",
          "Lines",
        ],
        ...filteredIssueBreakdownRows.map((row) => [
          row.departmentName,
          row.itemCode,
          row.itemName,
          row.uom,
          row.issuedQty,
          row.issuedValue,
          row.missingCostLines,
          row.requisitionCount,
          row.lineCount,
        ]),
      ]);
      return;
    }

    if (reportMode === "item-movement") {
      downloadCsv(`item-movement-${filters.period}-${exportLabel}.csv`, [
        ["Selected Item", selectedMovementItem ? `${selectedMovementItem.code} - ${selectedMovementItem.name}` : ""],
        ["Period", formatDateRange(range.startDate, range.endDate)],
        [],
        ["Department", "Received", "Issued", "Adjust", "Net Effect", "Value", "Missing Cost Lines", "Lines", "Docs"],
        ...itemMovementDepartmentRows.map((row) => [
          row.departmentName,
          row.inQty,
          row.outQty,
          row.adjQty,
          row.netQty,
          row.movementValue,
          row.missingCostLines,
          row.lineCount,
          row.referenceCount,
        ]),
        [],
        ["Date", "Department", "Movement", "Document", "Qty", "Effect", "Value", "Missing Cost Lines", "Notes"],
        ...itemMovementLineRows.map((row) => [
          row.date,
          row.departmentName,
          row.type === "ADJ"
            ? `${formatMovementType(row.type)} ${row.adjustmentMode === "DECREASE" ? "(-)" : "(+)"}`
            : formatMovementType(row.type),
          row.documentNumber,
          row.quantity,
          row.effectQty,
          row.movementValue,
          row.missingCostLines,
          row.notes,
        ]),
      ]);
      return;
    }

    if (reportMode === "losses") {
      downloadCsv(`loss-report-${filters.period}-${exportLabel}.csv`, [
        ["Type", "Code", "Item", "Department", "Qty", "Value", "Missing Cost Lines", "Lines", "Notes"],
        ...filteredLossRows.map((row) => [
          row.category,
          row.itemCode,
          row.itemName,
          row.departmentName,
          row.lossQty,
          row.lossValue,
          row.missingCostLines,
          row.lineCount,
          row.notes,
        ]),
      ]);
      return;
    }

    if (reportMode === "comparison") {
      downloadCsv(`comparison-report-${filters.period}-${exportLabel}.csv`, [
        ["Metric", "Current Period", "Previous Period", "Change"],
        ...comparisonRows.map((row) => [row.label, row.current, row.previous, row.change]),
      ]);
      return;
    }

    downloadCsv(`stock-position-${filters.period}-${exportLabel}.csv`, [
      [
        "Code",
        "Item",
        "UOM",
        "Unit Cost",
        "Opening",
        "Received",
        "Adjust",
        "Before Issue",
        "Issued",
        "Closing",
        "Refill",
        "Stock Value",
        "Min",
        "Max",
        "Lines",
        "Status",
      ],
      ...filteredStockRows.map((row) => {
        const status = getStatusMeta(row);

        return [
          row.code,
          row.name,
          row.uom,
          row.unitCost ?? "",
          row.opening,
          row.inQty,
          row.adjQty,
          row.availableQty,
          row.outQty,
          row.closing,
          row.requiredQty,
          row.stockValue ?? "",
          row.minStock ?? "",
          row.maxStock ?? "",
          row.lineCount,
          status.label,
        ];
      }),
    ]);
  }

  function handleEmailExport() {
    const currentPeriodLabel = formatDateRange(range.startDate, range.endDate);

    if (reportMode === "category-summary") {
      openEmailDraft({
        to: defaultEmail,
        subject: `${companyLabel} Category Summary ${currentPeriodLabel}`,
        body: [
          `Category summary from ${systemLabel}`,
          "",
          `Period: ${currentPeriodLabel}`,
          `Categories shown: ${formatNumber(visibleCategorySummary.categoryCount)}`,
          `Selected category: ${selectedCategoryName || "None"}`,
          `Items in selected category: ${formatNumber(selectedCategoryItemSummary.itemCount)}`,
          `Selected category value: ${formatValueWithCoverage(
            selectedCategoryItemSummary.stockValue,
            selectedCategoryItemSummary.missingCostItems
          )}`,
          `Items needing review: ${formatNumber(selectedCategoryItemSummary.reviewItems)}`,
          "",
          "Attach the CSV export if finance needs the category totals plus the item list under the selected category.",
        ].join("\n"),
      });
      return;
    }

    if (reportMode === "receipts") {
      openEmailDraft({
        to: defaultEmail,
        subject: `${companyLabel} Received Stock Report ${currentPeriodLabel}`,
        body: [
          `Received stock report from ${systemLabel}`,
          "",
          `Period: ${currentPeriodLabel}`,
          `Qty by UOM: ${visibleReceiptSummary.quantityMix || "-"}`,
          `Received value: ${formatValueWithCoverage(
            visibleReceiptSummary.receivedValue,
            visibleReceiptSummary.missingCostLines
          )}`,
          `Receipt lines: ${formatNumber(visibleReceiptSummary.lineCount)}`,
          `Items received: ${formatNumber(filteredReceiptRows.length)}`,
          "",
          "Attach the CSV export if finance needs the item-by-item receipt detail.",
        ].join("\n"),
      });
      return;
    }

    if (reportMode === "issues") {
      openEmailDraft({
        to: defaultEmail,
        subject: `${companyLabel} Issued Stock Report ${currentPeriodLabel}`,
        body: [
          `Issued stock report from ${systemLabel}`,
          "",
          `Period: ${currentPeriodLabel}`,
          `Qty by UOM: ${visibleIssueSummary.quantityMix || "-"}`,
          `Issued value: ${formatValueWithCoverage(
            visibleIssueSummary.issuedValue,
            visibleIssueSummary.missingCostLines
          )}`,
          `Issue lines: ${formatNumber(visibleIssueSummary.lineCount)}`,
          `Departments served: ${formatNumber(filteredIssueRows.length)}`,
          `Included in item detail: ${
            selectedIssueRows.map((row) => row.departmentName).join(", ") || "None"
          }`,
          "",
          "Attach the CSV export if finance needs both the department summary and the issued-item detail for the included departments.",
        ].join("\n"),
      });
      return;
    }

    if (reportMode === "item-movement") {
      openEmailDraft({
        to: defaultEmail,
        subject: `${companyLabel} Item Movement ${selectedMovementItem?.code ?? ""} ${currentPeriodLabel}`.trim(),
        body: [
          `Item movement report from ${systemLabel}`,
          "",
          `Period: ${currentPeriodLabel}`,
          `Selected item: ${
            selectedMovementItem
              ? `${selectedMovementItem.code} - ${selectedMovementItem.name} (${selectedMovementItem.uom})`
              : "No item selected"
          }`,
          `Opening: ${selectedMovementItem ? formatNumber(selectedMovementItem.opening) : "-"}`,
          `Received: ${selectedMovementItem ? formatNumber(selectedMovementItem.inQty) : "-"}`,
          `Issued: ${selectedMovementItem ? formatNumber(selectedMovementItem.outQty) : "-"}`,
          `Adjust: ${selectedMovementItem ? formatSignedNumber(selectedMovementItem.adjQty) : "-"}`,
          `Closing: ${selectedMovementItem ? formatNumber(selectedMovementItem.closing) : "-"}`,
          `Departments involved: ${formatNumber(itemMovementDepartmentRows.length)}`,
          `Movement lines: ${formatNumber(itemMovementLineRows.length)}`,
          `Missing cost lines: ${formatNumber(itemMovementMissingCostLines)}`,
          "",
          "Attach the CSV export if finance needs the department summary and full movement lines for this item.",
        ].join("\n"),
      });
      return;
    }

    if (reportMode === "losses") {
      openEmailDraft({
        to: defaultEmail,
        subject: `${companyLabel} Spoilt / Disposal Report ${currentPeriodLabel}`,
        body: [
          `Spoilt / disposal report from ${systemLabel}`,
          "",
          `Period: ${currentPeriodLabel}`,
          `Qty by UOM: ${visibleLossSummary.quantityMix || "-"}`,
          `Loss value: ${formatValueWithCoverage(
            visibleLossSummary.lossValue,
            visibleLossSummary.missingCostLines
          )}`,
          `Loss lines: ${formatNumber(visibleLossSummary.lineCount)}`,
          `Rows shown: ${formatNumber(filteredLossRows.length)}`,
          "",
          "Attach the CSV export if finance needs the item-level loss detail and notes.",
        ].join("\n"),
      });
      return;
    }

    if (reportMode === "comparison") {
      openEmailDraft({
        to: defaultEmail,
        subject: `${companyLabel} Period Comparison ${currentPeriodLabel}`,
        body: [
          `Period comparison from ${systemLabel}`,
          "",
          `Current period: ${currentPeriodLabel}`,
          `Previous period: ${formatDateRange(previousRange.startDate, previousRange.endDate)}`,
          `Outstanding stock value: ${formatNumber(overallTotals.stockValue)} vs ${formatNumber(previousTotals.stockValue)}`,
          `Issued value: ${formatNumber(periodSummary.issuedValue)} vs ${formatNumber(previousSummary.issuedValue)}`,
          `Loss value: ${formatNumber(periodSummary.lossValue)} vs ${formatNumber(previousSummary.lossValue)}`,
          `Items needing review: ${formatNumber(overallTotals.reviewCount)} vs ${formatNumber(previousTotals.reviewCount)}`,
          "",
          "Attach the CSV export if finance needs the metric-by-metric comparison table.",
        ].join("\n"),
      });
      return;
    }

    openEmailDraft({
      to: defaultEmail,
      subject: `${companyLabel} Stock Position ${currentPeriodLabel}`,
      body: [
        `Stock position summary from ${systemLabel}`,
        "",
        `Period: ${currentPeriodLabel}`,
        `Items shown: ${formatNumber(filteredStockRows.length)}`,
        `Received qty by UOM: ${visibleStockMovementSummary.receivedMix}`,
        `Issued qty by UOM: ${visibleStockMovementSummary.issuedMix}`,
        `Stock value shown: ${formatValueWithCoverage(
          visibleStockTotals.stockValue,
          stockHealthSummary.missingCostItems
        )}`,
        `Zero closing items: ${formatNumber(stockHealthSummary.zeroClosingItems)}`,
        `Items needing review: ${formatNumber(stockHealthSummary.reviewItems)}`,
        "",
        hasSubsetView
          ? `The current screen is showing ${formatNumber(filteredStockRows.length)} of ${formatNumber(rows.length)} items because of filters or search.`
          : "The current screen is showing the full stock position report.",
      ].join("\n"),
    });
  }

  function handlePrintExport() {
    const currentPeriodLabel = formatDateRange(range.startDate, range.endDate);
    const sharedSummary = summaryCards.map((card) => ({
      label: card.label,
      value: card.value,
      note: card.note,
    }));
    const sharedPrintMeta = {
      companyName: companyLabel,
      systemName: systemLabel,
      logoSrc: brandLogoUrl,
      accentColor: brandAccentColor,
      sidebarColor: brandSidebarColor,
      preparedBy: preparedByLabel,
    };

    if (reportMode === "category-summary") {
      openPrintReport({
        ...sharedPrintMeta,
        title: `${companyLabel} Category Summary Report`,
        subtitle: `Reporting period: ${currentPeriodLabel}.`,
        summary: sharedSummary,
        sections: [
          {
            title: "Stock By Category",
            columns: [
              "Category",
              "Items",
              "Opening",
              "Received",
              "Adjust",
              "Issued",
              "Closing",
              "Value",
              "Review Items",
              "Missing Cost Items",
            ],
            rows: filteredCategoryRows.map((row) => [
              row.category,
              formatNumber(row.itemCount),
              formatNumber(row.opening),
              formatNumber(row.inQty),
              formatSignedNumber(row.adjQty),
              formatNumber(row.outQty),
              formatNumber(row.closing),
              formatValueWithCoverage(row.stockValue, row.missingCostItems),
              formatNumber(row.reviewItems),
              formatNumber(row.missingCostItems),
            ]),
          },
          {
            title: selectedCategoryName
              ? `Items In ${selectedCategoryName}`
              : "Items In Selected Category",
            description: selectedCategoryName
              ? "This section lists every item under the chosen category for the same reporting period."
              : "Choose a category on screen to print the matching item detail here.",
            columns: [
              "Code",
              "Item",
              "UOM",
              "Opening",
              "Received",
              "Adjust",
              "Issued",
              "Closing",
              "Value",
              "Status",
              "Lines",
            ],
            rows: categoryItemRows.map((row) => [
              row.code,
              row.name,
              row.uom,
              formatNumber(row.opening),
              formatNumber(row.inQty),
              formatSignedNumber(row.adjQty),
              formatNumber(row.outQty),
              formatNumber(row.closing),
              formatValueWithCoverage(row.stockValue, row.missingCost ? 1 : 0),
              getStatusMeta(row).label,
              formatNumber(row.lineCount),
            ]),
            emptyMessage: "Select a category first to print the item detail under it.",
          },
        ],
      });
      return;
    }

    if (reportMode === "receipts") {
      openPrintReport({
        ...sharedPrintMeta,
        title: `${companyLabel} Received Stock Report`,
        subtitle: `Reporting period: ${currentPeriodLabel}.`,
        summary: sharedSummary,
        sections: [
          {
            title: "Received Stock",
            columns: [
              "Code",
              "Item",
              "UOM",
              "Received Qty",
              "Received Value",
              "Missing Cost Lines",
              "References",
              "Lines",
            ],
            rows: filteredReceiptRows.map((row) => [
              row.itemCode,
              row.itemName,
              row.uom,
              formatNumber(row.receivedQty),
              formatValueWithCoverage(row.receivedValue, row.missingCostLines),
              formatNumber(row.missingCostLines),
              formatNumber(row.referenceCount),
              formatNumber(row.lineCount),
            ]),
          },
        ],
      });
      return;
    }

    if (reportMode === "issues") {
      openPrintReport({
        ...sharedPrintMeta,
        title: `${companyLabel} Issued Stock Report`,
        subtitle: `Reporting period: ${currentPeriodLabel}.`,
        summary: sharedSummary,
        sections: [
          {
            title: "Issued By Department",
            columns: [
              "Department",
              "Qty by UOM",
              "Issued Value",
              "Missing Cost Lines",
              "Items",
              "Pages",
              "Lines",
            ],
            rows: filteredIssueRows.map((row) => [
              row.departmentName,
              row.quantityMix,
              formatValueWithCoverage(row.issuedValue, row.missingCostLines),
              formatNumber(row.missingCostLines),
              formatNumber(row.uniqueItems),
              formatNumber(row.requisitionCount),
              formatNumber(row.lineCount),
            ]),
          },
          {
            title:
              selectedIssueRows.length > 0
                ? `Issued Items For ${selectedIssueRows
                    .map((row) => row.departmentName)
                    .join(", ")}`
                : "Issued Item Detail",
            columns: [
              "Department",
              "Code",
              "Item",
              "UOM",
              "Issued Qty",
              "Issued Value",
              "Missing Cost Lines",
              "Pages",
              "Lines",
            ],
            rows: filteredIssueBreakdownRows.map((row) => [
              row.departmentName,
              row.itemCode,
              row.itemName,
              row.uom,
              formatNumber(row.issuedQty),
              formatValueWithCoverage(row.issuedValue, row.missingCostLines),
              formatNumber(row.missingCostLines),
              formatNumber(row.requisitionCount),
              formatNumber(row.lineCount),
            ]),
            emptyMessage: "Select one or more departments to open the issued-item detail.",
          },
        ],
      });
      return;
    }

    if (reportMode === "item-movement") {
      openPrintReport({
        ...sharedPrintMeta,
        title: `${companyLabel} Item Movement Report${
          selectedMovementItem ? ` - ${selectedMovementItem.code}` : ""
        }`,
        subtitle: `Reporting period: ${currentPeriodLabel}.`,
        summary: sharedSummary,
        sections: [
          {
            title: "Movement By Department",
            columns: [
              "Department",
              "Received",
              "Issued",
              "Adjust",
              "Net Effect",
              "Value",
              "Missing Cost Lines",
              "Lines",
              "Docs",
            ],
            rows: itemMovementDepartmentRows.map((row) => [
              row.departmentName,
              formatNumber(row.inQty),
              formatNumber(row.outQty),
              formatSignedNumber(row.adjQty),
              formatSignedNumber(row.netQty),
              formatValueWithCoverage(row.movementValue, row.missingCostLines),
              formatNumber(row.missingCostLines),
              formatNumber(row.lineCount),
              formatNumber(row.referenceCount),
            ]),
            emptyMessage: "Select one item with movement in this period to open this view.",
          },
          {
            title: selectedMovementItem
              ? `Movement Lines For ${selectedMovementItem.code} - ${selectedMovementItem.name}`
              : "Movement Lines",
            columns: [
              "Date",
              "Department",
              "Movement",
              "Document",
              "Qty",
              "Effect",
              "Value",
              "Missing Cost Lines",
              "Notes",
            ],
            rows: itemMovementLineRows.map((row) => [
              formatDate(row.date),
              row.departmentName,
              row.type === "ADJ"
                ? `${formatMovementType(row.type)} ${row.adjustmentMode === "DECREASE" ? "(-)" : "(+)"}`
                : formatMovementType(row.type),
              row.documentNumber,
              formatNumber(row.quantity),
              formatSignedNumber(row.effectQty),
              formatValueWithCoverage(row.movementValue, row.missingCostLines),
              formatNumber(row.missingCostLines),
              row.notes,
            ]),
            emptyMessage: "Select one item with movement in this period to open this view.",
          },
        ],
      });
      return;
    }

    if (reportMode === "losses") {
      openPrintReport({
        ...sharedPrintMeta,
        title: `${companyLabel} Spoilt / Disposal Report`,
        subtitle: `Reporting period: ${currentPeriodLabel}.`,
        summary: sharedSummary,
        sections: [
          {
            title: "Stock Reductions",
            columns: [
              "Type",
              "Code",
              "Item",
              "Department",
              "Qty",
              "Value",
              "Missing Cost Lines",
              "Lines",
              "Notes",
            ],
            rows: filteredLossRows.map((row) => [
              row.category,
              row.itemCode,
              row.itemName,
              row.departmentName,
              formatNumber(row.lossQty),
              formatValueWithCoverage(row.lossValue, row.missingCostLines),
              formatNumber(row.missingCostLines),
              formatNumber(row.lineCount),
              row.notes,
            ]),
          },
        ],
      });
      return;
    }

    if (reportMode === "comparison") {
      openPrintReport({
        ...sharedPrintMeta,
        title: `${companyLabel} Period Comparison Report`,
        subtitle: `Current period: ${currentPeriodLabel}. Previous period: ${formatDateRange(previousRange.startDate, previousRange.endDate)}.`,
        summary: sharedSummary,
        sections: [
          {
            title: "Comparison Metrics",
            columns: ["Metric", "Current", "Previous", "Change"],
            rows: comparisonRows.map((row) => [
              row.label,
              formatNumber(row.current),
              formatNumber(row.previous),
              formatDelta(row.change),
            ]),
          },
        ],
      });
      return;
    }

    openPrintReport({
      ...sharedPrintMeta,
      title: `${companyLabel} Stock Position Report`,
      subtitle: `Reporting period: ${currentPeriodLabel}.`,
      summary: sharedSummary,
      sections: [
        {
          title: "Movement Breakdown By UOM",
          description:
            "Quantities remain separated by unit of measure so cartons, kilograms, bottles, and pieces are not mixed into one total.",
          columns: ["Movement", "UOM", "Quantity"],
          rows: [
            ...visibleStockMovementSummary.receivedEntries.map((entry) => [
              "Received",
              entry.uom,
              formatNumber(entry.quantity),
            ]),
            ...visibleStockMovementSummary.issuedEntries.map((entry) => [
              "Issued",
              entry.uom,
              formatNumber(entry.quantity),
            ]),
          ],
          emptyMessage: "No received or issued quantities fall in this period.",
        },
        {
          title: "Stock Value Basis",
          description:
            "Stock value is calculated from closing quantity multiplied by the current running average cost for each item.",
          columns: ["Check", "Value"],
          rows: [
            ["Rows In View", formatNumber(filteredStockRows.length)],
            ["Costed Items", formatNumber(stockHealthSummary.valuedItems)],
            ["Items Missing Cost", formatNumber(stockHealthSummary.missingCostItems)],
            [
              "Reported Stock Value",
              formatValueWithCoverage(
                visibleStockTotals.stockValue,
                stockHealthSummary.missingCostItems
              ),
            ],
          ],
        },
        {
          title: "Outstanding Stock Position",
          columns: [
            "Code",
            "Item",
            "UOM",
            "Opening",
            "Received",
            "Adjust",
            "Before Issue",
            "Issued",
            "Closing",
            "Refill",
            "Value",
            "Status",
          ],
          rows: filteredStockRows.map((row) => [
            row.code,
            row.name,
            row.uom,
            formatNumber(row.opening),
            formatNumber(row.inQty),
            formatSignedNumber(row.adjQty),
            formatNumber(row.availableQty),
            formatNumber(row.outQty),
            formatNumber(row.closing),
            formatNumber(row.requiredQty),
            formatOptionalNumber(row.stockValue),
            getStatusMeta(row).label,
          ]),
        },
      ],
    });
  }

  return (
    <section className="card">
      <div className="card-header card-header-spread">
        <div>
          <h2>Finance Pack</h2>
          <p>Review the period. Export the pack.</p>
        </div>
        <div className="toolbar">
          <button className="button" onClick={handleMonthlyPackExport} type="button">
            Monthly Pack
          </button>
          <button className="button" onClick={handleMonthlyPdfPreview} type="button">
            Monthly PDF
          </button>
          <button className="button button-secondary" onClick={handleEmailExport} type="button">
            Email Summary
          </button>
          <button className="button button-secondary" onClick={handleExcelExport} type="button">
            Export Excel
          </button>
          <button className="button button-secondary" onClick={handleExport} type="button">
            Export CSV
          </button>
          <button className="button button-secondary" onClick={handlePrintExport} type="button">
            Open PDF Preview
          </button>
        </div>
      </div>

      <div className="detail-block">
        <div className="toolbar finance-toolbar">
          <div className="segmented-control">
            {[
              { id: "daily", label: "Daily" },
              { id: "weekly", label: "Weekly" },
              { id: "monthly", label: "Monthly" },
              { id: "custom", label: "Custom" },
            ].map((option) => (
              <button
                key={option.id}
                className={filters.period === option.id ? "is-active" : ""}
                onClick={() => onPeriodChange(option.id)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>

          {filters.period === "custom" ? (
            <div className="toolbar">
              <input
                className="input"
                type="date"
                value={filters.fromDate}
                onChange={(event) => onFilterChange("fromDate", event.target.value)}
              />
              <input
                className="input"
                type="date"
                value={filters.toDate}
                onChange={(event) => onFilterChange("toDate", event.target.value)}
              />
            </div>
          ) : (
            <div className="toolbar">
              <button
                className="button button-secondary button-small"
                onClick={() => onShiftPeriod(-1)}
                type="button"
              >
                Previous
              </button>
              <input
                className="input"
                type="date"
                value={filters.anchorDate}
                onChange={(event) => onFilterChange("anchorDate", event.target.value)}
              />
              <button
                className="button button-secondary button-small"
                onClick={() => onShiftPeriod(1)}
                type="button"
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="report-mode-grid">
          {reportModes.map((option) => (
            <button
              key={option.id}
              className={`report-mode-card ${reportMode === option.id ? "is-active" : ""}`}
              onClick={() => setReportMode(option.id)}
              type="button"
              aria-pressed={reportMode === option.id}
            >
              <div className="report-mode-card-head">
                <strong>{option.label}</strong>
                {reportMode === option.id ? (
                  <StatusPill tone="info">Current</StatusPill>
                ) : null}
              </div>
              {reportMode === option.id ? <span>{option.description}</span> : null}
            </button>
          ))}
        </div>

        <div className="toolbar finance-toolbar">
          <div className="field finance-report-field">
            <span>{reportModeMeta.label}</span>
            <small className="field-note">{reportModeMeta.description}</small>
          </div>

          {reportMode === "comparison" ||
          reportMode === "item-movement" ||
          reportMode === "category-summary" ? null : (
            <input
              className="input toolbar-search"
              placeholder={reportSearchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}

          {reportMode === "category-summary" ? (
            <label className="field finance-report-field">
              <span>Category</span>
              <select
                className="input toolbar-search"
                value={selectedCategoryFilter}
                onChange={(event) => {
                  const nextCategory = event.target.value;
                  setSelectedCategoryFilter(nextCategory);
                  if (nextCategory) {
                    setActiveCategory(nextCategory);
                  }
                }}
              >
                <option value="">Every category</option>
                {availableCategoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {reportMode === "stock" ? (
            <>
              <div className="segmented-control">
                <button
                  className={stockFilterMode === "all" ? "is-active" : ""}
                  onClick={() => setStockFilterMode("all")}
                  type="button"
                >
                  All Items
                </button>
                <button
                  className={stockFilterMode === "outstanding" ? "is-active" : ""}
                  onClick={() => setStockFilterMode("outstanding")}
                  type="button"
                >
                  Outstanding
                </button>
                <button
                  className={stockFilterMode === "action" ? "is-active" : ""}
                  onClick={() => setStockFilterMode("action")}
                  type="button"
                >
                  Needs Review
                </button>
              </div>

              <div className="segmented-control">
                <button
                  className={stockTableMode === "sheet" ? "is-active" : ""}
                  onClick={() => setStockTableMode("sheet")}
                  type="button"
                >
                  Simple Sheet
                </button>
                <button
                  className={stockTableMode === "full" ? "is-active" : ""}
                  onClick={() => setStockTableMode("full")}
                  type="button"
                >
                  Full Detail
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div className="pill-row">
          <StatusPill tone="info">
            Current period {formatDateRange(range.startDate, range.endDate)}
          </StatusPill>

          {reportMode === "comparison" ? (
            <StatusPill tone="warning">
              Previous period {formatDateRange(previousRange.startDate, previousRange.endDate)}
            </StatusPill>
          ) : null}

          {reportMode === "issues" ? (
            <StatusPill tone={selectedIssueRows.length ? "success" : "warning"}>
              {selectedIssueRows.length
                ? `${formatNumber(selectedIssueRows.length)} department(s) in detail`
                : "No departments in detail"}
            </StatusPill>
          ) : null}

          {reportMode === "item-movement" ? (
            <StatusPill tone={selectedMovementItem ? "success" : "warning"}>
              {selectedMovementItem
                ? `Selected item: ${selectedMovementItem.code} - ${selectedMovementItem.name}`
                : "Select an item to see all departments involved"}
            </StatusPill>
          ) : null}

          {reportMode === "category-summary" ? (
            <StatusPill tone={selectedCategoryName ? "success" : "warning"}>
              {selectedCategoryName
                ? `Selected category: ${selectedCategoryName}`
                : "Choose a category to see and print its items"}
            </StatusPill>
          ) : null}

          {hasIncompleteCosts ? (
            <StatusPill tone="warning">
              Some lines have no unit cost, so value figures are incomplete
            </StatusPill>
          ) : null}
        </div>

        <div className="stat-grid compact finance-period-snapshot">
          {periodReportCards.map((card) => (
            <div
              key={card.label}
              className={`summary-tile ${card.compact ? "summary-tile-compact" : ""}`.trim()}
            >
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              {card.note ? <small>{card.note}</small> : null}
            </div>
          ))}
        </div>
      </div>

      <div className="detail-block finance-insight-block">
        <strong>{reportInsight.title}</strong>
        <p>{reportInsight.narrative}</p>
        <small>{reportInsight.exportNote}</small>
      </div>

      <div className="detail-block detail-block-compact">
        <strong>{financeActionGuide.title}</strong>
        <p>{financeActionGuide.nextStep}</p>
        <div className="pill-row">
          <StatusPill tone={hasIncompleteCosts ? "warning" : "success"}>
            {costCompletenessMessage}
          </StatusPill>
        </div>
        {financeActionGuide.actions?.length ? (
          <div className="alert-actions">
            {financeActionGuide.actions.map((action) => (
              <button
                key={action.id}
                className={`button button-small ${
                  action.variant === "secondary" ? "button-secondary" : ""
                }`}
                onClick={() => handleFinanceGuideAction(action.id)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {reportMode === "item-movement" ? (
        <div className="detail-block">
          <div className="toolbar finance-toolbar">
            <div className="field">
              <span>Choose Item</span>
              <input
                className="input toolbar-search"
                placeholder="Search item code or name"
                value={itemSearch}
                onChange={(event) => setItemSearch(event.target.value)}
              />
            </div>

            <div className="pill-row">
              <StatusPill tone="info">
                {formatNumber(itemMovementSelectableRows.length)} items moved in this period
              </StatusPill>
            </div>
          </div>

          <div className="pill-row">
            {itemMovementMatches.map((row) => (
              <button
                key={row.id}
                className={`button button-small ${
                  row.id === selectedMovementItemId ? "" : "button-secondary"
                }`}
                onClick={() => setSelectedMovementItemId(row.id)}
                type="button"
              >
                {row.code} {row.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="stat-grid compact">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className={`summary-tile ${card.compact ? "summary-tile-compact" : ""}`.trim()}
          >
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            {card.note ? <small>{card.note}</small> : null}
          </div>
        ))}
      </div>

      {reportMode === "stock" ? (
        <>
          <div className="detail-block">
            <strong>Movement Breakdown And Value Basis</strong>
            <p>
              Quantities are kept separate by unit of measure, and stock value only covers items
              whose cost is known.
            </p>

            <div className="quantity-breakdown-grid">
              <div className="quantity-breakdown-block">
                <span>Received by UOM</span>
                <div className="quantity-chip-row">
                  {visibleStockMovementSummary.receivedEntries.length ? (
                    visibleStockMovementSummary.receivedEntries.map((entry) => (
                      <div key={`received-${entry.uom}`} className="quantity-chip">
                        <strong>{formatNumber(entry.quantity)}</strong>
                        <span>{entry.uom}</span>
                      </div>
                    ))
                  ) : (
                    <small>No received movement in this view.</small>
                  )}
                </div>
              </div>

              <div className="quantity-breakdown-block">
                <span>Issued by UOM</span>
                <div className="quantity-chip-row">
                  {visibleStockMovementSummary.issuedEntries.length ? (
                    visibleStockMovementSummary.issuedEntries.map((entry) => (
                      <div key={`issued-${entry.uom}`} className="quantity-chip">
                        <strong>{formatNumber(entry.quantity)}</strong>
                        <span>{entry.uom}</span>
                      </div>
                    ))
                  ) : (
                    <small>No issued movement in this view.</small>
                  )}
                </div>
              </div>
            </div>

            <div className="compact-metric-grid">
              <div className="compact-metric-tile">
                <span>Costed Items</span>
                <strong>{formatNumber(stockHealthSummary.valuedItems)}</strong>
              </div>
              <div className="compact-metric-tile">
                <span>Missing Cost</span>
                <strong>{formatNumber(stockHealthSummary.missingCostItems)}</strong>
              </div>
              <div className="compact-metric-tile">
                <span>Reported Value</span>
                <strong>
                  {formatValueWithCoverage(
                    visibleStockTotals.stockValue,
                    stockHealthSummary.missingCostItems
                  )}
                </strong>
              </div>
              <div className="compact-metric-tile">
                <span>Value Basis</span>
                <strong>Avg cost x closing</strong>
              </div>
            </div>
          </div>

          <div className="view-grid report-breakdown-grid">
            <section className="detail-block">
              <strong>View Health</strong>
              <p>
                Zero closing is not always a problem. Treat it as a stock-out or a setup gap, then
                open the item row to confirm its opening balance and movement history.
              </p>

              <div className="compact-metric-grid">
                <div className="compact-metric-tile">
                  <span>Zero Closing</span>
                  <strong>{formatNumber(stockHealthSummary.zeroClosingItems)}</strong>
                </div>
                <div className="compact-metric-tile">
                  <span>Needs Review</span>
                  <strong>{formatNumber(stockHealthSummary.reviewItems)}</strong>
                </div>
                <div className="compact-metric-tile">
                  <span>Missing Cost</span>
                  <strong>{formatNumber(stockHealthSummary.missingCostItems)}</strong>
                </div>
                <div className="compact-metric-tile">
                  <span>Refill Items</span>
                  <strong>{formatNumber(stockHealthSummary.refillItems)}</strong>
                </div>
              </div>
            </section>

            <section className="detail-block">
              <strong>{selectedRow ? selectedRow.name : "Select an item"}</strong>
              <p>
                {selectedRow
                  ? `${selectedRow.code} • ${selectedRow.uom} • ${getStatusMeta(selectedRow).label}`
                  : "Pick a row below to see the item-level breakdown for finance."}
              </p>

              {selectedRow ? (
                <>
                  <div className="compact-metric-grid">
                    <div className="compact-metric-tile">
                      <span>Opening</span>
                      <strong>{formatNumber(selectedRow.opening)}</strong>
                    </div>
                    <div className="compact-metric-tile">
                      <span>Received</span>
                      <strong>{formatNumber(selectedRow.inQty)}</strong>
                    </div>
                    <div className="compact-metric-tile">
                      <span>Adjust</span>
                      <strong>{formatSignedNumber(selectedRow.adjQty)}</strong>
                    </div>
                    <div className="compact-metric-tile">
                      <span>Before Issue</span>
                      <strong>{formatNumber(selectedRow.availableQty)}</strong>
                    </div>
                    <div className="compact-metric-tile">
                      <span>Issued</span>
                      <strong>{formatNumber(selectedRow.outQty)}</strong>
                    </div>
                    <div className="compact-metric-tile">
                      <span>Closing</span>
                      <strong>{formatNumber(selectedRow.closing)}</strong>
                    </div>
                  </div>

                  <div className="compact-metric-grid">
                    <div className="compact-metric-tile">
                      <span>Minimum</span>
                      <strong>{formatOptionalNumber(selectedRow.minStock)}</strong>
                    </div>
                    <div className="compact-metric-tile">
                      <span>Maximum</span>
                      <strong>{formatOptionalNumber(selectedRow.maxStock)}</strong>
                    </div>
                    <div className="compact-metric-tile">
                      <span>Refill</span>
                      <strong>{formatNumber(selectedRow.requiredQty)}</strong>
                    </div>
                    <div className="compact-metric-tile">
                      <span>Unit Cost</span>
                      <strong>{formatOptionalNumber(selectedRow.unitCost)}</strong>
                    </div>
                    <div className="compact-metric-tile">
                      <span>Stock Value</span>
                      <strong>
                        {formatValueWithCoverage(
                          selectedRow.stockValue,
                          selectedRow.stockValue === null ? 1 : 0
                        )}
                      </strong>
                    </div>
                    <div className="compact-metric-tile">
                      <span>Movement Lines</span>
                      <strong>{formatNumber(selectedRow.lineCount)}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <div className="compact-metric-grid">
                  <div className="compact-metric-tile">
                    <span>Visible Rows</span>
                    <strong>{formatNumber(filteredStockRows.length)}</strong>
                  </div>
                  <div className="compact-metric-tile">
                    <span>Closing By UOM</span>
                    <strong>{formatQuantityGroupCount(visibleStockMovementSummary.closingEntries)}</strong>
                  </div>
                  <div className="compact-metric-tile">
                    <span>Refill By UOM</span>
                    <strong>{formatQuantityGroupCount(visibleStockMovementSummary.refillEntries)}</strong>
                  </div>
                  <div className="compact-metric-tile">
                    <span>Visible Value</span>
                    <strong>
                      {formatValueWithCoverage(
                        visibleStockTotals.stockValue,
                        stockHealthSummary.missingCostItems
                      )}
                    </strong>
                  </div>
                </div>
              )}
            </section>
          </div>

          <DataTable
            columns={stockTableMode === "sheet" ? stockSheetColumns : stockFullColumns}
            rows={filteredStockRows}
            rowKey={(row) => row.id}
            pageSize={20}
            resetKey={`${reportMode}-${filters.period}-${range.startDate}-${range.endDate}-${stockFilterMode}-${stockTableMode}-${search}`}
            emptyMessage="No stock rows fit the current period, filter, or search."
            onRowClick={(row) => setSelectedItemId(row.id)}
            rowClassName={(row) => (row.id === selectedItemId ? "row-selected" : "")}
            rowAriaLabel={(row) => `Open stock detail for ${row.name}`}
          />
        </>
      ) : null}

      {reportMode === "receipts" ? (
        <DataTable
          columns={receiptColumns}
          rows={filteredReceiptRows}
          rowKey={(row) => row.id}
          pageSize={20}
          resetKey={`${reportMode}-${filters.period}-${range.startDate}-${range.endDate}-${search}`}
          emptyMessage="No receipt rows fit the current period, filter, or search."
        />
      ) : null}

      {reportMode === "category-summary" ? (
        <>
          <div className="card card-compact">
            <div className="card-header">
              <h2>Stock By Category</h2>
              <p>Select a category.</p>
            </div>

            <DataTable
              columns={categorySummaryColumns}
              rows={filteredCategoryRows}
              rowKey={(row) => row.id}
              pageSize={20}
              resetKey={`${reportMode}-${filters.period}-${range.startDate}-${range.endDate}-${selectedCategoryFilter}-${search}`}
              emptyMessage="No category rows fit the current period or search."
              onRowClick={(row) => setActiveCategory(row.category)}
              rowClassName={(row) => (row.category === selectedCategoryName ? "row-selected" : "")}
              rowAriaLabel={(row) => `Show items under ${row.category}`}
            />
          </div>

          <div className="card card-compact">
            <div className="card-header">
              <h2>{selectedCategoryName ? `Items In ${selectedCategoryName}` : "Category Items"}</h2>
              <p>
                {selectedCategoryName
                  ? `${formatNumber(categoryItemRows.length)} item(s).`
                  : "Choose a category."}
              </p>
            </div>

            <DataTable
              columns={categoryItemColumns}
              rows={categoryItemRows}
              rowKey={(row) => row.id}
              pageSize={20}
              resetKey={`${reportMode}-items-${selectedCategoryName}-${filters.period}-${range.startDate}-${range.endDate}`}
              emptyMessage="Select one category above to list its item detail."
            />
          </div>
        </>
      ) : null}

      {reportMode === "issues" ? (
        <>
          <div className="card card-compact">
            <div className="card-header">
              <h2>Issued By Department</h2>
            </div>

            <DataTable
              columns={issueColumns}
              rows={filteredIssueRows}
              rowKey={(row) => row.id}
              pageSize={12}
              resetKey={`${reportMode}-${filters.period}-${range.startDate}-${range.endDate}-${search}`}
              emptyMessage="No department issues fit the current period or search."
            />
          </div>

          <div className="card card-compact">
            <div className="card-header card-header-spread">
              <div>
                <h2>Issued Item Detail</h2>
                <p>{issueSelectionLabel}</p>
              </div>
              <div className="toolbar">
                <button
                  className="button button-secondary button-small"
                  onClick={() => setShowIssueDepartmentPicker((currentValue) => !currentValue)}
                  type="button"
                >
                  {showIssueDepartmentPicker
                    ? "Hide Departments"
                    : `Choose Departments (${formatNumber(selectedIssueRows.length)})`}
                </button>
                {showIssueDepartmentPicker ? (
                  <>
                    <button
                      className="button button-secondary button-small"
                      onClick={handleSelectAllIssueDepartments}
                      type="button"
                    >
                      All
                    </button>
                    <button
                      className="button button-secondary button-small"
                      onClick={handleClearIssueDepartments}
                      type="button"
                    >
                      Clear
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {showIssueDepartmentPicker ? (
              <div className="report-selector-grid">
                {filteredIssueRows.map((row) => (
                  <button
                    key={row.id}
                    className={`report-selector-chip ${
                      selectedIssueDepartmentIds.includes(row.id) ? "is-active" : ""
                    }`}
                    onClick={() => handleToggleIssueDepartment(row.id)}
                    type="button"
                  >
                    {row.departmentName}
                  </button>
                ))}
              </div>
            ) : null}

            <DataTable
              columns={issueBreakdownColumns}
              rows={filteredIssueBreakdownRows}
              rowKey={(row) => row.id}
              pageSize={12}
              resetKey={`${reportMode}-detail-${selectedIssueDepartmentIds.join(",")}-${search}`}
              emptyMessage="Select one or more departments to open the issued-item detail."
            />
          </div>
        </>
      ) : null}

      {reportMode === "item-movement" ? (
        <>
          <div className="card card-compact">
            <div className="card-header">
              <h2>Departments Involved In This Item</h2>
            </div>

            <DataTable
              columns={itemMovementDepartmentColumns}
              rows={itemMovementDepartmentRows}
              rowKey={(row) => row.id}
              pageSize={12}
              resetKey={`${reportMode}-department-${selectedMovementItemId}-${filters.period}-${range.startDate}-${range.endDate}`}
              emptyMessage="Select one item with movement in this period."
            />
          </div>

          <div className="card card-compact">
            <div className="card-header">
              <h2>Movement Lines For This Item</h2>
            </div>

            <DataTable
              columns={itemMovementLineColumns}
              rows={itemMovementLineRows}
              rowKey={(row) => row.id}
              pageSize={12}
              resetKey={`${reportMode}-lines-${selectedMovementItemId}-${filters.period}-${range.startDate}-${range.endDate}`}
              emptyMessage="Select one item with movement in this period."
            />
          </div>
        </>
      ) : null}

      {reportMode === "losses" ? (
        <DataTable
          columns={lossColumns}
          rows={filteredLossRows}
          rowKey={(row) => row.id}
          pageSize={20}
          resetKey={`${reportMode}-${filters.period}-${range.startDate}-${range.endDate}-${search}`}
          emptyMessage="No spoilage or disposal lines fit the current period or search."
        />
      ) : null}

      {reportMode === "comparison" ? (
        <DataTable
          columns={comparisonColumns}
          rows={comparisonRows}
          rowKey={(row) => row.id}
          emptyMessage="No comparison metrics are available for the selected periods."
        />
      ) : null}
    </section>
  );
}
