export const DEFAULT_PRODUCT_NAME = "Kingsoft Stock Flow";
export const DEFAULT_COMPANY_NAME = "Your Company";
export const DEFAULT_BRAND_LOGO_URL = "";
export const DEFAULT_BRAND_ACCENT_COLOR = "#c3922e";
export const DEFAULT_BRAND_SIDEBAR_COLOR = "#102235";

function normalizeHexDigitPair(value) {
  return value.length === 1 ? `${value}${value}` : value;
}

export function normalizeHexColor(value, fallback = DEFAULT_BRAND_ACCENT_COLOR) {
  const rawValue = String(value ?? "").trim();
  const normalizedValue = rawValue.startsWith("#") ? rawValue.slice(1) : rawValue;

  if (!/^[\da-fA-F]{3}([\da-fA-F]{3})?$/.test(normalizedValue)) {
    return fallback;
  }

  if (normalizedValue.length === 3) {
    return `#${normalizedValue
      .split("")
      .map((digit) => normalizeHexDigitPair(digit))
      .join("")
      .toLowerCase()}`;
  }

  return `#${normalizedValue.toLowerCase()}`;
}

export function getColorRgbTuple(hexColor) {
  const normalizedHex = normalizeHexColor(hexColor).slice(1);
  const red = Number.parseInt(normalizedHex.slice(0, 2), 16);
  const green = Number.parseInt(normalizedHex.slice(2, 4), 16);
  const blue = Number.parseInt(normalizedHex.slice(4, 6), 16);

  return `${red}, ${green}, ${blue}`;
}

export function buildBrandStyles({ accentColor, sidebarColor } = {}) {
  const normalizedAccent = normalizeHexColor(accentColor, DEFAULT_BRAND_ACCENT_COLOR);
  const normalizedSidebar = normalizeHexColor(sidebarColor, DEFAULT_BRAND_SIDEBAR_COLOR);

  return {
    "--accent": normalizedAccent,
    "--accent-rgb": getColorRgbTuple(normalizedAccent),
    "--bg-dark": normalizedSidebar,
    "--bg-dark-rgb": getColorRgbTuple(normalizedSidebar),
  };
}

export function getBrandInitials(name) {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "SF";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}
