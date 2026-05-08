import { describe, expect, it } from "vitest";
import {
  buildAssistantComposerHint,
  buildAssistantQuickLabel,
  buildAssistantStarterPrompts,
  buildAssistantWelcome,
  getAssistantReply,
} from "./assistant";

function createContext(overrides = {}) {
  return {
    companyName: "Client Company",
    availableModuleIds: ["dashboard", "entry", "stock", "finance", "department", "history", "admin"],
    metrics: {
      todayLines: 6,
      belowMinItems: 2,
      negativeItems: 1,
    },
    stockRows: [
      {
        id: "ITM-001",
        code: "ITM-001",
        name: "Bath Soap",
        uom: "PCS",
        openingBalance: 12,
        minStock: 5,
        maxStock: 20,
        stockOnHand: -2,
        belowMinStock: true,
        aboveMaxStock: false,
      },
      {
        id: "ITM-002",
        code: "ITM-002",
        name: "Tea Bags",
        uom: "BOX",
        openingBalance: 10,
        minStock: 4,
        maxStock: 18,
        stockOnHand: 9,
        belowMinStock: false,
        aboveMaxStock: false,
      },
    ],
    financeRows: [
      {
        opening: 10,
        inQty: 5,
        outQty: 3,
        adjQty: 1,
        closing: 13,
      },
    ],
    financeRange: {
      startDate: "2026-03-01",
      endDate: "2026-03-07",
    },
    departmentRows: [
      { id: "DPT-01", name: "Kitchen", totalQty: 12 },
      { id: "DPT-02", name: "Housekeeping", totalQty: 7 },
    ],
    departments: [
      { id: "DPT-01", code: "KIT", name: "Kitchen" },
      { id: "DPT-02", code: "HK", name: "Housekeeping" },
    ],
    departmentDate: "2026-03-25",
    ...overrides,
  };
}

describe("assistant helpers", () => {
  it("builds a welcome message with the company name", () => {
    expect(buildAssistantWelcome(createContext())).toContain("Client Company");
    expect(buildAssistantWelcome(createContext())).toContain("Talk to me");
    expect(buildAssistantWelcome(createContext({ activeTab: "entry" }))).toContain(
      "You're in Store Desk"
    );
  });

  it("prioritizes negative stock starter prompts when exceptions exist", () => {
    expect(buildAssistantStarterPrompts(createContext())[0]).toBe("Show negative stock items");
  });

  it("returns stock attention guidance for warning questions", () => {
    const reply = getAssistantReply("What needs attention today?", createContext());

    expect(reply.text).toContain("stock picture");
    expect(reply.actions[0].type).toBe("open_stock_view");
  });

  it("returns item-specific guidance when an item is searched", () => {
    const reply = getAssistantReply("Bath Soap", createContext());

    expect(reply.text).toContain("Bath Soap");
    expect(reply.actions.map((action) => action.type)).toContain("start_entry");
  });

  it("prepares an issue action from a natural request", () => {
    const reply = getAssistantReply(
      "Issue 2 Tea Bags to Kitchen req REQ-0012",
      createContext()
    );

    expect(reply.actions[0].type).toBe("start_entry");
    expect(reply.actions[0].entryType).toBe("OUT");
    expect(reply.actions[0].departmentId).toBe("DPT-01");
    expect(reply.actions[0].itemId).toBe("ITM-002");
    expect(reply.actions[0].quantity).toBe("2");
    expect(reply.actions[0].requisitionNumber).toBe("REQ-0012");
  });

  it("opens admin imports from a navigation request", () => {
    const reply = getAssistantReply("Open imports", createContext());

    expect(reply.actions[0].type).toBe("open_admin_section");
    expect(reply.actions[0].sectionId).toBe("imports");
  });

  it("answers help prompts in a more natural way", () => {
    const reply = getAssistantReply("What can you do?", createContext());

    expect(reply.text).toContain("talk to me naturally");
    expect(reply.actions.map((action) => action.type)).toContain("start_entry");
  });

  it("adapts quick prompts and composer hint to the current workspace", () => {
    const financeContext = createContext({ activeTab: "finance" });

    expect(buildAssistantQuickLabel(financeContext)).toBe("Report shortcuts");
    expect(buildAssistantComposerHint(financeContext)).toContain("issued report");
    expect(buildAssistantStarterPrompts(financeContext)).toContain(
      "Open category report for Beverages"
    );
  });

  it("explains operational readiness in a human way", () => {
    const reply = getAssistantReply("Is this system report-ready?", createContext());

    expect(reply.text).toContain("operating point of view");
    expect(reply.text).toContain("missing cost");
    expect(reply.actions.map((action) => action.type)).toContain("open_stock_view");
  });

  it("prioritizes restock guidance from report rows", () => {
    const reply = getAssistantReply("What should I restock first?", createContext({
      financeRows: [
        {
          code: "ITM-001",
          name: "Bath Soap",
          uom: "PCS",
          closing: 0,
          requiredQty: 12,
          belowMinStock: true,
        },
        {
          code: "ITM-002",
          name: "Tea Bags",
          uom: "BOX",
          closing: 2,
          requiredQty: 6,
          belowMinStock: true,
        },
      ],
    }));

    expect(reply.text).toContain("restock priorities");
    expect(reply.text).toContain("Bath Soap");
    expect(reply.actions[0].type).toBe("open_finance_view");
  });

  it("explains weighted average cost handling", () => {
    const reply = getAssistantReply("How do I handle a unit cost change?", createContext());

    expect(reply.text).toContain("weighted average cost");
    expect(reply.actions.map((action) => action.type)).toContain("start_entry");
  });

  it("gives a supportive start-work plan", () => {
    const reply = getAssistantReply("Where do I start today?", createContext());

    expect(reply.text).toContain("order I would use");
    expect(reply.text).toContain("operations first");
    expect(reply.actions.map((action) => action.type)).toContain("open_module");
  });

  it("coaches the user through fixing current issues", () => {
    const reply = getAssistantReply(
      "Help me fix the current stock issues",
      createContext()
    );

    expect(reply.text).toContain("cleanest way");
    expect(reply.text).toContain("negative stock");
    expect(reply.actions.map((action) => action.type)).toContain("open_stock_view");
  });
});
