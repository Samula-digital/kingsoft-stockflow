import { describe, expect, it } from "vitest";
import { createPublicBootstrapState } from "./publicState.js";

describe("createPublicBootstrapState", () => {
  it("keeps branding but strips protected operational data", () => {
    expect(
      createPublicBootstrapState({
        version: 6,
        productName: "Kingsoft Stock Flow",
        hotelName: "Your Company",
        brandLogoUrl: "/logo.png",
        brandAccentColor: "#c3922e",
        brandSidebarColor: "#1a2f4d",
        financeEmail: "finance@example.com",
        asOfDate: "2026-03-01",
        nextRequisitionNumber: 88,
        items: [{ id: "item-1" }],
        departments: [{ id: "department-1" }],
        movements: [{ id: "movement-1" }],
      })
    ).toEqual({
      version: 6,
      productName: "Kingsoft Stock Flow",
      hotelName: "Your Company",
      brandLogoUrl: "/logo.png",
      brandAccentColor: "#c3922e",
      brandSidebarColor: "#1a2f4d",
      financeEmail: "",
      asOfDate: "2026-03-01",
      nextRequisitionNumber: 1,
      items: [],
      departments: [],
      movements: [],
    });
  });
});
