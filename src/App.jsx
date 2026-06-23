import React, { useEffect, useMemo, useRef, useState } from "react";
import AssistantPanel from "./components/AssistantPanel";
import AppShell from "./components/AppShell";
import GettingStartedTour from "./components/GettingStartedTour";
import PasswordChangePanel from "./components/PasswordChangePanel";
import TextPromptDialog from "./components/TextPromptDialog";
import { normalizeItemCategory } from "./data/itemCategories";
import { useStockFlowState } from "./hooks/useStockFlowState";
import { buildFinancePeriodRange, shiftFinanceFilters } from "./utils/dateRanges";
import {
  buildDailySupportPlan,
  buildOperationalInsights,
  improvementRoadmap,
  workflowGuides,
} from "./utils/operationalInsights";
import { canRoleAccessModule, getRolePermissions } from "./utils/permissions";
import {
  buildItemSummary,
  calculateDashboardMetrics,
  calculateDepartmentDailyRows,
  calculateFinancePeriodRows,
  calculateMovementTrend,
  calculateStockRows,
  enrichMovements,
  filterActiveMovements,
  projectStockAfterEntry,
} from "./utils/calculations";
import {
  createDepartmentCode,
  createItemCode,
  formatMovementType,
  formatRequisitionNumber,
  getSuggestedNextRequisitionNumber,
  getTodayDateValue,
  normalizeRequisitionNumber,
  normalizeSearchValue,
  parseRequisitionNumber,
} from "./utils/formatters";
import {
  validateDepartmentForm,
  validateItemForm,
  validateMovementEntry,
  validateUserAccountForm,
} from "./utils/validation";
import { validatePasswordStrength } from "./utils/passwordPolicy.js";
import AdminView from "./views/AdminView";
import AuthView from "./views/AuthView";
import DashboardView from "./views/DashboardView";
import DepartmentDailyView from "./views/DepartmentDailyView";
import EntryView from "./views/EntryView";
import FinanceDailyView from "./views/FinanceDailyView";
import HistoryView from "./views/HistoryView";
import StockOnHandView from "./views/StockOnHandView";

const tabs = [
  {
    id: "dashboard",
    label: "Control Room",
    hint: "Alerts and next actions",
  },
  {
    id: "entry",
    label: "Store Desk",
    hint: "Issue / receive / adjust",
  },
  {
    id: "stock",
    label: "Item Ledger",
    hint: "Balances, costs, levels",
  },
  {
    id: "finance",
    label: "Finance Pack",
    hint: "Monthly reports",
  },
  {
    id: "department",
    label: "Department Use",
    hint: "Requisitions by department",
  },
  {
    id: "history",
    label: "Audit Trail",
    hint: "Every change",
  },
  {
    id: "admin",
    label: "Setup",
    hint: "Users, items, imports",
  },
];

const defaultTabByRole = {
  admin: "dashboard",
  finance: "finance",
  stores: "entry",
};

const tabPriorityByRole = {
  admin: ["dashboard", "entry", "stock", "finance", "department", "history", "admin"],
  finance: ["finance", "department", "stock", "history"],
  stores: ["entry", "finance", "stock", "department", "history"],
};

function normalizeRole(role) {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  return normalizedRole === "store" ? "stores" : normalizedRole;
}

function sortTabsForRole(role, availableTabs) {
  const priority = tabPriorityByRole[normalizeRole(role)] ?? tabs.map((tab) => tab.id);

  return [...availableTabs].sort((left, right) => {
    const leftIndex = priority.indexOf(left.id);
    const rightIndex = priority.indexOf(right.id);
    const safeLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const safeRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

    return safeLeftIndex - safeRightIndex;
  });
}

function getRequestedTabId() {
  if (typeof window === "undefined") return "";

  const requestedView = new URLSearchParams(window.location.search).get("view");
  return tabs.some((tab) => tab.id === requestedView) ? requestedView : "";
}

function buildMovementSupportMessage({
  savedMovement,
  itemName,
  requisitionLineCount = 0,
  isEditing = false,
  warningCount = 0,
}) {
  const savedTone = warningCount ? "warning" : "success";

  if (savedMovement.type === "OUT") {
    if (isEditing) {
      return {
        tone: savedTone,
        message: `${itemName} updated on page ${savedMovement.requisitionNumber}.`,
        actions: [
          { id: "preview_requisition", label: "Open Preview" },
          { id: "open_history", label: "Open History", variant: "secondary" },
        ],
      };
    }

    return {
      tone: savedTone,
      message: `${itemName} added to page ${savedMovement.requisitionNumber}. ${requisitionLineCount} line(s).`,
      actions: [
        { id: "preview_requisition", label: "Open Preview" },
        { id: "next_issue_page", label: "Use Next Page", variant: "secondary" },
      ],
    };
  }

  if (savedMovement.type === "IN") {
    return {
      tone: savedTone,
      message: `${itemName} receipt saved.`,
      actions: [
        { id: "open_finance", label: "Review Finance" },
        { id: "open_history", label: "Open History", variant: "secondary" },
      ],
    };
  }

  return {
    tone: savedTone,
    message: `${formatMovementType(savedMovement.type)} saved for ${itemName}.`,
    actions: [
      { id: "open_history", label: "Open History" },
      { id: "open_finance", label: "Review Finance", variant: "secondary" },
    ],
  };
}

function buildEntryAuditMessage({ mode, movement }) {
  if (mode === "edit_locked") {
    return {
      tone: "warning",
      message: "Deleted lines cannot be edited.",
      actions: [{ id: "open_history", label: "Open History" }],
    };
  }

  if (mode === "editing") {
    return {
      tone: "info",
      message: `Editing ${movement.itemName} on page ${movement.requisitionNumber}.`,
      actions: [
        { id: "preview_requisition", label: "Open Preview" },
        { id: "open_history", label: "Open History", variant: "secondary" },
      ],
    };
  }

  if (mode === "already_deleted") {
    return {
      tone: "warning",
      message: `${movement.itemName} is already deleted.`,
      actions: [{ id: "open_history", label: "Open History" }],
    };
  }

  if (mode === "deleted") {
    return {
      tone: "warning",
      message: `${movement.itemName} deleted from page ${movement.requisitionNumber}.`,
      actions: [
        { id: "preview_requisition", label: "Open Preview" },
        { id: "open_history", label: "Open History", variant: "secondary" },
      ],
    };
  }

  return {
    tone: "warning",
    message: "Deleted lines cannot be edited.",
    actions: [{ id: "open_history", label: "Open History" }],
  };
}

function detectStandaloneApp() {
  if (typeof window === "undefined") return false;

  return (
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true
  );
}

function buildEntryForm(
  items,
  departments,
  nextRequisitionNumber,
  enteredByDefault,
  overrides = {}
) {
  const type = overrides.type ?? "OUT";

  return {
    date: overrides.date ?? getTodayDateValue(),
    type,
    adjustmentMode: overrides.adjustmentMode ?? "INCREASE",
    departmentId:
      overrides.departmentId ?? getDefaultDepartmentId(departments, type),
    itemId: overrides.itemId ?? "",
    quantity: overrides.quantity ?? "",
    requisitionNumber:
      overrides.requisitionNumber ?? formatRequisitionNumber(nextRequisitionNumber),
    referenceNumber: overrides.referenceNumber ?? "",
    unitCost: overrides.unitCost ?? "",
    notes: overrides.notes ?? "",
    enteredBy: overrides.enteredBy ?? enteredByDefault,
  };
}

function syncEntryForm(
  currentForm,
  items,
  departments,
  nextRequisitionNumber,
  enteredByDefault
) {
  if (!currentForm) {
    return buildEntryForm(
      items,
      departments,
      nextRequisitionNumber,
      enteredByDefault
    );
  }

  return {
    ...currentForm,
    departmentId: departments.some((department) => department.id === currentForm.departmentId)
      ? currentForm.departmentId
      : getDefaultDepartmentId(departments, currentForm.type),
    itemId: items.some((item) => item.id === currentForm.itemId)
      ? currentForm.itemId
      : "",
    requisitionNumber:
      currentForm.type === "OUT"
        ? currentForm.requisitionNumber || formatRequisitionNumber(nextRequisitionNumber)
        : currentForm.requisitionNumber,
    unitCost: currentForm.type === "IN" ? currentForm.unitCost ?? "" : "",
    enteredBy: currentForm.enteredBy || enteredByDefault,
  };
}

function getDepartmentRequisitionStartNumber(departments, departmentId, fallback = 1) {
  const department = departments.find((entry) => entry.id === departmentId) ?? null;
  return Math.max(1, Number(department?.requisitionStartNumber) || Number(fallback) || 1);
}

function getDefaultDepartmentId(departments, movementType = "OUT") {
  if (!departments.length) return "";

  const mainStoreId = departments.find((department) => department.isMainStore)?.id ?? departments[0].id;
  if (movementType === "OUT") {
    return departments.find((department) => !department.isMainStore)?.id ?? mainStoreId;
  }

  return mainStoreId;
}

export default function App() {
  const {
    state,
    isReady,
    requiresBootstrap,
    deploymentStatus,
    lastSavedAt,
    saveError,
    itemMap,
    departmentMap,
    currentUser,
    users,
    bootstrapAdmin,
    saveMovement,
    applyOpeningBalances,
    importMovements,
    importFullWorkbook,
    importItemMaster,
    importDepartments,
    saveItem,
    saveDepartment,
    updateMovement,
    deleteMovement,
    createUser,
    registerUser,
    signIn,
    signOut,
    changePassword,
    approveUser,
    rejectUser,
    resetUserPassword,
    updateSettings,
  } = useStockFlowState();

  const {
    items,
    departments,
    movements,
    productName,
    hotelName,
    brandLogoUrl,
    brandAccentColor,
    brandSidebarColor,
    asOfDate,
    financeEmail,
  } = state;

  const activeEntryItems = useMemo(
    () => items.filter((item) => item.isActive !== false),
    [items]
  );
  const activeEntryDepartments = useMemo(
    () => departments.filter((department) => department.isActive !== false),
    [departments]
  );
  const activeMovements = useMemo(
    () => filterActiveMovements(movements),
    [movements]
  );
  const defaultOutDepartmentId = useMemo(
    () => getDefaultDepartmentId(activeEntryDepartments, "OUT"),
    [activeEntryDepartments]
  );
  const defaultOutDepartmentRequisitionNumber = useMemo(
    () =>
      getSuggestedNextRequisitionNumber(
        movements,
        getDepartmentRequisitionStartNumber(activeEntryDepartments, defaultOutDepartmentId),
        {
          departmentId: defaultOutDepartmentId,
        }
      ),
    [activeEntryDepartments, defaultOutDepartmentId, movements]
  );
  const defaultEnteredBy = currentUser?.name ?? "Storekeeper";

  const [activeTab, setActiveTab] = useState(() => getRequestedTabId() || "dashboard");
  const [financeFilters, setFinanceFilters] = useState(() => {
    const today = getTodayDateValue();

    return {
      period: "daily",
      anchorDate: today,
      fromDate: today,
      toDate: today,
    };
  });
  const [departmentDate, setDepartmentDate] = useState(getTodayDateValue());
  const [showEntryErrors, setShowEntryErrors] = useState(false);
  const [entryFeedback, setEntryFeedback] = useState(null);
  const [editingEntryMovementId, setEditingEntryMovementId] = useState("");
  const [assistantAdminRequest, setAssistantAdminRequest] = useState(null);
  const [assistantStockRequest, setAssistantStockRequest] = useState(null);
  const [assistantFinanceRequest, setAssistantFinanceRequest] = useState(null);
  const [showOnboardingTour, setShowOnboardingTour] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [isInstalledApp, setIsInstalledApp] = useState(() => detectStandaloneApp());
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [entryDeleteDialog, setEntryDeleteDialog] = useState({
    movementId: "",
    itemName: "",
    requisitionNumber: "",
    reason: "",
    error: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [passwordFeedback, setPasswordFeedback] = useState(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const initializedUserIdRef = useRef("");
  const [entryForm, setEntryForm] = useState(() =>
    buildEntryForm(
      activeEntryItems,
      activeEntryDepartments,
      defaultOutDepartmentRequisitionNumber,
      defaultEnteredBy
    )
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = `${productName} | ${hotelName}`;
  }, [hotelName, productName]);

  useEffect(() => {
    if (typeof window === "undefined" || !currentUser) return;

    const nextUrl = new URL(window.location.href);
    if (activeTab === "dashboard") {
      nextUrl.searchParams.delete("view");
    } else {
      nextUrl.searchParams.set("view", activeTab);
    }

    const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    if (nextPath !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState({}, "", nextPath);
    }
  }, [activeTab, currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setShowPasswordChange(false);
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setPasswordErrors({});
      setPasswordFeedback(null);
      return;
    }

    if (currentUser.forcePasswordReset) {
      setShowPasswordChange(true);
    }
  }, [currentUser]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)")
        : null;
    const syncInstallState = () => {
      setIsInstalledApp(detectStandaloneApp());
    };
    const captureInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
    };
    const markInstalled = () => {
      setInstallPromptEvent(null);
      syncInstallState();
    };

    syncInstallState();
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);

    if (mediaQuery?.addEventListener) {
      mediaQuery.addEventListener("change", syncInstallState);
    } else if (mediaQuery?.addListener) {
      mediaQuery.addListener(syncInstallState);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);

      if (mediaQuery?.removeEventListener) {
        mediaQuery.removeEventListener("change", syncInstallState);
      } else if (mediaQuery?.removeListener) {
        mediaQuery.removeListener(syncInstallState);
      }
    };
  }, []);

  async function handleInstallApp() {
    if (!installPromptEvent) return;

    await installPromptEvent.prompt();
    const outcome = await installPromptEvent.userChoice;
    if (outcome?.outcome !== "dismissed") {
      setInstallPromptEvent(null);
      setIsInstalledApp(true);
    }
  }

  async function handleCreateEntryItem(itemInput) {
    const validation = validateItemForm(itemInput, stockRows, null);

    if (!validation.isValid) {
      throw new Error(Object.values(validation.errors)[0] || "The item could not be created.");
    }

    const savedItem = await saveItem(validation.normalizedItem, null);
    setEntryFeedback({
      tone: "success",
      message: `${savedItem.name} was added and is ready to use in this movement.`,
    });
    return savedItem;
  }

  useEffect(() => {
    setEntryForm((currentForm) =>
      syncEntryForm(
        currentForm,
        activeEntryItems,
        activeEntryDepartments,
        defaultOutDepartmentRequisitionNumber,
        defaultEnteredBy
      )
    );
  }, [
    activeEntryDepartments,
    activeEntryItems,
    defaultOutDepartmentRequisitionNumber,
    defaultEnteredBy,
  ]);

  const stockRows = useMemo(
    () => calculateStockRows(items, activeMovements),
    [activeMovements, items]
  );

  const financeRange = useMemo(
    () => buildFinancePeriodRange(financeFilters),
    [financeFilters]
  );

  const financeRows = useMemo(
    () => calculateFinancePeriodRows(items, activeMovements, financeRange),
    [activeMovements, financeRange.endDate, financeRange.startDate, items]
  );

  const departmentRows = useMemo(
    () => calculateDepartmentDailyRows(departments, items, activeMovements, departmentDate),
    [activeMovements, departmentDate, departments, items]
  );

  const enrichedMovements = useMemo(
    () => enrichMovements(movements, itemMap, departmentMap),
    [departmentMap, itemMap, movements]
  );
  const activeEnrichedMovements = useMemo(
    () => enrichMovements(activeMovements, itemMap, departmentMap),
    [activeMovements, departmentMap, itemMap]
  );

  const currentItem = itemMap[entryForm.itemId] ?? null;
  const currentSummary = useMemo(
    () => buildItemSummary(currentItem, activeMovements),
    [activeMovements, currentItem]
  );

  const entryDepartmentRequisitionNumber = useMemo(
    () =>
      getSuggestedNextRequisitionNumber(
        movements,
        getDepartmentRequisitionStartNumber(
          activeEntryDepartments,
          entryForm.departmentId || defaultOutDepartmentId
        ),
        {
          departmentId: entryForm.departmentId || defaultOutDepartmentId,
        }
      ),
    [activeEntryDepartments, defaultOutDepartmentId, entryForm.departmentId, movements]
  );

  const projectedStock = useMemo(
    () => projectStockAfterEntry(currentSummary.stockOnHand, entryForm),
    [currentSummary.stockOnHand, entryForm]
  );

  const entryValidation = useMemo(
    () =>
      validateMovementEntry(entryForm, {
        movements,
        currentStock: currentSummary.stockOnHand,
        minStock: currentItem?.minStock ?? null,
        maxStock: currentItem?.maxStock ?? null,
      }),
    [
      currentItem?.maxStock,
      currentItem?.minStock,
      currentSummary.stockOnHand,
      entryForm,
      movements,
    ]
  );

  const dashboardMetrics = useMemo(
    () =>
      calculateDashboardMetrics({
        items,
        movements: activeMovements,
        stockRows,
        selectedDate: entryForm.date,
      }),
    [activeMovements, entryForm.date, items, stockRows]
  );

  const movementTrend = useMemo(
    () => calculateMovementTrend(activeMovements, entryForm.date, 7),
    [activeMovements, entryForm.date]
  );

  const operationalInsights = useMemo(
    () =>
      buildOperationalInsights({
        items,
        stockRows,
        movements: activeMovements,
        financeEmail,
      }),
    [activeMovements, financeEmail, items, stockRows]
  );

  const dailySupportPlan = useMemo(
    () =>
      buildDailySupportPlan({
        metrics: dashboardMetrics,
        stockRows,
        financeEmail,
        role: currentUser?.role ?? "admin",
      }),
    [currentUser?.role, dashboardMetrics, financeEmail, stockRows]
  );

  const stockAlerts = useMemo(
    () =>
      stockRows
        .filter(
          (row) =>
            row.stockOnHand <= 0 || row.belowMinStock || row.aboveMaxStock
        )
        .slice(0, 8),
    [stockRows]
  );

  const recentMovements = useMemo(
    () => activeEnrichedMovements.slice(0, 8),
    [activeEnrichedMovements]
  );

  const recentEntryItems = useMemo(() => {
    const seenItems = new Set();
    const matches = [];

    for (const movement of activeEnrichedMovements) {
      if (movement.type !== entryForm.type) continue;
      if (entryForm.departmentId && movement.departmentId !== entryForm.departmentId) continue;
      if (!itemMap[movement.itemId]) continue;
      if (seenItems.has(movement.itemId)) continue;

      seenItems.add(movement.itemId);
      matches.push(itemMap[movement.itemId]);

      if (matches.length >= 6) break;
    }

    return matches;
  }, [activeEnrichedMovements, entryForm.departmentId, entryForm.type, itemMap]);

  const currentRequisitionLines = useMemo(() => {
    if (
      entryForm.type !== "OUT" ||
      !entryForm.date ||
      !entryForm.departmentId ||
      !normalizeSearchValue(entryForm.requisitionNumber)
    ) {
      return [];
    }

    const normalizedRequisitionNumber = normalizeRequisitionNumber(entryForm.requisitionNumber);

    return enrichedMovements.filter(
      (movement) =>
        movement.type === "OUT" &&
        movement.date === entryForm.date &&
        movement.departmentId === entryForm.departmentId &&
        normalizeRequisitionNumber(movement.requisitionNumber) === normalizedRequisitionNumber
    );
  }, [
    enrichedMovements,
    entryForm.date,
    entryForm.departmentId,
    entryForm.requisitionNumber,
    entryForm.type,
  ]);

  const requisitionPageOptions = useMemo(() => {
    if (entryForm.type !== "OUT" || !entryForm.date || !entryForm.departmentId) {
      return [];
    }

    const pageMap = new Map();

    for (const movement of enrichedMovements) {
      if (
        movement.type !== "OUT" ||
        movement.date !== entryForm.date ||
        movement.departmentId !== entryForm.departmentId
      ) {
        continue;
      }

      const normalizedPage = normalizeRequisitionNumber(movement.requisitionNumber);
      if (!normalizedPage) continue;

      const existing = pageMap.get(normalizedPage);

      if (existing) {
        existing.lineCount += 1;
        existing.totalQty += Number(movement.quantity) || 0;
        existing.lastEnteredAt = movement.createdAt || movement.updatedAt || existing.lastEnteredAt;
        continue;
      }

      pageMap.set(normalizedPage, {
        id: normalizedPage,
        requisitionNumber: formatRequisitionNumber(movement.requisitionNumber),
        lineCount: 1,
        totalQty: Number(movement.quantity) || 0,
        lastEnteredAt: movement.createdAt || movement.updatedAt || movement.date,
      });
    }

    return Array.from(pageMap.values()).sort((left, right) => {
      const leftNumber = parseRequisitionNumber(left.requisitionNumber);
      const rightNumber = parseRequisitionNumber(right.requisitionNumber);

      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
        return rightNumber - leftNumber;
      }

      if (left.lastEnteredAt !== right.lastEnteredAt) {
        return String(right.lastEnteredAt).localeCompare(String(left.lastEnteredAt));
      }

      return String(right.requisitionNumber).localeCompare(String(left.requisitionNumber));
    });
  }, [enrichedMovements, entryForm.date, entryForm.departmentId, entryForm.type]);

  const departmentIssueLines = useMemo(
    () =>
      enrichedMovements.filter(
        (movement) => movement.type === "OUT" && movement.date === departmentDate
      ),
    [departmentDate, enrichedMovements]
  );

  const allowedTabs = useMemo(() => {
    if (!currentUser) return [];
    return sortTabsForRole(
      currentUser.role,
      tabs.filter((tab) => canRoleAccessModule(currentUser.role, tab.id))
    );
  }, [currentUser]);

  const rolePermissions = useMemo(
    () => getRolePermissions(currentUser?.role),
    [currentUser?.role]
  );
  const passwordChangeRequired = Boolean(currentUser?.forcePasswordReset);

  const assistantContext = useMemo(
    () => ({
      companyName: state.hotelName,
      currentUser,
      activeTab,
      availableModuleIds: allowedTabs.map((tab) => tab.id),
      departments: activeEntryDepartments,
      metrics: dashboardMetrics,
      stockRows,
      financeRows,
      financeRange,
      financePeriod: financeFilters.period,
      departmentRows,
      departmentDate,
      users,
    }),
    [
      activeTab,
      activeEntryDepartments,
      allowedTabs,
      currentUser,
      dashboardMetrics,
      departmentDate,
      departmentRows,
      financeFilters.period,
      financeRange,
      financeRows,
      state.hotelName,
      stockRows,
      users,
    ]
  );

  useEffect(() => {
    if (!currentUser) {
      initializedUserIdRef.current = "";
      return;
    }

    if (!allowedTabs.length) {
      return;
    }

    if (initializedUserIdRef.current === currentUser.id) {
      return;
    }

    const requestedTabId = getRequestedTabId();
    const preferredTabId =
      requestedTabId && allowedTabs.some((tab) => tab.id === requestedTabId)
        ? requestedTabId
        : defaultTabByRole[normalizeRole(currentUser.role)];

    if (preferredTabId && allowedTabs.some((tab) => tab.id === preferredTabId)) {
      initializedUserIdRef.current = currentUser.id;
      setActiveTab(preferredTabId);
      return;
    }

    initializedUserIdRef.current = currentUser.id;
  }, [allowedTabs, currentUser]);

  useEffect(() => {
    if (!allowedTabs.length) return;
    if (!allowedTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(allowedTabs[0].id);
    }
  }, [activeTab, allowedTabs]);

  function handleEntryFieldChange(field, value) {
    setEntryFeedback(null);
    if (field === "date" || field === "departmentId" || field === "requisitionNumber") {
      setEditingEntryMovementId("");
    }
    setEntryForm((currentForm) => {
      if (field === "departmentId" && currentForm.type === "OUT") {
        const departmentSuggestion = getSuggestedNextRequisitionNumber(
          movements,
          getDepartmentRequisitionStartNumber(activeEntryDepartments, value),
          { departmentId: value }
        );

        return {
          ...currentForm,
          departmentId: value,
          requisitionNumber: formatRequisitionNumber(departmentSuggestion),
        };
      }

      return {
        ...currentForm,
        [field]: value,
      };
    });
  }

  function handleTypeChange(type) {
    setEntryFeedback(null);
    setEditingEntryMovementId("");

    setEntryForm((currentForm) => {
      const nextDepartmentId = getDefaultDepartmentId(activeEntryDepartments, type);
      const nextDepartmentRequisitionNumber = getSuggestedNextRequisitionNumber(
        movements,
        getDepartmentRequisitionStartNumber(activeEntryDepartments, nextDepartmentId),
        { departmentId: nextDepartmentId }
      );

      return {
        ...currentForm,
        type,
        adjustmentMode: type === "ADJ" ? currentForm.adjustmentMode : "INCREASE",
        departmentId: nextDepartmentId,
        requisitionNumber:
          type === "OUT"
            ? formatRequisitionNumber(nextDepartmentRequisitionNumber)
            : currentForm.requisitionNumber,
        referenceNumber: type === "OUT" ? "" : currentForm.referenceNumber,
        unitCost: type === "IN" ? currentForm.unitCost : "",
      };
    });
  }

  function handleResetEntry() {
    setShowEntryErrors(false);
    setEntryFeedback(null);
    setEditingEntryMovementId("");

    setEntryForm((currentForm) =>
      buildEntryForm(
        activeEntryItems,
        activeEntryDepartments,
        entryDepartmentRequisitionNumber,
        defaultEnteredBy,
        {
          type: currentForm.type,
          date: currentForm.date,
          departmentId: currentForm.departmentId,
          adjustmentMode: currentForm.adjustmentMode,
          requisitionNumber:
            currentForm.type === "OUT"
              ? currentForm.requisitionNumber ||
                formatRequisitionNumber(entryDepartmentRequisitionNumber)
              : currentForm.requisitionNumber,
          referenceNumber: currentForm.referenceNumber,
          unitCost: "",
          enteredBy: currentForm.enteredBy,
        }
      )
    );
  }

  async function handleSaveMovement() {
    const resolvedMovementUnitCost =
      entryForm.type === "IN"
        ? entryForm.unitCost
        : entryForm.unitCost || currentSummary.unitCost || "";
    const entryToSave = {
      ...entryForm,
      enteredBy: currentUser?.name || entryForm.enteredBy || "Storekeeper",
      unitCost: resolvedMovementUnitCost,
    };

    const validation = validateMovementEntry(entryToSave, {
      movements,
      currentStock: currentSummary.stockOnHand,
      minStock: currentItem?.minStock ?? null,
      maxStock: currentItem?.maxStock ?? null,
    });

    if (!validation.isValid) {
      setShowEntryErrors(true);
      setEntryFeedback({
        tone: "danger",
        message: "Please fix the required fields before saving this movement.",
      });
      return;
    }

    try {
      const savedMovement = editingEntryMovementId
        ? await updateMovement(editingEntryMovementId, validation.normalizedEntry)
        : await saveMovement(validation.normalizedEntry);
      const itemName = itemMap[savedMovement.itemId]?.name ?? "selected item";
      const currentRequisitionLineCount =
        savedMovement.type === "OUT"
          ? activeMovements.filter(
              (movement) =>
                movement.type === "OUT" &&
                movement.date === savedMovement.date &&
                movement.departmentId === savedMovement.departmentId &&
                normalizeRequisitionNumber(movement.requisitionNumber) ===
                  normalizeRequisitionNumber(savedMovement.requisitionNumber)
            ).length + 1
          : 0;
      setShowEntryErrors(false);
      setEntryFeedback(
        buildMovementSupportMessage({
          savedMovement,
          itemName,
          requisitionLineCount: currentRequisitionLineCount,
          isEditing: Boolean(editingEntryMovementId),
          warningCount: validation.warnings.length,
        })
      );
      setEditingEntryMovementId("");

      setEntryForm((currentForm) => ({
        ...currentForm,
        itemId: "",
        quantity: "",
        unitCost: "",
        notes: "",
      }));
    } catch (error) {
      setEntryFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "The movement could not be saved.",
      });
    }
  }

  function handleEditEntryMovement(movementId) {
    const movement = enrichedMovements.find((line) => line.id === movementId);
    if (!movement) return;
    if (movement.isDeleted) {
      setEntryFeedback(buildEntryAuditMessage({ mode: "edit_locked", movement }));
      return;
    }

    setActiveTab("entry");
    setShowEntryErrors(false);
    setEntryFeedback(buildEntryAuditMessage({ mode: "editing", movement }));
    setEditingEntryMovementId(movement.id);
    setEntryForm((currentForm) => ({
      ...currentForm,
      type: "OUT",
      date: movement.date,
      departmentId: movement.departmentId,
      requisitionNumber: formatRequisitionNumber(movement.requisitionNumber),
      itemId: movement.itemId,
      quantity: String(movement.quantity ?? ""),
      unitCost: movement.unitCost ?? currentForm.unitCost ?? "",
      notes: movement.notes ?? "",
      enteredBy: currentUser?.name || currentForm.enteredBy || defaultEnteredBy,
    }));
  }

  async function handleDeleteEntryMovement(movementId) {
    const movement = enrichedMovements.find((line) => line.id === movementId);
    if (!movement) return;
    if (movement.isDeleted) {
      setEntryFeedback(buildEntryAuditMessage({ mode: "already_deleted", movement }));
      return;
    }

    setEntryDeleteDialog({
      movementId: movement.id,
      itemName: movement.itemName,
      requisitionNumber: movement.requisitionNumber,
      reason: "",
      error: "",
    });
  }

  async function handleConfirmDeleteEntryMovement() {
    const movementId = entryDeleteDialog.movementId;
    if (!movementId) return;

    if (!String(entryDeleteDialog.reason ?? "").trim()) {
      setEntryDeleteDialog((currentDialog) => ({
        ...currentDialog,
        error: "A delete reason is required so the requisition audit trail stays complete.",
      }));
      return;
    }

    const movement = enrichedMovements.find((line) => line.id === movementId);
    if (!movement) {
      setEntryDeleteDialog({
        movementId: "",
        itemName: "",
        requisitionNumber: "",
        reason: "",
        error: "",
      });
      setEntryFeedback({
        tone: "danger",
        message: "The selected issue line could not be found anymore.",
      });
      return;
    }

    try {
      await deleteMovement(movementId, entryDeleteDialog.reason);
      if (editingEntryMovementId === movementId) {
        setEditingEntryMovementId("");
        setEntryForm((currentForm) => ({
          ...currentForm,
          itemId: "",
          quantity: "",
          unitCost: "",
          notes: "",
        }));
      }
      setEntryFeedback(buildEntryAuditMessage({ mode: "deleted", movement }));
      setShowEntryErrors(false);
      setEntryDeleteDialog({
        movementId: "",
        itemName: "",
        requisitionNumber: "",
        reason: "",
        error: "",
      });
    } catch (error) {
      setEntryFeedback({
        tone: "danger",
        message:
          error instanceof Error ? error.message : "The issue line could not be marked deleted.",
      });
    }
  }

  function handleOpenEntryForItem(itemId, options = {}) {
    const nextType = options.type ?? "ADJ";

    setActiveTab("entry");
    setShowEntryErrors(false);
    setEntryFeedback(null);
    setEntryForm((currentForm) =>
      buildEntryForm(
        activeEntryItems,
        activeEntryDepartments,
        defaultOutDepartmentRequisitionNumber,
        defaultEnteredBy,
        {
          date: currentForm?.date ?? getTodayDateValue(),
          type: nextType,
          adjustmentMode:
            nextType === "ADJ"
              ? options.adjustmentMode ?? currentForm?.adjustmentMode ?? "INCREASE"
              : "INCREASE",
          departmentId: getDefaultDepartmentId(activeEntryDepartments, nextType),
          itemId,
          quantity: "",
          requisitionNumber:
            nextType === "OUT"
              ? formatRequisitionNumber(
                  getSuggestedNextRequisitionNumber(
                    movements,
                    getDepartmentRequisitionStartNumber(
                      activeEntryDepartments,
                      getDefaultDepartmentId(activeEntryDepartments, nextType)
                    ),
                    {
                      departmentId: getDefaultDepartmentId(activeEntryDepartments, nextType),
                    }
                  )
                )
              : "",
          referenceNumber: "",
          unitCost: "",
          notes: "",
          enteredBy: currentForm?.enteredBy ?? defaultEnteredBy,
        }
      )
    );
  }

  function handleFinanceFilterChange(field, value) {
    setFinanceFilters((currentFilters) => ({
      ...currentFilters,
      [field]: value,
    }));
  }

  function handlePasswordFieldChange(field, value) {
    setPasswordFeedback(null);
    setPasswordErrors((currentErrors) => ({
      ...currentErrors,
      [field]: "",
    }));
    setPasswordForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function handleOpenPasswordChange() {
    setPasswordErrors({});
    setPasswordFeedback(null);
    setShowPasswordChange(true);
  }

  function handleClosePasswordChange() {
    setPasswordErrors({});
    setPasswordFeedback(null);
    setPasswordForm({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setShowPasswordChange(false);
  }

  async function handleChangePassword() {
    const nextErrors = {};
    const passwordCheck = validatePasswordStrength(passwordForm.newPassword);

    if (!String(passwordForm.currentPassword ?? "").trim()) {
      nextErrors.currentPassword = "Current password is required.";
    }

    if (!passwordCheck.isValid) {
      nextErrors.newPassword = passwordCheck.error;
    }

    if (passwordCheck.password !== String(passwordForm.confirmPassword ?? "").trim()) {
      nextErrors.confirmPassword = "Confirmation must match the new password.";
    }

    if (Object.keys(nextErrors).length) {
      setPasswordErrors(nextErrors);
      setPasswordFeedback({
        tone: "danger",
        message: "Please fix the password fields before saving.",
      });
      return;
    }

    setPasswordBusy(true);

    try {
      const message = await changePassword(passwordForm);
      setPasswordErrors({});
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setPasswordFeedback({
        tone: "success",
        message,
      });
      setShowPasswordChange(false);
    } catch (error) {
      setPasswordFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "The password could not be updated.",
      });
    } finally {
      setPasswordBusy(false);
    }
  }

  function handleFinancePeriodChange(period) {
    setFinanceFilters((currentFilters) => {
      const currentRange = buildFinancePeriodRange(currentFilters);

      if (period === "custom") {
        return {
          ...currentFilters,
          period,
          fromDate: currentRange.startDate,
          toDate: currentRange.endDate,
        };
      }

      return {
        ...currentFilters,
        period,
        anchorDate:
          currentFilters.anchorDate || currentRange.startDate || currentRange.endDate,
      };
    });
  }

  function handleShiftFinancePeriod(direction) {
    setFinanceFilters((currentFilters) => shiftFinanceFilters(currentFilters, direction));
  }

  async function handleAssistantAction(action) {
    if (!action) return "";

    if (action.type === "open_module" && action.moduleId) {
      setActiveTab(action.moduleId);
      const tabLabel = tabs.find((tab) => tab.id === action.moduleId)?.label ?? "requested module";
      return `Opened ${tabLabel}.`;
    }

    if (action.type === "open_admin_section" && action.sectionId) {
      setActiveTab("admin");
      setAssistantAdminRequest({
        sectionId: action.sectionId,
        requestId: `${Date.now()}-${action.sectionId}`,
      });
      return `Opened Setup > ${action.sectionId}.`;
    }

    if (action.type === "open_stock_view") {
      setActiveTab("stock");
      setAssistantStockRequest({
        search: action.search ?? "",
        statusFilter: action.statusFilter ?? "all",
        requestId: `${Date.now()}-${action.search ?? ""}-${action.statusFilter ?? "all"}`,
      });

      if (action.search) {
        return `Opened Item Ledger and searched for ${action.search}.`;
      }

      if (action.statusFilter && action.statusFilter !== "all") {
        return `Opened Item Ledger filtered to ${action.statusFilter}.`;
      }

      return "Opened Item Ledger.";
    }

    if (action.type === "open_finance_view") {
      setActiveTab("finance");

      if (action.period) {
        setFinanceFilters((currentFilters) => ({
          ...currentFilters,
          period: action.period,
          anchorDate: currentFilters.anchorDate || getTodayDateValue(),
        }));

        setAssistantFinanceRequest({
          requestId: `${Date.now()}-${action.reportMode ?? "stock"}-${action.search ?? ""}`,
          reportMode: action.reportMode ?? "stock",
          search: action.search ?? "",
          itemId: action.itemId ?? "",
        });
        return `Opened Finance Pack in ${action.period} view.`;
      }

      setAssistantFinanceRequest({
        requestId: `${Date.now()}-${action.reportMode ?? "stock"}-${action.search ?? ""}`,
        reportMode: action.reportMode ?? "stock",
        search: action.search ?? "",
        itemId: action.itemId ?? "",
      });
      return "Opened Finance Pack.";
    }

    if (action.type === "start_entry") {
      if (!allowedTabs.some((tab) => tab.id === "entry")) {
        return "You do not have permission to open Store Desk from this account.";
      }

      const entryType = action.entryType ?? "OUT";
      const targetDepartmentId =
        action.departmentId ?? getDefaultDepartmentId(activeEntryDepartments, entryType);
      const suggestedRequisitionNumber = getSuggestedNextRequisitionNumber(
        movements,
        getDepartmentRequisitionStartNumber(activeEntryDepartments, targetDepartmentId),
        { departmentId: targetDepartmentId }
      );

      setActiveTab("entry");
      setShowEntryErrors(false);
      setEntryFeedback({
        tone: "info",
        message: `Assistant prepared ${formatMovementType(entryType)}. Review the details and save when ready.`,
      });
      setEntryForm((currentForm) =>
        buildEntryForm(
          activeEntryItems,
          activeEntryDepartments,
          defaultOutDepartmentRequisitionNumber,
          currentForm?.enteredBy ?? defaultEnteredBy,
          {
            date: action.date ?? currentForm?.date ?? getTodayDateValue(),
            type: entryType,
            adjustmentMode:
              entryType === "ADJ" ? action.adjustmentMode ?? "INCREASE" : "INCREASE",
            departmentId: targetDepartmentId,
            itemId: action.itemId ?? "",
            quantity: action.quantity ?? "",
            requisitionNumber:
              entryType === "OUT"
                ? action.requisitionNumber ||
                  formatRequisitionNumber(suggestedRequisitionNumber)
                : "",
            referenceNumber: entryType === "OUT" ? "" : action.referenceNumber ?? "",
            unitCost: entryType === "IN" ? action.unitCost ?? "" : "",
            notes: action.notes ?? "",
            enteredBy: currentForm?.enteredBy ?? defaultEnteredBy,
          }
        )
      );

      return `Prepared ${formatMovementType(entryType)} in Store Desk.`;
    }

    if (action.type === "save_entry") {
      const targetItem = itemMap[action.itemId] ?? items.find((item) => item.id === action.itemId);
      if (!targetItem) {
        return "I could not save that movement because the item was not found.";
      }

      const stockRow = stockRows.find((row) => row.id === action.itemId) ?? null;
      const entryType = action.entryType ?? "OUT";
      const movementInput = {
        date: action.date || getTodayDateValue(),
        type: entryType,
        adjustmentMode: entryType === "ADJ" ? action.adjustmentMode ?? "INCREASE" : "INCREASE",
        departmentId: action.departmentId || getDefaultDepartmentId(activeEntryDepartments, entryType),
        itemId: action.itemId,
        quantity: action.quantity || "",
        requisitionNumber: entryType === "OUT" ? action.requisitionNumber || "" : "",
        referenceNumber: entryType === "OUT" ? "" : action.referenceNumber || "",
        unitCost:
          entryType === "IN"
            ? action.unitCost || ""
            : stockRow?.unitCost ?? "",
        notes: action.notes || "",
        enteredBy: action.enteredBy || defaultEnteredBy,
      };
      const validation = validateMovementEntry(movementInput, {
        movements,
        currentStock: stockRow?.stockOnHand ?? 0,
        minStock: targetItem?.minStock ?? null,
        maxStock: targetItem?.maxStock ?? null,
      });

      if (!validation.isValid) {
        return `I could not save the movement yet. ${Object.values(validation.errors)[0]}`;
      }

      const savedMovement = await saveMovement(validation.normalizedEntry);
      setActiveTab("entry");
      setShowEntryErrors(false);
      setEntryFeedback(
        buildMovementSupportMessage({
          savedMovement,
          itemName: targetItem.name,
          requisitionLineCount:
            savedMovement.type === "OUT"
              ? activeMovements.filter(
                  (movement) =>
                    movement.type === "OUT" &&
                    movement.date === savedMovement.date &&
                    movement.departmentId === savedMovement.departmentId &&
                    normalizeRequisitionNumber(movement.requisitionNumber) ===
                      normalizeRequisitionNumber(savedMovement.requisitionNumber)
                ).length + 1
              : 0,
          warningCount: validation.warnings.length,
        })
      );

      return `Saved ${formatMovementType(savedMovement.type).toLowerCase()} for ${targetItem.name}.`;
    }

    if (action.type === "create_item") {
      if (currentUser?.role !== "admin") {
        return "Only admin can create items from the assistant.";
      }

      const itemInput = {
        code: action.code || createItemCode(items),
        name: action.name || "",
        category: normalizeItemCategory(action.category, ""),
        uom: action.uom || "",
        openingBalance: action.openingBalance || 0,
        unitCost: action.unitCost || "",
        sellingPrice: action.sellingPrice || "",
        minStock: action.minStock || "",
        maxStock: action.maxStock || "",
        isActive: action.isActive !== false,
      };
      const validation = validateItemForm(itemInput, stockRows, null);

      if (!validation.isValid) {
        return `I could not create the item yet. ${Object.values(validation.errors)[0]}`;
      }

      const savedItem = await saveItem(validation.normalizedItem, null);
      setActiveTab("admin");
      setAssistantAdminRequest({
        sectionId: "items",
        requestId: `${Date.now()}-items`,
      });
      return `Created item ${savedItem.name} (${savedItem.code}) under ${savedItem.category}.`;
    }

    if (action.type === "update_item_levels") {
      if (currentUser?.role !== "admin") {
        return "Only admin can update stock levels from the assistant.";
      }

      const existingItem = stockRows.find((row) => row.id === action.itemId);
      if (!existingItem) {
        return "I could not update levels because the item was not found.";
      }

      const itemInput = {
        code: existingItem.code,
        name: existingItem.name,
        category: existingItem.category,
        uom: existingItem.uom,
        openingBalance:
          action.openingBalance !== "" && action.openingBalance !== undefined
            ? action.openingBalance
            : existingItem.openingBalance,
        unitCost: existingItem.unitCost ?? "",
        sellingPrice: existingItem.sellingPrice ?? "",
        minStock:
          action.minStock !== "" && action.minStock !== undefined
            ? action.minStock
            : existingItem.minStock ?? "",
        maxStock:
          action.maxStock !== "" && action.maxStock !== undefined
            ? action.maxStock
            : existingItem.maxStock ?? "",
        isActive: existingItem.isActive,
      };
      const validation = validateItemForm(itemInput, stockRows, existingItem.id);

      if (!validation.isValid) {
        return `I could not update levels yet. ${Object.values(validation.errors)[0]}`;
      }

      await saveItem(validation.normalizedItem, existingItem.id);
      setActiveTab("stock");
      setAssistantStockRequest({
        search: existingItem.code,
        statusFilter: "all",
        requestId: `${Date.now()}-${existingItem.code}`,
      });
      return `Updated levels for ${existingItem.name}.`;
    }

    if (action.type === "create_department") {
      if (currentUser?.role !== "admin") {
        return "Only admin can create departments from the assistant.";
      }

      const departmentInput = {
        code: action.code || createDepartmentCode(departments),
        name: action.name || "",
        requisitionStartNumber: action.requisitionStartNumber || 1,
        isMainStore: Boolean(action.isMainStore),
        isActive: action.isActive !== false,
      };
      const validation = validateDepartmentForm(departmentInput, departments, null);

      if (!validation.isValid) {
        return `I could not create the department yet. ${Object.values(validation.errors)[0]}`;
      }

      const savedDepartment = await saveDepartment(validation.normalizedDepartment, null);
      setActiveTab("admin");
      setAssistantAdminRequest({
        sectionId: "departments",
        requestId: `${Date.now()}-departments`,
      });
      return `Created department ${savedDepartment.name}.`;
    }

    if (action.type === "create_account") {
      if (currentUser?.role !== "admin") {
        return "Only admin can create accounts from the assistant.";
      }

      const validation = validateUserAccountForm(
        {
          name: action.name || "",
          email: action.email || "",
          password: action.password || "",
          role: action.role || "stores",
        },
        users,
        null,
        { passwordRequired: true }
      );

      if (!validation.isValid) {
        return `I could not create the account yet. ${Object.values(validation.errors)[0]}`;
      }

      const createdUser = await createUser(
        validation.normalizedUser ?? {
          name: action.name,
          email: action.email,
          password: action.password,
          role: action.role || "stores",
        }
      );

      setActiveTab("admin");
      setAssistantAdminRequest({
        sectionId: "accounts",
        requestId: `${Date.now()}-accounts`,
      });
      return `Created ${action.role || "stores"} account for ${createdUser?.name || action.name}.`;
    }

    if (action.type === "approve_account") {
      if (currentUser?.role !== "admin") {
        return "Only admin can approve accounts from the assistant.";
      }
      const user = users.find((entry) => entry.id === action.userId);
      if (!user) return "I could not find that account to approve.";
      await approveUser(user.id, currentUser.name, user.role);
      return `Approved account for ${user.name}.`;
    }

    if (action.type === "reject_account") {
      if (currentUser?.role !== "admin") {
        return "Only admin can reject accounts from the assistant.";
      }
      const user = users.find((entry) => entry.id === action.userId);
      if (!user) return "I could not find that account to reject.";
      await rejectUser(user.id, currentUser.name);
      return `Rejected account for ${user.name}.`;
    }

    if (action.type === "update_settings") {
      if (currentUser?.role !== "admin") {
        return "Only admin can update system settings from the assistant.";
      }

      await updateSettings({
        ...(action.financeEmail ? { financeEmail: action.financeEmail } : {}),
      });
      setActiveTab("admin");
      setAssistantAdminRequest({
        sectionId: "system",
        requestId: `${Date.now()}-system`,
      });
      return action.financeEmail
        ? `Updated finance email to ${action.financeEmail}.`
        : "Updated the requested system settings.";
    }

    return "";
  }

  if (!isReady) {
    return (
      <div className="auth-shell">
        <div className="page-backdrop" />
        <section className="auth-panel">
          <div className="card auth-card">
            <h1>Loading {productName}</h1>
            <p>Connecting to the shared stock flow database.</p>
            {saveError ? <div className="alert-banner alert-danger">{saveError}</div> : null}
          </div>
        </section>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthView
        onSignIn={signIn}
        onRequestAccess={registerUser}
        onBootstrapAdmin={bootstrapAdmin}
        onInstallApp={handleInstallApp}
        canInstallApp={Boolean(!isInstalledApp && installPromptEvent)}
        isInstalledApp={isInstalledApp}
        requiresBootstrap={requiresBootstrap}
        hotelName={hotelName}
        productName={productName}
        brandLogoUrl={brandLogoUrl}
        brandAccentColor={brandAccentColor}
        brandSidebarColor={brandSidebarColor}
        serverError={saveError}
        deploymentStatus={deploymentStatus}
      />
    );
  }

  return (
    <AppShell
      tabs={allowedTabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      lastSavedAt={lastSavedAt}
      saveError={saveError}
      currentUser={currentUser}
      onSignOut={signOut}
      onOpenPasswordChange={handleOpenPasswordChange}
      onInstallApp={handleInstallApp}
      canInstallApp={Boolean(!isInstalledApp && installPromptEvent)}
      isInstalledApp={isInstalledApp}
      passwordChangeRequired={passwordChangeRequired}
      hotelName={hotelName}
      productName={productName}
      brandLogoUrl={brandLogoUrl}
      brandAccentColor={brandAccentColor}
      brandSidebarColor={brandSidebarColor}
    >
      {showPasswordChange || passwordChangeRequired ? (
        <PasswordChangePanel
          currentUser={currentUser}
          form={passwordForm}
          errors={passwordErrors}
          feedback={passwordFeedback}
          isBusy={passwordBusy}
          isRequired={passwordChangeRequired}
          onFieldChange={handlePasswordFieldChange}
          onSubmit={handleChangePassword}
          onClose={passwordChangeRequired ? null : handleClosePasswordChange}
        />
      ) : null}

      <TextPromptDialog
        isOpen={Boolean(entryDeleteDialog.movementId)}
        title="Mark issue line deleted"
        description={
          entryDeleteDialog.movementId
            ? `This keeps ${entryDeleteDialog.itemName} visible in the audit trail while removing it from live stock and finance totals.`
            : ""
        }
        label="Delete reason"
        value={entryDeleteDialog.reason}
        error={entryDeleteDialog.error}
        helperText={
          entryDeleteDialog.requisitionNumber
            ? `Page ${entryDeleteDialog.requisitionNumber} will still show the deleted line for audit review. After delete, review the preview or Audit Trail so the reason is clear to finance and admin.`
            : ""
        }
        placeholder="Explain why this line is being removed from the live requisition."
        submitLabel="Mark Deleted"
        cancelLabel="Cancel"
        multiline
        onChange={(value) =>
          setEntryDeleteDialog((currentDialog) => ({
            ...currentDialog,
            reason: value,
            error: "",
          }))
        }
        onClose={() =>
          setEntryDeleteDialog({
            movementId: "",
            itemName: "",
            requisitionNumber: "",
            reason: "",
            error: "",
          })
        }
        onSubmit={handleConfirmDeleteEntryMovement}
      />

      {!passwordChangeRequired && activeTab === "dashboard" ? (
        <DashboardView
          metrics={dashboardMetrics}
          dailySupportPlan={dailySupportPlan}
          stockAlerts={stockAlerts}
          recentMovements={recentMovements}
          departmentRows={departmentRows}
          operationalInsights={operationalInsights}
          workflowGuides={workflowGuides}
          improvementRoadmap={improvementRoadmap}
          movementTrend={movementTrend}
          availableModules={allowedTabs}
          onOpenModule={setActiveTab}
          onStartTour={() => setShowOnboardingTour(true)}
        />
      ) : null}

      <GettingStartedTour
        isOpen={showOnboardingTour}
        onClose={() => setShowOnboardingTour(false)}
      />

      {!passwordChangeRequired && activeTab === "entry" ? (
        <EntryView
          form={entryForm}
          editingMovementId={editingEntryMovementId}
          hotelName={hotelName}
          productName={productName}
          brandLogoUrl={brandLogoUrl}
          brandAccentColor={brandAccentColor}
          brandSidebarColor={brandSidebarColor}
          currentUserName={currentUser?.name ?? ""}
          errors={entryValidation.errors}
          showErrors={showEntryErrors}
          feedback={entryFeedback}
          warnings={entryValidation.warnings}
          departments={activeEntryDepartments}
          items={activeEntryItems}
          currentItem={currentItem}
          currentSummary={currentSummary}
          projectedStock={projectedStock}
          nextRequisitionNumber={entryDepartmentRequisitionNumber}
          recentItems={recentEntryItems}
          requisitionPageOptions={requisitionPageOptions}
          currentRequisitionLines={currentRequisitionLines}
          canCreateItems={rolePermissions.canCreateItems}
          nextItemCode={createItemCode(items)}
          onFieldChange={handleEntryFieldChange}
          onTypeChange={handleTypeChange}
          onReset={handleResetEntry}
          onSubmit={handleSaveMovement}
          onCreateItem={handleCreateEntryItem}
          onEditCurrentLine={handleEditEntryMovement}
          onDeleteCurrentLine={handleDeleteEntryMovement}
          onOpenHistory={() => setActiveTab("history")}
          onOpenFinance={() => setActiveTab("finance")}
        />
      ) : null}

      {!passwordChangeRequired && activeTab === "stock" ? (
        <StockOnHandView
          rows={stockRows}
          onSaveItem={rolePermissions.canEditStockLevels ? saveItem : null}
          onOpenEntryForItem={
            rolePermissions.canOpenAdjustmentFromStock ? handleOpenEntryForItem : null
          }
          canEditLevels={rolePermissions.canEditStockLevels}
          canOpenAdjustment={rolePermissions.canOpenAdjustmentFromStock}
          requestedSearch={assistantStockRequest?.search ?? ""}
          requestedStatusFilter={assistantStockRequest?.statusFilter ?? "all"}
          requestKey={assistantStockRequest?.requestId ?? ""}
        />
      ) : null}

      {!passwordChangeRequired && activeTab === "finance" ? (
        <FinanceDailyView
          items={items}
          departments={departments}
          movements={activeMovements}
          filters={financeFilters}
          range={financeRange}
          rows={financeRows}
          hotelName={hotelName}
          productName={productName}
          brandLogoUrl={brandLogoUrl}
          brandAccentColor={brandAccentColor}
          brandSidebarColor={brandSidebarColor}
          defaultEmail={financeEmail}
          currentUser={currentUser}
          onFilterChange={handleFinanceFilterChange}
          onPeriodChange={handleFinancePeriodChange}
          onShiftPeriod={handleShiftFinancePeriod}
        />
      ) : null}

      {!passwordChangeRequired && activeTab === "department" ? (
        <DepartmentDailyView
          departmentDate={departmentDate}
          onDateChange={setDepartmentDate}
          departments={departments}
          issueLines={departmentIssueLines}
          hotelName={hotelName}
          productName={productName}
          brandLogoUrl={brandLogoUrl}
          brandAccentColor={brandAccentColor}
          brandSidebarColor={brandSidebarColor}
          currentUserName={currentUser?.name ?? ""}
          canManageIssueLines={rolePermissions.canEditMovementHistory}
          canDeleteIssueLines={rolePermissions.canDeleteMovementHistory}
          onEditIssueLine={rolePermissions.canEditMovementHistory ? handleEditEntryMovement : null}
          onDeleteIssueLine={rolePermissions.canDeleteMovementHistory ? deleteMovement : null}
        />
      ) : null}

      {!passwordChangeRequired && activeTab === "history" ? (
        <HistoryView
          departments={departments}
          items={items}
          rows={enrichedMovements}
          hotelName={hotelName}
          productName={productName}
          defaultEmail={financeEmail}
          onSaveMovement={rolePermissions.canEditMovementHistory ? updateMovement : null}
          onDeleteMovement={rolePermissions.canDeleteMovementHistory ? deleteMovement : null}
          canEditHistory={rolePermissions.canEditMovementHistory}
          canDeleteHistory={rolePermissions.canDeleteMovementHistory}
        />
      ) : null}

      {!passwordChangeRequired && activeTab === "admin" ? (
        <AdminView
          productName={productName}
          hotelName={hotelName}
          brandLogoUrl={brandLogoUrl}
          brandAccentColor={brandAccentColor}
          brandSidebarColor={brandSidebarColor}
          asOfDate={asOfDate}
          financeEmail={financeEmail}
          departments={departments}
          stockRows={stockRows}
          movementRows={enrichedMovements}
          users={users}
          currentUser={currentUser}
          onApplyOpeningBalances={applyOpeningBalances}
          onImportMovements={importMovements}
          onImportFullWorkbook={importFullWorkbook}
          onImportItems={importItemMaster}
          onImportDepartments={importDepartments}
          onSaveItem={saveItem}
          onSaveDepartment={saveDepartment}
          onCreateUser={createUser}
          onApproveUser={approveUser}
          onRejectUser={rejectUser}
          onResetUserPassword={resetUserPassword}
          onSaveSettings={updateSettings}
          requestedSection={assistantAdminRequest}
          onOpenModule={setActiveTab}
        />
      ) : null}

      {!passwordChangeRequired && rolePermissions.showAssistant ? (
        <AssistantPanel context={assistantContext} onRunAction={handleAssistantAction} />
      ) : null}
    </AppShell>
  );
}
