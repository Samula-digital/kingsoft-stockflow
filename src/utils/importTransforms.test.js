import { describe, expect, it } from "vitest";
import {
  prepareHistoricalMovementImportRows,
  prepareDepartmentImportRows,
  prepareItemMasterImportRows,
  prepareOpeningBalanceImportRows,
} from "./importTransforms";

describe("item master import transforms", () => {
  it("maps selling price alongside cost and limits", () => {
    const result = prepareItemMasterImportRows(
      [
        {
          item_code: "ITM-001",
          item_name: "Bath Soap",
          category: "Housekeeping",
          uom: "PCS",
          opening_balance: "12",
          unit_cost: "1500",
          selling_price: "2000",
          min_stock: "5",
          max_stock: "20",
          is_active: "yes",
        },
      ],
      [
        {
          id: "ITM-001",
          code: "ITM-001",
          name: "Bath Soap",
          category: "House Hold",
          uom: "PCS",
        },
      ]
    );

    expect(result.errors).toEqual([]);
    expect(result.mappedRows[0]).toMatchObject({
      itemId: "ITM-001",
      category: "House Hold",
      unitCost: 1500,
      sellingPrice: 2000,
      minStock: 5,
      maxStock: 20,
      importAction: "update",
    });
  });

  it("matches an existing item by name and UOM when the name exists in multiple UOMs", () => {
    const result = prepareItemMasterImportRows(
      [
        {
          item_code: "ITM-237",
          item_name: "Nutmeg",
          category: "Dry Foods",
          uom: "pkt",
          opening_balance: "0",
          unit_cost: "4000",
          is_active: "yes",
        },
      ],
      [
        {
          id: "ITM-236",
          code: "ITM-236",
          name: "Nutmeg",
          category: "Dry Foods",
          uom: "TIN",
        },
        {
          id: "ITM-237",
          code: "ITM-237",
          name: "Nutmeg",
          category: "Dry Foods",
          uom: "PKT",
        },
      ]
    );

    expect(result.errors).toEqual([]);
    expect(result.mappedRows[0]).toMatchObject({
      itemId: "ITM-237",
      code: "ITM-237",
      name: "Nutmeg",
      uom: "PKT",
      importAction: "update",
    });
  });

  it("generates item codes when a new item master file has names but no codes", () => {
    const result = prepareItemMasterImportRows(
      [
        {
          item_name: "Sugar",
          category: "Dry Foods",
          uom: "KGS",
          opening_balance: "20",
          unit_cost: "4000",
        },
        {
          item_name: "A4 Envelopes",
          category: "Admin Stationary",
          uom: "PCS",
          opening_balance: "10",
          unit_cost: "400",
        },
      ],
      []
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain("Row 2: item code was blank, so ITM-001 was generated.");
    expect(result.warnings).toContain("Row 3: item code was blank, so ITM-002 was generated.");
    expect(result.mappedRows).toMatchObject([
      {
        code: "ITM-001",
        name: "Sugar",
        uom: "KGS",
        importAction: "new",
      },
      {
        code: "ITM-002",
        name: "A4 Envelopes",
        uom: "PCS",
        importAction: "new",
      },
    ]);
  });
});

describe("opening balance import transforms", () => {
  it("matches items by code, name, and UOM for duplicate-name items", () => {
    const result = prepareOpeningBalanceImportRows(
      [
        {
          item_code: "",
          item_name: "Nutmeg",
          uom: "pkt",
          opening_balance: "5",
          unit_cost: "4000",
        },
      ],
      [
        {
          id: "ITM-236",
          code: "ITM-236",
          name: "Nutmeg",
          uom: "TIN",
        },
        {
          id: "ITM-237",
          code: "ITM-237",
          name: "Nutmeg",
          uom: "PKT",
        },
      ]
    );

    expect(result.errors).toEqual([]);
    expect(result.mappedRows[0]).toMatchObject({
      itemId: "ITM-237",
      openingBalance: 5,
      unitCost: 4000,
    });
  });
});

describe("historical movement import transforms", () => {
  it("matches duplicate-name items by UOM so movement rows stay importable", () => {
    const result = prepareHistoricalMovementImportRows(
      [
        {
          date: "2026-03-27",
          movement_type: "OUT",
          department: "Kitchen",
          item_name: "Nutmeg",
          uom: "pkt",
          quantity: "2",
          requisition_number: "12",
        },
      ],
      [
        {
          id: "ITM-236",
          code: "ITM-236",
          name: "Nutmeg",
          uom: "TIN",
        },
        {
          id: "ITM-237",
          code: "ITM-237",
          name: "Nutmeg",
          uom: "PKT",
        },
      ],
      [
        {
          id: "kitchen",
          code: "DPT-01",
          name: "Kitchen",
          isMainStore: false,
          isActive: true,
        },
      ]
    );

    expect(result.errors).toEqual([]);
    expect(result.mappedRows[0]).toMatchObject({
      itemId: "ITM-237",
      departmentId: "kitchen",
      type: "OUT",
      quantity: 2,
      requisitionNumber: "12",
    });
  });
});

describe("department import transforms", () => {
  it("maps new departments and keeps one main store", () => {
    const result = prepareDepartmentImportRows(
      [
        {
          department_code: "DPT-08",
          department_name: "IT",
          requisition_start_number: "25",
          is_main_store: "no",
          is_active: "yes",
        },
      ],
      [
        {
          id: "main-store",
          code: "DPT-07",
          name: "Main Store",
          isMainStore: true,
          isActive: true,
        },
      ]
    );

    expect(result.errors).toEqual([]);
    expect(result.mappedRows[0]).toMatchObject({
      departmentId: null,
      code: "DPT-08",
      name: "IT",
      requisitionStartNumber: 25,
      isMainStore: false,
      isActive: true,
      importAction: "new",
    });
  });
});
