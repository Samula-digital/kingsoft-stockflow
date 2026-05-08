import React, { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import BrandMark from "../components/BrandMark";
import DataTable from "../components/DataTable";
import StatusPill from "../components/StatusPill";
import TextPromptDialog from "../components/TextPromptDialog";
import { STANDARD_ITEM_CATEGORIES } from "../data/itemCategories";
import { buildBrandStyles, normalizeHexColor } from "../utils/branding";
import {
  filterWorkbookPreviewByScope,
  filterWorkbookPreviewByDateRange,
  loadWorkbookFromFile,
  parseDailyStoresWorkbook,
  readWorkbookSheetRows,
} from "../utils/excelImport";
import {
  departmentImportTemplateColumns,
  itemMasterTemplateColumns,
  movementImportTemplateColumns,
  openingBalanceTemplateColumns,
  prepareOpeningBalanceImportRows,
  prepareDepartmentImportRows,
  prepareHistoricalMovementImportRows,
  prepareItemMasterImportRows,
} from "../utils/importTransforms";
import {
  createDepartmentCode,
  createItemCode,
  formatDate,
  formatNumber,
  normalizeSearchValue,
  searchItemRecords,
} from "../utils/formatters";
import { downloadWorkbook } from "../utils/export";
import { getPasswordPolicyHint } from "../utils/passwordPolicy.js";
import {
  hydrateWorkbookIssueDepartmentMap,
  resolveWorkbookIssueDepartmentIdByCategory,
  WORKBOOK_ISSUE_DEPARTMENT_MAPPING_VERSION,
} from "../utils/workbookDepartments.js";
import {
  validateDepartmentForm,
  validateEmailAddress,
  validateItemForm,
  validateUserAccountForm,
} from "../utils/validation";

const adminSections = [
  {
    id: "system",
    label: "System",
    hint: "Branding, opening date, and finance email",
  },
  {
    id: "accounts",
    label: "Accounts",
    hint: "Manage sign-in access",
  },
  {
    id: "departments",
    label: "Departments",
    hint: "Add or edit departments",
  },
  {
    id: "items",
    label: "Items",
    hint: "Manage item master records",
  },
  {
    id: "imports",
    label: "Imports",
    hint: "Bring in workbook data",
  },
];

const commonUomOptions = [
  "PCS",
  "PKT",
  "BOX",
  "BTL",
  "TIN",
  "BAG",
  "ROLL",
  "LTR",
  "ML",
  "KGS",
];

const commonCategoryOptions = STANDARD_ITEM_CATEGORIES;

function buildItemForm(item, items) {
  if (!item) {
    return {
      code: createItemCode(items),
      name: "",
      category: "",
      uom: "",
      openingBalance: 0,
      unitCost: "",
      sellingPrice: "",
      minStock: "",
      maxStock: "",
      isActive: true,
    };
  }

  return {
    code: item.code,
    name: item.name,
    category: item.category ?? "",
    uom: item.uom,
    openingBalance: item.openingBalance,
    unitCost: item.unitCost ?? "",
    sellingPrice: item.sellingPrice ?? "",
    minStock: item.minStock ?? "",
    maxStock: item.maxStock ?? "",
    isActive: item.isActive !== false,
  };
}

function buildDepartmentForm(department, departments) {
  if (!department) {
    return {
      code: createDepartmentCode(departments),
      name: "",
      requisitionStartNumber: "1",
      isMainStore: false,
      isActive: true,
    };
  }

  return {
    code: department.code,
    name: department.name,
    requisitionStartNumber: String(department.requisitionStartNumber ?? 1),
    isMainStore: Boolean(department.isMainStore),
    isActive: department.isActive !== false,
  };
}

function buildBulkItemEditForm() {
  return {
    category: "",
    openingBalance: "",
    unitCost: "",
    sellingPrice: "",
    minStock: "",
    maxStock: "",
    isActiveAction: "keep",
  };
}

function getDefaultReceiveDepartmentId(departments) {
  return departments.find((department) => department.isMainStore)?.id ?? departments[0]?.id ?? "";
}

function getDefaultIssueDepartmentId(departments) {
  return departments.find((department) => !department.isMainStore)?.id ?? departments[0]?.id ?? "";
}

function buildDepartmentRequisitionStartNumbers(departments = []) {
  return Object.fromEntries(
    departments.map((department) => [
      department.id,
      Math.max(1, Number(department.requisitionStartNumber) || 1),
    ])
  );
}

function toWorkbookBoolean(value) {
  return value ? "TRUE" : "FALSE";
}

function describeWorkbookImportChoices(choices) {
  const labels = [
    choices.includeWorkbookItems ? "item profiles" : "",
    choices.includeWorkbookOpenings ? "opening balances" : "",
    choices.includeWorkbookMovements ? "movement history" : "",
  ].filter(Boolean);

  if (!labels.length) return "nothing";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]}, and ${labels[2]}`;
}

function summarizeWorkbookWarnings(warnings = []) {
  if (!warnings.length) return "";

  const maxBelowMinCount = warnings.filter((warning) =>
    warning.includes("maximum stock below minimum stock")
  ).length;

  if (maxBelowMinCount === warnings.length) {
    return `${formatNumber(maxBelowMinCount)} stock-level fixes were normalized during import.`;
  }

  if (maxBelowMinCount > 0) {
    return `${formatNumber(warnings.length)} workbook warnings found, including ${formatNumber(
      maxBelowMinCount
    )} stock-level fixes.`;
  }

  return `${formatNumber(warnings.length)} workbook warnings found.`;
}

function formatBalanceOnlySheetNote(sheetSummaries = []) {
  const balanceOnlySheets = sheetSummaries.filter(
    (sheet) => sheet.openingCount > 0 && sheet.movementCount === 0 && sheet.unmatchedCount === 0
  );

  if (!balanceOnlySheets.length) return "";

  const labels = balanceOnlySheets.map((sheet) => sheet.sheetName);
  const visibleLabels =
    labels.length <= 3 ? labels.join(", ") : `${labels.slice(0, 3).join(", ")} +${labels.length - 3} more`;

  return `Balance-only sheets: ${visibleLabels}. No receipt or issue lines were found on those dates.`;
}

function buildWorkbookImportSupportMessage({
  dateFrom,
  dateTo,
  result,
  importConfig,
  selectedWorkbookItemIds,
  preview,
}) {
  const issueMapped =
    preview?.movementRows?.some((row) => row.type === "OUT") ?? false;
  const parts = [
    `Applied workbook data for ${dateFrom} to ${dateTo}: ${result.itemCount} item profiles, ${result.openingCount} opening balances, and ${result.movementCount} movement lines.`,
  ];

  if (importConfig.workbookCategoryFilter !== "all") {
    parts.push(`Category scope: ${importConfig.workbookCategoryFilter}.`);
  }

  if (selectedWorkbookItemIds.length) {
    parts.push(`Item scope: ${selectedWorkbookItemIds.length} selected item(s).`);
  }

  if (issueMapped) {
    parts.push("Issue lines were mapped by workbook section/category where possible.");
  }

  if (!importConfig.includeWorkbookItems) {
    parts.push("Existing item profiles were preserved.");
  }

  if (result.skippedMovementCount) {
    parts.push(`${result.skippedMovementCount} duplicate movement lines were skipped.`);
  }

  if (result.retiredItemCount) {
    parts.push(
      `${result.retiredItemCount} older app-only item records were retired so the workbook controls active item detail.`
    );
  }

  const actions = [];

  if (importConfig.includeWorkbookOpenings && result.openingCount) {
    actions.push({ id: "open_stock", label: "Review Stock" });
  }

  if (importConfig.includeWorkbookMovements && result.movementCount) {
    actions.push({ id: "open_finance", label: "Review Finance", variant: "secondary" });
  }

  if (importConfig.includeWorkbookItems && result.itemCount) {
    actions.push({ id: "open_items", label: "Review Items", variant: "secondary" });
  }

  return { text: parts.join(" "), actions };
}

function countConfiguredItemOptionalFields(item) {
  if (!item || typeof item !== "object") return 0;

  const checks = [
    Number(item.openingBalance ?? 0) > 0,
    item.unitCost !== "" && item.unitCost !== null && item.unitCost !== undefined,
    item.sellingPrice !== "" && item.sellingPrice !== null && item.sellingPrice !== undefined,
    item.minStock !== "" && item.minStock !== null && item.minStock !== undefined,
    item.maxStock !== "" && item.maxStock !== null && item.maxStock !== undefined,
  ];

  return checks.filter(Boolean).length;
}

export default function AdminView({
  productName,
  hotelName,
  brandLogoUrl,
  brandAccentColor,
  brandSidebarColor,
  asOfDate,
  financeEmail,
  departments,
  stockRows,
  movementRows,
  users,
  currentUser,
  onApplyOpeningBalances,
  onImportMovements,
  onImportFullWorkbook,
  onImportItems,
  onImportDepartments,
  onSaveItem,
  onSaveDepartment,
  onCreateUser,
  onApproveUser,
  onRejectUser,
  onResetUserPassword,
  onSaveSettings,
  requestedSection,
  onOpenModule,
}) {
  const [activeSection, setActiveSection] = useState("system");
  const [selectedItemId, setSelectedItemId] = useState(stockRows[0]?.id ?? "");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(departments[0]?.id ?? "");
  const [showItemErrors, setShowItemErrors] = useState(false);
  const [showDepartmentErrors, setShowDepartmentErrors] = useState(false);
  const [itemErrors, setItemErrors] = useState({});
  const [departmentErrors, setDepartmentErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [itemSearch, setItemSearch] = useState("");
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [settingsErrors, setSettingsErrors] = useState({});
  const [itemWorkspaceView, setItemWorkspaceView] = useState("browse");
  const [departmentWorkspaceView, setDepartmentWorkspaceView] = useState("browse");
  const [settings, setSettings] = useState({
    productName,
    hotelName,
    brandLogoUrl,
    brandAccentColor,
    brandSidebarColor,
    asOfDate,
    financeEmail,
  });
  const [importBusy, setImportBusy] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [structuredImportPreview, setStructuredImportPreview] = useState(null);
  const [workbookMovementSearch, setWorkbookMovementSearch] = useState("");
  const [workbookMovementTypeFilter, setWorkbookMovementTypeFilter] = useState("all");
  const [workbookItemSearch, setWorkbookItemSearch] = useState("");
  const [selectedWorkbookItemIds, setSelectedWorkbookItemIds] = useState([]);
  const [workbookPreviewPanel, setWorkbookPreviewPanel] = useState("summary");
  const [importConfig, setImportConfig] = useState({
    openingDate: asOfDate,
    workbookDateFrom: asOfDate,
    workbookDateTo: asOfDate,
    workbookCategoryFilter: "all",
    receiveDepartmentId: getDefaultReceiveDepartmentId(departments),
    issueDepartmentId: getDefaultIssueDepartmentId(departments),
    issueDepartmentMap: hydrateWorkbookIssueDepartmentMap({}, departments),
    enteredBy: "Excel Import",
    movementMode: "append",
    includeWorkbookItems: false,
    includeWorkbookOpenings: true,
    includeWorkbookMovements: true,
    structuredImportType: "items",
    structuredMovementMode: "append",
    structuredApplyScope: "all",
  });
  const [accountForm, setAccountForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "store",
    forcePasswordReset: true,
  });
  const [accountErrors, setAccountErrors] = useState({});
  const [showAccountErrors, setShowAccountErrors] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [itemBusy, setItemBusy] = useState(false);
  const [departmentBusy, setDepartmentBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [showItemAdvancedFields, setShowItemAdvancedFields] = useState(false);
  const [resetPasswordDialog, setResetPasswordDialog] = useState({
    userId: "",
    userName: "",
    password: "",
    error: "",
    isBusy: false,
  });
  const [selectedItemIds, setSelectedItemIds] = useState([]);
  const [bulkItemEditForm, setBulkItemEditForm] = useState(() => buildBulkItemEditForm());
  const [bulkItemEditBusy, setBulkItemEditBusy] = useState(false);
  const passwordPolicyHint = getPasswordPolicyHint();

  const selectedItem = stockRows.find((item) => item.id === selectedItemId) ?? null;
  const selectedDepartment =
    departments.find((department) => department.id === selectedDepartmentId) ?? null;
  const isEditingItem = Boolean(selectedItemId);
  const isEditingDepartment = Boolean(selectedDepartmentId);
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const activeItemCount = useMemo(
    () => stockRows.filter((item) => item.isActive !== false).length,
    [stockRows]
  );
  const inactiveItemCount = stockRows.length - activeItemCount;
  const activeItemsMissingCostCount = useMemo(
    () =>
      stockRows.filter(
        (item) => item.isActive !== false && (item.unitCost === null || item.unitCost === undefined)
      ).length,
    [stockRows]
  );
  const activeItemsWithoutLevelsCount = useMemo(
    () =>
      stockRows.filter(
        (item) => item.isActive !== false && item.minStock === null && item.maxStock === null
      ).length,
    [stockRows]
  );
  const activeItemsZeroOpeningCount = useMemo(
    () =>
      stockRows.filter(
        (item) => item.isActive !== false && Number(item.openingBalance) === 0
      ).length,
    [stockRows]
  );
  const itemsWithLimitsCount = useMemo(
    () => stockRows.filter((item) => item.minStock !== null || item.maxStock !== null).length,
    [stockRows]
  );
  const [itemForm, setItemForm] = useState(() => buildItemForm(selectedItem, stockRows));
  const [departmentForm, setDepartmentForm] = useState(() =>
    buildDepartmentForm(selectedDepartment, departments)
  );
  const itemOptionalFieldCount = useMemo(
    () => countConfiguredItemOptionalFields(itemForm),
    [itemForm]
  );

  useEffect(() => {
    setSettings({
      productName,
      hotelName,
      brandLogoUrl,
      brandAccentColor,
      brandSidebarColor,
      asOfDate,
      financeEmail,
    });
  }, [
    asOfDate,
    brandAccentColor,
    brandLogoUrl,
    brandSidebarColor,
    financeEmail,
    hotelName,
    productName,
  ]);

  useEffect(() => {
    if (requestedSection?.sectionId) {
      setActiveSection(requestedSection.sectionId);
    }
  }, [requestedSection]);

  useEffect(() => {
    setImportConfig((currentConfig) => ({
      ...currentConfig,
      openingDate: currentConfig.openingDate || asOfDate,
      workbookDateFrom: currentConfig.workbookDateFrom || asOfDate,
      workbookDateTo: currentConfig.workbookDateTo || asOfDate,
      receiveDepartmentId:
        currentConfig.receiveDepartmentId || getDefaultReceiveDepartmentId(departments),
      issueDepartmentId:
        currentConfig.issueDepartmentId || getDefaultIssueDepartmentId(departments),
      issueDepartmentMap: hydrateWorkbookIssueDepartmentMap(
        currentConfig.issueDepartmentMap,
        departments
      ),
    }));
  }, [asOfDate, departments]);

  const currentSection = adminSections.find((section) => section.id === activeSection);

  function handleMessageAction(actionId) {
    if (actionId === "open_stock") {
      onOpenModule?.("stock");
      return;
    }

    if (actionId === "open_finance") {
      onOpenModule?.("finance");
      return;
    }

    if (actionId === "open_items") {
      setActiveSection("items");
    }
  }
  const dateFilteredWorkbookPreview = useMemo(
    () =>
      filterWorkbookPreviewByDateRange(
        importPreview,
        importConfig.workbookDateFrom,
        importConfig.workbookDateTo
      ),
    [importConfig.workbookDateFrom, importConfig.workbookDateTo, importPreview]
  );
  const workbookCategoryOptions = useMemo(() => {
    const categories = new Set(
      (dateFilteredWorkbookPreview?.itemProfileRows ?? [])
        .map((row) => String(row.category ?? "").trim())
        .filter(Boolean)
    );

    return Array.from(categories).sort((left, right) => left.localeCompare(right));
  }, [dateFilteredWorkbookPreview?.itemProfileRows]);
  const workbookCategoryScopedItemIds = useMemo(
    () =>
      new Set(
        (dateFilteredWorkbookPreview?.itemProfileRows ?? [])
          .filter(
            (row) =>
              importConfig.workbookCategoryFilter === "all" ||
              row.category === importConfig.workbookCategoryFilter
          )
          .map((row) => row.itemId)
      ),
    [dateFilteredWorkbookPreview?.itemProfileRows, importConfig.workbookCategoryFilter]
  );
  const workbookSelectableItems = useMemo(() => {
    const query = normalizeSearchValue(workbookItemSearch);

    return (dateFilteredWorkbookPreview?.itemProfileRows ?? []).filter((row) => {
      if (
        importConfig.workbookCategoryFilter !== "all" &&
        row.category !== importConfig.workbookCategoryFilter
      ) {
        return false;
      }

      if (!query) return true;

      return [row.code, row.name, row.uom, row.category]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [
    dateFilteredWorkbookPreview?.itemProfileRows,
    importConfig.workbookCategoryFilter,
    workbookItemSearch,
  ]);
  const selectedWorkbookItemIdSet = useMemo(
    () => new Set(selectedWorkbookItemIds),
    [selectedWorkbookItemIds]
  );
  const filteredWorkbookPreview = useMemo(
    () =>
      filterWorkbookPreviewByScope(dateFilteredWorkbookPreview, {
        category: importConfig.workbookCategoryFilter,
        itemIds: selectedWorkbookItemIds,
      }),
    [dateFilteredWorkbookPreview, importConfig.workbookCategoryFilter, selectedWorkbookItemIds]
  );
  const unmatchedPreview = filteredWorkbookPreview?.unmatchedRows?.slice(0, 6) ?? [];
  const reconciliationPreview = filteredWorkbookPreview?.reconciliationRows?.slice(0, 6) ?? [];
  const workbookReportInsight = filteredWorkbookPreview?.reportInsight ?? null;
  const workbookWarningSummary = useMemo(
    () => summarizeWorkbookWarnings(importPreview?.warnings ?? []),
    [importPreview?.warnings]
  );
  const workbookBalanceOnlyNote = useMemo(
    () => formatBalanceOnlySheetNote(filteredWorkbookPreview?.sheetSummaries ?? []),
    [filteredWorkbookPreview?.sheetSummaries]
  );
  const workbookImportedBy = currentUser?.name || importConfig.enteredBy || "Excel Import";
  const workbookScopeLabel = selectedWorkbookItemIds.length
    ? `${formatNumber(selectedWorkbookItemIds.length)} item(s)`
    : importConfig.workbookCategoryFilter !== "all"
      ? importConfig.workbookCategoryFilter
      : "Whole date window";
  const shouldRetireMissingWorkbookItems = Boolean(
    filteredWorkbookPreview &&
      importConfig.includeWorkbookItems &&
      importConfig.workbookCategoryFilter === "all" &&
      selectedWorkbookItemIds.length === 0 &&
      importPreview?.availableDates?.[0] === filteredWorkbookPreview.selectedDateFrom &&
      importPreview?.availableDates?.at(-1) === filteredWorkbookPreview.selectedDateTo
  );
  const workbookPreviewExceptionCount =
    (filteredWorkbookPreview?.reconciliationRows?.length ?? 0) +
    (filteredWorkbookPreview?.unmatchedRows?.length ?? 0);

  useEffect(() => {
    if (!dateFilteredWorkbookPreview?.availableDates?.length) return;

    const earliestDate = dateFilteredWorkbookPreview.availableDates[0];
    const latestDate =
      dateFilteredWorkbookPreview.availableDates.at(-1) ?? dateFilteredWorkbookPreview.availableDates[0];

    setImportConfig((currentConfig) => {
      const nextOpeningDate = dateFilteredWorkbookPreview.availableDates.includes(currentConfig.openingDate)
        ? currentConfig.openingDate
        : earliestDate;
      const nextFromDate = importPreview?.availableDates?.includes(currentConfig.workbookDateFrom)
        ? currentConfig.workbookDateFrom
        : earliestDate;
      const nextToDate = importPreview?.availableDates?.includes(currentConfig.workbookDateTo)
        ? currentConfig.workbookDateTo
        : latestDate;

      if (
        nextOpeningDate === currentConfig.openingDate &&
        nextFromDate === currentConfig.workbookDateFrom &&
        nextToDate === currentConfig.workbookDateTo
      ) {
        return currentConfig;
      }

      return {
        ...currentConfig,
        openingDate: nextOpeningDate,
        workbookDateFrom: nextFromDate,
        workbookDateTo: nextToDate,
      };
    });
  }, [dateFilteredWorkbookPreview?.availableDates, importPreview?.availableDates]);

  useEffect(() => {
    setSelectedWorkbookItemIds((currentSelection) =>
      currentSelection.filter((itemId) =>
        (dateFilteredWorkbookPreview?.itemProfileRows ?? []).some((row) => row.itemId === itemId)
      )
    );
  }, [dateFilteredWorkbookPreview?.itemProfileRows]);

  useEffect(() => {
    setSelectedWorkbookItemIds((currentSelection) =>
      currentSelection.filter((itemId) => workbookCategoryScopedItemIds.has(itemId))
    );
  }, [workbookCategoryScopedItemIds]);

  useEffect(() => {
    if (
      importConfig.workbookCategoryFilter !== "all" &&
      !workbookCategoryOptions.includes(importConfig.workbookCategoryFilter)
    ) {
      setImportConfig((currentConfig) => ({
        ...currentConfig,
        workbookCategoryFilter: "all",
      }));
    }
  }, [importConfig.workbookCategoryFilter, workbookCategoryOptions]);

  useEffect(() => {
    setStructuredImportPreview(null);
    setImportConfig((currentConfig) => ({
      ...currentConfig,
      structuredApplyScope: "all",
    }));
  }, [importConfig.structuredImportType]);

  useEffect(() => {
    setSelectedItemIds((currentSelection) =>
      currentSelection.filter((itemId) => stockRows.some((item) => item.id === itemId))
    );
  }, [stockRows]);

  useEffect(() => {
    if (!stockRows.length) {
      setSelectedItemId("");
      return;
    }

    if (!selectedItemId || !selectedItem) {
      setSelectedItemId(stockRows[0].id);
    }
  }, [selectedItem, selectedItemId, stockRows]);

  useEffect(() => {
    if (departmentWorkspaceView === "browse" && !selectedDepartmentId && departments.length) {
      setSelectedDepartmentId(departments[0].id);
      return;
    }

    if (selectedDepartmentId && selectedDepartment) {
      setDepartmentForm(buildDepartmentForm(selectedDepartment, departments));
      return;
    }

    if (!selectedDepartmentId) {
      setDepartmentForm(buildDepartmentForm(null, departments));
    }
  }, [departmentWorkspaceView, departments, selectedDepartment, selectedDepartmentId]);

  const deferredItemSearch = useDeferredValue(itemSearch);
  const deferredDepartmentSearch = useDeferredValue(departmentSearch);

  const filteredItemRows = useMemo(() => {
    return searchItemRecords(stockRows, deferredItemSearch);
  }, [deferredItemSearch, stockRows]);

  const filteredDepartments = useMemo(() => {
    const query = normalizeSearchValue(deferredDepartmentSearch);
    if (!query) return departments;

    return departments.filter((department) =>
      [department.code, department.name].some((value) =>
        normalizeSearchValue(value).includes(query)
      )
    );
  }, [deferredDepartmentSearch, departments]);

  const selectedBulkItems = useMemo(
    () => stockRows.filter((item) => selectedItemIdSet.has(item.id)),
    [selectedItemIdSet, stockRows]
  );

  const allFilteredItemsSelected =
    filteredItemRows.length > 0 &&
    filteredItemRows.every((item) => selectedItemIdSet.has(item.id));

  const pendingUsers = useMemo(
    () => users.filter((user) => user.status === "pending"),
    [users]
  );

  const activeUsers = useMemo(
    () => users.filter((user) => user.status === "approved"),
    [users]
  );
  const rejectedUsers = useMemo(
    () => users.filter((user) => user.status === "rejected"),
    [users]
  );
  const deferredWorkbookMovementSearch = useDeferredValue(workbookMovementSearch);
  const structuredImportMeta =
    importConfig.structuredImportType === "departments"
      ? {
          label: "Departments",
          description: "Create or update department records in one clean sheet.",
          columns: departmentImportTemplateColumns,
        }
      : importConfig.structuredImportType === "openings"
        ? {
            label: "Opening Balances",
            description: "Load starting balances and cost backfill without changing the whole item master.",
            columns: openingBalanceTemplateColumns,
          }
      : importConfig.structuredImportType === "movements"
        ? {
            label: "Audit Trail",
            description: "Load past stock movement lines with the required control fields.",
            columns: movementImportTemplateColumns,
          }
        : {
            label: "Item Master",
            description: "Bring in item setup, levels, cost, and selling price.",
            columns: itemMasterTemplateColumns,
          };
  const importReferenceGroups = [
    {
      label: "Item Master",
      description: "Use this when setting up or updating the item master.",
      columns: itemMasterTemplateColumns,
    },
    {
      label: "Opening Balances",
      description: "Use this for one-time starting balances and cost backfill.",
      columns: openingBalanceTemplateColumns,
    },
    {
      label: "Departments",
      description: "Use this to load or update operational departments.",
      columns: departmentImportTemplateColumns,
    },
    {
      label: "Audit Trail",
      description: "Use this when importing past receipts, issues, and adjustments.",
      columns: movementImportTemplateColumns,
    },
  ];

  const workbookImportChoices = [
    {
      key: "includeWorkbookItems",
      label: "Update item setup from workbook",
      note: "Optional. Use only when you want workbook category, UOM, cost, and min/max to overwrite the current item master.",
      count: filteredWorkbookPreview?.itemProfileRows?.length ?? 0,
    },
    {
      key: "includeWorkbookOpenings",
      label: "Opening stock from selected day",
      note: "Use one workbook day as the starting stock position for the selected report window.",
      count:
        filteredWorkbookPreview?.openingSnapshots?.find(
          (entry) => entry.date === importConfig.openingDate
        )?.rows?.length ?? 0,
    },
    {
      key: "includeWorkbookMovements",
      label: "Received, issued, and closing adjustments",
      note: "Daily receipts, issues, and closing-stock reconciliations from the dated sheets.",
      count: filteredWorkbookPreview?.movementRows?.length ?? 0,
    },
  ];

  const selectedWorkbookImportChoices = workbookImportChoices.filter(
    (choice) => importConfig[choice.key]
  );

  const workbookItemProfileMap = useMemo(
    () =>
      Object.fromEntries(
        (filteredWorkbookPreview?.itemProfileRows ?? []).map((row) => [row.itemId, row])
      ),
    [filteredWorkbookPreview?.itemProfileRows]
  );
  const workbookIssueMappingCategories = useMemo(() => {
    const categories = new Set(
      (filteredWorkbookPreview?.movementRows ?? [])
        .filter((row) => row.type === "OUT")
        .map((row) => String(row.category ?? workbookItemProfileMap[row.itemId]?.category ?? "").trim())
        .filter(Boolean)
    );

    return Array.from(categories).sort((left, right) => left.localeCompare(right));
  }, [filteredWorkbookPreview?.movementRows, workbookItemProfileMap]);
  const departmentNameById = useMemo(
    () =>
      Object.fromEntries(departments.map((department) => [department.id, department.name])),
    [departments]
  );
  const resolveWorkbookIssueDepartmentId = (row) => {
    const category = String(row.category ?? workbookItemProfileMap[row.itemId]?.category ?? "").trim();
    return resolveWorkbookIssueDepartmentIdByCategory(category, departments, {
      explicitMap: importConfig.issueDepartmentMap,
      fallbackDepartmentId: importConfig.issueDepartmentId,
    });
  };
  const resolveWorkbookMovementDepartmentId = (row) =>
    row.type === "OUT" ? resolveWorkbookIssueDepartmentId(row) : importConfig.receiveDepartmentId;
  const resolveWorkbookMovementDepartmentName = (row) => {
    const departmentId = resolveWorkbookMovementDepartmentId(row);
    return departmentNameById[departmentId] ?? departmentId ?? "";
  };

  const filteredWorkbookMovementRows = useMemo(() => {
    const query = normalizeSearchValue(deferredWorkbookMovementSearch);

    return (filteredWorkbookPreview?.movementRows ?? []).filter((row) => {
      if (workbookMovementTypeFilter !== "all" && row.type !== workbookMovementTypeFilter) {
        return false;
      }

      if (!query) return true;

      const itemProfile = workbookItemProfileMap[row.itemId] ?? null;
      const haystack = [
        itemProfile?.code,
        itemProfile?.name,
        row.type,
        row.date,
        row.referenceNumber,
        row.requisitionNumber,
        row.sourceSheet,
        row.category,
        resolveWorkbookMovementDepartmentName(row),
        row.notes,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [
    deferredWorkbookMovementSearch,
    filteredWorkbookPreview?.movementRows,
    workbookItemProfileMap,
    workbookMovementTypeFilter,
    resolveWorkbookMovementDepartmentName,
  ]);

  const workbookMovementColumns = [
    { key: "date", label: "Date" },
    { key: "sourceSheet", label: "Sheet" },
    { key: "type", label: "Type" },
    {
      key: "department",
      label: "Department",
      render: (row) => resolveWorkbookMovementDepartmentName(row) || "-",
    },
    {
      key: "itemCode",
      label: "Code",
      render: (row) => workbookItemProfileMap[row.itemId]?.code ?? row.itemId,
    },
    {
      key: "itemName",
      label: "Item",
      render: (row) => workbookItemProfileMap[row.itemId]?.name ?? row.itemId,
    },
    {
      key: "category",
      label: "Category",
      render: (row) => row.category ?? workbookItemProfileMap[row.itemId]?.category ?? "-",
    },
    { key: "quantity", label: "Qty", align: "right", render: (row) => formatNumber(row.quantity) },
    {
      key: "document",
      label: "Document",
      render: (row) => row.requisitionNumber || row.referenceNumber || "-",
    },
    {
      key: "unitCost",
      label: "Cost",
      align: "right",
      render: (row) => (row.unitCost === null || row.unitCost === undefined ? "-" : formatNumber(row.unitCost)),
    },
  ];

  const workbookMovementSummary = useMemo(
    () => ({
      inLines: (filteredWorkbookPreview?.movementRows ?? []).filter((row) => row.type === "IN").length,
      outLines: (filteredWorkbookPreview?.movementRows ?? []).filter((row) => row.type === "OUT").length,
      adjLines: (filteredWorkbookPreview?.movementRows ?? []).filter((row) => row.type === "ADJ").length,
    }),
    [filteredWorkbookPreview?.movementRows]
  );

  const workbookItemColumns = [
    {
      key: "selected",
      label: "Select",
      render: (row) => (
        <label className="table-checkbox">
          <input
            checked={selectedWorkbookItemIdSet.has(row.itemId)}
            onChange={() => {
              setSelectedWorkbookItemIds((currentSelection) => {
                const nextSelection = new Set(currentSelection);
                if (nextSelection.has(row.itemId)) {
                  nextSelection.delete(row.itemId);
                } else {
                  nextSelection.add(row.itemId);
                }
                return Array.from(nextSelection);
              });
            }}
            type="checkbox"
          />
          <span>Select</span>
        </label>
      ),
    },
    { key: "code", label: "Code" },
    { key: "name", label: "Item" },
    { key: "category", label: "Category" },
    { key: "uom", label: "UOM" },
  ];

  const structuredImportApplyRows = useMemo(() => {
    if (!structuredImportPreview) return [];

    if (
      structuredImportPreview.importType === "movements" ||
      structuredImportPreview.importType === "openings" ||
      importConfig.structuredApplyScope === "all"
    ) {
      return structuredImportPreview.mappedRows;
    }

    const targetAction =
      importConfig.structuredApplyScope === "updates-only" ? "update" : "new";
    return structuredImportPreview.mappedRows.filter((row) => row.importAction === targetAction);
  }, [
    importConfig.structuredApplyScope,
    structuredImportPreview,
  ]);

  const previewSheetColumns = [
    { key: "sheetName", label: "Sheet" },
    { key: "date", label: "Date" },
    { key: "matchedCount", label: "Matched Items", align: "right" },
    { key: "openingCount", label: "Opening Rows", align: "right" },
    { key: "movementCount", label: "Movements", align: "right" },
    { key: "reconciliationCount", label: "Closing Adj.", align: "right" },
    { key: "unmatchedCount", label: "Unmatched", align: "right" },
  ];

  const unmatchedColumns = [
    { key: "sheetName", label: "Sheet" },
    { key: "rowNumber", label: "Row", align: "right" },
    { key: "itemLabel", label: "Workbook Item" },
  ];

  async function handleExportCurrentDataWorkbook() {
    await downloadWorkbook("stock-flow-current-data.xlsx", [
      {
        name: "Item Master",
        rows: [
          itemMasterTemplateColumns,
          ...stockRows.map((row) => [
            row.code,
            row.name,
            row.category ?? "",
            row.uom,
            row.openingBalance ?? 0,
            row.unitCost ?? "",
            row.sellingPrice ?? "",
            row.minStock ?? "",
            row.maxStock ?? "",
            toWorkbookBoolean(row.isActive !== false),
          ]),
        ],
      },
      {
        name: "Opening Balances",
        rows: [
          openingBalanceTemplateColumns,
          ...stockRows.map((row) => [
            row.code,
            row.name,
            row.uom,
            row.openingBalance ?? 0,
            row.unitCost ?? "",
          ]),
        ],
      },
      {
        name: "Departments",
        rows: [
          departmentImportTemplateColumns,
          ...departments.map((department) => [
            department.code,
            department.name,
            department.requisitionStartNumber ?? 1,
            toWorkbookBoolean(department.isMainStore),
            toWorkbookBoolean(department.isActive !== false),
          ]),
        ],
      },
      {
        name: "Audit Trail",
        rows: [
          movementImportTemplateColumns,
          ...(movementRows ?? []).map((row) => [
            row.date,
            row.type,
            row.departmentName ?? row.departmentId ?? "",
            row.itemCode ?? row.itemId ?? "",
            row.itemName ?? row.itemId ?? "",
            row.quantity,
            row.unitCost ?? "",
            row.referenceNumber ?? "",
            row.requisitionNumber ?? "",
            row.adjustmentMode ?? "",
            row.notes ?? "",
            row.enteredBy ?? "",
          ]),
        ],
      },
    ]);

    setMessage({
      tone: "success",
      text: "Current frontend data was exported to Excel successfully.",
    });
  }

  async function handleDownloadImportTemplatesWorkbook() {
    await downloadWorkbook("stock-flow-import-templates.xlsx", [
      {
        name: "Item Master Template",
        rows: [
          itemMasterTemplateColumns,
          ["ITM-001", "Sugar", "Dry Foods", "kgs", 20, 3500, "", 10, 50, "TRUE"],
        ],
      },
      {
        name: "Opening Balance Template",
        rows: [
          openingBalanceTemplateColumns,
          ["ITM-001", "Sugar", "kgs", 20, 3500],
        ],
      },
      {
        name: "Department Template",
        rows: [
          departmentImportTemplateColumns,
          ["DPT-01", "Kitchen", 12, "FALSE", "TRUE"],
        ],
      },
      {
        name: "Movement Template",
        rows: [
          movementImportTemplateColumns,
          ["2026-03-27", "OUT", "Kitchen", "ITM-001", "Sugar", 5, 3750, "", 12, "", "Imported issue", "Excel Import"],
        ],
      },
    ]);

    setMessage({
      tone: "success",
      text: "Import template workbook downloaded successfully.",
    });
  }

  async function handleExportWorkbookPreview() {
    if (!filteredWorkbookPreview) return;

    const openingRowsForDate =
      filteredWorkbookPreview.openingSnapshots.find((entry) => entry.date === importConfig.openingDate)
        ?.rows ?? [];
    const reportInsight = filteredWorkbookPreview.reportInsight;

    await downloadWorkbook(
      `workbook-window-${filteredWorkbookPreview.selectedDateFrom}-to-${filteredWorkbookPreview.selectedDateTo}.xlsx`,
      [
        {
          name: "Report Readiness",
          rows: [
            ["Workbook Window", `${filteredWorkbookPreview.selectedDateFrom} to ${filteredWorkbookPreview.selectedDateTo}`],
            ["Suggested Opening Date", reportInsight?.openingDateSuggestion ?? ""],
            ["Supported Reports", reportInsight?.supportedReports?.join(", ") ?? ""],
            [],
            ["Metric", "Value"],
            ["Sheets", reportInsight?.sheetCount ?? 0],
            ["Item Profiles", reportInsight?.itemProfileCount ?? 0],
            ["Opening Rows", reportInsight?.openingRowCount ?? 0],
            ["Movement Lines", reportInsight?.movementLineCount ?? 0],
            ["Items With Levels", reportInsight?.itemsWithLevelsCount ?? 0],
            ["Item Cost Coverage %", reportInsight?.itemCostCoveragePercent ?? 0],
            ["Opening Cost Coverage %", reportInsight?.openingCostCoveragePercent ?? 0],
            ["Receipt Cost Coverage %", reportInsight?.receiptCostCoveragePercent ?? 0],
            ["Level Coverage %", reportInsight?.levelCoveragePercent ?? 0],
            ["Closing Adjustments", reportInsight?.reconciliationCount ?? 0],
            ["Unmatched Rows", reportInsight?.unmatchedCount ?? 0],
            [],
            ["Plan", "Status", "Recommended Import", "Reports", "Notes"],
            ...((reportInsight?.reportPlans ?? []).map((plan) => [
              plan.label,
              plan.statusLabel,
              describeWorkbookImportChoices(plan.recommendedChoices),
              plan.focusReports.join(", "),
              plan.notes.join(" | "),
            ])),
            [],
            ["General Notes"],
            ...((reportInsight?.notes ?? []).map((note) => [note])),
          ],
        },
        {
          name: "Sheet Summary",
          rows: [
            [
              "Sheet",
              "Date",
              "Matched Items",
              "Opening Rows",
              "Movements",
              "Closing Adjustments",
              "Unmatched",
            ],
            ...filteredWorkbookPreview.sheetSummaries.map((row) => [
              row.sheetName,
              row.date,
              row.matchedCount,
              row.openingCount,
              row.movementCount,
              row.reconciliationCount ?? 0,
              row.unmatchedCount,
            ]),
          ],
        },
        {
          name: "Item Profiles",
          rows: [
            itemMasterTemplateColumns,
            ...filteredWorkbookPreview.itemProfileRows.map((row) => [
              row.code,
              row.name,
              row.category ?? "",
              row.uom,
              row.openingBalance ?? 0,
              row.unitCost ?? "",
              "",
              row.minStock ?? "",
              row.maxStock ?? "",
              "TRUE",
            ]),
          ],
        },
        {
          name: "Selected Openings",
          rows: [
            ["Opening Date", importConfig.openingDate || ""],
            [],
            openingBalanceTemplateColumns,
            ...openingRowsForDate.map((row) => [
              row.code,
              row.name,
              row.uom,
              row.openingBalance ?? 0,
              row.unitCost ?? "",
            ]),
          ],
        },
        {
          name: "Movement Preview",
          rows: [
            movementImportTemplateColumns,
            ...filteredWorkbookPreview.movementRows.map((row) => [
              row.date,
              row.type,
              resolveWorkbookMovementDepartmentName(row),
              stockRows.find((item) => item.id === row.itemId)?.code ?? row.itemId,
              stockRows.find((item) => item.id === row.itemId)?.name ?? row.itemId,
              row.quantity,
              row.unitCost ?? "",
              row.referenceNumber ?? "",
              row.requisitionNumber ?? "",
              row.adjustmentMode ?? "",
              row.notes ?? "",
              row.enteredBy ?? workbookImportedBy,
            ]),
          ],
        },
      ]
    );

    setMessage({
      tone: "success",
      text:
        `Workbook window ${filteredWorkbookPreview.selectedDateFrom} to ${filteredWorkbookPreview.selectedDateTo} was exported to Excel.`,
    });
  }

  const itemColumns = [
    {
      key: "selected",
      label: "Select",
      render: (row) => (
        <label className="table-checkbox">
          <input
            checked={selectedItemIdSet.has(row.id)}
            onChange={() => handleToggleItemSelection(row.id)}
            type="checkbox"
          />
          <span>Select</span>
        </label>
      ),
    },
    { key: "code", label: "Code" },
    { key: "name", label: "Item" },
    {
      key: "category",
      label: "Category",
      render: (row) => row.category || "-",
    },
    { key: "uom", label: "UOM" },
    {
      key: "openingBalance",
      label: "Opening",
      align: "right",
      render: (row) => formatNumber(row.openingBalance),
    },
    {
      key: "unitCost",
      label: "Unit Cost",
      align: "right",
      render: (row) => (row.unitCost === null ? "-" : formatNumber(row.unitCost)),
    },
    {
      key: "sellingPrice",
      label: "Price",
      align: "right",
      render: (row) => (row.sellingPrice === null ? "-" : formatNumber(row.sellingPrice)),
    },
    {
      key: "minStock",
      label: "Min",
      align: "right",
      render: (row) => (row.minStock === null ? "-" : formatNumber(row.minStock)),
    },
    {
      key: "maxStock",
      label: "Max",
      align: "right",
      render: (row) => (row.maxStock === null ? "-" : formatNumber(row.maxStock)),
    },
    {
      key: "stockValue",
      label: "Value",
      align: "right",
      render: (row) => (row.stockValue === null ? "-" : formatNumber(row.stockValue)),
    },
    {
      key: "stockOnHand",
      label: "SOH",
      align: "right",
      render: (row) => formatNumber(row.stockOnHand),
    },
    {
      key: "status",
      label: "Status",
      render: (row) =>
        row.isActive === false ? (
          <StatusPill tone="warning">Inactive</StatusPill>
        ) : row.stockOnHand < 0 ? (
          <StatusPill tone="danger">Negative</StatusPill>
        ) : row.belowMinStock ? (
          <StatusPill tone="warning">Below Min</StatusPill>
        ) : row.aboveMaxStock ? (
          <StatusPill tone="info">Above Max</StatusPill>
        ) : (
          <StatusPill tone="success">Active</StatusPill>
        ),
    },
    {
      key: "action",
      label: "",
      render: (row) => (
        <button
          className="button button-secondary button-small"
          onClick={() => handleEditItem(row.id)}
          type="button"
        >
          Edit
        </button>
      ),
    },
  ];

  const departmentColumns = [
    { key: "code", label: "Code" },
    { key: "name", label: "Department" },
    {
      key: "requisitionStartNumber",
      label: "Book Starts",
      align: "right",
      render: (row) => formatNumber(row.requisitionStartNumber ?? 1),
    },
    {
      key: "isMainStore",
      label: "Role",
      render: (row) =>
        row.isMainStore ? (
          <StatusPill tone="info">Main Store</StatusPill>
        ) : (
          <StatusPill tone="neutral">Operational</StatusPill>
        ),
    },
    {
      key: "isActive",
      label: "Status",
      render: (row) =>
        row.isActive !== false ? (
          <StatusPill tone="success">Active</StatusPill>
        ) : (
          <StatusPill tone="warning">Inactive</StatusPill>
        ),
    },
    {
      key: "action",
      label: "",
      render: (row) => (
        <button
          className="button button-secondary button-small"
          onClick={() => handleEditDepartment(row.id)}
          type="button"
        >
          Edit
        </button>
      ),
    },
  ];

  const accountColumns = [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    {
      key: "role",
      label: "Role",
      render: (row) => (
        <StatusPill
          tone={row.role === "finance" ? "info" : row.role === "admin" ? "danger" : "success"}
        >
          {row.role}
        </StatusPill>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusPill
          tone={
            row.status === "approved"
              ? "success"
              : row.status === "pending"
                ? "warning"
                : "danger"
          }
        >
          {row.status}
        </StatusPill>
      ),
    },
    {
      key: "security",
      label: "Security",
      render: (row) =>
        row.status !== "approved" ? (
          <span>-</span>
        ) : row.forcePasswordReset ? (
          <StatusPill tone="warning">Password change pending</StatusPill>
        ) : (
          <StatusPill tone="success">Password current</StatusPill>
        ),
    },
    {
      key: "action",
      label: "",
      render: (row) =>
        row.status === "pending" ? (
          <div className="toolbar">
            <button
              className="button button-secondary button-small"
              onClick={() => void handleApproveAccount(row)}
              type="button"
            >
              Approve
            </button>
            <button
              className="button button-secondary button-small"
              onClick={() => void handleRejectAccount(row)}
              type="button"
            >
              Reject
            </button>
          </div>
        ) : row.status === "approved" ? (
          <div className="toolbar">
            <span>{row.approvedBy || "-"}</span>
            {row.id !== currentUser?.id ? (
              <button
                className="button button-secondary button-small"
                onClick={() => void handleResetAccountPassword(row)}
                type="button"
              >
                Reset Password
              </button>
            ) : null}
          </div>
        ) : (
          <span>{row.approvedBy || "-"}</span>
        ),
    },
  ];

  function handleNewItem() {
    setSelectedItemId("");
    setItemWorkspaceView("edit");
    setShowItemErrors(false);
    setItemErrors({});
    setItemForm(buildItemForm(null, stockRows));
    setShowItemAdvancedFields(false);
    setMessage(null);
  }

  function handleUseNextItemCode() {
    setItemForm((current) => ({
      ...current,
      code: createItemCode(stockRows),
    }));
  }

  function handleEditItem(itemId) {
    const itemToEdit = stockRows.find((item) => item.id === itemId) ?? null;
    setItemWorkspaceView("edit");
    setSelectedItemId(itemId);
    setShowItemErrors(false);
    setItemErrors({});
    setItemForm(buildItemForm(itemToEdit, stockRows));
    setShowItemAdvancedFields(countConfiguredItemOptionalFields(itemToEdit) > 0);
    setMessage(null);
  }

  function handleOpenSelectedItemEditor() {
    if (selectedItemId) {
      handleEditItem(selectedItemId);
      return;
    }

    handleNewItem();
  }

  function handleResetItemEditor() {
    setShowItemErrors(false);
    setItemErrors({});
    setMessage(null);

    if (selectedItemId && selectedItem) {
      setItemForm(buildItemForm(selectedItem, stockRows));
      setShowItemAdvancedFields(countConfiguredItemOptionalFields(selectedItem) > 0);
      return;
    }

    setItemForm(buildItemForm(null, stockRows));
    setShowItemAdvancedFields(false);
  }

  function handleToggleItemSelection(itemId) {
    setSelectedItemIds((currentSelection) =>
      currentSelection.includes(itemId)
        ? currentSelection.filter((currentItemId) => currentItemId !== itemId)
        : [...currentSelection, itemId]
    );
  }

  function handleSelectFilteredItems() {
    setSelectedItemIds((currentSelection) => {
      const nextSelection = new Set(currentSelection);
      filteredItemRows.forEach((item) => {
        nextSelection.add(item.id);
      });
      return Array.from(nextSelection);
    });
  }

  function handleClearSelectedItems() {
    setSelectedItemIds([]);
    setBulkItemEditForm(buildBulkItemEditForm());
  }

  function handleSelectItemsNeedingSetup(setupType) {
    const matchingItems = stockRows.filter((item) => {
      if (item.isActive === false) return false;

      if (setupType === "missing-cost") {
        return item.unitCost === null || item.unitCost === undefined;
      }

      if (setupType === "missing-levels") {
        return item.minStock === null && item.maxStock === null;
      }

      if (setupType === "zero-opening") {
        return Number(item.openingBalance) === 0;
      }

      return false;
    });

    setSelectedItemIds(matchingItems.map((item) => item.id));
    setItemWorkspaceView("browse");

    const setupLabel =
      setupType === "missing-cost"
        ? "missing unit cost"
        : setupType === "missing-levels"
          ? "missing min/max levels"
          : "zero opening";

    setMessage({
      tone: matchingItems.length ? "warning" : "success",
      text: matchingItems.length
        ? `${matchingItems.length} active item(s) with ${setupLabel} are now selected for review or bulk update.`
        : `No active items currently need ${setupLabel} correction.`,
    });
  }

  async function handleApplyBulkItemEdit() {
    if (!selectedBulkItems.length) {
      setMessage({
        tone: "danger",
        text: "Select one or more items first, then apply the bulk update.",
      });
      return;
    }

    const hasChanges =
      bulkItemEditForm.category ||
      bulkItemEditForm.openingBalance !== "" ||
      bulkItemEditForm.unitCost !== "" ||
      bulkItemEditForm.sellingPrice !== "" ||
      bulkItemEditForm.minStock !== "" ||
      bulkItemEditForm.maxStock !== "" ||
      bulkItemEditForm.isActiveAction !== "keep";

    if (!hasChanges) {
      setMessage({
        tone: "danger",
        text: "Choose at least one field to update before applying the bulk edit.",
      });
      return;
    }

    const preparedRows = [];

    for (const item of selectedBulkItems) {
      const candidateForm = {
        code: item.code,
        name: item.name,
        category: bulkItemEditForm.category || item.category || "",
        uom: item.uom,
        openingBalance:
          bulkItemEditForm.openingBalance !== ""
            ? bulkItemEditForm.openingBalance
            : item.openingBalance,
        unitCost:
          bulkItemEditForm.unitCost !== "" ? bulkItemEditForm.unitCost : item.unitCost ?? "",
        sellingPrice:
          bulkItemEditForm.sellingPrice !== ""
            ? bulkItemEditForm.sellingPrice
            : item.sellingPrice ?? "",
        minStock:
          bulkItemEditForm.minStock !== "" ? bulkItemEditForm.minStock : item.minStock ?? "",
        maxStock:
          bulkItemEditForm.maxStock !== "" ? bulkItemEditForm.maxStock : item.maxStock ?? "",
        isActive:
          bulkItemEditForm.isActiveAction === "keep"
            ? item.isActive !== false
            : bulkItemEditForm.isActiveAction === "active",
      };

      const validation = validateItemForm(candidateForm, stockRows, item.id);
      if (!validation.isValid) {
        const firstError = Object.values(validation.errors)[0];
        setMessage({
          tone: "danger",
          text: `${item.name} could not be updated. ${firstError}`,
        });
        return;
      }

      preparedRows.push({
        itemId: item.id,
        ...validation.normalizedItem,
      });
    }

    setBulkItemEditBusy(true);

    try {
      const result = await onImportItems(preparedRows);
      setBulkItemEditForm(buildBulkItemEditForm());
      setMessage({
        tone: "success",
        text: `Bulk update applied to ${result.importedCount} selected items.`,
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "The selected items could not be updated.",
      });
    } finally {
      setBulkItemEditBusy(false);
    }
  }

  function handleNewDepartment() {
    setDepartmentWorkspaceView("edit");
    setSelectedDepartmentId("");
    setShowDepartmentErrors(false);
    setDepartmentErrors({});
    setDepartmentForm(buildDepartmentForm(null, departments));
    setMessage(null);
  }

  function handleEditDepartment(departmentId) {
    setDepartmentWorkspaceView("edit");
    setSelectedDepartmentId(departmentId);
    setShowDepartmentErrors(false);
    setDepartmentErrors({});
    setMessage(null);
  }

  function handleResetDepartmentEditor() {
    setShowDepartmentErrors(false);
    setDepartmentErrors({});
    setMessage(null);

    if (selectedDepartmentId && selectedDepartment) {
      setDepartmentForm(buildDepartmentForm(selectedDepartment, departments));
      return;
    }

    setDepartmentForm(buildDepartmentForm(null, departments));
  }

  function handleResetAccountForm() {
    setShowAccountErrors(false);
    setAccountErrors({});
    setMessage(null);
    setAccountForm({
      name: "",
      email: "",
      password: "",
      role: "store",
      forcePasswordReset: true,
    });
  }

  function handleResetSettingsForm() {
    setSettingsErrors({});
    setMessage(null);
    setSettings({
      productName,
      hotelName,
      brandLogoUrl,
      brandAccentColor,
      brandSidebarColor,
      asOfDate,
      financeEmail,
    });
  }

  async function handleApproveAccount(user) {
    try {
      await onApproveUser(user.id, currentUser.name, user.role);
      setMessage({
        tone: "success",
        text: `${user.name} is now approved.`,
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "The account could not be approved.",
      });
    }
  }

  async function handleRejectAccount(user) {
    try {
      await onRejectUser(user.id, currentUser.name);
      setMessage({
        tone: "warning",
        text: `${user.name} was rejected.`,
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "The account could not be rejected.",
      });
    }
  }

  async function handleCreateAccount() {
    const validation = validateUserAccountForm(accountForm, users, null, {
      passwordRequired: true,
    });

    if (!validation.isValid) {
      setShowAccountErrors(true);
      setAccountErrors(validation.errors);
      setMessage({ tone: "danger", text: "Please fix the account fields before creating it." });
      return;
    }

    setAccountBusy(true);

    try {
      const createdUser = await onCreateUser({
        ...validation.normalizedUser,
        forcePasswordReset: accountForm.forcePasswordReset !== false,
      });
      setShowAccountErrors(false);
      setAccountErrors({});
      handleResetAccountForm();
      setMessage({
        tone: "success",
        text: `Account created for ${createdUser?.name ?? validation.normalizedUser.name}.`,
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "The account could not be created.",
      });
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleResetAccountPassword(user) {
    if (!onResetUserPassword) return;

    setResetPasswordDialog({
      userId: user.id,
      userName: user.name,
      password: "",
      error: "",
      isBusy: false,
    });
  }

  function handleCloseResetPasswordDialog() {
    if (resetPasswordDialog.isBusy) return;
    setResetPasswordDialog({
      userId: "",
      userName: "",
      password: "",
      error: "",
      isBusy: false,
    });
  }

  async function handleConfirmResetAccountPassword() {
    if (!onResetUserPassword || !resetPasswordDialog.userId) return;

    const nextPassword = String(resetPasswordDialog.password ?? "").trim();
    if (!nextPassword) {
      setResetPasswordDialog((currentDialog) => ({
        ...currentDialog,
        error: "Enter a temporary password before continuing.",
      }));
      return;
    }

    setResetPasswordDialog((currentDialog) => ({
      ...currentDialog,
      error: "",
      isBusy: true,
    }));

    try {
      const message = await onResetUserPassword(resetPasswordDialog.userId, nextPassword);
      handleCloseResetPasswordDialog();
      setMessage({
        tone: "warning",
        text: message,
      });
    } catch (error) {
      setResetPasswordDialog((currentDialog) => ({
        ...currentDialog,
        error:
          error instanceof Error ? error.message : "The password could not be reset.",
        isBusy: false,
      }));
      setMessage({
        tone: "danger",
        text: "The password could not be reset.",
      });
    }
  }

  async function handleSaveItem(startNew = false) {
    const validation = validateItemForm(itemForm, stockRows, selectedItemId || null);
    if (!validation.isValid) {
      setShowItemErrors(true);
      setItemErrors(validation.errors);
      setMessage({ tone: "danger", text: "Please fix the item fields before saving." });
      return;
    }

    setItemBusy(true);

    try {
      const savedItem = await onSaveItem(validation.normalizedItem, selectedItemId || null);
      setShowItemErrors(false);
      setItemErrors({});

      if (startNew) {
        setSelectedItemId("");
        setItemForm(buildItemForm(null, [...stockRows, savedItem]));
        setShowItemAdvancedFields(false);
        setMessage({
          tone: "success",
          text: selectedItemId
            ? "Item updated. You can add the next item now."
            : "New item added. You can add the next item now.",
        });
        return;
      }

      setSelectedItemId(savedItem.id);
      setItemWorkspaceView("edit");
      setItemForm(buildItemForm(savedItem, stockRows));
      setShowItemAdvancedFields(countConfiguredItemOptionalFields(savedItem) > 0);
      setMessage({
        tone: "success",
        text: selectedItemId ? "Item updated successfully." : "New item added successfully.",
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "The item could not be saved.",
      });
    } finally {
      setItemBusy(false);
    }
  }

  async function handleSaveDepartment() {
    const validation = validateDepartmentForm(
      departmentForm,
      departments,
      selectedDepartmentId || null
    );

    if (!validation.isValid) {
      setShowDepartmentErrors(true);
      setDepartmentErrors(validation.errors);
      setMessage({ tone: "danger", text: "Please fix the department fields before saving." });
      return;
    }

    setDepartmentBusy(true);

    try {
      const savedDepartment = await onSaveDepartment(
        validation.normalizedDepartment,
        selectedDepartmentId || null
      );

      setSelectedDepartmentId(savedDepartment.id);
      setDepartmentWorkspaceView("edit");
      setShowDepartmentErrors(false);
      setDepartmentErrors({});
      setMessage({
        tone: "success",
        text: selectedDepartmentId
          ? "Department updated successfully."
          : "New department added successfully.",
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "The department could not be saved.",
      });
    } finally {
      setDepartmentBusy(false);
    }
  }

  async function handleSaveSettings() {
    const nextProductName = String(settings.productName ?? "").trim();
    const nextHotelName = String(settings.hotelName ?? "").trim();
    const emailValidation = validateEmailAddress(settings.financeEmail);
    const nextErrors = {};

    if (!nextProductName) {
      nextErrors.productName = "Enter the system name.";
    }

    if (!nextHotelName) {
      nextErrors.hotelName = "Enter the hotel or company name.";
    }

    if (!emailValidation.isValid) {
      nextErrors.financeEmail = emailValidation.error;
    }

    if (Object.keys(nextErrors).length) {
      setSettingsErrors(nextErrors);
      setMessage({ tone: "danger", text: "Please fix the highlighted settings before saving." });
      return;
    }

    setSettingsErrors({});
    setSettingsBusy(true);
    try {
      await onSaveSettings({
        productName: nextProductName,
        hotelName: nextHotelName,
        brandLogoUrl: String(settings.brandLogoUrl ?? "").trim(),
        brandAccentColor: normalizeHexColor(settings.brandAccentColor),
        brandSidebarColor: normalizeHexColor(settings.brandSidebarColor),
        asOfDate: settings.asOfDate,
        financeEmail: emailValidation.email,
      });

      setMessage({ tone: "success", text: "System settings updated." });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "The system settings could not be saved.",
      });
    } finally {
      setSettingsBusy(false);
    }
  }

  function handleLogoFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!String(file.type ?? "").startsWith("image/")) {
      setMessage({ tone: "danger", text: "Choose an image file for the logo." });
      event.target.value = "";
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setMessage({
        tone: "danger",
        text: "Logo image is too large. Use an image smaller than 2 MB.",
      });
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSettings((current) => ({
        ...current,
        brandLogoUrl: String(reader.result ?? ""),
      }));
      setMessage({
        tone: "success",
        text: `${file.name} is ready as the new logo. Save settings to apply it across the system.`,
      });
    };
    reader.onerror = () => {
      setMessage({
        tone: "danger",
        text: "The logo image could not be read. Try another image file.",
      });
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function handleImportConfigChange(field, value) {
    setImportConfig((currentConfig) => ({
      ...currentConfig,
      [field]: value,
    }));
  }

  function handleSelectVisibleWorkbookItems() {
    setSelectedWorkbookItemIds((currentSelection) => {
      const nextSelection = new Set(currentSelection);
      workbookSelectableItems.forEach((row) => nextSelection.add(row.itemId));
      return Array.from(nextSelection);
    });
  }

  function handleSelectAllWorkbookScopeItems() {
    setSelectedWorkbookItemIds(Array.from(workbookCategoryScopedItemIds));
  }

  function handleClearWorkbookItemSelection() {
    setSelectedWorkbookItemIds([]);
  }

  async function handleWorkbookFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportBusy(true);
    setMessage(null);

    try {
      const { workbook, xlsxModule } = await loadWorkbookFromFile(file);
      const preview = parseDailyStoresWorkbook(workbook, stockRows, {
        xlsx: xlsxModule,
        fileName: file.name,
        receiveDepartmentId: importConfig.receiveDepartmentId,
        issueDepartmentId: importConfig.issueDepartmentId,
        issueDepartmentMap: importConfig.issueDepartmentMap,
        departmentRequisitionStartNumbers: buildDepartmentRequisitionStartNumbers(departments),
      });

      if (!preview.sheetSummaries.length) {
        throw new Error(
          "No dated daily sheets were found in this workbook. Use the structured import below for item, department, or movement files."
        );
      }

      startTransition(() => {
        setImportPreview(preview);
        setSelectedWorkbookItemIds([]);
        setWorkbookItemSearch("");
        setWorkbookPreviewPanel("summary");
        setImportConfig((currentConfig) => ({
          ...currentConfig,
          workbookDateFrom: preview.availableDates[0] ?? currentConfig.workbookDateFrom,
          workbookDateTo:
            preview.availableDates.at(-1) ??
            preview.availableDates[0] ??
            currentConfig.workbookDateTo,
          openingDate: preview.availableDates[0] ?? currentConfig.openingDate,
          workbookCategoryFilter: "all",
          includeWorkbookItems:
            currentConfig.includeWorkbookItems ||
            stockRows.length === 0 ||
            preview.itemProfileRows.some((row) => row.importAction === "new"),
          includeWorkbookOpenings:
            currentConfig.includeWorkbookOpenings || preview.openingSnapshots.length > 0,
          includeWorkbookMovements:
            currentConfig.includeWorkbookMovements || preview.movementRows.length > 0,
        }));
      });

      setMessage({
        tone: "success",
        text:
          `Workbook parsed successfully: ${preview.sheetSummaries.length} dated sheets found, ` +
          `${preview.movementRows.length} movement lines prepared, ` +
          `${preview.reportInsight.supportedReports.length} report views look supported, and ` +
          `${preview.unmatchedRows.length} rows still need attention.`,
      });
    } catch (error) {
      setImportPreview(null);
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "The workbook could not be parsed.",
      });
    } finally {
      setImportBusy(false);
      event.target.value = "";
    }
  }

  async function handleStructuredImportFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportBusy(true);
    setMessage(null);

    try {
      const { workbook, xlsxModule } = await loadWorkbookFromFile(file);
      const { sheetName, rows } = readWorkbookSheetRows(workbook, xlsxModule);

      let preview;
      if (importConfig.structuredImportType === "items") {
        preview = prepareItemMasterImportRows(rows, stockRows);
      } else if (importConfig.structuredImportType === "openings") {
        preview = prepareOpeningBalanceImportRows(rows, stockRows);
      } else if (importConfig.structuredImportType === "departments") {
        preview = prepareDepartmentImportRows(rows, departments);
      } else {
        preview = prepareHistoricalMovementImportRows(rows, stockRows, departments);
      }

      startTransition(() => {
        setStructuredImportPreview({
          ...preview,
          fileName: file.name,
          sheetName,
          rowCount: rows.length,
          importType: importConfig.structuredImportType,
        });
      });

      if (preview.errors?.length) {
        setMessage({
          tone: "warning",
          text: `${file.name} was read, but there are import errors to fix before applying.`,
        });
      } else {
        setMessage({
          tone: "success",
          text: `${file.name} is ready to import as ${importConfig.structuredImportType}.`,
        });
      }
    } catch (error) {
      setStructuredImportPreview(null);
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "The file could not be parsed.",
      });
    } finally {
      setImportBusy(false);
      event.target.value = "";
    }
  }

  function buildWorkbookItemImportRows() {
    if (!filteredWorkbookPreview) return [];

    return (filteredWorkbookPreview.itemProfileRows ?? []).map((row) => {
      return {
        itemId: row.itemId,
        code: row.code,
        name: row.name,
        category: row.category,
        uom: row.uom || "EA",
        openingBalance: row.openingBalance ?? 0,
        unitCost: row.unitCost,
        sellingPrice: null,
        minStock: row.minStock,
        maxStock: row.maxStock,
        isActive: true,
      };
    });
  }

  async function handleImportFullWorkbook() {
    if (!filteredWorkbookPreview) return;

    if (!filteredWorkbookPreview.sheetSummaries.length) {
      setMessage({
        tone: "danger",
        text: "The selected workbook date window has no dated sheets to import.",
      });
      return;
    }

    if (!selectedWorkbookImportChoices.length) {
      setMessage({
        tone: "danger",
        text: "Select at least one workbook section before applying the import.",
      });
      return;
    }

    try {
      const workbookItemRows = buildWorkbookItemImportRows();
      const openingSnapshot = filteredWorkbookPreview.openingSnapshots.find(
        (entry) => entry.date === importConfig.openingDate
      );

      if (importConfig.includeWorkbookOpenings && !openingSnapshot) {
        throw new Error("Select a valid opening balance date before importing the workbook.");
      }

      const movementRows = filteredWorkbookPreview.movementRows.map((row) => ({
        ...row,
        departmentId: resolveWorkbookMovementDepartmentId(row),
        workbookCategory: String(
          row.category ?? workbookItemProfileMap[row.itemId]?.category ?? ""
        ).trim(),
        departmentMappingVersion:
          row.type === "OUT" ? WORKBOOK_ISSUE_DEPARTMENT_MAPPING_VERSION : "",
        enteredBy: workbookImportedBy,
      }));
      const existingItemIds = new Set(stockRows.map((row) => row.id));
      const requiredWorkbookItemIds = new Set();

      if (importConfig.includeWorkbookOpenings) {
        for (const row of openingSnapshot?.rows ?? []) {
          if (!existingItemIds.has(row.itemId)) requiredWorkbookItemIds.add(row.itemId);
        }
      }

      if (importConfig.includeWorkbookMovements) {
        for (const row of movementRows) {
          if (!existingItemIds.has(row.itemId)) requiredWorkbookItemIds.add(row.itemId);
        }
      }

      const dependencyItemRows = workbookItemRows.filter((row) => requiredWorkbookItemIds.has(row.itemId));
      if (!importConfig.includeWorkbookItems && dependencyItemRows.length) {
        throw new Error(
          `${dependencyItemRows.length} workbook item(s) do not exist in the current item master. ` +
            "Add those items first or turn on “Update item setup from workbook” for this import."
        );
      }

      const itemRowsToImport = importConfig.includeWorkbookItems ? workbookItemRows : [];

      const result = await onImportFullWorkbook({
        itemRows: itemRowsToImport,
        openingRows: importConfig.includeWorkbookOpenings ? openingSnapshot?.rows ?? [] : [],
        asOfDate: importConfig.includeWorkbookOpenings ? openingSnapshot?.date ?? "" : "",
        movementRows: importConfig.includeWorkbookMovements ? movementRows : [],
        movementMode: importConfig.movementMode,
        retireMissingWorkbookItems:
          importConfig.includeWorkbookItems && shouldRetireMissingWorkbookItems,
      });

      if (importConfig.includeWorkbookOpenings && openingSnapshot?.date) {
        setSettings((currentSettings) => ({
          ...currentSettings,
          asOfDate: openingSnapshot.date,
        }));
      }

      const supportMessage = buildWorkbookImportSupportMessage({
        dateFrom: filteredWorkbookPreview.selectedDateFrom,
        dateTo: filteredWorkbookPreview.selectedDateTo,
        result,
        importConfig,
        selectedWorkbookItemIds,
        preview: filteredWorkbookPreview,
      });

      setMessage({
        tone: "success",
        text: supportMessage.text,
        actions: supportMessage.actions,
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "The workbook could not be imported. Please review the file and try again.",
      });
    }
  }

  function handleApplyWorkbookReportPlan(planId) {
    const plan = workbookReportInsight?.reportPlans?.find((entry) => entry.id === planId);
    if (!plan) return;

    setImportConfig((currentConfig) => ({
      ...currentConfig,
      ...plan.recommendedChoices,
      openingDate:
        plan.recommendedChoices.includeWorkbookOpenings &&
        plan.recommendedOpeningDate &&
        filteredWorkbookPreview?.availableDates?.includes(plan.recommendedOpeningDate)
          ? plan.recommendedOpeningDate
          : currentConfig.openingDate,
    }));

    setMessage({
      tone: plan.tone === "danger" ? "warning" : "success",
      text:
        `${plan.label} setup is now selected. The import will apply ${describeWorkbookImportChoices(
          plan.recommendedChoices
        )}.` +
        (plan.recommendedChoices.includeWorkbookOpenings && plan.recommendedOpeningDate
          ? ` Suggested opening date: ${plan.recommendedOpeningDate}.`
          : ""),
    });
  }

  async function handleApplyStructuredImport() {
    if (!structuredImportPreview) return;
    if (structuredImportPreview.errors?.length) {
      setMessage({
        tone: "danger",
        text: "Fix the import errors first, then apply the file again.",
      });
      return;
    }

    if (!structuredImportApplyRows.length) {
      setMessage({
        tone: "danger",
        text: "No rows match the current import selection. Change the selection and try again.",
      });
      return;
    }

    try {
      if (structuredImportPreview.importType === "items") {
        const result = await onImportItems(structuredImportApplyRows);
        setMessage({
          tone: "success",
          text: `${result.importedCount} items imported from ${structuredImportPreview.fileName}.`,
        });
        return;
      }

      if (structuredImportPreview.importType === "departments") {
        const result = await onImportDepartments(structuredImportApplyRows);
        setMessage({
          tone: "success",
          text: `${result.importedCount} departments imported from ${structuredImportPreview.fileName}.`,
        });
        return;
      }

      if (structuredImportPreview.importType === "openings") {
        const result = await onApplyOpeningBalances(structuredImportApplyRows, {
          asOfDate: importConfig.openingDate || asOfDate,
        });
        setMessage({
          tone: "success",
          text: `${result.updatedCount} opening balances applied from ${structuredImportPreview.fileName}.`,
        });
        return;
      }

      const result = await onImportMovements(structuredImportApplyRows, {
        mode: importConfig.structuredMovementMode,
      });
      setMessage({
        tone: "success",
        text:
          `${result.importedCount} movement lines imported from ${structuredImportPreview.fileName}.` +
          (result.skippedCount ? ` ${result.skippedCount} duplicate lines were skipped.` : ""),
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "The selected import file could not be applied.",
      });
    }
  }

  function renderSystemSection() {
    const brandPreviewStyles = buildBrandStyles({
      accentColor: settings.brandAccentColor,
      sidebarColor: settings.brandSidebarColor,
    });

    return (
      <>
        <section className="card">
          <div className="card-header">
            <div>
              <div className="section-kicker">System settings</div>
              <h2>System identity and defaults</h2>
              <p>Set the brand, opening date, and finance contact used across the app.</p>
            </div>
          </div>

          <div className="detail-block editor-context-card">
            <div className="editor-context-head">
              <div className="editor-context-copy">
                <strong>{settings.productName || "System settings"}</strong>
                <p>These settings drive the shell, login, exports, and PDF headers.</p>
              </div>
              <StatusPill tone="info">System-wide settings</StatusPill>
            </div>
            <div className="pill-row">
              <StatusPill tone="neutral">Company {settings.hotelName || "Not set"}</StatusPill>
              <StatusPill tone="neutral">As-of {settings.asOfDate || "Not set"}</StatusPill>
              <StatusPill tone={settings.financeEmail ? "success" : "warning"}>
                {settings.financeEmail ? "Finance email set" : "Finance email not set"}
              </StatusPill>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>System Name</span>
              <input
                className="input"
                value={settings.productName}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, productName: event.target.value }))
                }
                placeholder="Kingsoft Stock Flow"
              />
              {settingsErrors.productName ? <small>{settingsErrors.productName}</small> : null}
            </label>

            <label className="field">
              <span>Hotel / Company Name</span>
              <input
                className="input"
                value={settings.hotelName}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, hotelName: event.target.value }))
                }
                placeholder="Your Company"
              />
              {settingsErrors.hotelName ? <small>{settingsErrors.hotelName}</small> : null}
            </label>

            <label className="field">
              <span>Opening Balance As-Of Date</span>
              <input
                className="input"
                type="date"
                value={settings.asOfDate}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, asOfDate: event.target.value }))
                }
              />
            </label>

            <label className="field">
              <span>Logo URL Or Asset Path</span>
              <input
                className="input"
                value={settings.brandLogoUrl}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, brandLogoUrl: event.target.value }))
                }
                placeholder="/assets/brand/your-logo.png or https://..."
              />
              <div className="field-note">
                Leave this blank to use a text logo, or point to an image in `public/assets`.
              </div>
            </label>

            <label className="field">
              <span>Upload Logo Image</span>
              <input
                className="input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleLogoFileChange}
              />
              <div className="field-note">
                Upload a small PNG, JPG, WebP, or SVG. Keep it under 2 MB.
              </div>
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Accent Color</span>
              <input
                className="input input-color"
                type="color"
                value={normalizeHexColor(settings.brandAccentColor)}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, brandAccentColor: event.target.value }))
                }
              />
            </label>

            <label className="field">
              <span>Sidebar Color</span>
              <input
                className="input input-color"
                type="color"
                value={normalizeHexColor(settings.brandSidebarColor)}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, brandSidebarColor: event.target.value }))
                }
              />
            </label>
          </div>

          <div className="detail-block branding-preview-card" style={brandPreviewStyles}>
            <div className="branding-preview-head">
              <div className="branding-preview-head-copy">
                <strong>Brand Preview</strong>
                <small>Preview of the shell, reports, and sign-in screens.</small>
              </div>
              <div className="branding-preview-chip">Powered by Kingsoft Online Solutions</div>
            </div>
            <div className="branding-preview-shell">
              <div className="branding-preview-sidebar">
                <BrandMark
                  title={settings.hotelName}
                  subtitle={settings.productName}
                  logoSrc={settings.brandLogoUrl}
                  compact
                />
                <div className="branding-preview-nav">
                  <span className="branding-preview-nav-pill is-active">Store Desk</span>
                  <span className="branding-preview-nav-pill">Finance Pack</span>
                  <span className="branding-preview-nav-pill">Setup</span>
                </div>
              </div>
              <div className="branding-preview-main">
                <div className="branding-preview-window">
                  <div className="branding-preview-window-top">
                    <strong>{settings.productName}</strong>
                    <span>{settings.hotelName}</span>
                  </div>
                  <div className="branding-preview-window-body">
                    <p>
                      The name, logo, and colors carry through the shell, login, PDF header, and desktop build.
                    </p>
                    <div className="branding-preview-metrics">
                      <div className="branding-preview-metric">
                        <span>Login</span>
                        <strong>Branded</strong>
                      </div>
                      <div className="branding-preview-metric">
                        <span>Reports</span>
                        <strong>PDF Ready</strong>
                      </div>
                      <div className="branding-preview-metric">
                        <span>Install App</span>
                        <strong>Enabled</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="detail-block system-note-card">
            <div className="system-note-kicker">Requisition Numbering</div>
            <strong>Each department keeps its own requisition book.</strong>
            <p>
              Set the first page exactly as it appears in the physical book. The system continues from there.
            </p>
          </div>

          <label className="field">
            <span>Finance Email</span>
            <input
              className="input"
              type="email"
              value={settings.financeEmail}
              onChange={(event) =>
                setSettings((current) => ({ ...current, financeEmail: event.target.value }))
              }
              placeholder="finance@hotel.com"
            />
            {settingsErrors.financeEmail ? <small>{settingsErrors.financeEmail}</small> : null}
          </label>

          <div className="detail-block editor-action-bar">
            <div className="editor-action-copy">
              <strong>Save these system settings</strong>
              <p>Save only when the live brand, opening date, or finance contact has changed.</p>
            </div>
            <div className="button-row">
              <button className="button" onClick={handleSaveSettings} type="button" disabled={settingsBusy}>
                {settingsBusy ? "Saving..." : "Save Settings"}
              </button>
              <button
                className="button button-secondary"
                onClick={handleResetSettingsForm}
                type="button"
                disabled={settingsBusy}
              >
                Reset Changes
              </button>
              <button
                className="button button-secondary"
                onClick={() =>
                  setSettings((current) => ({
                    ...current,
                    brandLogoUrl: "",
                  }))
                }
                type="button"
                disabled={settingsBusy}
              >
                Use Text Logo Instead
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <div className="section-kicker">Import support</div>
              <h2>Import templates</h2>
              <p>Use these columns when preparing a clean CSV or Excel import file.</p>
            </div>
          </div>

          <div className="import-reference-grid">
            {importReferenceGroups.map((group) => (
              <div key={group.label} className="detail-block import-reference-card">
                <div className="import-reference-card-head">
                  <strong>{group.label}</strong>
                  <small>{group.description}</small>
                </div>
                <div className="template-column-list">
                  {group.columns.map((column) => (
                    <code key={`${group.label}-${column}`} className="template-column-chip">
                      {column}
                    </code>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {importPreview?.warnings?.length ? (
            <div className="detail-block import-reference-warning">
              <strong>Recent workbook warnings</strong>
              <p>{workbookWarningSummary}</p>
            </div>
          ) : null}
        </section>
      </>
    );
  }

  function renderAccountsSection() {
    return (
      <div className="view-stack">
        <section className="card">
          <div className="card-header">
            <div>
              <div className="section-kicker">User access</div>
              <h2>Create and control access</h2>
              <p>Create working accounts here and review any pending access requests.</p>
            </div>
          </div>

          <div className="stat-grid compact">
            <div className="summary-tile">
              <span>Pending requests</span>
              <strong>{formatNumber(pendingUsers.length)}</strong>
            </div>
            <div className="summary-tile">
              <span>Approved users</span>
              <strong>{formatNumber(activeUsers.length)}</strong>
            </div>
            <div className="summary-tile">
              <span>Rejected users</span>
              <strong>{formatNumber(rejectedUsers.length)}</strong>
            </div>
          </div>

          <div className="detail-block editor-context-card">
            <div className="editor-context-head">
              <div className="editor-context-copy">
                <strong>{accountForm.name || "New account draft"}</strong>
                <p>Keep this to the essentials: name, email, role, and a temporary password.</p>
              </div>
              <StatusPill tone="info">Admin-controlled access</StatusPill>
            </div>
            <div className="pill-row">
              <StatusPill tone="neutral">Role {accountForm.role || "store"}</StatusPill>
              <StatusPill tone={accountForm.forcePasswordReset !== false ? "warning" : "success"}>
                {accountForm.forcePasswordReset !== false
                  ? "Password change required"
                  : "Password change optional"}
              </StatusPill>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Full Name</span>
              <input
                className="input"
                value={accountForm.name}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, name: event.target.value }))
                }
              />
              {showAccountErrors && accountErrors.name ? <small>{accountErrors.name}</small> : null}
            </label>

            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                value={accountForm.email}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, email: event.target.value }))
                }
              />
              {showAccountErrors && accountErrors.email ? <small>{accountErrors.email}</small> : null}
            </label>

            <label className="field">
              <span>Temporary Password</span>
              <input
                className="input"
                type="password"
                value={accountForm.password}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, password: event.target.value }))
                }
              />
              {showAccountErrors && accountErrors.password ? (
                <small>{accountErrors.password}</small>
              ) : (
                <small>{passwordPolicyHint}</small>
              )}
            </label>

            <label className="field">
              <span>Role</span>
              <select
                className="input"
                value={accountForm.role}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, role: event.target.value }))
                }
              >
                <option value="store">Stores</option>
                <option value="finance">Finance</option>
                <option value="admin">Admin</option>
              </select>
              {showAccountErrors && accountErrors.role ? <small>{accountErrors.role}</small> : null}
            </label>
          </div>

          <div className="checkbox-row">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={accountForm.forcePasswordReset !== false}
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    forcePasswordReset: event.target.checked,
                  }))
                }
              />
              <span>Require password change at first sign-in</span>
            </label>
          </div>

          <div className="detail-block editor-action-bar">
            <div className="editor-action-copy">
              <strong>Create this account</strong>
              <p>Use a temporary password and confirm the role before saving.</p>
            </div>
            <div className="button-row">
              <button className="button" onClick={() => void handleCreateAccount()} type="button" disabled={accountBusy}>
                {accountBusy ? "Creating..." : "Create Account"}
              </button>
              <button
                className="button button-secondary"
                onClick={handleResetAccountForm}
                type="button"
                disabled={accountBusy}
              >
                Clear Form
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <div className="section-kicker">Existing accounts</div>
              <h2>Current access and status</h2>
            </div>
          </div>

          <DataTable
            columns={accountColumns}
            rows={users}
            rowKey={(row) => row.id}
            emptyMessage="No accounts yet. Create the first working account here."
          />
        </section>
      </div>
    );
  }

  function renderDepartmentsSection() {
    return (
      <div className="view-stack">
        <section className="card">
          <div className="workspace-toggle">
            <div className="workspace-toggle-copy">
              <div className="section-kicker">Departments</div>
              <h2>Keep department setup focused</h2>
              <p>Choose an existing department first. Create a new one only when you truly need it.</p>
            </div>

            <div className="toolbar">
              <div className="segmented-control" role="tablist" aria-label="Department workspace">
                <button
                  className={departmentWorkspaceView === "browse" ? "is-active" : ""}
                  onClick={() => setDepartmentWorkspaceView("browse")}
                  type="button"
                >
                  Department List
                </button>
                <button
                  className={departmentWorkspaceView === "edit" ? "is-active" : ""}
                  onClick={() => setDepartmentWorkspaceView("edit")}
                  type="button"
                >
                  {selectedDepartmentId ? "Edit Department" : "New Department"}
                </button>
              </div>

              <button className="button button-secondary" onClick={handleNewDepartment} type="button">
                Create Department
              </button>
            </div>
          </div>
        </section>

        {departmentWorkspaceView === "browse" ? (
          <section className="card">
            <div className="card-header card-header-spread">
              <div>
                <div className="section-kicker">Department master</div>
                <h2>Search and manage departments</h2>
                <p>Select one department, then edit only when something has changed.</p>
              </div>
              <input
                className="input toolbar-search"
                placeholder="Search departments"
                value={departmentSearch}
                onChange={(event) => setDepartmentSearch(event.target.value)}
              />
            </div>

            <DataTable
              columns={departmentColumns}
              rows={filteredDepartments}
              rowKey={(row) => row.id}
              rowClassName={(row) => (row.id === selectedDepartmentId ? "row-selected" : "")}
            />
          </section>
        ) : (
          <section className="card">
            <div className="card-header card-header-spread">
              <div>
                <div className="section-kicker">Department editor</div>
                <h2>{isEditingDepartment ? "Edit department" : "Create department"}</h2>
                <p>Keep this to the essentials: code, name, and the first page in that requisition book.</p>
              </div>
              <button
                className="button button-secondary"
                onClick={() => setDepartmentWorkspaceView("browse")}
                type="button"
                disabled={departmentBusy}
              >
                Back to Department List
              </button>
            </div>

            <div className="detail-block editor-context-card">
              <div className="editor-context-head">
                <div className="editor-context-copy">
                  <strong>{departmentForm.name || (isEditingDepartment ? "Selected department" : "New department")}</strong>
                  <p>
                    {isEditingDepartment
                      ? "You are editing one department record."
                      : "Create the department once, then only revisit it when an operational detail changes."}
                  </p>
                </div>
                <StatusPill tone={isEditingDepartment ? "info" : "success"}>
                  {isEditingDepartment ? "Editing current department" : "New department"}
                </StatusPill>
              </div>
              <div className="pill-row">
                <StatusPill tone="neutral">Code {departmentForm.code || "Not set"}</StatusPill>
                <StatusPill tone="neutral">
                  Book starts {departmentForm.requisitionStartNumber || "Not set"}
                </StatusPill>
                <StatusPill tone="neutral">
                  {departmentForm.isMainStore ? "Main Store" : "Operational"}
                </StatusPill>
                <StatusPill tone={departmentForm.isActive ? "success" : "warning"}>
                  {departmentForm.isActive ? "Active" : "Inactive"}
                </StatusPill>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Department Code</span>
                <input
                  className="input"
                  value={departmentForm.code}
                  onChange={(event) =>
                    setDepartmentForm((current) => ({ ...current, code: event.target.value }))
                  }
                />
                {showDepartmentErrors && departmentErrors.code ? <small>{departmentErrors.code}</small> : null}
              </label>

              <label className="field">
                <span>Department Name</span>
                <input
                  className="input"
                  value={departmentForm.name}
                  onChange={(event) =>
                    setDepartmentForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
                {showDepartmentErrors && departmentErrors.name ? <small>{departmentErrors.name}</small> : null}
              </label>

              <label className="field">
                <span>First Requisition Page In Book</span>
                <input
                  className="input"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  type="number"
                  value={departmentForm.requisitionStartNumber}
                  onChange={(event) =>
                    setDepartmentForm((current) => ({
                      ...current,
                      requisitionStartNumber: event.target.value,
                    }))
                  }
                />
                {showDepartmentErrors && departmentErrors.requisitionStartNumber ? (
                  <small>{departmentErrors.requisitionStartNumber}</small>
                ) : (
                  <small>Use the exact first page printed in that department's requisition book.</small>
                )}
              </label>
            </div>

            <div className="checkbox-row">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={departmentForm.isMainStore}
                  onChange={(event) =>
                    setDepartmentForm((current) => ({
                      ...current,
                      isMainStore: event.target.checked,
                    }))
                  }
                />
                <span>Main Store department</span>
              </label>

              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={departmentForm.isActive}
                  onChange={(event) =>
                    setDepartmentForm((current) => ({
                      ...current,
                      isActive: event.target.checked,
                    }))
                  }
                />
                <span>Department is active</span>
              </label>
            </div>

            {showDepartmentErrors && departmentErrors.isMainStore ? (
              <div className="alert-banner alert-danger">{departmentErrors.isMainStore}</div>
            ) : null}
            {showDepartmentErrors && departmentErrors.isActive ? (
              <div className="alert-banner alert-danger">{departmentErrors.isActive}</div>
            ) : null}

            <div className="detail-block editor-action-bar">
              <div className="editor-action-copy">
                <strong>{isEditingDepartment ? "Save this department" : "Create this department"}</strong>
                <p>Departments affect requisitions, movement entry, and reports, so keep them clean.</p>
              </div>
              <div className="button-row">
                <button className="button" onClick={handleSaveDepartment} type="button" disabled={departmentBusy}>
                  {departmentBusy
                    ? isEditingDepartment
                      ? "Saving..."
                      : "Creating..."
                    : isEditingDepartment
                      ? "Save Changes"
                      : "Create Department"}
                </button>
                <button
                  className="button button-secondary"
                  onClick={handleResetDepartmentEditor}
                  type="button"
                  disabled={departmentBusy}
                >
                  {isEditingDepartment ? "Reset Changes" : "Clear Form"}
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => setDepartmentWorkspaceView("browse")}
                  type="button"
                  disabled={departmentBusy}
                >
                  Back to Department List
                </button>
              </div>
            </div>
          </section>
        )}

        {departmentWorkspaceView === "browse" ? (
          <section className="card">
            <div className="card-header card-header-spread">
              <div>
                <div className="section-kicker">Selected department</div>
                <h2>Department quick view</h2>
                <p>Review the selected department here before opening the editor.</p>
              </div>
              {selectedDepartmentId ? (
                <button
                  className="button button-secondary"
                  onClick={() => handleEditDepartment(selectedDepartmentId)}
                  type="button"
                >
                  Edit Selected Department
                </button>
              ) : null}
            </div>

            <div className="summary-grid">
              <div className="summary-tile">
                <span>Selected department</span>
                <strong>{selectedDepartment?.name ?? "No department selected"}</strong>
              </div>
              <div className="summary-tile">
                <span>Code</span>
                <strong>{selectedDepartment?.code ?? "-"}</strong>
              </div>
              <div className="summary-tile">
                <span>Book starts</span>
                <strong>{selectedDepartment?.requisitionStartNumber ?? "-"}</strong>
              </div>
              <div className="summary-tile">
                <span>Role</span>
                <strong>{selectedDepartment?.isMainStore ? "Main Store" : "Operational"}</strong>
              </div>
              <div className="summary-tile">
                <span>Status</span>
                <strong>{selectedDepartment?.isActive === false ? "Inactive" : "Active"}</strong>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  function renderItemsSection() {
    return (
      <div className="view-stack">
        <section className="card">
          <div className="workspace-toggle">
            <div className="workspace-toggle-copy">
              <div className="section-kicker">Items</div>
              <h2>Keep item setup simple</h2>
              <p>Use Item List for existing items. Create Item only for a true new record.</p>
            </div>

            <div className="toolbar">
              <div className="segmented-control" role="tablist" aria-label="Item workspace">
                <button
                  className={itemWorkspaceView === "browse" ? "is-active" : ""}
                  onClick={() => setItemWorkspaceView("browse")}
                  type="button"
                >
                  Item List
                </button>
                <button
                  className={itemWorkspaceView === "edit" ? "is-active" : ""}
                  onClick={handleOpenSelectedItemEditor}
                  type="button"
                >
                  {selectedItemId ? "Edit Item" : "New Item"}
                </button>
              </div>

              <button className="button button-secondary" onClick={handleNewItem} type="button">
                Create Item
              </button>
            </div>
          </div>
        </section>

        {itemWorkspaceView === "browse" ? (
          <section className="card">
            <div className="card-header card-header-spread">
              <div>
                <div className="section-kicker">Item master</div>
                <h2>Search and manage items</h2>
                <p>Search the item master, edit one item, or select many for one controlled bulk update.</p>
              </div>
              <div className="toolbar toolbar-wrap">
                <input
                  className="input toolbar-search"
                  placeholder="Search item master"
                  value={itemSearch}
                  onChange={(event) => setItemSearch(event.target.value)}
                />
                <button
                  className="button button-secondary button-small"
                  onClick={handleSelectFilteredItems}
                  type="button"
                  disabled={!filteredItemRows.length || allFilteredItemsSelected}
                >
                  Select Filtered
                </button>
                <button
                  className="button button-secondary button-small"
                  onClick={handleClearSelectedItems}
                  type="button"
                  disabled={!selectedItemIds.length}
                >
                  Clear Selection
                </button>
              </div>
            </div>

            <div className="stat-grid compact">
              <div className="summary-tile">
                <span>Total items</span>
                <strong>{formatNumber(stockRows.length)}</strong>
              </div>
              <div className="summary-tile">
                <span>Active items</span>
                <strong>{formatNumber(activeItemCount)}</strong>
              </div>
              <div className="summary-tile">
                <span>Inactive items</span>
                <strong>{formatNumber(inactiveItemCount)}</strong>
              </div>
              <div className="summary-tile">
                <span>Min/Max set</span>
                <strong>{formatNumber(itemsWithLimitsCount)}</strong>
              </div>
              <div className="summary-tile">
                <span>Filtered results</span>
                <strong>{formatNumber(filteredItemRows.length)}</strong>
              </div>
              <div className="summary-tile">
                <span>Selected for bulk edit</span>
                <strong>{formatNumber(selectedItemIds.length)}</strong>
              </div>
            </div>

            <div className="detail-block detail-block-compact">
              <strong>Bulk edit works on the selected rows only.</strong>
              <p>
                Select items from the table, then apply category, stock, cost, price, or status changes in one save.
              </p>
            </div>

            {(activeItemsMissingCostCount || activeItemsWithoutLevelsCount || activeItemsZeroOpeningCount) ? (
              <div className="detail-block detail-block-compact import-reference-warning">
                <strong>Items that still need setup</strong>
                <p>
                  {activeItemsMissingCostCount
                    ? `${formatNumber(activeItemsMissingCostCount)} active item(s) are missing unit cost. `
                    : ""}
                  {activeItemsWithoutLevelsCount
                    ? `${formatNumber(activeItemsWithoutLevelsCount)} active item(s) have no min/max levels. `
                    : ""}
                  {activeItemsZeroOpeningCount
                    ? `${formatNumber(activeItemsZeroOpeningCount)} active item(s) still show zero opening. `
                    : ""}
                  Choose one group below to review the affected items together, then fix them with bulk edit or by opening one item at a time.
                </p>
                <div className="toolbar toolbar-wrap">
                  <button
                    className="button button-secondary button-small"
                    onClick={() => handleSelectItemsNeedingSetup("missing-cost")}
                    type="button"
                    disabled={!activeItemsMissingCostCount}
                  >
                    Select Missing Cost
                  </button>
                  <button
                    className="button button-secondary button-small"
                    onClick={() => handleSelectItemsNeedingSetup("missing-levels")}
                    type="button"
                    disabled={!activeItemsWithoutLevelsCount}
                  >
                    Select No Min / Max
                  </button>
                  <button
                    className="button button-secondary button-small"
                    onClick={() => handleSelectItemsNeedingSetup("zero-opening")}
                    type="button"
                    disabled={!activeItemsZeroOpeningCount}
                  >
                    Select Zero Opening
                  </button>
                </div>
              </div>
            ) : null}

            <DataTable
              columns={itemColumns}
              rows={filteredItemRows}
              rowKey={(row) => row.id}
              rowClassName={(row) => (row.id === selectedItemId ? "row-selected" : "")}
              pageSize={12}
              resetKey={itemSearch}
              onRowClick={(row) => setSelectedItemId(row.id)}
              rowAriaLabel={(row) => `Select ${row.name} for quick view or editing`}
            />

            {selectedBulkItems.length ? (
              <div className="bulk-edit-card">
                <div className="card-header card-header-spread">
                  <div>
                    <div className="section-kicker">Bulk item update</div>
                    <h2>Update {formatNumber(selectedBulkItems.length)} selected items</h2>
                    <p>Leave any field blank to keep the current value on those items.</p>
                  </div>
                  <StatusPill tone="info">{formatNumber(selectedBulkItems.length)} selected</StatusPill>
                </div>

                <div className="form-grid">
                  <label className="field">
                    <span>Category</span>
                    <select
                      className="input"
                      value={bulkItemEditForm.category}
                      onChange={(event) =>
                        setBulkItemEditForm((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                    >
                      <option value="">Leave unchanged</option>
                      {commonCategoryOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Status</span>
                    <select
                      className="input"
                      value={bulkItemEditForm.isActiveAction}
                      onChange={(event) =>
                        setBulkItemEditForm((current) => ({
                          ...current,
                          isActiveAction: event.target.value,
                        }))
                      }
                    >
                      <option value="keep">Leave unchanged</option>
                      <option value="active">Set active</option>
                      <option value="inactive">Set inactive</option>
                    </select>
                  </label>
                </div>

                <div className="form-grid">
                  <label className="field">
                    <span>Opening Balance</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Leave unchanged"
                      value={bulkItemEditForm.openingBalance}
                      onChange={(event) =>
                        setBulkItemEditForm((current) => ({
                          ...current,
                          openingBalance: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="field">
                    <span>Unit Cost</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Leave unchanged"
                      value={bulkItemEditForm.unitCost}
                      onChange={(event) =>
                        setBulkItemEditForm((current) => ({
                          ...current,
                          unitCost: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="form-grid">
                  <label className="field">
                    <span>Selling Price</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Leave unchanged"
                      value={bulkItemEditForm.sellingPrice}
                      onChange={(event) =>
                        setBulkItemEditForm((current) => ({
                          ...current,
                          sellingPrice: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="field">
                    <span>Minimum Stock</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Leave unchanged"
                      value={bulkItemEditForm.minStock}
                      onChange={(event) =>
                        setBulkItemEditForm((current) => ({
                          ...current,
                          minStock: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="form-grid">
                  <label className="field">
                    <span>Maximum Stock</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Leave unchanged"
                      value={bulkItemEditForm.maxStock}
                      onChange={(event) =>
                        setBulkItemEditForm((current) => ({
                          ...current,
                          maxStock: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="button-row">
                  <button
                    className="button"
                    onClick={handleApplyBulkItemEdit}
                    type="button"
                    disabled={bulkItemEditBusy}
                  >
                    Apply To Selected Items
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => setBulkItemEditForm(buildBulkItemEditForm())}
                    type="button"
                  >
                    Reset Bulk Fields
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="card">
            <div className="card-header card-header-spread">
              <div>
                <div className="section-kicker">Item editor</div>
                <h2>{isEditingItem ? "Edit item" : "Create item"}</h2>
                <p>
                  {isEditingItem
                    ? "Change only the fields that need correction."
                    : "Start with code, name, category, and UOM. Add stock, cost, or pricing only when needed."}
                </p>
              </div>
              <button
                className="button button-secondary"
                onClick={() => setItemWorkspaceView("browse")}
                type="button"
                disabled={itemBusy}
              >
                Back to Item List
              </button>
            </div>

            <div className="detail-block editor-context-card">
              <div className="editor-context-head">
                <div className="editor-context-copy">
                  <strong>
                    {itemForm.name || (isEditingItem ? "Selected item" : "New item draft")}
                  </strong>
                  <p>
                    {isEditingItem
                      ? "You are editing one item record. Departments are chosen later during movement entry."
                      : "Items do not belong to one department here. Departments are chosen when stock is received, issued, or adjusted."}
                  </p>
                </div>
                <StatusPill tone={isEditingItem ? "info" : "success"}>
                  {isEditingItem ? "Editing current item" : "New item"}
                </StatusPill>
              </div>
              <div className="pill-row">
                <StatusPill tone="neutral">Code {itemForm.code || "Not set"}</StatusPill>
                <StatusPill tone="neutral">Category {itemForm.category || "Not set"}</StatusPill>
                <StatusPill tone="neutral">UOM {itemForm.uom || "Not set"}</StatusPill>
                {isEditingItem ? (
                  <StatusPill tone="neutral">
                    Stock {formatNumber(selectedItem?.stockOnHand ?? 0)}
                  </StatusPill>
                ) : null}
                <StatusPill tone={itemOptionalFieldCount ? "info" : "neutral"}>
                  {itemOptionalFieldCount
                    ? `${itemOptionalFieldCount} optional field(s) set`
                    : "Only core details shown"}
                </StatusPill>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Item Code</span>
                <div className="inline-action">
                  <input
                    className="input"
                    value={itemForm.code}
                    onChange={(event) =>
                      setItemForm((current) => ({ ...current, code: event.target.value }))
                    }
                  />
                  <button
                    className="button button-secondary button-small"
                    onClick={handleUseNextItemCode}
                    type="button"
                  >
                    Use Next Code
                  </button>
                </div>
                <div className="field-note">
                  Use the suggested next code unless you need to match an existing internal code.
                </div>
                {showItemErrors && itemErrors.code ? <small>{itemErrors.code}</small> : null}
              </label>

              <label className="field field-span-full">
                <span>Item Name</span>
                <input
                  className="input"
                  value={itemForm.name}
                  onChange={(event) =>
                    setItemForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Type the item name"
                />
                {showItemErrors && itemErrors.name ? <small>{itemErrors.name}</small> : null}
              </label>

              <label className="field">
                <span>Category</span>
                <select
                  className="input"
                  value={itemForm.category}
                  onChange={(event) =>
                    setItemForm((current) => ({ ...current, category: event.target.value }))
                  }
                >
                  <option value="">Select category</option>
                  {commonCategoryOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </select>
                <div className="field-note">
                  Pick one reporting category before saving the item.
                </div>
                {showItemErrors && itemErrors.category ? <small>{itemErrors.category}</small> : null}
              </label>

              <label className="field">
                <span>UOM</span>
                <input
                  className="input"
                  list="common-uom-options"
                  value={itemForm.uom}
                  onChange={(event) =>
                    setItemForm((current) => ({ ...current, uom: event.target.value }))
                  }
                  placeholder="PCS, BTL, KGS, LTR"
                />
                <datalist id="common-uom-options">
                  {commonUomOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
                {showItemErrors && itemErrors.uom ? <small>{itemErrors.uom}</small> : null}
              </label>
            </div>

            <div className="detail-block editor-optional-card">
              <div className="editor-optional-head">
                <div className="editor-context-copy">
                  <strong>Optional stock, cost, and level controls</strong>
                  <p>
                    Open this only when you need a starting balance, cost, price, or control level.
                  </p>
                </div>
                <button
                  className="button button-secondary button-small"
                  onClick={() => setShowItemAdvancedFields((currentValue) => !currentValue)}
                  type="button"
                >
                  {showItemAdvancedFields
                    ? "Hide Optional Fields"
                    : itemOptionalFieldCount
                      ? "Review Optional Fields"
                      : "Add Optional Fields"}
                </button>
              </div>

              {showItemAdvancedFields ? (
                <>
                  <div className="form-grid">
                    <label className="field">
                      <span>Opening Balance</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={itemForm.openingBalance}
                        onChange={(event) =>
                          setItemForm((current) => ({
                            ...current,
                            openingBalance: event.target.value,
                          }))
                        }
                      />
                      {showItemErrors && itemErrors.openingBalance ? <small>{itemErrors.openingBalance}</small> : null}
                    </label>

                    <label className="field">
                      <span>Unit Cost</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={itemForm.unitCost}
                        onChange={(event) =>
                          setItemForm((current) => ({
                            ...current,
                            unitCost: event.target.value,
                          }))
                        }
                        placeholder="Optional"
                      />
                      {showItemErrors && itemErrors.unitCost ? <small>{itemErrors.unitCost}</small> : null}
                    </label>

                    <label className="field">
                      <span>Selling Price</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={itemForm.sellingPrice}
                        onChange={(event) =>
                          setItemForm((current) => ({
                            ...current,
                            sellingPrice: event.target.value,
                          }))
                        }
                        placeholder="Optional"
                      />
                      {showItemErrors && itemErrors.sellingPrice ? (
                        <small>{itemErrors.sellingPrice}</small>
                      ) : null}
                    </label>
                  </div>

                  <div className="form-grid">
                    <label className="field">
                      <span>Minimum Stock</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={itemForm.minStock}
                        onChange={(event) =>
                          setItemForm((current) => ({
                            ...current,
                            minStock: event.target.value,
                          }))
                        }
                        placeholder="Optional"
                      />
                      {showItemErrors && itemErrors.minStock ? <small>{itemErrors.minStock}</small> : null}
                    </label>

                    <label className="field">
                      <span>Maximum Stock</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={itemForm.maxStock}
                        onChange={(event) =>
                          setItemForm((current) => ({
                            ...current,
                            maxStock: event.target.value,
                          }))
                        }
                        placeholder="Optional"
                      />
                      {showItemErrors && itemErrors.maxStock ? <small>{itemErrors.maxStock}</small> : null}
                    </label>
                  </div>
                </>
              ) : (
                <small>
                  Departments are assigned during movement entry, so item setup stays focused on the item itself.
                </small>
              )}
            </div>

            <div className="checkbox-row">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={itemForm.isActive}
                  onChange={(event) =>
                    setItemForm((current) => ({ ...current, isActive: event.target.checked }))
                  }
                />
                <span>Item is active for new entries</span>
              </label>
            </div>

            <div className="detail-block editor-action-bar">
              <div className="editor-action-copy">
                <strong>{isEditingItem ? "Save this item" : "Create this item"}</strong>
                <p>You only need code, name, category, and UOM to create a usable item.</p>
              </div>
              <div className="button-row">
                <button className="button" onClick={() => handleSaveItem(false)} type="button" disabled={itemBusy}>
                  {itemBusy
                    ? isEditingItem
                      ? "Saving..."
                      : "Creating..."
                    : isEditingItem
                      ? "Save Changes"
                      : "Create Item"}
                </button>
                {!isEditingItem ? (
                  <button
                    className="button button-secondary"
                    onClick={() => handleSaveItem(true)}
                    type="button"
                    disabled={itemBusy}
                  >
                    Create and Add Another
                  </button>
                ) : null}
                <button
                  className="button button-secondary"
                  onClick={handleResetItemEditor}
                  type="button"
                  disabled={itemBusy}
                >
                  {isEditingItem ? "Reset Changes" : "Clear Form"}
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => setItemWorkspaceView("browse")}
                  type="button"
                  disabled={itemBusy}
                >
                  Back to Item List
                </button>
              </div>
            </div>
          </section>
        )}

        {itemWorkspaceView === "browse" ? (
          <section className="card">
            <div className="card-header card-header-spread">
              <div>
                <div className="section-kicker">Selected item</div>
                <h2>Item quick view</h2>
                <p>Review the selected item here before opening the editor.</p>
              </div>
              {selectedItemId ? (
                <button
                  className="button button-secondary"
                  onClick={() => handleEditItem(selectedItemId)}
                  type="button"
                >
                  Edit Selected Item
                </button>
              ) : null}
            </div>

            <div className="summary-grid">
              <div className="summary-tile">
                <span>Selected item</span>
                <strong>{selectedItem?.name ?? "No item selected"}</strong>
              </div>
              <div className="summary-tile">
                <span>Code / UOM</span>
                <strong>{selectedItem ? `${selectedItem.code} / ${selectedItem.uom}` : "-"}</strong>
              </div>
              <div className="summary-tile">
                <span>Stock on hand</span>
                <strong>{formatNumber(selectedItem?.stockOnHand ?? 0)}</strong>
              </div>
              <div className="summary-tile">
                <span>Unit cost</span>
                <strong>
                  {selectedItem?.unitCost === null || selectedItem?.unitCost === undefined
                    ? "-"
                    : formatNumber(selectedItem.unitCost)}
                </strong>
              </div>
              <div className="summary-tile">
                <span>Stock value</span>
                <strong>
                  {selectedItem?.stockValue === null || selectedItem?.stockValue === undefined
                    ? "-"
                    : formatNumber(selectedItem.stockValue)}
                </strong>
              </div>
              <div className="summary-tile">
                <span>Status</span>
                <strong>
                  {selectedItem?.stockOnHand < 0
                    ? "Negative"
                    : selectedItem?.belowMinStock
                      ? "Below minimum"
                      : selectedItem?.aboveMaxStock
                        ? "Above maximum"
                        : selectedItem?.isActive === false
                          ? "Inactive"
                          : "Healthy"}
                </strong>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  function renderImportsSection() {
    return (
      <>
        <section className="card">
          <div className="card-header card-header-spread">
            <div>
              <div className="section-kicker">Daily stores movement template</div>
              <h2>Import daily workbook</h2>
              <p>Dated sheets are detected automatically.</p>
            </div>
            <StatusPill tone="info">Workbook</StatusPill>
          </div>

          {importBusy ? <div className="alert-banner alert-warning">Parsing import file...</div> : null}

          <div className="import-step-grid">
            <article className="import-step-card">
              <span className="system-note-kicker">Step 1</span>
              <strong>Upload workbook</strong>
              <small>Select the Excel file.</small>
            </article>
            <article className="import-step-card">
              <span className="system-note-kicker">Step 2</span>
              <strong>Map departments</strong>
              <small>Match issue sections.</small>
            </article>
            <article className="import-step-card">
              <span className="system-note-kicker">Step 3</span>
              <strong>Narrow scope</strong>
              <small>Date, category, items.</small>
            </article>
            <article className="import-step-card">
              <span className="system-note-kicker">Step 4</span>
              <strong>Apply</strong>
              <small>Save selected data.</small>
            </article>
          </div>

          <div className="import-config-layout">
            <div className="import-config-panel">
              <div className="import-config-head">
                <div>
                  <div className="system-note-kicker">Upload and date window</div>
                  <strong>Workbook and period</strong>
                </div>
                <StatusPill tone={importPreview ? "success" : "info"}>
                  {importPreview ? "Workbook parsed" : "Waiting for workbook"}
                </StatusPill>
              </div>

              <label className="field">
                <span>Daily stores workbook</span>
                <input
                  className="input"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleWorkbookFileChange}
                />
              </label>

              <div className="detail-block detail-block-compact">
                <strong>Imported as {workbookImportedBy}</strong>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>Workbook From</span>
                  <select
                    className="input"
                    value={importConfig.workbookDateFrom}
                    onChange={(event) => {
                      const nextDate = event.target.value;
                      setImportConfig((currentConfig) => ({
                        ...currentConfig,
                        workbookDateFrom: nextDate,
                        workbookDateTo:
                          currentConfig.workbookDateTo && currentConfig.workbookDateTo < nextDate
                            ? nextDate
                            : currentConfig.workbookDateTo,
                        openingDate:
                          currentConfig.openingDate && currentConfig.openingDate < nextDate
                            ? nextDate
                            : currentConfig.openingDate,
                      }));
                    }}
                    disabled={!importPreview}
                  >
                    {!importPreview?.availableDates?.length ? (
                      <option value="">Upload workbook first</option>
                    ) : (
                      importPreview.availableDates.map((date) => (
                        <option key={date} value={date}>
                          {date}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="field">
                  <span>Workbook To</span>
                  <select
                    className="input"
                    value={importConfig.workbookDateTo}
                    onChange={(event) => {
                      const nextDate = event.target.value;
                      setImportConfig((currentConfig) => ({
                        ...currentConfig,
                        workbookDateTo: nextDate,
                        workbookDateFrom:
                          currentConfig.workbookDateFrom && currentConfig.workbookDateFrom > nextDate
                            ? nextDate
                            : currentConfig.workbookDateFrom,
                        openingDate:
                          currentConfig.openingDate && currentConfig.openingDate > nextDate
                            ? nextDate
                            : currentConfig.openingDate,
                      }));
                    }}
                    disabled={!importPreview}
                  >
                    {!importPreview?.availableDates?.length ? (
                      <option value="">Upload workbook first</option>
                    ) : (
                      importPreview.availableDates.map((date) => (
                        <option key={date} value={date}>
                          {date}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="field">
                  <span>Start day for stock position</span>
                  <select
                    className="input"
                    value={importConfig.openingDate}
                    onChange={(event) => handleImportConfigChange("openingDate", event.target.value)}
                    disabled={!importPreview}
                  >
                    {!filteredWorkbookPreview?.availableDates?.length ? (
                      <option value="">Upload workbook first</option>
                    ) : (
                      filteredWorkbookPreview.availableDates.map((date) => (
                        <option key={date} value={date}>
                          {date}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="field">
                  <span>Movement Import Mode</span>
                  <select
                    className="input"
                    value={importConfig.movementMode}
                    onChange={(event) => handleImportConfigChange("movementMode", event.target.value)}
                    disabled={!importConfig.includeWorkbookMovements}
                  >
                    <option value="append">Append to existing movements</option>
                    <option value="replace">Replace current movement history</option>
                  </select>
                  {!importConfig.includeWorkbookMovements ? (
                    <small>Enable movement history below if you want this mode to be used.</small>
                  ) : null}
                </label>
              </div>
            </div>

            <div className="import-config-panel">
              <div className="import-config-head">
                <div>
                  <div className="system-note-kicker">Department mapping</div>
                  <strong>Set where imported stock belongs</strong>
                </div>
                <StatusPill tone="info">
                  {workbookIssueMappingCategories.length
                    ? `${workbookIssueMappingCategories.length} section map(s)`
                    : "Using defaults"}
                </StatusPill>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>Imported receipts go into</span>
                  <select
                    className="input"
                    value={importConfig.receiveDepartmentId}
                    onChange={(event) =>
                      handleImportConfigChange("receiveDepartmentId", event.target.value)
                    }
                  >
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Issues without a clear match go to</span>
                  <select
                    className="input"
                    value={importConfig.issueDepartmentId}
                    onChange={(event) =>
                      handleImportConfigChange("issueDepartmentId", event.target.value)
                    }
                  >
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {workbookIssueMappingCategories.length ? (
                <div className="form-grid">
                  {workbookIssueMappingCategories.map((category) => (
                    <label key={category} className="field">
                      <span>{category}</span>
                      <select
                        className="input"
                        value={importConfig.issueDepartmentMap?.[category] ?? ""}
                        onChange={(event) =>
                          setImportConfig((currentConfig) => ({
                            ...currentConfig,
                            issueDepartmentMap: {
                              ...currentConfig.issueDepartmentMap,
                              [category]: event.target.value,
                            },
                          }))
                        }
                      >
                        <option value="">Use fallback issue department</option>
                        {departments.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              ) : null}

              <div className="detail-block detail-block-compact">
                <strong>Issue mapping</strong>
                <p>Sections map first. Fallback is only for unmatched rows.</p>
              </div>
            </div>
          </div>

          <div className="import-workspace-layout">
            <div className="workbook-import-plan import-scope-panel">
              <div className="workbook-import-plan-head">
                <div>
                  <div className="system-note-kicker">Scope</div>
                  <strong>Import scope</strong>
                </div>
                <StatusPill tone="info">{workbookScopeLabel}</StatusPill>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>Category Scope</span>
                  <select
                    className="input"
                    value={importConfig.workbookCategoryFilter}
                    onChange={(event) =>
                      handleImportConfigChange("workbookCategoryFilter", event.target.value)
                    }
                    disabled={!dateFilteredWorkbookPreview}
                  >
                    <option value="all">Every category</option>
                    {workbookCategoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Find Items In This Scope</span>
                  <input
                    className="input"
                    value={workbookItemSearch}
                    onChange={(event) => setWorkbookItemSearch(event.target.value)}
                    placeholder="Search code, item, UOM, or category"
                    disabled={!dateFilteredWorkbookPreview}
                  />
                </label>
              </div>

              <div className="button-row">
                <button
                  className="button button-secondary button-small"
                  onClick={handleSelectAllWorkbookScopeItems}
                  type="button"
                  disabled={!workbookCategoryScopedItemIds.size}
                >
                  Select All In Scope
                </button>
                <button
                  className="button button-secondary button-small"
                  onClick={handleSelectVisibleWorkbookItems}
                  type="button"
                  disabled={!workbookSelectableItems.length}
                >
                  Add Visible Items
                </button>
                <button
                  className="button button-secondary button-small"
                  onClick={handleClearWorkbookItemSelection}
                  type="button"
                  disabled={!selectedWorkbookItemIds.length}
                >
                  Clear Item Selection
                </button>
              </div>

              <div className="detail-block detail-block-compact">
                <strong>Current scope</strong>
                <p>
                  {filteredWorkbookPreview?.selectedDateFrom || "-"} to{" "}
                  {filteredWorkbookPreview?.selectedDateTo || "-"} /{" "}
                  {importConfig.workbookCategoryFilter === "all"
                    ? "all categories"
                    : importConfig.workbookCategoryFilter} /{" "}
                  {selectedWorkbookItemIds.length
                    ? `${formatNumber(selectedWorkbookItemIds.length)} item(s)`
                    : "all items"}
                </p>
              </div>

              {dateFilteredWorkbookPreview ? (
                <DataTable
                  columns={workbookItemColumns}
                  rows={workbookSelectableItems}
                  rowKey={(row) => row.itemId}
                  pageSize={8}
                  resetKey={`${importConfig.workbookCategoryFilter}-${workbookItemSearch}`}
                  emptyMessage="No workbook items match the current date, category, and search scope."
                />
              ) : null}
            </div>

            <div className="workbook-import-plan import-apply-panel">
              <div className="workbook-import-plan-head">
                <div>
                  <div className="system-note-kicker">Apply</div>
                  <strong>Data to import</strong>
                </div>
                <StatusPill tone={selectedWorkbookImportChoices.length ? "success" : "info"}>
                  {selectedWorkbookImportChoices.length
                    ? `${selectedWorkbookImportChoices.length} selected`
                    : "Nothing selected"}
                </StatusPill>
              </div>

              <div className="workbook-selection-grid">
                {workbookImportChoices.map((choice) => (
                  <label key={choice.key} className="selection-card">
                    <input
                      checked={Boolean(importConfig[choice.key])}
                      onChange={(event) =>
                        handleImportConfigChange(choice.key, event.target.checked)
                      }
                      type="checkbox"
                    />
                    <div>
                      <strong>{choice.label}</strong>
                      <span>{choice.note}</span>
                      <small>{formatNumber(choice.count)} ready from this workbook.</small>
                    </div>
                  </label>
                ))}
              </div>

              <div className="detail-block detail-block-compact">
                <strong>Safe default</strong>
                <p>Openings + movement history. Leave item setup off unless you mean to overwrite it.</p>
              </div>

              <div className="button-row import-action-row">
                <button
                  className="button"
                  onClick={handleImportFullWorkbook}
                  disabled={!filteredWorkbookPreview || importBusy || !selectedWorkbookImportChoices.length}
                  type="button"
                >
                  Apply Selected Workbook Data
                </button>
                <button
                  className="button button-secondary"
                  onClick={handleExportWorkbookPreview}
                  disabled={!filteredWorkbookPreview}
                  type="button"
                >
                  Export Workbook Window
                </button>
              </div>
            </div>
          </div>

          <div className="detail-block detail-block-compact import-support-tools">
            <div className="workbook-import-plan-head">
              <div>
                <strong>Support tools</strong>
              </div>
            </div>
            <div className="button-row import-action-row">
              <button
                className="button button-secondary"
                onClick={handleExportCurrentDataWorkbook}
                type="button"
              >
                Export Current Data
              </button>
              <button
                className="button button-secondary"
                onClick={handleDownloadImportTemplatesWorkbook}
                type="button"
              >
                Download Import Templates
              </button>
            </div>
          </div>

          {filteredWorkbookPreview ? (
            <div className="workbook-import-preview">
              <div className="workbook-import-plan-head">
                <div>
                  <div className="section-kicker">Parsed workbook preview</div>
                  <strong>Preview before apply</strong>
                </div>
                <div className="import-preview-toolbar">
                  <StatusPill tone={workbookPreviewExceptionCount ? "warning" : "success"}>
                    {workbookPreviewExceptionCount
                      ? `${formatNumber(workbookPreviewExceptionCount)} exception(s)`
                      : "Clean preview"}
                  </StatusPill>
                  <div className="segmented-control">
                    <button
                      className={workbookPreviewPanel === "summary" ? "is-active" : ""}
                      onClick={() => setWorkbookPreviewPanel("summary")}
                      type="button"
                    >
                      Summary
                    </button>
                    <button
                      className={workbookPreviewPanel === "movements" ? "is-active" : ""}
                      onClick={() => setWorkbookPreviewPanel("movements")}
                      type="button"
                    >
                      Movements
                    </button>
                    <button
                      className={workbookPreviewPanel === "exceptions" ? "is-active" : ""}
                      onClick={() => setWorkbookPreviewPanel("exceptions")}
                      type="button"
                    >
                      Exceptions
                    </button>
                  </div>
                </div>
              </div>

              <div className="stat-grid compact">
                <div className="summary-tile">
                  <span>Sheets</span>
                  <strong>{formatNumber(filteredWorkbookPreview.sheetSummaries.length)}</strong>
                </div>
                <div className="summary-tile">
                  <span>Item Profiles</span>
                  <strong>{formatNumber(filteredWorkbookPreview.itemProfileRows.length)}</strong>
                </div>
                <div className="summary-tile">
                  <span>Openings</span>
                  <strong>{formatNumber(filteredWorkbookPreview.openingSnapshots.length)}</strong>
                </div>
                <div className="summary-tile">
                  <span>Movements</span>
                  <strong>{formatNumber(filteredWorkbookPreview.movementRows.length)}</strong>
                </div>
                <div className="summary-tile">
                  <span>New Items</span>
                  <strong>
                    {formatNumber(
                      filteredWorkbookPreview.itemProfileRows.filter(
                        (row) => row.importAction === "new"
                      ).length
                    )}
                  </strong>
                </div>
                <div className="summary-tile">
                  <span>Exceptions</span>
                  <strong>{formatNumber(workbookPreviewExceptionCount)}</strong>
                </div>
              </div>

              {workbookPreviewPanel === "summary" ? (
                <>
                  <div className="detail-block">
                    <div className="workbook-import-plan-head">
                      <div>
                        <div className="section-kicker">Report readiness</div>
                        <strong>What this workbook window can feed</strong>
                      </div>
                      <StatusPill
                        tone={
                          workbookReportInsight?.reportReady
                            ? "success"
                            : workbookReportInsight?.readyReportCount
                              ? "warning"
                              : "info"
                        }
                      >
                        {workbookReportInsight?.reportReady
                          ? "Ready for reports"
                          : workbookReportInsight?.readyReportCount
                            ? `${workbookReportInsight.readyReportCount} report view(s) supported`
                            : "Needs more data"}
                      </StatusPill>
                    </div>

                    <div className="stat-grid compact">
                      <div className="summary-tile">
                        <span>Opening suggestion</span>
                        <strong>{workbookReportInsight?.openingDateSuggestion || "-"}</strong>
                        <small>Best date to anchor balances in this workbook window.</small>
                      </div>
                      <div className="summary-tile">
                        <span>Reports supported</span>
                        <strong>{formatNumber(workbookReportInsight?.readyReportCount ?? 0)}</strong>
                        <small>
                          {(workbookReportInsight?.supportedReports ?? []).join(", ") ||
                            "No report view is ready yet."}
                        </small>
                      </div>
                      <div className="summary-tile">
                        <span>Receipt cost coverage</span>
                        <strong>{formatNumber(workbookReportInsight?.receiptCostCoveragePercent ?? 0)}%</strong>
                        <small>
                          {formatNumber(workbookReportInsight?.receiptCostedCount ?? 0)} of{" "}
                          {formatNumber(workbookReportInsight?.receiptLineCount ?? 0)} receipt lines carry
                          direct cost.
                        </small>
                      </div>
                      <div className="summary-tile">
                        <span>Level coverage</span>
                        <strong>{formatNumber(workbookReportInsight?.levelCoveragePercent ?? 0)}%</strong>
                        <small>
                          {formatNumber(workbookReportInsight?.itemsWithLevelsCount ?? 0)} of{" "}
                          {formatNumber(workbookReportInsight?.itemProfileCount ?? 0)} items carry min/max
                          levels.
                        </small>
                      </div>
                    </div>

                    <div className="insight-grid">
                      {(workbookReportInsight?.reportPlans ?? []).map((plan) => (
                        <article
                          key={plan.id}
                          className={`insight-card insight-${plan.tone}`}
                        >
                          <div className="insight-card-top">
                            <strong>{plan.label}</strong>
                            <StatusPill tone={plan.tone}>{plan.statusLabel}</StatusPill>
                          </div>
                          <p>{plan.description}</p>
                          <small>
                            Recommended import: {describeWorkbookImportChoices(plan.recommendedChoices)}.
                          </small>
                          <small>
                            Reports:{" "}
                            {plan.focusReports.length
                              ? plan.focusReports.join(", ")
                              : "No matching report view in this workbook window yet."}
                          </small>
                          {plan.notes.length ? (
                            <ul className="simple-list">
                              {plan.notes.map((note) => (
                                <li key={note}>{note}</li>
                              ))}
                            </ul>
                          ) : null}
                          <div className="button-row">
                            <button
                              className="button button-secondary"
                              onClick={() => handleApplyWorkbookReportPlan(plan.id)}
                              type="button"
                            >
                              Use This Plan
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>

                    {workbookReportInsight?.notes?.length ? (
                      <>
                        <strong>Import analysis notes</strong>
                        <ul className="simple-list">
                          {workbookReportInsight.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                          {workbookBalanceOnlyNote ? <li>{workbookBalanceOnlyNote}</li> : null}
                        </ul>
                      </>
                    ) : workbookBalanceOnlyNote ? (
                      <>
                        <strong>Import analysis notes</strong>
                        <ul className="simple-list">
                          <li>{workbookBalanceOnlyNote}</li>
                        </ul>
                      </>
                    ) : null}
                  </div>

                  <div className="detail-block detail-block-compact">
                    <strong>What the current selection will do</strong>
                    <ul className="simple-list">
                      <li>
                        The workbook window is currently {filteredWorkbookPreview.selectedDateFrom} to{" "}
                        {filteredWorkbookPreview.selectedDateTo}.
                      </li>
                      <li>
                        Category scope is{" "}
                        {importConfig.workbookCategoryFilter === "all"
                          ? "every category"
                          : importConfig.workbookCategoryFilter}
                        , and item scope is{" "}
                        {selectedWorkbookItemIds.length
                          ? `${formatNumber(selectedWorkbookItemIds.length)} selected item(s)`
                          : "all items in the current scope"}
                        .
                      </li>
                      <li>
                        The selected start day becomes the opening stock anchor when you include opening stock.
                      </li>
                      <li>
                        Movement import turns received stock, issued stock, and closing differences into app
                        movement lines.
                      </li>
                    </ul>
                  </div>

                  <DataTable
                    columns={previewSheetColumns}
                    rows={filteredWorkbookPreview.sheetSummaries}
                    rowKey={(row) => `${row.sheetName}-${row.date}`}
                  />
                </>
              ) : null}

              {workbookPreviewPanel === "movements" ? (
                <div className="detail-block">
                  <strong>Workbook movement preview</strong>
                  <p>These are the lines that will appear in History and Finance for the selected workbook window.</p>

                  <div className="stat-grid compact">
                    <div className="summary-tile">
                      <span>Receipts</span>
                      <strong>{formatNumber(workbookMovementSummary.inLines)}</strong>
                    </div>
                    <div className="summary-tile">
                      <span>Issues</span>
                      <strong>{formatNumber(workbookMovementSummary.outLines)}</strong>
                    </div>
                    <div className="summary-tile">
                      <span>Adjustments</span>
                      <strong>{formatNumber(workbookMovementSummary.adjLines)}</strong>
                    </div>
                    <div className="summary-tile">
                      <span>Visible Rows</span>
                      <strong>{formatNumber(filteredWorkbookMovementRows.length)}</strong>
                    </div>
                  </div>

                  <div className="form-grid">
                    <label className="field">
                      <span>Movement Type</span>
                      <select
                        className="input"
                        value={workbookMovementTypeFilter}
                        onChange={(event) => setWorkbookMovementTypeFilter(event.target.value)}
                      >
                        <option value="all">All</option>
                        <option value="IN">Receipts</option>
                        <option value="OUT">Issues</option>
                        <option value="ADJ">Adjustments</option>
                      </select>
                    </label>

                    <label className="field">
                      <span>Search Movement Rows</span>
                      <input
                        className="input"
                        value={workbookMovementSearch}
                        onChange={(event) => setWorkbookMovementSearch(event.target.value)}
                        placeholder="Search item, sheet, or document"
                      />
                    </label>
                  </div>

                  <DataTable
                    columns={workbookMovementColumns}
                    rows={filteredWorkbookMovementRows}
                    rowKey={(row, index) =>
                      `${row.date}-${row.type}-${row.itemId}-${row.referenceNumber || row.requisitionNumber}-${index}`
                    }
                    pageSize={12}
                    resetKey={`${workbookMovementTypeFilter}-${deferredWorkbookMovementSearch}-${filteredWorkbookPreview.selectedDateFrom}-${filteredWorkbookPreview.selectedDateTo}`}
                  />
                </div>
              ) : null}

              {workbookPreviewPanel === "exceptions" ? (
                <div className="import-exception-grid">
                  {reconciliationPreview.length ? (
                    <div className="detail-block">
                      <strong>Sample closing balance reconciliations</strong>
                      <p>These become adjustment lines if you include movement history.</p>
                      <DataTable
                        columns={[
                          { key: "sheetName", label: "Sheet" },
                          { key: "rowNumber", label: "Row", align: "right" },
                          { key: "itemName", label: "Item" },
                          { key: "variance", label: "Adjustment", align: "right" },
                        ]}
                        rows={reconciliationPreview}
                        rowKey={(row) => `${row.sheetName}-${row.rowNumber}-${row.itemId}`}
                      />
                    </div>
                  ) : (
                    <div className="empty-panel">
                      <strong>No closing balance exceptions in this scope.</strong>
                      <p>The selected workbook window does not need reconciliation adjustments.</p>
                    </div>
                  )}

                  {unmatchedPreview.length ? (
                    <div className="detail-block">
                      <strong>Sample unmatched workbook rows</strong>
                      <p>These rows are left out instead of breaking the import.</p>
                      <DataTable
                        columns={unmatchedColumns}
                        rows={unmatchedPreview}
                        rowKey={(row) => `${row.sheetName}-${row.rowNumber}-${row.itemLabel}`}
                      />
                    </div>
                  ) : (
                    <div className="empty-panel">
                      <strong>No unmatched rows in this scope.</strong>
                      <p>The workbook rows in the selected window can already be understood by the importer.</p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="card">
          <div className="card-header card-header-spread">
            <div>
              <div className="section-kicker">Structured imports</div>
              <h2>Import item master, departments, or movement files</h2>
              <p>Use one clean CSV or Excel sheet when you need setup or historical data.</p>
            </div>
            <StatusPill tone="success">Single-sheet CSV or Excel</StatusPill>
          </div>

          <div className="structured-import-layout">
            <div className="structured-import-panel">
              <label className="field">
                <span>Import Type</span>
                <select
                  className="input"
                  value={importConfig.structuredImportType}
                  onChange={(event) =>
                    handleImportConfigChange("structuredImportType", event.target.value)
                  }
                >
                  <option value="items">Item Master</option>
                  <option value="openings">Opening Balances</option>
                  <option value="departments">Departments</option>
                  <option value="movements">Audit Trail</option>
                </select>
              </label>

              {importConfig.structuredImportType === "movements" ? (
                <label className="field">
                  <span>Movement Mode</span>
                  <select
                    className="input"
                    value={importConfig.structuredMovementMode}
                    onChange={(event) =>
                      handleImportConfigChange("structuredMovementMode", event.target.value)
                    }
                  >
                    <option value="append">Append to existing movements</option>
                    <option value="replace">Replace current movement history</option>
                  </select>
                </label>
              ) : importConfig.structuredImportType === "openings" ? (
                <div className="detail-block structured-import-help">
                  <strong>{structuredImportMeta.label}</strong>
                  <p>{structuredImportMeta.description}</p>
                </div>
              ) : (
                <>
                  <label className="field">
                    <span>Apply Rows</span>
                    <select
                      className="input"
                      value={importConfig.structuredApplyScope}
                      onChange={(event) =>
                        handleImportConfigChange("structuredApplyScope", event.target.value)
                      }
                    >
                      <option value="all">All ready rows</option>
                      <option value="new-only">New rows only</option>
                      <option value="updates-only">Update rows only</option>
                    </select>
                  </label>
                  <div className="detail-block structured-import-help">
                    <strong>{structuredImportMeta.label}</strong>
                    <p>{structuredImportMeta.description}</p>
                  </div>
                </>
              )}

              <div className="button-row import-action-row structured-import-actions">
                <label className="button button-secondary">
                  <input
                    className="visually-hidden"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleStructuredImportFileChange}
                  />
                  Choose File
                </label>
                <button
                  className="button"
                  onClick={handleApplyStructuredImport}
                  disabled={!structuredImportPreview || importBusy}
                  type="button"
                >
                  Import {structuredImportMeta.label}
                </button>
              </div>
            </div>

            <div className="detail-block structured-import-reference">
              <div className="structured-import-reference-head">
                <div>
                  <div className="system-note-kicker">Expected Columns</div>
                  <strong>{structuredImportMeta.label}</strong>
                </div>
                <StatusPill tone="info">Required</StatusPill>
              </div>
              <p>{structuredImportMeta.description}</p>
              <div className="template-column-list">
                {structuredImportMeta.columns.map((column) => (
                  <code key={column} className="template-column-chip">
                    {column}
                  </code>
                ))}
              </div>
            </div>
          </div>

          {structuredImportPreview ? (
            <>
              <div className="stat-grid compact">
                <div className="summary-tile">
                  <span>Sheet Rows</span>
                  <strong>{formatNumber(structuredImportPreview.rowCount)}</strong>
                </div>
                <div className="summary-tile">
                  <span>Ready Rows</span>
                  <strong>{formatNumber(structuredImportPreview.mappedRows.length)}</strong>
                </div>
                <div className="summary-tile">
                  <span>Selected Rows</span>
                  <strong>{formatNumber(structuredImportApplyRows.length)}</strong>
                </div>
                <div className="summary-tile">
                  <span>Updates</span>
                  <strong>{formatNumber(structuredImportPreview.updateCount ?? 0)}</strong>
                </div>
                <div className="summary-tile">
                  <span>New</span>
                  <strong>{formatNumber(structuredImportPreview.newCount ?? 0)}</strong>
                </div>
                <div className="summary-tile">
                  <span>Errors</span>
                  <strong>{formatNumber(structuredImportPreview.errors?.length ?? 0)}</strong>
                </div>
                <div className="summary-tile">
                  <span>Warnings</span>
                  <strong>{formatNumber(structuredImportPreview.warnings?.length ?? 0)}</strong>
                </div>
              </div>

              <div className="detail-block structured-import-loaded-file">
                <strong>Loaded file</strong>
                <p>
                  {structuredImportPreview.fileName}
                  {structuredImportPreview.sheetName
                    ? ` • sheet: ${structuredImportPreview.sheetName}`
                    : ""}
                </p>
              </div>

              {structuredImportPreview.errors?.length ? (
                <div className="detail-block">
                  <strong>Import errors</strong>
                  <p>{structuredImportPreview.errors.slice(0, 8).join(" ")}</p>
                </div>
              ) : null}

              {structuredImportPreview.warnings?.length ? (
                <div className="detail-block">
                  <strong>Import warnings</strong>
                  <p>{structuredImportPreview.warnings.slice(0, 8).join(" ")}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </>
    );
  }

  return (
    <div className="workspace-layout admin-layout">
      <TextPromptDialog
        isOpen={Boolean(resetPasswordDialog.userId)}
        title="Reset account password"
        description={
          resetPasswordDialog.userId
            ? `Set a new temporary password for ${resetPasswordDialog.userName}. The user will need to sign in with this password and change it if forced reset is enabled.`
            : ""
        }
        label="Temporary password"
        value={resetPasswordDialog.password}
        error={resetPasswordDialog.error}
        helperText={passwordPolicyHint}
        placeholder="Enter a strong temporary password"
        inputType="password"
        submitLabel="Reset Password"
        cancelLabel="Cancel"
        isBusy={resetPasswordDialog.isBusy}
        onChange={(value) =>
          setResetPasswordDialog((currentDialog) => ({
            ...currentDialog,
            password: value,
            error: "",
          }))
        }
        onClose={handleCloseResetPasswordDialog}
        onSubmit={handleConfirmResetAccountPassword}
      />

      <aside className="menu-panel menu-panel-light admin-menu-panel">
        <div className="menu-panel-header admin-menu-header">
          <div className="section-kicker">Setup</div>
          <h2>Control setup</h2>
          <p>Choose an area.</p>
        </div>

        <div className="menu-list admin-menu-list">
          {adminSections.map((section) => (
            <button
              key={section.id}
              className={`menu-button menu-button-light admin-menu-button ${
                activeSection === section.id ? "is-active" : ""
              }`}
              onClick={() => setActiveSection(section.id)}
              type="button"
            >
              <strong>{section.label}</strong>
              <span>{section.hint}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="view-stack">
        {currentSection ? (
          <section className="card current-view-card admin-current-view-card">
            <div className="section-kicker">Current area</div>
            <h2>{currentSection.label}</h2>
            <p>{currentSection.hint}</p>
          </section>
        ) : null}

        {message ? (
          <div className={`alert-banner alert-${message.tone}`}>
            <div className="alert-copy">
              {message.text}
              {message.actions?.length ? (
                <div className="alert-actions">
                  {message.actions.map((action) => (
                    <button
                      key={action.id}
                      className={`button button-small ${
                        action.variant === "secondary" ? "button-secondary" : ""
                      }`}
                      onClick={() => handleMessageAction(action.id)}
                      type="button"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeSection === "system" ? renderSystemSection() : null}
        {activeSection === "accounts" ? renderAccountsSection() : null}
        {activeSection === "departments" ? renderDepartmentsSection() : null}
        {activeSection === "items" ? renderItemsSection() : null}
        {activeSection === "imports" ? renderImportsSection() : null}
      </div>
    </div>
  );
}
