function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function createDateFromValue(value) {
  const [year, month, day] = String(value ?? "")
    .split("-")
    .map((part) => Number(part));

  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

export function toDateValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate()
  )}`;
}

export function shiftDateValue(value, dayOffset) {
  const date = createDateFromValue(value);
  if (!date) return value;

  date.setDate(date.getDate() + dayOffset);
  return toDateValue(date);
}

export function getWeekRange(anchorDateValue) {
  const anchorDate = createDateFromValue(anchorDateValue) ?? new Date();
  const weekDay = (anchorDate.getDay() + 6) % 7;
  const startDate = new Date(anchorDate);
  startDate.setDate(anchorDate.getDate() - weekDay);

  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);

  return {
    startDate: toDateValue(startDate),
    endDate: toDateValue(endDate),
  };
}

export function getMonthRange(anchorDateValue) {
  const anchorDate = createDateFromValue(anchorDateValue) ?? new Date();
  const startDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const endDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);

  return {
    startDate: toDateValue(startDate),
    endDate: toDateValue(endDate),
  };
}

export function buildFinancePeriodRange(filters) {
  const period = filters?.period ?? "daily";
  const anchorDate = filters?.anchorDate || toDateValue(new Date());

  if (period === "weekly") {
    return {
      period,
      anchorDate,
      ...getWeekRange(anchorDate),
    };
  }

  if (period === "monthly") {
    return {
      period,
      anchorDate,
      ...getMonthRange(anchorDate),
    };
  }

  if (period === "custom") {
    const fromDate = filters?.fromDate || anchorDate;
    const toDate = filters?.toDate || fromDate;

    return {
      period,
      anchorDate,
      startDate: fromDate <= toDate ? fromDate : toDate,
      endDate: fromDate <= toDate ? toDate : fromDate,
    };
  }

  return {
    period: "daily",
    anchorDate,
    startDate: anchorDate,
    endDate: anchorDate,
  };
}

export function getPreviousFinancePeriodRange(range) {
  const currentStartDate = range?.startDate ?? "";
  const currentEndDate = range?.endDate ?? currentStartDate;
  const startDate = createDateFromValue(currentStartDate);
  const endDate = createDateFromValue(currentEndDate);
  const period = range?.period ?? "custom";

  if (!startDate || !endDate) {
    return {
      startDate: currentStartDate,
      endDate: currentEndDate,
    };
  }

  if (period === "daily") {
    return {
      startDate: shiftDateValue(currentStartDate, -1),
      endDate: shiftDateValue(currentEndDate, -1),
    };
  }

  if (period === "weekly") {
    return {
      startDate: shiftDateValue(currentStartDate, -7),
      endDate: shiftDateValue(currentEndDate, -7),
    };
  }

  if (period === "monthly") {
    const previousMonthStartDate = new Date(startDate.getFullYear(), startDate.getMonth() - 1, 1);
    const previousMonthEndDate = new Date(startDate.getFullYear(), startDate.getMonth(), 0);

    return {
      startDate: toDateValue(previousMonthStartDate),
      endDate: toDateValue(previousMonthEndDate),
    };
  }

  const spanInDays =
    Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  return {
    startDate: shiftDateValue(currentStartDate, -spanInDays),
    endDate: shiftDateValue(currentStartDate, -1),
  };
}

export function shiftFinanceFilters(currentFilters, direction) {
  const offset = direction >= 0 ? 1 : -1;
  const period = currentFilters?.period ?? "daily";

  if (period === "weekly") {
    return {
      ...currentFilters,
      anchorDate: shiftDateValue(currentFilters.anchorDate, offset * 7),
    };
  }

  if (period === "monthly") {
    const anchorDate = createDateFromValue(currentFilters.anchorDate);
    if (!anchorDate) return currentFilters;

    anchorDate.setMonth(anchorDate.getMonth() + offset);

    return {
      ...currentFilters,
      anchorDate: toDateValue(anchorDate),
    };
  }

  if (period === "custom") {
    const range = buildFinancePeriodRange(currentFilters);
    const startDate = createDateFromValue(range.startDate);
    const endDate = createDateFromValue(range.endDate);
    if (!startDate || !endDate) return currentFilters;

    const spanInDays =
      Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

    return {
      ...currentFilters,
      fromDate: shiftDateValue(range.startDate, offset * spanInDays),
      toDate: shiftDateValue(range.endDate, offset * spanInDays),
    };
  }

  return {
    ...currentFilters,
    anchorDate: shiftDateValue(currentFilters.anchorDate, offset),
  };
}
