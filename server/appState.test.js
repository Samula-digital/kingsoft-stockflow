import { describe, expect, it } from "vitest";
import {
  createInitialAppState,
  deleteMovementInState,
  importFullWorkbookInState,
  importItemMasterInState,
  normalizeAppState,
  saveItemInState,
  saveMovementInState,
  updateMovementInState,
} from "./appState.js";

function buildOutMovement(overrides = {}) {
  const state = createInitialAppState();
  const issueDepartment =
    state.departments.find((department) => !department.isMainStore)?.id ??
    state.departments[0]?.id;
  const itemId = state.items[0]?.id;

  return {
    date: state.asOfDate,
    type: "OUT",
    departmentId: issueDepartment,
    itemId,
    quantity: 1,
    requisitionNumber: "12",
    referenceNumber: "",
    adjustmentMode: "INCREASE",
    notes: "",
    enteredBy: "Tester",
    ...overrides,
  };
}

describe("appState server validation", () => {
  it("rejects duplicate item codes on save", () => {
    const state = createInitialAppState();

    expect(() =>
      saveItemInState(state, {
        code: state.items[0].code,
        name: "Duplicate Item",
        uom: "PCS",
        category: state.items[0].category,
        openingBalance: 20,
        unitCost: null,
        sellingPrice: null,
        minStock: null,
        maxStock: null,
        isActive: true,
      })
    ).toThrow(/Item code already exists/i);
  });

  it("rejects stock movement that would issue more than available", () => {
    const state = createInitialAppState();

    expect(() =>
      saveMovementInState(
        state,
        buildOutMovement({
          quantity: (state.items[0]?.openingBalance ?? 0) + 5,
        })
      )
    ).toThrow(/available right now|No stock is available/i);
  });

  it("rejects update for missing movement ids", () => {
    const state = createInitialAppState();

    expect(() =>
      updateMovementInState(state, "MOV-404", buildOutMovement())
    ).toThrow(/movement was not found/i);
  });

  it("rejects delete for missing movement ids", () => {
    const state = createInitialAppState();

    expect(() => deleteMovementInState(state, "MOV-404")).toThrow(/movement was not found/i);
  });

  it("marks movements deleted instead of removing them", () => {
    const state = createInitialAppState();
    const saved = saveMovementInState(state, buildOutMovement(), {
      actorName: "Store Tester",
    });

    const result = deleteMovementInState(saved.nextState, saved.movement.id, {
      actorName: "Store Tester",
      reason: "Wrong requisition line",
    });

    expect(result.nextState.movements).toHaveLength(saved.nextState.movements.length);
    expect(result.movement.deletedReason).toBe("Wrong requisition line");
    expect(result.movement.deletedBy).toBe("Store Tester");
    expect(result.movement.deletedAt).toBeTruthy();
    expect(result.movement.auditTrail.at(-1)?.action).toBe("delete");
  });

  it("rejects invalid item import rows on the server", () => {
    const state = createInitialAppState();

    expect(() =>
      importItemMasterInState(state, [
        {
          code: "NEW-01",
          name: "Bad Import",
          uom: "PCS",
          category: "Dry Foods",
          openingBalance: 0,
          unitCost: -5,
          sellingPrice: null,
          minStock: null,
          maxStock: null,
          isActive: true,
        },
      ])
    ).toThrow(/unit cost must be blank or 0 and above/i);
  });

  it("keeps the matched item identity when an import row would collide with another item name", () => {
    const state = createInitialAppState();
    const firstItem = state.items[0];
    const secondItem = state.items[1];

    const result = importItemMasterInState(state, [
      {
        itemId: firstItem.id,
        code: firstItem.code,
        name: secondItem.name,
        uom: firstItem.uom,
        category: firstItem.category,
        openingBalance: firstItem.openingBalance,
        unitCost: 4500,
        sellingPrice: firstItem.sellingPrice ?? null,
        minStock: firstItem.minStock ?? null,
        maxStock: firstItem.maxStock ?? null,
        isActive: true,
      },
    ]);

    const updatedFirstItem = result.nextState.items.find((item) => item.id === firstItem.id);
    expect(updatedFirstItem?.name).toBe(firstItem.name);
    expect(updatedFirstItem?.unitCost).toBe(4500);
    expect(result.importedCount).toBe(1);
  });

  it("updates a duplicate-name item when the UOM is different", () => {
    const state = createInitialAppState();
    const nutmegPacket = state.items.find((item) => item.id === "ITM-237");

    expect(nutmegPacket?.name).toBe("NUTMEG");

    const result = importItemMasterInState(state, [
      {
        itemId: "ITM-237",
        code: "ITM-237",
        name: "NUTMEG",
        uom: "pkt",
        category: "Dry Foods",
        openingBalance: 0,
        unitCost: 4000,
        sellingPrice: null,
        minStock: null,
        maxStock: 10,
        isActive: true,
      },
    ]);

    const updatedItem = result.nextState.items.find((item) => item.id === "ITM-237");
    expect(updatedItem?.uom).toBe("pkt");
    expect(updatedItem?.unitCost).toBe(4000);
    expect(result.importedCount).toBe(1);
  });

  it("generates item codes when importing a fresh item master without codes", () => {
    const state = normalizeAppState({
      ...createInitialAppState(),
      items: [],
      movements: [],
    });

    const result = importItemMasterInState(state, [
      {
        name: "Sugar",
        category: "Dry Foods",
        uom: "KGS",
        openingBalance: 20,
        unitCost: 4000,
        sellingPrice: null,
        minStock: null,
        maxStock: null,
        isActive: true,
      },
      {
        name: "A4 Envelopes",
        category: "Admin Stationary",
        uom: "PCS",
        openingBalance: 10,
        unitCost: 400,
        sellingPrice: null,
        minStock: null,
        maxStock: null,
        isActive: true,
      },
    ]);

    expect(result.importedCount).toBe(2);
    expect(result.nextState.items.map((item) => item.code).sort()).toEqual([
      "ITM-001",
      "ITM-002",
    ]);
  });

  it("keeps receipt unit cost on saved IN movements", () => {
    const state = createInitialAppState();
    const mainStoreId =
      state.departments.find((department) => department.isMainStore)?.id ??
      state.departments[0]?.id;
    const itemId = state.items[0]?.id;

    const result = saveMovementInState(state, {
      date: state.asOfDate,
      type: "IN",
      departmentId: mainStoreId,
      itemId,
      quantity: 5,
      unitCost: 4500,
      requisitionNumber: "",
      referenceNumber: "GRN-100",
      adjustmentMode: "INCREASE",
      notes: "",
      enteredBy: "Tester",
    });

    expect(result.movement.unitCost).toBe(4500);
  });

  it("stores the server actor as enteredBy when saving a movement", () => {
    const state = createInitialAppState();
    const result = saveMovementInState(state, buildOutMovement({ enteredBy: "Spoofed User" }), {
      actorName: "Signed In User",
    });

    expect(result.movement.enteredBy).toBe("Signed In User");
    expect(result.movement.createdBy).toBe("Signed In User");
  });

  it("preserves the original enteredBy when editing a movement", () => {
    const state = createInitialAppState();
    const saved = saveMovementInState(state, buildOutMovement(), {
      actorName: "Original Recorder",
    });

    const updated = updateMovementInState(
      saved.nextState,
      saved.movement.id,
      buildOutMovement({
        quantity: 2,
        enteredBy: "Changed In Client",
      }),
      {
        actorName: "History Admin",
      }
    );

    expect(updated.movement.enteredBy).toBe("Original Recorder");
    expect(updated.movement.updatedBy).toBe("History Admin");
  });

  it("repairs legacy workbook issue departments from item category and refreshes import signatures", () => {
    const state = createInitialAppState();
    const kitchenId =
      state.departments.find((department) => department.name === "Kitchen")?.id ?? "";
    const oldFallbackDepartmentId =
      state.departments.find((department) => department.name === "Housekeeping (HK)")?.id ?? "";
    const sugarItem =
      state.items.find((item) => item.name === "SUGAR") ?? state.items[0];

    const normalized = normalizeAppState({
      ...state,
      movements: [
        {
          id: "MOV-LEGACY-1",
          date: state.asOfDate,
          type: "OUT",
          departmentId: oldFallbackDepartmentId,
          itemId: sugarItem.id,
          quantity: 3,
          requisitionNumber: "12",
          notes: "Imported issued stock from 1.3.2026.",
          enteredBy: "Excel Import",
          sourceType: "excel-daily-template",
          sourceFile: "daily.xlsx",
          sourceSheet: "1.3.2026",
          sourceRow: 27,
          importSignature: [
            state.asOfDate,
            "OUT",
            oldFallbackDepartmentId,
            sugarItem.id,
            3,
            "",
            "",
            "12",
            "excel-daily-template",
            "daily.xlsx",
            "1.3.2026",
            27,
          ].join("|"),
        },
      ],
    });

    expect(normalized.movements[0]?.departmentId).toBe(kitchenId);
    expect(normalized.movements[0]?.departmentMappingVersion).toBe("category-v1");
    expect(normalized.movements[0]?.workbookCategory).toBe("Dry Foods");
    expect(normalized.movements[0]?.importSignature).toContain(`|${kitchenId}|`);
  });

  it("retires missing workbook-only seed detail when full workbook sync is requested", () => {
    const state = createInitialAppState();
    const staleItem = {
      ...state.items.find((item) => item.id === "ITM-397"),
      openingBalance: 20,
      unitCost: 1500,
      minStock: 5,
      maxStock: 10,
      isActive: true,
    };
    const activeWorkbookItem = {
      ...state.items.find((item) => item.id === "ITM-001"),
      openingBalance: 8,
      unitCost: 120000,
      minStock: 1,
      maxStock: 2,
      isActive: true,
    };
    const preparedState = {
      ...state,
      items: state.items.map((item) =>
        item.id === staleItem.id
          ? staleItem
          : item.id === activeWorkbookItem.id
            ? activeWorkbookItem
            : item
      ),
      movements: [],
    };

    const result = importFullWorkbookInState(preparedState, {
      itemRows: [
        {
          itemId: activeWorkbookItem.id,
          code: activeWorkbookItem.code,
          name: activeWorkbookItem.name,
          category: activeWorkbookItem.category,
          uom: activeWorkbookItem.uom,
          openingBalance: 8,
          unitCost: 120000,
          sellingPrice: null,
          minStock: 1,
          maxStock: 2,
          isActive: true,
        },
      ],
      openingRows: [],
      asOfDate: preparedState.asOfDate,
      movementRows: [],
      movementMode: "append",
      retireMissingWorkbookItems: true,
    });

    const retiredItem = result.nextState.items.find((item) => item.id === staleItem.id);
    expect(retiredItem?.isActive).toBe(false);
    expect(retiredItem?.openingBalance).toBe(0);
    expect(retiredItem?.unitCost).toBeNull();
    expect(retiredItem?.minStock).toBeNull();
    expect(retiredItem?.maxStock).toBeNull();
    expect(result.retiredItemCount).toBeGreaterThan(0);
  });
});
