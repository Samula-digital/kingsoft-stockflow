import { describe, expect, it } from "vitest";
import { canRoleAccessModule, getRolePermissions } from "./permissions";

describe("role permissions", () => {
  it("keeps finance out of entry and admin", () => {
    expect(canRoleAccessModule("finance", "entry")).toBe(false);
    expect(canRoleAccessModule("finance", "admin")).toBe(false);
  });

  it("allows store movement work but not stock level editing", () => {
    const permissions = getRolePermissions("store");

    expect(permissions.canEnterMovements).toBe(true);
    expect(permissions.canCreateItems).toBe(true);
    expect(permissions.canEditStockLevels).toBe(false);
    expect(permissions.canEditMovementHistory).toBe(true);
    expect(permissions.moduleIds).toContain("finance");
    expect(permissions.moduleIds).toContain("department");
  });

  it("gives admin full operational control", () => {
    const permissions = getRolePermissions("admin");

    expect(permissions.canCreateItems).toBe(true);
    expect(permissions.canEditStockLevels).toBe(true);
    expect(permissions.canDeleteMovementHistory).toBe(true);
    expect(permissions.moduleIds).toContain("admin");
  });

  it("does not allow finance to create items", () => {
    const permissions = getRolePermissions("finance");

    expect(permissions.canCreateItems).toBe(false);
  });
});
