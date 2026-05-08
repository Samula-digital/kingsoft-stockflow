import { describe, expect, it } from "vitest";
import {
  getSeedItemCategory,
  isSeedCategoryHeader,
  normalizeItemCategory,
  resolvePreferredItemCategory,
} from "./itemCategories";

describe("item category helpers", () => {
  it("normalizes legacy category labels into the hotel category list", () => {
    expect(normalizeItemCategory("Housekeeping")).toBe("House Hold");
    expect(normalizeItemCategory("Fresh Foods / Produce")).toBe("Fresh Foods and Fruits");
    expect(normalizeItemCategory("Cold Room")).toBe("Cold Room Items");
    expect(normalizeItemCategory("General Items")).toBe("Others");
  });

  it("recognizes workbook section headers instead of treating them as items", () => {
    expect(isSeedCategoryHeader("BEVERAGE")).toBe(true);
    expect(isSeedCategoryHeader("DRY ITEMS/GLOSSARIES")).toBe(true);
    expect(isSeedCategoryHeader("FRESH FOODS,FRUITS AND VEGS")).toBe(true);
    expect(isSeedCategoryHeader("FISH")).toBe(false);
  });

  it("returns seeded categories for known hotel items", () => {
    expect(getSeedItemCategory("FISH")).toBe("Cold Room Items");
    expect(getSeedItemCategory("RED BULL")).toBe("Beverages");
    expect(getSeedItemCategory("A4 ENVELOPES")).toBe("Admin Stationary");
    expect(getSeedItemCategory("LEMONS")).toBe("Fresh Foods and Fruits");
    expect(getSeedItemCategory("MANGOES")).toBe("Fresh Foods and Fruits");
  });

  it("upgrades generic saved categories to the seeded hotel category when possible", () => {
    expect(resolvePreferredItemCategory("FISH", "Others")).toBe("Cold Room Items");
    expect(resolvePreferredItemCategory("RED BULL", "")).toBe("Beverages");
    expect(resolvePreferredItemCategory("Unknown Item", "Others")).toBe("Others");
  });
});
