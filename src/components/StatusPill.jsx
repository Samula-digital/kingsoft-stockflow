import React from "react";

const toneClassMap = {
  neutral: "pill-neutral",
  info: "pill-info",
  success: "pill-success",
  warning: "pill-warning",
  danger: "pill-danger",
};

export default function StatusPill({ children, tone = "neutral" }) {
  return <span className={`status-pill ${toneClassMap[tone] ?? toneClassMap.neutral}`}>{children}</span>;
}
