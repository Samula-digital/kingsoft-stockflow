import fs from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";

import {
  importFullWorkbookInState,
} from "../server/appState.js";
import { getAppStateRecord, getDatabasePath, saveAppState } from "../server/store.js";
import {
  filterWorkbookPreviewByDateRange,
  loadWorkbookFromFile,
  parseDailyStoresWorkbook,
} from "../src/utils/excelImport.js";
import { hydrateWorkbookIssueDepartmentMap } from "../src/utils/workbookDepartments.js";

function parseArgs(argv) {
  const args = {
    apply: false,
    filePath: "",
    dateFrom: "",
    dateTo: "",
    includeItemSetup: false,
    replaceWorkbookHistory: false,
    retireMissingWorkbookItems: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--apply") {
      args.apply = true;
      continue;
    }

    if (value === "--replace-workbook-history") {
      args.replaceWorkbookHistory = true;
      continue;
    }

    if (value === "--include-item-setup") {
      args.includeItemSetup = true;
      continue;
    }

    if (value === "--retire-missing-workbook-items") {
      args.retireMissingWorkbookItems = true;
      continue;
    }

    if (value === "--from") {
      args.dateFrom = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (value === "--to") {
      args.dateTo = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (!args.filePath) {
      args.filePath = value;
    }
  }

  if (!args.filePath) {
    throw new Error(
      'Provide the workbook path. Example: node scripts/import-workbook.mjs "/path/to/workbook.xlsx" --from 2026-01-01 --to 2026-03-31 --replace-workbook-history --apply'
    );
  }

  return {
    ...args,
    filePath: resolve(args.filePath),
  };
}

function isWorkbookMovement(movement) {
  return String(movement?.sourceType ?? "").trim().toLowerCase() === "excel-daily-template";
}

function summarizeWorkbookWarnings(warnings = []) {
  if (!warnings.length) return "";

  const levelFixCount = warnings.filter((warning) =>
    warning.includes("maximum stock below minimum stock")
  ).length;

  if (levelFixCount === warnings.length) {
    return `${levelFixCount} stock-level fixes were normalized.`;
  }

  if (levelFixCount > 0) {
    return `${warnings.length} warnings found, including ${levelFixCount} stock-level fixes.`;
  }

  return `${warnings.length} warnings found.`;
}

function findBalanceOnlySheets(sheetSummaries = []) {
  return sheetSummaries
    .filter(
      (sheet) =>
        sheet.openingCount > 0 &&
        sheet.movementCount === 0 &&
        sheet.unmatchedCount === 0
    )
    .map((sheet) => sheet.sheetName);
}

function buildDepartmentRequisitionStartNumbers(departments = []) {
  return Object.fromEntries(
    departments.map((department) => [
      department.id,
      Math.max(1, Number(department.requisitionStartNumber) || 1),
    ])
  );
}

async function backupJsonStoreIfPossible() {
  const databasePath = String(await getDatabasePath()).trim();

  if (!databasePath || extname(databasePath).toLowerCase() !== ".json") {
    return "";
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(
    dirname(databasePath),
    `kingsoft-stockflow.backup-${timestamp}-pre-cli-workbook-import.json`
  );

  await fs.copyFile(databasePath, backupPath);
  return backupPath;
}

async function main() {
  const {
    apply,
    filePath,
    dateFrom,
    dateTo,
    includeItemSetup,
    replaceWorkbookHistory,
    retireMissingWorkbookItems,
  } = parseArgs(
    process.argv.slice(2)
  );
  const { state } = await getAppStateRecord();
  const fileBuffer = await fs.readFile(filePath);
  const workbookFile = {
    arrayBuffer: async () => fileBuffer,
  };

  const { workbook, xlsxModule } = await loadWorkbookFromFile(workbookFile);
  const mainStoreId =
    state.departments.find((department) => department.isMainStore)?.id ??
    state.departments[0]?.id ??
    "";
  const fallbackIssueDepartmentId =
    state.departments.find((department) => department.isMainStore !== true)?.id ??
    state.departments[0]?.id ??
    "";
  const issueDepartmentMap = hydrateWorkbookIssueDepartmentMap({}, state.departments);

  const preview = parseDailyStoresWorkbook(workbook, state.items, {
    xlsx: xlsxModule,
    fileName: basename(filePath),
    receiveDepartmentId: mainStoreId,
    issueDepartmentId: fallbackIssueDepartmentId,
    issueDepartmentMap,
    departmentRequisitionStartNumbers: buildDepartmentRequisitionStartNumbers(state.departments),
    enteredBy: "Workbook Import",
  });
  const filteredPreview = filterWorkbookPreviewByDateRange(preview, dateFrom, dateTo) ?? preview;
  const openingSnapshot =
    filteredPreview.openingSnapshots.find(
      (entry) => entry.date === filteredPreview.selectedDateFrom
    ) ?? filteredPreview.openingSnapshots[0];

  const itemRows = filteredPreview.itemProfileRows.map((row) => ({
    itemId: row.itemId,
    code: row.code,
    name: row.name,
    category: row.category,
    uom: row.uom,
    openingBalance: row.openingBalance ?? 0,
    unitCost: row.unitCost,
    sellingPrice: null,
    minStock: row.minStock,
    maxStock: row.maxStock,
    isActive: true,
  }));
  const existingItemIds = new Set(state.items.map((item) => item.id));
  const requiredItemIds = new Set([
    ...(openingSnapshot?.rows ?? []).map((row) => row.itemId),
    ...filteredPreview.movementRows.map((row) => row.itemId),
  ]);
  const missingDependencyIds = Array.from(requiredItemIds).filter(
    (itemId) => itemId && !existingItemIds.has(itemId)
  );

  if (!includeItemSetup && missingDependencyIds.length) {
    throw new Error(
      `${missingDependencyIds.length} workbook item(s) are not in the current item master. ` +
        "Run again with --include-item-setup if you intentionally want the workbook to add them."
    );
  }

  const movementRows = filteredPreview.movementRows.map((row) => ({
    ...row,
    departmentId:
      row.departmentId || (row.type === "OUT" ? fallbackIssueDepartmentId : mainStoreId),
    departmentMappingVersion:
      row.type === "OUT" ? "category-v1" : row.departmentMappingVersion,
    enteredBy: "Workbook Import",
  }));

  const baseState = replaceWorkbookHistory
    ? {
        ...state,
        movements: state.movements.filter((movement) => !isWorkbookMovement(movement)),
      }
    : state;

  const importResult = importFullWorkbookInState(baseState, {
    itemRows: includeItemSetup ? itemRows : [],
    openingRows: openingSnapshot?.rows ?? [],
    asOfDate: openingSnapshot?.date ?? baseState.asOfDate,
    movementRows,
    movementMode: "append",
    retireMissingWorkbookItems: includeItemSetup && retireMissingWorkbookItems,
  });
  const nextState = importResult.nextState;
  let backupPath = "";

  if (apply) {
    backupPath = await backupJsonStoreIfPossible();
    await saveAppState(nextState);
  }

  console.log(
    JSON.stringify(
      {
        applied: apply,
        workbook: basename(filePath),
        range: {
          from: filteredPreview.selectedDateFrom || filteredPreview.availableDates[0] || null,
          to:
            filteredPreview.selectedDateTo ||
            filteredPreview.availableDates.at(-1) ||
            null,
        },
        counts: {
          items: importResult.itemCount,
          openings: importResult.openingCount,
          movements: importResult.movementCount,
          skippedMovements: importResult.skippedMovementCount,
          removedWorkbookMovements: replaceWorkbookHistory
            ? state.movements.length - baseState.movements.length
            : 0,
          warnings: filteredPreview.warnings.length,
          warningSummary: summarizeWorkbookWarnings(filteredPreview.warnings),
          unmatchedRows: filteredPreview.unmatchedRows.length,
          balanceOnlySheets: findBalanceOnlySheets(filteredPreview.sheetSummaries),
          finalMovementCount: nextState.movements.length,
          retiredItems: importResult.retiredItemCount,
        },
        itemSetupIncluded: includeItemSetup,
        backupPath,
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
