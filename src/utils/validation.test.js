import { describe, expect, it } from "vitest";
import {
  validateDepartmentForm,
  validateItemForm,
  validateMovementEntry,
} from "./validation";

describe("movement validation", () => {
  it("requires requisition number for OUT", () => {
    const result = validateMovementEntry(
      {
        date: "2026-03-24",
        type: "OUT",
        departmentId: "kitchen",
        itemId: "ITM-001",
        quantity: 3,
        requisitionNumber: "",
        referenceNumber: "",
        adjustmentMode: "INCREASE",
        notes: "",
        enteredBy: "Storekeeper",
      },
      { currentStock: 5 }
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.requisitionNumber).toBeTruthy();
  });

  it("requires reference number for IN and ADJ", () => {
    const result = validateMovementEntry(
      {
        date: "2026-03-24",
        type: "IN",
        departmentId: "main-store",
        itemId: "ITM-001",
        quantity: 3,
        requisitionNumber: "",
        referenceNumber: "",
        adjustmentMode: "INCREASE",
        notes: "",
        enteredBy: "Storekeeper",
      },
      { currentStock: 5 }
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.referenceNumber).toBeTruthy();
  });

  it("blocks a save that would make stock negative", () => {
    const result = validateMovementEntry(
      {
        date: "2026-03-24",
        type: "OUT",
        departmentId: "kitchen",
        itemId: "ITM-001",
        quantity: 8,
        requisitionNumber: "REQ-0008",
        referenceNumber: "",
        adjustmentMode: "INCREASE",
        notes: "",
        enteredBy: "Storekeeper",
      },
      { currentStock: 3 }
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.quantity).toContain("Only 3");
  });

  it("does not apply live stock checks when current stock is intentionally unknown", () => {
    const result = validateMovementEntry(
      {
        date: "2026-03-24",
        type: "OUT",
        departmentId: "kitchen",
        itemId: "ITM-001",
        quantity: 8,
        requisitionNumber: "REQ-0008",
        referenceNumber: "",
        adjustmentMode: "INCREASE",
        notes: "",
        enteredBy: "Importer",
      },
      { currentStock: null }
    );

    expect(result.isValid).toBe(true);
    expect(result.errors.quantity).toBeUndefined();
    expect(result.projectedStock).toBeNull();
  });

  it("warns when projected stock goes below minimum", () => {
    const result = validateMovementEntry(
      {
        date: "2026-03-24",
        type: "OUT",
        departmentId: "kitchen",
        itemId: "ITM-001",
        quantity: 3,
        requisitionNumber: "REQ-0008",
        referenceNumber: "",
        adjustmentMode: "INCREASE",
        notes: "",
        enteredBy: "Storekeeper",
      },
      { currentStock: 5, minStock: 4 }
    );

    expect(result.isValid).toBe(true);
    expect(result.warnings).toContain(
      "Projected stock will fall below the minimum level for this item."
    );
  });

  it("blocks reusing the same department requisition number on a different date", () => {
    const result = validateMovementEntry(
      {
        date: "2026-03-25",
        type: "OUT",
        departmentId: "kitchen",
        itemId: "ITM-002",
        quantity: 2,
        requisitionNumber: "REQ-0008",
        referenceNumber: "",
        adjustmentMode: "INCREASE",
        notes: "",
        enteredBy: "Storekeeper",
      },
      {
        movements: [
          {
            id: "MOV-001",
            date: "2026-03-24",
            type: "OUT",
            departmentId: "kitchen",
            itemId: "ITM-001",
            requisitionNumber: "REQ-0008",
          },
        ],
      }
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.requisitionNumber).toContain("2026-03-24");
  });

  it("allows the same department requisition number on the same date", () => {
    const result = validateMovementEntry(
      {
        date: "2026-03-24",
        type: "OUT",
        departmentId: "kitchen",
        itemId: "ITM-002",
        quantity: 2,
        requisitionNumber: "REQ-0008",
        referenceNumber: "",
        adjustmentMode: "INCREASE",
        notes: "",
        enteredBy: "Storekeeper",
      },
      {
        movements: [
          {
            id: "MOV-001",
            date: "2026-03-24",
            type: "OUT",
            departmentId: "kitchen",
            itemId: "ITM-001",
            requisitionNumber: "REQ-0008",
          },
        ],
      }
    );

    expect(result.isValid).toBe(true);
    expect(result.errors.requisitionNumber).toBeUndefined();
  });

  it("treats old prefixed requisitions and plain book pages as the same page", () => {
    const result = validateMovementEntry(
      {
        date: "2026-03-25",
        type: "OUT",
        departmentId: "kitchen",
        itemId: "ITM-002",
        quantity: 2,
        requisitionNumber: "8",
        referenceNumber: "",
        adjustmentMode: "INCREASE",
        notes: "",
        enteredBy: "Storekeeper",
      },
      {
        movements: [
          {
            id: "MOV-001",
            date: "2026-03-24",
            type: "OUT",
            departmentId: "kitchen",
            itemId: "ITM-001",
            requisitionNumber: "REQ-0008",
          },
        ],
      }
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.requisitionNumber).toContain("2026-03-24");
  });
});

describe("item validation", () => {
  it("prevents duplicate item names for the same UOM", () => {
    const result = validateItemForm(
      {
        code: "ITM-900",
        name: "Bath Soap",
        uom: "PCS",
        openingBalance: 0,
        isActive: true,
      },
      [
        {
          id: "ITM-001",
          code: "ITM-001",
          name: "Bath Soap",
          uom: "PCS",
          openingBalance: 4,
          isActive: true,
        },
      ]
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBe("Item name and UOM already exist.");
  });

  it("allows the same item name when the UOM is different", () => {
    const result = validateItemForm(
      {
        code: "ITM-901",
        name: "Nutmeg",
        uom: "PKT",
        category: "Dry Foods",
        openingBalance: 0,
        isActive: true,
      },
      [
        {
          id: "ITM-236",
          code: "ITM-236",
          name: "Nutmeg",
          uom: "TIN",
          category: "Dry Foods",
          openingBalance: 4,
          isActive: true,
        },
      ]
    );

    expect(result.isValid).toBe(true);
    expect(result.errors.name).toBeUndefined();
  });

  it("requires maximum stock to stay above minimum stock", () => {
    const result = validateItemForm(
      {
        code: "ITM-901",
        name: "Shampoo",
        uom: "PCS",
        openingBalance: 0,
        minStock: 10,
        maxStock: 5,
        isActive: true,
      },
      []
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.maxStock).toBe(
      "Maximum stock must be equal to or greater than minimum stock."
    );
  });

  it("rejects a negative unit cost", () => {
    const result = validateItemForm(
      {
        code: "ITM-902",
        name: "Laundry Soap",
        uom: "PCS",
        openingBalance: 0,
        unitCost: -10,
        isActive: true,
      },
      []
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.unitCost).toBe("Unit cost must be blank or 0 and above.");
  });

  it("rejects a negative selling price", () => {
    const result = validateItemForm(
      {
        code: "ITM-903",
        name: "Body Lotion",
        uom: "PCS",
        openingBalance: 0,
        sellingPrice: -5,
        isActive: true,
      },
      []
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.sellingPrice).toBe("Selling price must be blank or 0 and above.");
  });
});

describe("department validation", () => {
  it("requires first requisition page to be 1 or greater", () => {
    const result = validateDepartmentForm(
      {
        code: "DPT-08",
        name: "IT",
        requisitionStartNumber: 0,
        isMainStore: false,
        isActive: true,
      },
      []
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.requisitionStartNumber).toBe(
      "First requisition page must be 1 or greater."
    );
  });
});
