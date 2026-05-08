function normalizeOverride(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function resolveForwardedProto(request) {
  const forwardedProto = String(request?.headers?.["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (forwardedProto) {
    return forwardedProto;
  }

  const forwardedHeader = String(request?.headers?.forwarded ?? "").trim();
  if (!forwardedHeader) {
    return "";
  }

  const protoMatch = forwardedHeader.match(/proto=([^;,\s]+)/i);
  return protoMatch ? String(protoMatch[1]).trim().toLowerCase() : "";
}

export function shouldUseSecureCookies(
  request,
  {
    isDevMode = false,
    isDesktopApp = false,
    override = "",
  } = {}
) {
  const normalizedOverride = normalizeOverride(override);

  if (["1", "true", "yes", "always"].includes(normalizedOverride)) {
    return true;
  }

  if (["0", "false", "no", "never"].includes(normalizedOverride)) {
    return false;
  }

  if (isDevMode || isDesktopApp) {
    return false;
  }

  if (request?.socket?.encrypted) {
    return true;
  }

  return resolveForwardedProto(request) === "https";
}
