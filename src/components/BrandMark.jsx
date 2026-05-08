import React from "react";
import { getBrandInitials } from "../utils/branding";

export default function BrandMark({
  title = "Stock Flow",
  subtitle = "Stock Flow",
  logoSrc = "",
  compact = false,
}) {
  const hotelName = String(title ?? "").trim() || "Stock Flow";
  const appLabel = String(subtitle ?? "").trim();
  const initials = getBrandInitials(hotelName);
  const hasLogo = Boolean(String(logoSrc ?? "").trim());

  return (
    <div className={`brand-mark ${compact ? "brand-mark-compact" : ""}`}>
      <div className="brand-logo-frame">
        {hasLogo ? (
          <img
            className="brand-image"
            src={logoSrc}
            alt={hotelName}
          />
        ) : (
          <div className="brand-logo-placeholder" aria-hidden="true">
            {initials}
          </div>
        )}
      </div>

      <div className="brand-copy">
        <strong>{hotelName}</strong>
        {appLabel ? <div className="brand-app-label">{appLabel}</div> : null}
      </div>
    </div>
  );
}
