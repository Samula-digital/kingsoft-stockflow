export function createPublicBootstrapState(state) {
  return {
    version: Number(state?.version) || 0,
    productName: String(state?.productName ?? "").trim() || "Stock Flow",
    hotelName: String(state?.hotelName ?? "").trim() || "Stock Flow",
    brandLogoUrl: String(state?.brandLogoUrl ?? "").trim(),
    brandAccentColor: String(state?.brandAccentColor ?? "").trim(),
    brandSidebarColor: String(state?.brandSidebarColor ?? "").trim(),
    financeEmail: "",
    asOfDate: String(state?.asOfDate ?? "").trim(),
    nextRequisitionNumber: 1,
    items: [],
    departments: [],
    movements: [],
  };
}
