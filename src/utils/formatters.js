const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("en-UG", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const compactDateFormatter = new Intl.DateTimeFormat("en-UG", {
  day: "2-digit",
  month: "short",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-UG", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function createDepartmentId(name, index = 0) {
  return slugify(name) || `department-${index + 1}`;
}

export function createDepartmentCode(departments) {
  const highestValue = departments.reduce((currentHighest, department) => {
    const match = String(department.code ?? "").match(/(\d+)$/);
    return Math.max(currentHighest, match ? Number(match[1]) : 0);
  }, 0);

  return `DPT-${String(highestValue + 1).padStart(2, "0")}`;
}

export function createEntityId(prefix = "REC") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function createItemCode(items) {
  const highestValue = items.reduce((currentHighest, item) => {
    const match = String(item.code ?? item.id ?? "").match(/(\d+)$/);
    return Math.max(currentHighest, match ? Number(match[1]) : 0);
  }, 0);

  return `ITM-${String(highestValue + 1).padStart(3, "0")}`;
}

export function formatRequisitionNumber(value) {
  const parsedValue = parseRequisitionNumber(value);
  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return String(parsedValue);
  }

  return String(value ?? "").trim();
}

export function parseRequisitionNumber(value) {
  const normalizedValue = String(value ?? "").trim().toUpperCase();

  if (!normalizedValue) return null;

  const prefixedMatch = normalizedValue.match(/^REQ[-/\s]?(\d+)$/);
  if (prefixedMatch) {
    return Number(prefixedMatch[1]);
  }

  if (/^\d+$/.test(normalizedValue)) {
    return Number(normalizedValue);
  }

  return null;
}

export function normalizeRequisitionNumber(value) {
  const parsedValue = parseRequisitionNumber(value);
  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return String(parsedValue);
  }

  return String(value ?? "").trim().toLowerCase();
}

export function getSuggestedNextRequisitionNumber(movements, fallback = 1, options = {}) {
  const normalizedDepartmentId = String(options.departmentId ?? "").trim();
  const highestRecordedValue = movements.reduce((highestValue, movement) => {
    if (movement.type !== "OUT") return highestValue;
    if (normalizedDepartmentId && movement.departmentId !== normalizedDepartmentId) {
      return highestValue;
    }

    const parsedValue = parseRequisitionNumber(movement.requisitionNumber);
    if (!Number.isFinite(parsedValue)) return highestValue;

    return Math.max(highestValue, parsedValue);
  }, 0);

  if (highestRecordedValue > 0) {
    return highestRecordedValue + 1;
  }

  return Math.max(1, Number(fallback) || 1);
}

export function formatMovementType(type) {
  if (type === "IN") return "Receive";
  if (type === "OUT") return "Issue";
  return "Adjustment";
}

export function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

export function formatDate(value) {
  if (!value) return "-";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date);
}

export function formatCompactDate(value) {
  if (!value) return "-";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return compactDateFormatter.format(date);
}

export function formatDateRange(startDate, endDate) {
  if (!startDate && !endDate) return "-";
  if (!startDate || startDate === endDate) return formatDate(startDate || endDate);

  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

export function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateTimeFormatter.format(date);
}

export function getTodayDateValue() {
  const today = new Date();

  return `${today.getFullYear()}-${padDatePart(today.getMonth() + 1)}-${padDatePart(
    today.getDate()
  )}`;
}

export function getMovementReference(movement) {
  if (movement.type === "OUT") {
    return formatRequisitionNumber(movement.requisitionNumber);
  }

  return movement.referenceNumber;
}

export function normalizeSearchValue(value) {
  return String(value ?? "").toLowerCase().trim();
}

export function searchItemRecords(items, query, options = {}) {
  const normalizedQuery = normalizeSearchValue(query);
  const limit = options.limit ?? items.length;

  if (!normalizedQuery) {
    return items.slice(0, limit);
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

  const rankedItems = items
    .map((item) => {
      const code = normalizeSearchValue(item.code);
      const name = normalizeSearchValue(item.name);
      const category = normalizeSearchValue(item.category);
      const uom = normalizeSearchValue(item.uom);
      const label = `${code} ${name} ${category} ${uom}`.trim();
      const nameWords = name.split(/\s+/).filter(Boolean);

      const matchesAllTokens = queryTokens.every((token) =>
        [code, name, category, uom].some((value) => value.includes(token))
      );

      if (!matchesAllTokens) {
        return null;
      }

      let score = 0;

      if (code === normalizedQuery) score += 120;
      if (name === normalizedQuery) score += 115;
      if (label === normalizedQuery) score += 110;
      if (code.startsWith(normalizedQuery)) score += 90;
      if (name.startsWith(normalizedQuery)) score += 85;
      if (nameWords.some((word) => word.startsWith(normalizedQuery))) score += 70;
      if (label.includes(normalizedQuery)) score += 40;

      for (const token of queryTokens) {
        if (code.startsWith(token)) score += 24;
        else if (code.includes(token)) score += 18;

        if (name.startsWith(token)) score += 20;
        else if (nameWords.some((word) => word.startsWith(token))) score += 16;
        else if (name.includes(token)) score += 12;

        if (category.startsWith(token)) score += 10;
        else if (category.includes(token)) score += 8;

        if (uom === token) score += 10;
        else if (uom.startsWith(token)) score += 8;
        else if (uom.includes(token)) score += 6;
      }

      return {
        item,
        score,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return String(left.item.name ?? "").localeCompare(String(right.item.name ?? ""));
    });

  return rankedItems.slice(0, limit).map((entry) => entry.item);
}

export function sortByName(records, key = "name") {
  return [...records].sort((left, right) =>
    String(left?.[key] ?? "").localeCompare(String(right?.[key] ?? ""))
  );
}
