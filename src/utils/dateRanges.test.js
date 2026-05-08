import { describe, expect, it } from "vitest";
import {
  buildFinancePeriodRange,
  getMonthRange,
  getPreviousFinancePeriodRange,
  getWeekRange,
  shiftFinanceFilters,
} from "./dateRanges";

describe("finance date ranges", () => {
  it("builds a Monday-to-Sunday weekly range from the anchor date", () => {
    expect(getWeekRange("2026-03-18")).toEqual({
      startDate: "2026-03-16",
      endDate: "2026-03-22",
    });
  });

  it("builds a full monthly range from the anchor date", () => {
    expect(getMonthRange("2026-02-10")).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
  });

  it("normalizes custom finance ranges and shifts them by the same span", () => {
    const range = buildFinancePeriodRange({
      period: "custom",
      anchorDate: "2026-03-24",
      fromDate: "2026-03-10",
      toDate: "2026-03-05",
    });

    expect(range).toMatchObject({
      startDate: "2026-03-05",
      endDate: "2026-03-10",
    });

    expect(
      shiftFinanceFilters(
        {
          period: "custom",
          anchorDate: "2026-03-24",
          fromDate: "2026-03-05",
          toDate: "2026-03-10",
        },
        1
      )
    ).toMatchObject({
      fromDate: "2026-03-11",
      toDate: "2026-03-16",
    });
  });

  it("builds the previous calendar month for monthly finance ranges", () => {
    expect(
      getPreviousFinancePeriodRange({
        period: "monthly",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      })
    ).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });
  });

  it("builds the previous comparable custom range by span", () => {
    expect(
      getPreviousFinancePeriodRange({
        period: "custom",
        startDate: "2026-03-05",
        endDate: "2026-03-10",
      })
    ).toEqual({
      startDate: "2026-02-27",
      endDate: "2026-03-04",
    });
  });
});
