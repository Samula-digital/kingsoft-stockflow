import { describe, expect, it } from "vitest";
import {
  createItemCode,
  formatRequisitionNumber,
  getSuggestedNextRequisitionNumber,
  normalizeRequisitionNumber,
  parseRequisitionNumber,
  searchItemRecords,
} from "./formatters";

describe("requisition formatting", () => {
  it("keeps suggested requisition pages in the same plain-number style as the books", () => {
    expect(formatRequisitionNumber(7)).toBe("7");
    expect(formatRequisitionNumber(42)).toBe("42");
  });

  it("parses supported requisition formats", () => {
    expect(parseRequisitionNumber("REQ-0007")).toBe(7);
    expect(parseRequisitionNumber("req 18")).toBe(18);
    expect(parseRequisitionNumber("42")).toBe(42);
    expect(parseRequisitionNumber("IMP-OUT-2026")).toBeNull();
  });

  it("suggests the next requisition from recorded OUT documents only", () => {
    expect(
      getSuggestedNextRequisitionNumber(
        [
          { type: "OUT", requisitionNumber: "REQ-0011" },
          { type: "OUT", requisitionNumber: "REQ-0011" },
          { type: "IN", requisitionNumber: "" },
          { type: "OUT", requisitionNumber: "REQ-0014" },
        ],
        4
      )
    ).toBe(15);
  });

  it("can suggest the next requisition by department book", () => {
    expect(
      getSuggestedNextRequisitionNumber(
        [
          { type: "OUT", departmentId: "kitchen", requisitionNumber: "REQ-0009" },
          { type: "OUT", departmentId: "housekeeping", requisitionNumber: "REQ-0016" },
          { type: "OUT", departmentId: "kitchen", requisitionNumber: "12" },
        ],
        1,
        { departmentId: "kitchen" }
      )
    ).toBe(13);
  });

  it("normalizes prefixed and plain requisition formats to the same book page", () => {
    expect(normalizeRequisitionNumber("REQ-0008")).toBe("8");
    expect(normalizeRequisitionNumber("8")).toBe("8");
  });
});

describe("item search", () => {
  const items = [
    { id: "1", code: "ITM-001", name: "Bath Soap", uom: "PCS" },
    { id: "2", code: "ITM-002", name: "Liquid Soap", uom: "LTR" },
    { id: "3", code: "HK-100", name: "Bath Towel", uom: "PCS" },
  ];

  it("prefers exact and prefix code matches", () => {
    const results = searchItemRecords(items, "ITM-001");
    expect(results[0].code).toBe("ITM-001");
  });

  it("supports multi-token matching across item fields", () => {
    const results = searchItemRecords(items, "bath pcs");
    expect(results.map((item) => item.name)).toContain("Bath Soap");
    expect(results.map((item) => item.name)).toContain("Bath Towel");
  });

  it("suggests the next highest item code for new items", () => {
    expect(
      createItemCode([
        { code: "ITM-001" },
        { code: "ITM-014" },
        { code: "BAR-001" },
      ])
    ).toBe("ITM-015");
  });
});
