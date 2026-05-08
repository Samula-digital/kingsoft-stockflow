import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";

import * as XLSX from "../src/vendor/xlsx.js";
import { getAppStateRecord } from "../server/store.js";
import {
  calculateFinancePeriodRows,
  calculateIssueDepartmentBreakdownRows,
  calculateIssueDepartmentReportRows,
  calculateLossReportRows,
  calculatePeriodMovementSummary,
  calculateReceiptReportRows,
  shouldShowOperationalItemRow,
} from "../src/utils/calculations.js";
import { formatDateRange } from "../src/utils/formatters.js";

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function toDateValue(date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate()
  )}`;
}

function getPreviousMonthValue() {
  const today = new Date();
  const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return `${previousMonth.getFullYear()}-${padDatePart(previousMonth.getMonth() + 1)}`;
}

function getMonthRange(monthValue) {
  const match = String(monthValue ?? "").trim().match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    throw new Error("Use --month YYYY-MM, for example --month 2026-04.");
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const startDate = new Date(year, monthIndex, 1);
  const endDate = new Date(year, monthIndex + 1, 0);

  return {
    period: "monthly",
    startDate: toDateValue(startDate),
    endDate: toDateValue(endDate),
  };
}

function parseArgs(argv) {
  const args = {
    month: "",
    from: "",
    to: "",
    out: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--month") {
      args.month = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (value === "--from") {
      args.from = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (value === "--to") {
      args.to = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (value === "--out") {
      args.out = argv[index + 1] ?? "";
      index += 1;
    }
  }

  if (args.from || args.to) {
    const startDate = args.from || args.to;
    const endDate = args.to || args.from;
    return {
      range: {
        period: "custom",
        startDate: startDate <= endDate ? startDate : endDate,
        endDate: startDate <= endDate ? endDate : startDate,
      },
      outputPath: args.out,
    };
  }

  return {
    range: getMonthRange(args.month || getPreviousMonthValue()),
    outputPath: args.out,
  };
}

function formatOptionalNumber(value) {
  return value === null || value === undefined ? "" : value;
}

function getStatusLabel(row) {
  if (row.negative) return "Negative closing";
  if (row.closing === 0) return "Zero closing";
  if (row.belowMinStock) return "Below minimum";
  if (row.aboveMaxStock) return "Above maximum";
  if (row.hasActivity) return "Moved in period";
  return "No movement";
}

function sumRows(rows, selector) {
  return rows.reduce((sum, row) => sum + (Number(selector(row)) || 0), 0);
}

function sanitizeSheetName(name, fallback = "Sheet") {
  const cleaned = String(name ?? "")
    .replace(/[\\/?*\[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || fallback).slice(0, 31);
}

function appendSheet(workbook, name, rows) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(name));
}

function buildStockRows(rows) {
  return rows.map((row) => [
    row.code,
    row.name,
    row.category,
    row.uom,
    formatOptionalNumber(row.unitCost),
    row.opening,
    row.inQty,
    row.adjQty,
    row.availableQty,
    row.outQty,
    row.closing,
    row.requiredQty,
    formatOptionalNumber(row.stockValue),
    formatOptionalNumber(row.minStock),
    formatOptionalNumber(row.maxStock),
    getStatusLabel(row),
    row.lineCount,
  ]);
}

function buildWorkbook({ state, range }) {
  const workbook = XLSX.utils.book_new();
  const rows = calculateFinancePeriodRows(state.items, state.movements, range).filter(
    shouldShowOperationalItemRow
  );
  const outstandingRows = rows.filter((row) => Number(row.closing) > 0);
  const reviewRows = rows.filter((row) => row.needsReview || row.stockValue === null);
  const receiptRows = calculateReceiptReportRows(state.items, state.movements, range);
  const issueRows = calculateIssueDepartmentReportRows(
    state.departments,
    state.items,
    state.movements,
    range
  );
  const issueBreakdownRows = calculateIssueDepartmentBreakdownRows(
    state.departments,
    state.items,
    state.movements,
    range
  );
  const lossRows = calculateLossReportRows(state.items, state.departments, state.movements, range);
  const periodSummary = calculatePeriodMovementSummary(state.items, state.movements, range);
  const periodLabel = formatDateRange(range.startDate, range.endDate);
  const stockValue = sumRows(rows, (row) => row.stockValue);
  const outstandingValue = sumRows(outstandingRows, (row) => row.stockValue);
  const missingStockCosts = rows.filter((row) => row.stockValue === null).length;
  const missingMovementCosts =
    periodSummary.receiptMissingCostLines +
    periodSummary.issueMissingCostLines +
    periodSummary.lossMissingCostLines;
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

  appendSheet(workbook, "Summary", [
    ["Company", state.hotelName || "Stock Flow"],
    ["System", state.productName || "Stock Flow"],
    ["Period", periodLabel],
    ["Generated", new Date().toLocaleString()],
    [],
    ["Metric", "Value", "Note"],
    ["Items Shown", rows.length, "operational item rows"],
    ["Stock Value", stockValue, "closing stock value"],
    ["Outstanding Stock", outstandingRows.length, `${outstandingValue} value`],
    ["Received Value", periodSummary.receivedValue, `${periodSummary.receiptLines} receipt lines`],
    ["Issued Value", periodSummary.issuedValue, `${periodSummary.issueLines} issue lines`],
    ["Departments Served", issueRows.length, "departments with issues"],
    [
      "Cost Check",
      missingStockCosts || missingMovementCosts ? "Incomplete" : "Complete",
      `${missingStockCosts} stock item(s), ${missingMovementCosts} movement line(s) missing cost`,
    ],
  ]);

  appendSheet(workbook, "Stock Position", [
    ["Period", periodLabel],
    [],
    stockColumns,
    ...buildStockRows(rows),
  ]);

  appendSheet(workbook, "Outstanding Stock", [
    ["Period", periodLabel],
    [],
    stockColumns,
    ...buildStockRows(outstandingRows),
  ]);

  appendSheet(workbook, "Needs Review", [
    ["Period", periodLabel],
    [],
    stockColumns,
    ...buildStockRows(reviewRows),
  ]);

  appendSheet(workbook, "Received", [
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
      formatOptionalNumber(row.averageUnitCost),
      row.missingCostLines,
      row.referenceCount,
      row.lineCount,
    ]),
  ]);

  appendSheet(workbook, "Issued Departments", [
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
  ]);

  appendSheet(workbook, "Issued Item Detail", [
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
  ]);

  appendSheet(workbook, "Spoilt Disposal", [
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
  ]);

  return {
    workbook,
    summary: {
      periodLabel,
      rows: rows.length,
      stockValue,
      outstandingRows: outstandingRows.length,
      outstandingValue,
      receivedValue: periodSummary.receivedValue,
      issuedValue: periodSummary.issuedValue,
      receiptLines: periodSummary.receiptLines,
      issueLines: periodSummary.issueLines,
      missingStockCosts,
      missingMovementCosts,
    },
  };
}

async function main() {
  const { range, outputPath } = parseArgs(process.argv.slice(2));
  const { state } = await getAppStateRecord();
  const { workbook, summary } = buildWorkbook({ state, range });
  const safeRange = `${range.startDate}-to-${range.endDate}`;
  const finalOutputPath = outputPath
    ? resolve(outputPath)
    : resolve(process.cwd(), "reports", `stockflow-monthly-report-${safeRange}.xlsx`);

  await fs.mkdir(dirname(finalOutputPath), { recursive: true });
  const workbookBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  await fs.writeFile(finalOutputPath, workbookBuffer);

  console.log(
    JSON.stringify(
      {
        outputPath: finalOutputPath,
        ...summary,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
