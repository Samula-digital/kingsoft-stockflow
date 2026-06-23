const permissionProfiles = {
  admin: {
    moduleIds: [
      "dashboard",
      "entry",
      "stock",
      "finance",
      "department",
      "history",
      "admin",
    ],
    canEnterMovements: true,
    canCreateItems: true,
    canEditStockLevels: true,
    canOpenAdjustmentFromStock: true,
    canEditMovementHistory: true,
    canDeleteMovementHistory: true,
    showAssistant: true,
  },
  finance: {
    moduleIds: ["finance", "department", "stock", "history"],
    canEnterMovements: false,
    canCreateItems: false,
    canEditStockLevels: false,
    canOpenAdjustmentFromStock: false,
    canEditMovementHistory: false,
    canDeleteMovementHistory: false,
    showAssistant: true,
  },
  stores: {
    moduleIds: ["entry", "finance", "stock", "department", "history"],
    canEnterMovements: true,
    canCreateItems: true,
    canEditStockLevels: false,
    canOpenAdjustmentFromStock: true,
    canEditMovementHistory: true,
    canDeleteMovementHistory: true,
    showAssistant: false,
  },
};

const fallbackProfile = {
  moduleIds: [],
  canEnterMovements: false,
  canCreateItems: false,
  canEditStockLevels: false,
  canOpenAdjustmentFromStock: false,
  canEditMovementHistory: false,
  canDeleteMovementHistory: false,
  showAssistant: false,
};

function normalizeRole(role) {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  return normalizedRole === "store" ? "stores" : normalizedRole;
}

export function getRolePermissions(role) {
  return permissionProfiles[normalizeRole(role)] ?? fallbackProfile;
}

export function canRoleAccessModule(role, moduleId) {
  return getRolePermissions(role).moduleIds.includes(moduleId);
}
