import { describe, expect, it } from "vitest";
import {
  calculateDashboardMetrics,
  calculateFinanceCategoryRows,
  calculateFinanceCategoryItemRows,
  calculateFinanceDailyRows,
  calculateFinancePeriodRows,
  calculateIssueDepartmentBreakdownRows,
  calculateIssueDepartmentItemRows,
  calculateIssueDepartmentReportRows,
  calculateItemMovementDepartmentRows,
  calculateItemMovementLineRows,
  calculateItemStock,
  calculateLossReportRows,
  calculateMovementTrend,
  calculatePeriodMovementSummary,
  calculateReceiptReportRows,
  calculateStockRows,
  filterActiveMovements,
  projectWeightedAverageCost,
} from "./calculations";

describe("stock calculations", () => {
  const item = {
    id: "ITM-001",
    code: "ITM-001",
    name: "Coffee Beans",
    uom: "kgs",
    openingBalance: 10,
    unitCost: 15000,
    minStock: 4,
    maxStock: 12,
  };

  const movements = [
    {
      id: "MOV-1",
      itemId: "ITM-001",
      departmentId: "main-store",
      date: "2026-03-01",
      type: "IN",
      quantity: 5,
      adjustmentMode: "INCREASE",
    },
    {
      id: "MOV-2",
      itemId: "ITM-001",
      departmentId: "kitchen",
      date: "2026-03-02",
      type: "OUT",
      quantity: 3,
      adjustmentMode: "INCREASE",
    },
    {
      id: "MOV-3",
      itemId: "ITM-001",
      departmentId: "main-store",
      date: "2026-03-02",
      type: "ADJ",
      quantity: 2,
      adjustmentMode: "DECREASE",
    },
  ];

  it("calculates stock on hand from opening and movements", () => {
    expect(calculateItemStock(item, movements)).toMatchObject({
      inQty: 5,
      outQty: 3,
      adjQty: -2,
      stockOnHand: 10,
    });
  });

  it("calculates finance daily opening and closing correctly", () => {
    const [row] = calculateFinanceDailyRows([item], movements, "2026-03-02");

    expect(row.opening).toBe(15);
    expect(row.inQty).toBe(0);
    expect(row.outQty).toBe(3);
    expect(row.adjQty).toBe(-2);
    expect(row.availableQty).toBe(13);
    expect(row.closing).toBe(10);
    expect(row.requiredQty).toBe(0);
    expect(row.stockValue).toBe(150000);
  });

  it("calculates finance period totals for a weekly range", () => {
    const [row] = calculateFinancePeriodRows([item], movements, {
      startDate: "2026-03-01",
      endDate: "2026-03-07",
    });

    expect(row.opening).toBe(10);
    expect(row.inQty).toBe(5);
    expect(row.outQty).toBe(3);
    expect(row.adjQty).toBe(-2);
    expect(row.availableQty).toBe(13);
    expect(row.closing).toBe(10);
    expect(row.lineCount).toBe(3);
    expect(row.hasActivity).toBe(true);
    expect(row.needsReview).toBe(false);
    expect(row.stockValue).toBe(150000);
  });

  it("ignores deleted movements in stock and movement metrics", () => {
    const deletedMovements = [
      ...movements,
      {
        id: "MOV-4",
        itemId: "ITM-001",
        departmentId: "kitchen",
        date: "2026-03-03",
        type: "OUT",
        quantity: 4,
        adjustmentMode: "INCREASE",
        deletedAt: "2026-03-03T10:00:00.000Z",
      },
    ];

    expect(filterActiveMovements(deletedMovements)).toHaveLength(3);
    expect(calculateItemStock(item, deletedMovements).stockOnHand).toBe(10);

    const trend = calculateMovementTrend(deletedMovements, "2026-03-03", 1);
    expect(trend[0].lineCount).toBe(0);
  });

  it("builds dashboard metrics for the selected day", () => {
    const stockRows = calculateStockRows(
      [
        {
          ...item,
          minStock: 12,
          maxStock: 18,
        },
      ],
      movements
    );

    const metrics = calculateDashboardMetrics({
      items: [item],
      movements,
      stockRows,
      selectedDate: "2026-03-02",
    });

    expect(metrics.todayLines).toBe(2);
    expect(metrics.todayOutLines).toBe(1);
    expect(metrics.todayAdjLines).toBe(1);
    expect(metrics.departmentsWithIssuesToday).toBe(1);
    expect(metrics.belowMinItems).toBe(1);
    expect(metrics.itemsWithMinMax).toBe(1);
  });

  it("builds a 7-day movement trend ending on the selected date", () => {
    const trend = calculateMovementTrend(movements, "2026-03-04", 4);

    expect(trend).toEqual([
      {
        date: "2026-03-01",
        lineCount: 1,
        inLines: 1,
        outLines: 0,
        adjLines: 0,
      },
      {
        date: "2026-03-02",
        lineCount: 2,
        inLines: 0,
        outLines: 1,
        adjLines: 1,
      },
      {
        date: "2026-03-03",
        lineCount: 0,
        inLines: 0,
        outLines: 0,
        adjLines: 0,
      },
      {
        date: "2026-03-04",
        lineCount: 0,
        inLines: 0,
        outLines: 0,
        adjLines: 0,
      },
    ]);
  });

  it("uses weighted average cost after a new receipt price changes", () => {
    const sugarItem = {
      id: "ITM-SUGAR",
      code: "ITM-SUGAR",
      name: "Sugar",
      uom: "kgs",
      openingBalance: 10,
      unitCost: 3000,
      minStock: 4,
      maxStock: 60,
    };
    const sugarMovements = [
      {
        id: "MOV-IN-SUGAR",
        itemId: "ITM-SUGAR",
        departmentId: "main-store",
        date: "2026-03-01",
        type: "IN",
        quantity: 30,
        unitCost: 4000,
        adjustmentMode: "INCREASE",
      },
      {
        id: "MOV-OUT-SUGAR",
        itemId: "ITM-SUGAR",
        departmentId: "kitchen",
        date: "2026-03-02",
        type: "OUT",
        quantity: 5,
        adjustmentMode: "INCREASE",
        requisitionNumber: "12",
      },
    ];

    expect(projectWeightedAverageCost(10, 3000, 30, 4000)).toBe(3750);

    const [stockRow] = calculateStockRows([sugarItem], sugarMovements);
    expect(stockRow.unitCost).toBe(3750);
    expect(stockRow.lastPurchaseCost).toBe(4000);
    expect(stockRow.stockOnHand).toBe(35);
    expect(stockRow.stockValue).toBe(131250);

    const [issueRow] = calculateIssueDepartmentReportRows(
      [{ id: "kitchen", name: "Kitchen" }],
      [sugarItem],
      sugarMovements,
      { startDate: "2026-03-01", endDate: "2026-03-31" }
    );
    expect(issueRow.issuedValue).toBe(18750);
  });
});

describe("finance reporting calculations", () => {
  const items = [
    {
      id: "ITM-001",
      code: "ITM-001",
      name: "Coffee Beans",
      category: "Beverages",
      uom: "kgs",
      openingBalance: 10,
      unitCost: 15000,
    },
    {
      id: "ITM-002",
      code: "ITM-002",
      name: "Bath Soap",
      category: "Housekeeping",
      uom: "pcs",
      openingBalance: 20,
      unitCost: 2500,
    },
  ];

  const departments = [
    { id: "main-store", name: "Main Store" },
    { id: "kitchen", name: "Kitchen" },
    { id: "housekeeping", name: "Housekeeping" },
  ];

  const movements = [
    {
      id: "MOV-1",
      itemId: "ITM-001",
      departmentId: "main-store",
      date: "2026-03-01",
      type: "IN",
      quantity: 5,
      adjustmentMode: "INCREASE",
      referenceNumber: "GRN-001",
    },
    {
      id: "MOV-2",
      itemId: "ITM-001",
      departmentId: "kitchen",
      date: "2026-03-02",
      type: "OUT",
      quantity: 3,
      adjustmentMode: "INCREASE",
      requisitionNumber: "REQ-0001",
    },
    {
      id: "MOV-3",
      itemId: "ITM-002",
      departmentId: "housekeeping",
      date: "2026-03-02",
      type: "OUT",
      quantity: 4,
      adjustmentMode: "INCREASE",
      requisitionNumber: "REQ-0002",
    },
    {
      id: "MOV-4",
      itemId: "ITM-002",
      departmentId: "main-store",
      date: "2026-03-03",
      type: "ADJ",
      quantity: 2,
      adjustmentMode: "DECREASE",
      referenceNumber: "ADJ-001",
      notes: "Spoilt stock after damage",
    },
    {
      id: "MOV-5",
      itemId: "ITM-002",
      departmentId: "main-store",
      date: "2026-03-04",
      type: "IN",
      quantity: 10,
      adjustmentMode: "INCREASE",
      referenceNumber: "GRN-002",
    },
  ];

  const range = {
    startDate: "2026-03-01",
    endDate: "2026-03-31",
  };

  it("summarizes received, issued, and loss movements for a period", () => {
    expect(calculatePeriodMovementSummary(items, movements, range)).toMatchObject({
      receivedQty: 15,
      issuedQty: 7,
      lossQty: 2,
      increaseAdjustQty: 0,
      decreaseAdjustQty: 2,
      receivedValue: 100000,
      issuedValue: 55000,
      lossValue: 5000,
      lineCount: 5,
      receiptLines: 2,
      issueLines: 2,
      lossLines: 1,
    });
  });

  it("builds received stock rows by item", () => {
    expect(calculateReceiptReportRows(items, movements, range)).toEqual([
      expect.objectContaining({
        id: "ITM-002",
        itemName: "Bath Soap",
        category: "Housekeeping",
        receivedQty: 10,
        receivedValue: 25000,
        referenceCount: 1,
        lineCount: 1,
      }),
      expect.objectContaining({
        id: "ITM-001",
        itemName: "Coffee Beans",
        category: "Beverages",
        receivedQty: 5,
        receivedValue: 75000,
        referenceCount: 1,
        lineCount: 1,
      }),
    ]);
  });

  it("builds department issue summaries and item drill-down rows", () => {
    const departmentRows = calculateIssueDepartmentReportRows(
      departments,
      items,
      movements,
      range
    );

    expect(departmentRows).toEqual([
      expect.objectContaining({
        id: "housekeeping",
        departmentName: "Housekeeping",
        issuedQty: 4,
        issuedValue: 10000,
        uniqueItems: 1,
        requisitionCount: 1,
      }),
      expect.objectContaining({
        id: "kitchen",
        departmentName: "Kitchen",
        issuedQty: 3,
        issuedValue: 45000,
        uniqueItems: 1,
        requisitionCount: 1,
      }),
    ]);

    expect(
      calculateIssueDepartmentItemRows(items, movements, range, "housekeeping")
    ).toEqual([
      expect.objectContaining({
        id: "ITM-002",
        itemName: "Bath Soap",
        issuedQty: 4,
        issuedValue: 10000,
        requisitionCount: 1,
      }),
    ]);
  });

  it("builds issue item rows across multiple selected departments", () => {
    expect(
      calculateIssueDepartmentBreakdownRows(
        departments,
        items,
        movements,
        range,
        ["kitchen", "housekeeping"]
      )
    ).toEqual([
      expect.objectContaining({
        departmentName: "Housekeeping",
        itemName: "Bath Soap",
        category: "Housekeeping",
        issuedQty: 4,
        issuedValue: 10000,
        requisitionCount: 1,
      }),
      expect.objectContaining({
        departmentName: "Kitchen",
        itemName: "Coffee Beans",
        category: "Beverages",
        issuedQty: 3,
        issuedValue: 45000,
        requisitionCount: 1,
      }),
    ]);
  });

  it("builds spoilt and disposal rows from reducing adjustments", () => {
    expect(calculateLossReportRows(items, departments, movements, range)).toEqual([
      expect.objectContaining({
        id: "ITM-002:Spoilt / Expired",
        itemName: "Bath Soap",
        itemCategory: "Housekeeping",
        departmentName: "Main Store",
        category: "Spoilt / Expired",
        lossQty: 2,
        lossValue: 5000,
      }),
    ]);
  });

  it("builds item movement summaries across all departments for one item", () => {
    const rows = calculateItemMovementDepartmentRows(
      items,
      departments,
      movements,
      range,
      "ITM-002"
    );

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          departmentName: "Housekeeping",
          inQty: 0,
          outQty: 4,
          adjQty: 0,
          netQty: -4,
          lineCount: 1,
          referenceCount: 1,
        }),
        expect.objectContaining({
          departmentName: "Main Store",
          inQty: 10,
          outQty: 0,
          adjQty: -2,
          netQty: 8,
          lineCount: 2,
          referenceCount: 2,
        }),
      ])
    );
  });

  it("builds finance rows grouped by item category", () => {
    expect(calculateFinanceCategoryRows(items, movements, range)).toEqual([
      expect.objectContaining({
        category: "Beverages",
        itemCount: 1,
        opening: 10,
        inQty: 5,
        outQty: 3,
        closing: 12,
        stockValue: 180000,
      }),
      expect.objectContaining({
        category: "Housekeeping",
        itemCount: 1,
        opening: 20,
        inQty: 10,
        adjQty: -2,
        outQty: 4,
        closing: 24,
        stockValue: 60000,
      }),
    ]);
  });

  it("builds item-level finance rows for one selected category", () => {
    expect(
      calculateFinanceCategoryItemRows(items, movements, range, "Beverages")
    ).toEqual([
      expect.objectContaining({
        id: "ITM-001",
        code: "ITM-001",
        name: "Coffee Beans",
        category: "Beverages",
        opening: 10,
        inQty: 5,
        outQty: 3,
        closing: 12,
        stockValue: 180000,
      }),
    ]);
  });

  it("builds item movement line rows with documents and signed effects", () => {
    expect(
      calculateItemMovementLineRows(items, departments, movements, range, "ITM-002")
    ).toEqual([
      expect.objectContaining({
        date: "2026-03-02",
        departmentName: "Housekeeping",
        type: "OUT",
        documentNumber: "2",
        quantity: 4,
        effectQty: -4,
      }),
      expect.objectContaining({
        date: "2026-03-03",
        departmentName: "Main Store",
        type: "ADJ",
        documentNumber: "ADJ-001",
        quantity: 2,
        effectQty: -2,
      }),
      expect.objectContaining({
        date: "2026-03-04",
        departmentName: "Main Store",
        type: "IN",
        documentNumber: "GRN-002",
        quantity: 10,
        effectQty: 10,
      }),
    ]);
  });
});
