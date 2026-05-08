import { describe, expect, it } from "vitest";
import { buildDailySupportPlan, buildOperationalInsights } from "./operationalInsights";

describe("operational insights", () => {
  it("flags negative stock and missing finance setup", () => {
    const insights = buildOperationalInsights({
      items: [{ id: "ITM-001", openingBalance: 0, minStock: null, maxStock: null }],
      stockRows: [
        {
          id: "ITM-001",
          stockOnHand: -2,
          lastMovementDate: "2026-03-24",
          belowMinStock: false,
          aboveMaxStock: false,
        },
      ],
      movements: [{ id: "MOV-001", type: "OUT" }],
      financeEmail: "",
    });

    expect(insights.some((insight) => insight.title.includes("below zero"))).toBe(true);
    expect(insights.some((insight) => insight.title.includes("Finance email"))).toBe(true);
  });

  it("prompts setup when there is no movement history", () => {
    const insights = buildOperationalInsights({
      items: [{ id: "ITM-001", openingBalance: 0, minStock: null, maxStock: null }],
      stockRows: [
        {
          id: "ITM-001",
          stockOnHand: 0,
          lastMovementDate: "",
          belowMinStock: false,
          aboveMaxStock: false,
        },
      ],
      movements: [],
      financeEmail: "finance@example.com",
    });

    expect(
      insights.some((insight) => insight.title === "Build the movement history first")
    ).toBe(true);
  });

  it("flags items below minimum stock", () => {
    const insights = buildOperationalInsights({
      items: [{ id: "ITM-001", openingBalance: 4, minStock: 5, maxStock: 12 }],
      stockRows: [
        {
          id: "ITM-001",
          stockOnHand: 3,
          lastMovementDate: "2026-03-24",
          belowMinStock: true,
          aboveMaxStock: false,
        },
      ],
      movements: [{ id: "MOV-001", type: "OUT" }],
      financeEmail: "finance@example.com",
    });

    expect(insights.some((insight) => insight.title.includes("below minimum stock"))).toBe(true);
  });

  it("flags active items without cost and ignores inactive legacy rows", () => {
    const insights = buildOperationalInsights({
      items: [
        {
          id: "ITM-001",
          openingBalance: 8,
          minStock: 2,
          maxStock: 20,
          unitCost: null,
          isActive: true,
        },
        {
          id: "ITM-002",
          openingBalance: 0,
          minStock: null,
          maxStock: null,
          unitCost: null,
          isActive: false,
        },
      ],
      stockRows: [
        {
          id: "ITM-001",
          stockOnHand: 8,
          openingBalance: 8,
          inQty: 0,
          outQty: 0,
          adjQty: 0,
          lineCount: 0,
          lastMovementDate: "2026-03-24",
          belowMinStock: false,
          aboveMaxStock: false,
          isActive: true,
        },
        {
          id: "ITM-002",
          stockOnHand: 0,
          openingBalance: 0,
          inQty: 0,
          outQty: 0,
          adjQty: 0,
          lineCount: 0,
          lastMovementDate: "",
          belowMinStock: false,
          aboveMaxStock: false,
          isActive: false,
        },
      ],
      movements: [{ id: "MOV-001", type: "OUT" }],
      financeEmail: "finance@example.com",
    });

    expect(
      insights.some((insight) => insight.title === "1 active item(s) have no unit cost")
    ).toBe(true);
  });

  it("builds a supportive daily plan from current operational pressure", () => {
    const plan = buildDailySupportPlan({
      metrics: {
        todayLines: 8,
        belowMinItems: 1,
        aboveMaxItems: 0,
        negativeItems: 1,
        todayAdjLines: 0,
        departmentsWithIssuesToday: 2,
      },
      stockRows: [
        {
          id: "ITM-001",
          isActive: true,
          stockOnHand: -1,
          belowMinStock: true,
          aboveMaxStock: false,
          unitCost: 1200,
        },
        {
          id: "ITM-002",
          isActive: true,
          stockOnHand: 0,
          belowMinStock: false,
          aboveMaxStock: false,
          unitCost: null,
        },
      ],
      financeEmail: "",
      role: "admin",
    });

    expect(plan.headline).toContain("stock corrections");
    expect(plan.summary).toContain("below zero");
    expect(plan.steps[0]).toContain("negative stock");
    expect(plan.shortcuts[0].moduleId).toBe("stock");
  });

  it("adapts the daily plan for finance users", () => {
    const plan = buildDailySupportPlan({
      metrics: {
        todayLines: 8,
        belowMinItems: 0,
        aboveMaxItems: 0,
        negativeItems: 0,
        todayAdjLines: 3,
        departmentsWithIssuesToday: 2,
      },
      stockRows: [
        {
          id: "ITM-001",
          isActive: true,
          stockOnHand: 5,
          belowMinStock: false,
          aboveMaxStock: false,
          unitCost: null,
        },
      ],
      financeEmail: "finance@example.com",
      role: "finance",
    });

    expect(plan.roleLabel).toBe("Finance briefing");
    expect(plan.headline).toContain("Finance");
    expect(plan.shortcuts[0].moduleId).toBe("finance");
  });

  it("adapts the daily plan for store users", () => {
    const plan = buildDailySupportPlan({
      metrics: {
        todayLines: 4,
        belowMinItems: 1,
        aboveMaxItems: 0,
        negativeItems: 0,
        todayAdjLines: 0,
        departmentsWithIssuesToday: 1,
      },
      stockRows: [
        {
          id: "ITM-001",
          isActive: true,
          stockOnHand: 0,
          belowMinStock: false,
          aboveMaxStock: false,
          unitCost: 1200,
        },
      ],
      financeEmail: "finance@example.com",
      role: "store",
    });

    expect(plan.roleLabel).toBe("Storekeeper briefing");
    expect(plan.headline.toLowerCase()).toContain("store");
    expect(plan.shortcuts[0].moduleId).toBe("entry");
  });
});
