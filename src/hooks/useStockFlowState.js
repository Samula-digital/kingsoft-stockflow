import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_BRAND_ACCENT_COLOR,
  DEFAULT_BRAND_LOGO_URL,
  DEFAULT_BRAND_SIDEBAR_COLOR,
  DEFAULT_COMPANY_NAME,
  DEFAULT_PRODUCT_NAME,
} from "../utils/branding.js";
import * as api from "../services/api";

function buildInitialAppState() {
  return {
    version: 0,
    productName: DEFAULT_PRODUCT_NAME,
    hotelName: DEFAULT_COMPANY_NAME,
    brandLogoUrl: DEFAULT_BRAND_LOGO_URL,
    brandAccentColor: DEFAULT_BRAND_ACCENT_COLOR,
    brandSidebarColor: DEFAULT_BRAND_SIDEBAR_COLOR,
    financeEmail: "",
    asOfDate: "",
    nextRequisitionNumber: 1,
    items: [],
    departments: [],
    movements: [],
  };
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : "The server request could not be completed.";
}

export function useStockFlowState() {
  const [state, setState] = useState(() => buildInitialAppState());
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(() => new Date().toISOString());
  const [saveError, setSaveError] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [requiresBootstrap, setRequiresBootstrap] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState(null);

  const itemMap = useMemo(
    () => Object.fromEntries(state.items.map((item) => [item.id, item])),
    [state.items]
  );

  const departmentMap = useMemo(
    () => Object.fromEntries(state.departments.map((department) => [department.id, department])),
    [state.departments]
  );

  function syncSnapshot(snapshot) {
    if (snapshot?.state) {
      setState(snapshot.state);
    }

    setUsers(snapshot?.users ?? []);
    setCurrentUser(snapshot?.currentUser ?? null);
    setRequiresBootstrap(Boolean(snapshot?.requiresBootstrap));

    if (snapshot?.lastSavedAt) {
      setLastSavedAt(snapshot.lastSavedAt);
    }

    setSaveError("");
  }

  useEffect(() => {
    let isCancelled = false;

    api
      .fetchDeploymentStatus()
      .then(async (status) => {
        if (isCancelled) return;
        setDeploymentStatus(status);

        if (status?.ok === false) {
          setRequiresBootstrap(false);
          setSaveError("");
          setIsReady(true);
          return;
        }

        const snapshot = await api.fetchBootstrap();
        if (isCancelled) return;
        syncSnapshot(snapshot);
        setIsReady(true);
      })
      .catch((error) => {
        if (isCancelled) return;
        setSaveError(getErrorMessage(error));
        setIsReady(true);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  async function runMutation(request) {
    try {
      const snapshot = await request();
      syncSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      setSaveError(getErrorMessage(error));
      throw error;
    }
  }

  async function bootstrapAdmin(userInput) {
    try {
      const snapshot = await runMutation(() => api.bootstrapAdmin(userInput));
      return {
        ok: true,
        user: snapshot.currentUser ?? null,
      };
    } catch (error) {
      return {
        ok: false,
        error: getErrorMessage(error),
      };
    }
  }

  async function registerUser(userInput) {
    try {
      const result = await api.requestAccess(userInput);
      setSaveError("");
      return {
        ok: true,
        message: result.message,
      };
    } catch (error) {
      setSaveError(getErrorMessage(error));
      return {
        ok: false,
        error: getErrorMessage(error),
      };
    }
  }

  async function signIn(credentials) {
    try {
      const snapshot = await runMutation(() => api.signIn(credentials));
      return {
        ok: true,
        user: snapshot.currentUser ?? null,
      };
    } catch (error) {
      return {
        ok: false,
        error: getErrorMessage(error),
      };
    }
  }

  async function signOut() {
    try {
      await runMutation(() => api.signOut());
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: getErrorMessage(error),
      };
    }
  }

  async function createUser(userInput) {
    const snapshot = await runMutation(() => api.createUser(userInput));
    const createdUser =
      snapshot.users?.find(
        (user) => user.email?.toLowerCase() === String(userInput.email ?? "").trim().toLowerCase()
      ) ?? null;

    return createdUser;
  }

  async function changePassword(passwordInput) {
    const snapshot = await runMutation(() => api.changePassword(passwordInput));
    return snapshot.message ?? "Password updated successfully.";
  }

  async function approveUser(userId, approvedBy, role = null) {
    await runMutation(() =>
      api.approveUser(userId, {
        approvedBy,
        role,
      })
    );
  }

  async function rejectUser(userId, approvedBy) {
    void approvedBy;
    await runMutation(() => api.rejectUser(userId));
  }

  async function resetUserPassword(userId, password) {
    const snapshot = await runMutation(() =>
      api.resetUserPassword(userId, {
        password,
      })
    );

    return snapshot.message ?? "Password reset successfully.";
  }

  async function saveMovement(movementInput) {
    const snapshot = await runMutation(() => api.createMovement(movementInput));
    return snapshot.movement;
  }

  async function applyOpeningBalances(rows, options = {}) {
    const snapshot = await runMutation(() =>
      api.applyOpeningBalances({
        rows,
        asOfDate: options.asOfDate,
      })
    );

    return {
      updatedCount: snapshot.updatedCount ?? 0,
    };
  }

  async function importMovements(movementInputs, options = {}) {
    const snapshot = await runMutation(() =>
      api.importMovements({
        rows: movementInputs,
        mode: options.mode ?? "append",
      })
    );

    return {
      importedCount: snapshot.importedCount ?? 0,
      skippedCount: snapshot.skippedCount ?? 0,
    };
  }

  async function importFullWorkbook(payload) {
    const snapshot = await runMutation(() => api.importFullWorkbook(payload));

    return {
      itemCount: snapshot.itemCount ?? 0,
      openingCount: snapshot.openingCount ?? 0,
      movementCount: snapshot.movementCount ?? 0,
      skippedMovementCount: snapshot.skippedMovementCount ?? 0,
      retiredItemCount: snapshot.retiredItemCount ?? 0,
    };
  }

  async function importItemMaster(itemInputs) {
    const snapshot = await runMutation(() =>
      api.importItems({
        rows: itemInputs,
      })
    );

    return {
      importedCount: snapshot.importedCount ?? 0,
    };
  }

  async function importDepartments(departmentInputs) {
    const snapshot = await runMutation(() =>
      api.importDepartments({
        rows: departmentInputs,
      })
    );

    return {
      importedCount: snapshot.importedCount ?? 0,
    };
  }

  async function saveItem(itemInput, itemId = null) {
    const snapshot = await runMutation(() =>
      itemId ? api.updateItem(itemId, itemInput) : api.createItem(itemInput)
    );

    return snapshot.item ?? null;
  }

  async function saveDepartment(departmentInput, departmentId = null) {
    const snapshot = await runMutation(() =>
      departmentId
        ? api.updateDepartment(departmentId, departmentInput)
        : api.createDepartment(departmentInput)
    );

    return snapshot.department ?? null;
  }

  async function updateMovement(movementId, movementInput) {
    const snapshot = await runMutation(() => api.updateMovement(movementId, movementInput));
    return snapshot.movement ?? null;
  }

  async function deleteMovement(movementId, reason) {
    const snapshot = await runMutation(() =>
      api.deleteMovement(movementId, {
        reason,
      })
    );

    return snapshot.movement ?? null;
  }

  async function updateSettings(patch) {
    await runMutation(() => api.saveSettings(patch));
  }

  return {
    state,
    users,
    currentUser,
    itemMap,
    departmentMap,
    lastSavedAt,
    saveError,
    isReady,
    requiresBootstrap,
    deploymentStatus,
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
    bootstrapAdmin,
    registerUser,
    createUser,
    changePassword,
    signIn,
    signOut,
    approveUser,
    rejectUser,
    resetUserPassword,
    updateSettings,
  };
}
