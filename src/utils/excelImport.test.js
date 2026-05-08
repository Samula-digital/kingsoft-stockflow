import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  filterWorkbookPreviewByScope,
  filterWorkbookPreviewByDateRange,
  parseDailyStoresSheetRows,
  parseDailyStoresWorkbook,
  parseTemplateDate,
} from "./excelImport";

describe("excel import helpers", () => {
  it("parses sheet names into ISO dates", () => {
    expect(parseTemplateDate("1.1.2026")).toBe("2026-01-01");
    expect(parseTemplateDate("21.2.2026")).toBe("2026-02-21");
    expect(parseTemplateDate("Summary")).toBe("");
  });

  it("extracts openings and movements from the daily stores template", () => {
    const rows = [
      [
        "99999",
        "Uom",
        "OPENING STOCK",
        "RECIEVED STOCK",
        "Total Stock",
        "Issued Stock",
        "Clossing Stock",
        "Unit",
        "Stock Value",
        "Maxmum",
        "Mini mum stock level",
        "Required stock",
      ],
      ["FISH", "kgs", 10, 5, 15, 4, 11, 14000, 154000, 50, 30, 39],
      ["", "", "", "", "", "", "", "TOTAL"],
      [
        "DRY ITEMS/GLOSSARIES",
        "Uom",
        "OPENING STOCK",
        "RECIEVED STOCK",
        "Total Stock",
        "Issued Stock",
        "Clossing Stock",
        "Unit",
        "Stock Value",
        "Maxmum",
        "Mini mum stock level",
        "Required stock",
      ],
      ["BEEF", "kgs", 3, 0, 3, 0, 5, 13000, 65000, 100, 10, 95],
    ];

    const items = [
      { id: "ITM-001", code: "ITM-001", name: "FISH", uom: "kgs" },
      { id: "ITM-002", code: "ITM-002", name: "BEEF", uom: "kgs" },
    ];

    const parsed = parseDailyStoresSheetRows(rows, "1.1.2026", items, {
      receiveDepartmentId: "main-store",
      issueDepartmentId: "kitchen",
      fileName: "daily.xlsx",
      enteredBy: "Excel Import",
    });

    expect(parsed.openingRows).toHaveLength(2);
    expect(parsed.movements).toHaveLength(3);

    expect(parsed.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "IN",
          itemId: "ITM-001",
          quantity: 5,
          departmentId: "main-store",
          category: "Cold Room Items",
        }),
        expect.objectContaining({
          type: "OUT",
          itemId: "ITM-001",
          quantity: 4,
          departmentId: "kitchen",
          category: "Cold Room Items",
        }),
        expect.objectContaining({
          type: "ADJ",
          itemId: "ITM-002",
          quantity: 2,
          adjustmentMode: "INCREASE",
          departmentId: "main-store",
          category: "Dry Foods",
        }),
      ])
    );

    expect(parsed.openingRows[0]).toMatchObject({
      itemId: "ITM-001",
      category: "Cold Room Items",
      unitCost: 14000,
      minStock: 30,
      maxStock: 50,
      requiredStock: 39,
    });

    expect(parsed.openingRows[1]).toMatchObject({
      itemId: "ITM-002",
      category: "Dry Foods",
    });

    expect(parsed.reconciliationRows[0]).toMatchObject({
      itemName: "BEEF",
      variance: 2,
    });
  });

  it("derives unit cost from stock value when the unit column is blank", () => {
    const rows = [
      [
        "Item Name",
        "Uom",
        " OPENING STOCK ",
        " RECIEVED STOCK ",
        " Total Stock ",
        "Issued Stock",
        " Clossing Stock ",
        " Unit ",
        " Stock Value ",
        "Maxmum",
        "Mini mum stock level",
        " Required stock ",
      ],
      ["FISH", "kgs", 0, 0, 5, 0, 5, "", 70000, 50, 30, 45],
    ];

    const items = [{ id: "ITM-001", code: "ITM-001", name: "FISH", uom: "kgs" }];
    const parsed = parseDailyStoresSheetRows(rows, "1.1.2026", items);

    expect(parsed.openingRows[0]).toMatchObject({
      itemId: "ITM-001",
      unitCost: 14000,
      sourceStockValue: 70000,
    });
  });

  it("normalizes beer crate costs when the stock item is tracked per bottle", () => {
    const rows = [
      [
        "Item Name",
        "Uom",
        " OPENING STOCK ",
        " RECIEVED STOCK ",
        " Total Stock ",
        "Issued Stock",
        " Clossing Stock ",
        " Unit ",
        " Stock Value ",
        "Maxmum",
        "Mini mum stock level",
        " Required stock ",
      ],
      ["BEERS", "crt", 580, 160, 740, 50, 690, 69800, 48162000, 50, 20, 0],
    ];

    const items = [{ id: "ITM-BEER", code: "ITM-BEER", name: "BEERS", uom: "BTL" }];
    const parsed = parseDailyStoresSheetRows(rows, "1.1.2026", items, {
      receiveDepartmentId: "main-store",
      issueDepartmentId: "bar",
    });

    expect(parsed.openingRows[0]).toMatchObject({
      itemId: "ITM-BEER",
      unitCost: 2792,
      minStock: 500,
      maxStock: 1250,
    });
    expect(parsed.movements.find((movement) => movement.type === "IN")).toMatchObject({
      itemId: "ITM-BEER",
      quantity: 160,
      unitCost: 2792,
    });
  });

  it("groups workbook issue rows into daily requisition pages by inferred department", () => {
    const workbook = XLSX.utils.book_new();
    const header = [
      "Item Name",
      "Uom",
      " OPENING STOCK ",
      " RECIEVED STOCK ",
      " Total Stock ",
      "Issued Stock",
      " Clossing Stock ",
      " Unit ",
      " Stock Value ",
      "Maxmum",
      "Mini mum stock level",
      " Required stock ",
    ];
    const householdHeader = [
      "HOUSE HOLD",
      "Uom",
      "OPENING STOCK",
      "RECIEVED STOCK",
      "Total Stock",
      "Issued Stock",
      "Clossing Stock",
      "Unit",
      "STOCK VALUE",
      "Maximum",
      "Mini mum stock level",
      "Required stock",
    ];

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        header,
        ["FISH", "kgs", 10, 0, 10, 2, 8, 14000, 112000, 50, 30, 42],
        ["BEEF", "kgs", 10, 0, 10, 1, 9, 17000, 153000, 50, 30, 41],
        householdHeader,
        ["BAR SOAP", "bar", 10, 0, 10, 3, 7, 2000, 14000, 50, 30, 43],
      ]),
      "1.1.2026"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        header,
        ["FISH", "kgs", 8, 0, 8, 1, 7, 14000, 98000, 50, 30, 43],
        householdHeader,
        ["BAR SOAP", "bar", 7, 0, 7, 1, 6, 2000, 12000, 50, 30, 44],
      ]),
      "2.1.2026"
    );

    const parsed = parseDailyStoresWorkbook(
      workbook,
      [
        { id: "ITM-FISH", code: "ITM-FISH", name: "FISH", uom: "kgs" },
        { id: "ITM-BEEF", code: "ITM-BEEF", name: "BEEF", uom: "kgs" },
        { id: "ITM-SOAP", code: "ITM-SOAP", name: "BAR SOAP", uom: "bar" },
      ],
      {
        xlsx: XLSX,
        issueDepartmentMap: {
          "Cold Room Items": "kitchen",
          "House Hold": "housekeeping",
        },
        departmentRequisitionStartNumbers: {
          kitchen: 7,
          housekeeping: 3,
        },
      }
    );

    const issues = parsed.movementRows.filter((row) => row.type === "OUT");
    const fishDayOne = issues.find((row) => row.date === "2026-01-01" && row.itemId === "ITM-FISH");
    const beefDayOne = issues.find((row) => row.date === "2026-01-01" && row.itemId === "ITM-BEEF");
    const soapDayOne = issues.find((row) => row.date === "2026-01-01" && row.itemId === "ITM-SOAP");
    const fishDayTwo = issues.find((row) => row.date === "2026-01-02" && row.itemId === "ITM-FISH");
    const soapDayTwo = issues.find((row) => row.date === "2026-01-02" && row.itemId === "ITM-SOAP");

    expect(fishDayOne?.departmentId).toBe("kitchen");
    expect(beefDayOne?.departmentId).toBe("kitchen");
    expect(fishDayOne?.requisitionNumber).toBe("7");
    expect(beefDayOne?.requisitionNumber).toBe("7");
    expect(fishDayTwo?.requisitionNumber).toBe("8");
    expect(soapDayOne?.departmentId).toBe("housekeeping");
    expect(soapDayOne?.requisitionNumber).toBe("3");
    expect(soapDayTwo?.requisitionNumber).toBe("4");
  });

  it("preserves the last known workbook cost when a newer sheet leaves cost blank", () => {
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [
          "Item Name",
          "Uom",
          " OPENING STOCK ",
          " RECIEVED STOCK ",
          " Total Stock ",
          "Issued Stock",
          " Clossing Stock ",
          " Unit ",
          " Stock Value ",
          "Maxmum",
          "Mini mum stock level",
          " Required stock ",
        ],
        ["FISH", "kgs", 1, 0, 1, 0, 1, 14000, 14000, 50, 30, 49],
      ]),
      "1.1.2026"
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [
          "Item Name",
          "Uom",
          " OPENING STOCK ",
          " RECIEVED STOCK ",
          " Total Stock ",
          "Issued Stock",
          " Clossing Stock ",
          " Unit ",
          " Stock Value ",
          "Maxmum",
          "Mini mum stock level",
          " Required stock ",
        ],
        ["FISH", "kgs", 2, 0, 2, 0, 2, "", 28000, 55, 35, 53],
      ]),
      "2.1.2026"
    );

    const items = [{ id: "ITM-001", code: "ITM-001", name: "FISH", uom: "kgs" }];
    const parsed = parseDailyStoresWorkbook(workbook, items, { xlsx: XLSX });

    expect(parsed.itemProfileRows).toEqual([
      expect.objectContaining({
        itemId: "ITM-001",
        openingBalance: 2,
        unitCost: 14000,
        minStock: 35,
        maxStock: 55,
      }),
    ]);
  });

  it("recognizes workbook header variations and ignores section headers", () => {
    const rows = [
      [
        "FRESH FOODS,FRUITS AND VEGs",
        "UoM",
        "OPENINGSTOCK",
        "RECIEVED STOCK",
        "Total Stock",
        "Issued Stock",
        "Clossing Stock",
        "Unit",
        "STOCK VALUE",
        "Maximum",
        "Minimum",
        "Required stock",
      ],
      ["IMPORTED FRUITS", "pcs", "-", "", "-", "", "-", "", "-", 50, 20, 50],
      ["VEGETABLES", "Bchs", "-", "", "-", "", "-", "", "-", 50, 20, 50],
    ];

    const items = [
      { id: "ITM-001", code: "ITM-001", name: "IMPORTED FRUITS", uom: "pcs" },
      { id: "ITM-002", code: "ITM-002", name: "VEGETABLES", uom: "Bchs" },
    ];

    const parsed = parseDailyStoresSheetRows(rows, "1.3.2026", items);

    expect(parsed.unmatchedRows).toEqual([]);
    expect(parsed.openingRows).toHaveLength(2);
    expect(parsed.openingRows[0].category).toBe("Fresh Foods and Fruits");
  });

  it("creates workbook item profiles for new workbook-only items", () => {
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [
          "BEVERAGE",
          "Uom",
          "OPENING STOCK ",
          "RECIEVED STOCK",
          "Total Stock",
          "Issued Stock",
          "Clossing Stock",
          "Unit",
          "STOCK VALUE",
          "Maximum",
          "Mini mum stock level",
          "Required stock",
        ],
        ["UG750MLS lemon and ginger", "btl", 4, 2, 6, 1, 5, 12000, 60000, 12, 2, 8],
      ]),
      "5.3.2026"
    );

    const parsed = parseDailyStoresWorkbook(workbook, [], { xlsx: XLSX });
    const [itemProfile] = parsed.itemProfileRows;
    const [openingSnapshot] = parsed.openingSnapshots;
    const movementTypes = parsed.movementRows.map((row) => row.type);

    expect(itemProfile).toMatchObject({
      code: expect.stringMatching(/^WB-/),
      name: "UG750MLS lemon and ginger",
      category: "Beverages",
      uom: "btl",
      importAction: "new",
    });
    expect(openingSnapshot.rows[0].itemId).toBe(itemProfile.itemId);
    expect(movementTypes).toEqual(["IN", "OUT"]);
  });

  it("flags blank UOM workbook rows as unmatched when the same item name exists with different UOMs", () => {
    const rows = [
      [
        "Item Name",
        "Uom",
        " OPENING STOCK ",
        " RECIEVED STOCK ",
        " Total Stock ",
        "Issued Stock",
        " Clossing Stock ",
        " Unit ",
        " Stock Value ",
        "Maximum",
        "Mini mum stock level",
        " Required stock ",
      ],
      ["SUGAR", "", 10, 0, 10, 0, 10, "", 100000, 50, 20, 45],
    ];

    const items = [
      { id: "ITM-001", code: "ITM-001", name: "SUGAR", uom: "KGS" },
      { id: "ITM-002", code: "ITM-002", name: "SUGAR", uom: "BAGS" },
    ];

    const parsed = parseDailyStoresSheetRows(rows, "1.1.2026", items);

    expect(parsed.unmatchedRows).toHaveLength(1);
    expect(parsed.openingRows).toHaveLength(0);
    expect(parsed.unmatchedRows[0]).toMatchObject({
      itemLabel: "SUGAR",
      uom: "",
      category: "Cold Room Items",
    });
  });

  it("uses category-specific issue departments when workbook sections imply ownership", () => {
    const rows = [
      [
        "HOUSE HOLD",
        "Uom",
        "OPENING STOCK",
        "RECIEVED STOCK",
        "Total Stock",
        "Issued Stock",
        "Clossing Stock",
        "Unit",
        "STOCK VALUE",
        "Maximum",
        "Mini mum stock level",
        "Required stock",
      ],
      ["BAR SOAP", "bar", 7, 0, 7, 2, 5, 3500, 17500, 24, 5, 19],
      [
        "BEVERAGE",
        "Uom",
        "OPENING STOCK",
        "RECIEVED STOCK",
        "Total Stock",
        "Issued Stock",
        "Clossing Stock",
        "Unit",
        "STOCK VALUE",
        "Maximum",
        "Mini mum stock level",
        "Required stock",
      ],
      ["HEINKEN", "btl", 10, 0, 10, 3, 7, 7000, 49000, 24, 5, 17],
    ];

    const items = [
      { id: "ITM-001", code: "ITM-001", name: "BAR SOAP", uom: "bar" },
      { id: "ITM-002", code: "ITM-002", name: "HEINKEN", uom: "btl" },
    ];

    const parsed = parseDailyStoresSheetRows(rows, "1.3.2026", items, {
      issueDepartmentId: "fallback-issues",
      issueDepartmentMap: {
        "House Hold": "housekeeping",
        Beverages: "coffee-bar",
      },
    });

    expect(parsed.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "OUT",
          itemId: "ITM-001",
          departmentId: "housekeeping",
          category: "House Hold",
        }),
        expect.objectContaining({
          type: "OUT",
          itemId: "ITM-002",
          departmentId: "coffee-bar",
          category: "Beverages",
        }),
      ])
    );
  });

  it("normalizes workbook levels when maximum stock is below minimum stock", () => {
    const rows = [
      [
        "Item Name",
        "Uom",
        "OPENING STOCK",
        "RECIEVED STOCK",
        "Total Stock",
        "Issued Stock",
        "Clossing Stock",
        "Unit",
        "Stock Value",
        "Maxmum",
        "Mini mum stock level",
        "Required stock",
      ],
      ["STAPLER", "Pic", 0, 0, 0, 0, 0, 18000, 0, 3, 5, 3],
    ];

    const items = [{ id: "ITM-331", code: "ITM-331", name: "STAPLER", uom: "Pic" }];
    const parsed = parseDailyStoresSheetRows(rows, "27.3.2026", items);

    expect(parsed.openingRows[0]).toMatchObject({
      itemId: "ITM-331",
      minStock: 5,
      maxStock: 5,
      requiredStock: 3,
    });
    expect(parsed.warnings[0]).toContain("maximum stock below minimum stock");
  });

  it("filters workbook previews down to the selected reporting window", () => {
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [
          "Item Name",
          "Uom",
          "OPENING STOCK",
          "RECIEVED STOCK",
          "Total Stock",
          "Issued Stock",
          "Clossing Stock",
          "Unit",
          "Stock Value",
          "Maxmum",
          "Mini mum stock level",
          "Required stock",
        ],
        ["FISH", "kgs", 10, 0, 10, 2, 8, 14000, 112000, 50, 30, 42],
      ]),
      "28.2.2026"
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [
          "Item Name",
          "Uom",
          "OPENING STOCK",
          "RECIEVED STOCK",
          "Total Stock",
          "Issued Stock",
          "Clossing Stock",
          "Unit",
          "Stock Value",
          "Maxmum",
          "Mini mum stock level",
          "Required stock",
        ],
        ["FISH", "kgs", 8, 5, 13, 3, 10, 14500, 145000, 50, 30, 40],
      ]),
      "1.3.2026"
    );

    const items = [{ id: "ITM-001", code: "ITM-001", name: "FISH", uom: "kgs" }];
    const parsed = parseDailyStoresWorkbook(workbook, items, { xlsx: XLSX });
    const filtered = filterWorkbookPreviewByDateRange(parsed, "2026-03-01", "2026-03-31");

    expect(filtered.sheetSummaries).toHaveLength(1);
    expect(filtered.sheetSummaries[0].date).toBe("2026-03-01");
    expect(filtered.openingSnapshots).toHaveLength(1);
    expect(filtered.movementRows).toHaveLength(2);
    expect(filtered.itemProfileRows[0]).toMatchObject({
      itemId: "ITM-001",
      openingBalance: 8,
      unitCost: 14500,
    });
    expect(filtered.reportInsight).toMatchObject({
      dateFrom: "2026-03-01",
      dateTo: "2026-03-31",
      openingDateSuggestion: "2026-03-01",
    });
  });

  it("filters workbook previews by category and selected items", () => {
    const preview = {
      sheetSummaries: [
        {
          sheetName: "1.3.2026",
          date: "2026-03-01",
          matchedCount: 2,
          openingCount: 2,
          movementCount: 2,
          unmatchedCount: 1,
          reconciliationCount: 1,
        },
      ],
      openingSnapshots: [
        {
          date: "2026-03-01",
          sheetName: "1.3.2026",
          rows: [
            { itemId: "ITM-001", category: "Dry Foods" },
            { itemId: "ITM-002", category: "Beverages" },
          ],
        },
      ],
      movementRows: [
        { date: "2026-03-01", type: "OUT", itemId: "ITM-001", quantity: 3 },
        { date: "2026-03-01", type: "IN", itemId: "ITM-002", quantity: 2 },
      ],
      itemProfileRows: [
        { itemId: "ITM-001", code: "ITM-001", name: "SUGAR", category: "Dry Foods", uom: "kgs" },
        { itemId: "ITM-002", code: "ITM-002", name: "WATER", category: "Beverages", uom: "btl" },
      ],
      unmatchedRows: [{ date: "2026-03-01", category: "Dry Foods", itemLabel: "UNKNOWN" }],
      reconciliationRows: [{ date: "2026-03-01", itemId: "ITM-001", variance: 1 }],
      availableDates: ["2026-03-01"],
      selectedDateFrom: "2026-03-01",
      selectedDateTo: "2026-03-01",
    };

    const filtered = filterWorkbookPreviewByScope(preview, {
      category: "Dry Foods",
      itemIds: ["ITM-001"],
    });

    expect(filtered.itemProfileRows).toHaveLength(1);
    expect(filtered.itemProfileRows[0].itemId).toBe("ITM-001");
    expect(filtered.movementRows).toHaveLength(1);
    expect(filtered.reconciliationRows).toHaveLength(1);
    expect(filtered.unmatchedRows).toEqual([]);
    expect(filtered.sheetSummaries[0]).toMatchObject({
      matchedCount: 1,
      openingCount: 1,
      movementCount: 1,
      reconciliationCount: 1,
      unmatchedCount: 0,
    });
  });

  it("builds report readiness insight and import plans for reporting", () => {
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [
          "Item Name",
          "Uom",
          "OPENING STOCK",
          "RECIEVED STOCK",
          "Total Stock",
          "Issued Stock",
          "Clossing Stock",
          "Unit",
          "Stock Value",
          "Maxmum",
          "Mini mum stock level",
          "Required stock",
        ],
        ["SUGAR", "kgs", 10, 5, 15, 3, 12, 3500, 42000, 50, 10, 38],
      ]),
      "1.3.2026"
    );

    const items = [{ id: "ITM-001", code: "ITM-001", name: "SUGAR", uom: "kgs" }];
    const parsed = parseDailyStoresWorkbook(workbook, items, { xlsx: XLSX });
    const financePlan = parsed.reportInsight.reportPlans.find((plan) => plan.id === "finance");
    const movementPlan = parsed.reportInsight.reportPlans.find((plan) => plan.id === "movement");
    const stockPlan = parsed.reportInsight.reportPlans.find((plan) => plan.id === "stock");

    expect(parsed.reportInsight).toMatchObject({
      openingDateSuggestion: "2026-03-01",
      itemProfileCount: 1,
      openingRowCount: 1,
      movementLineCount: 2,
      itemCostCoveragePercent: 100,
      receiptCostCoveragePercent: 100,
      levelCoveragePercent: 100,
      readyReportCount: 5,
    });
    expect(parsed.reportInsight.supportedReports).toEqual(
      expect.arrayContaining(["Stock Position", "By Category", "Received", "Issued", "Item Movement"])
    );
    expect(financePlan).toMatchObject({
      tone: "success",
      recommendedChoices: {
        includeWorkbookItems: true,
        includeWorkbookOpenings: true,
        includeWorkbookMovements: true,
      },
      recommendedOpeningDate: "2026-03-01",
    });
    expect(movementPlan).toMatchObject({
      tone: "success",
      recommendedChoices: {
        includeWorkbookItems: true,
        includeWorkbookOpenings: false,
        includeWorkbookMovements: true,
      },
    });
    expect(stockPlan).toMatchObject({
      tone: "success",
      recommendedChoices: {
        includeWorkbookItems: true,
        includeWorkbookOpenings: true,
        includeWorkbookMovements: true,
      },
    });
  });
});
