import { describe, expect, it } from "vitest";
import {
  buildBrandStyles,
  getBrandInitials,
  normalizeHexColor,
} from "./branding";

describe("branding helpers", () => {
  it("normalizes short and invalid hex colors safely", () => {
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
    expect(normalizeHexColor("bad-value", "#112233")).toBe("#112233");
  });

  it("builds css variables for accent and sidebar colors", () => {
    expect(
      buildBrandStyles({
        accentColor: "#123456",
        sidebarColor: "#654321",
      })
    ).toEqual({
      "--accent": "#123456",
      "--accent-rgb": "18, 52, 86",
      "--bg-dark": "#654321",
      "--bg-dark-rgb": "101, 67, 33",
    });
  });

  it("builds fallback initials from the company or hotel name", () => {
    expect(getBrandInitials("Client Company")).toBe("CC");
    expect(getBrandInitials("Warehouse")).toBe("WA");
  });
});
