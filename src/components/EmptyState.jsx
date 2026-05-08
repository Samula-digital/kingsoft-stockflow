import React from "react";

export default function EmptyState({
  eyebrow = "",
  title,
  message,
  actionLabel = "",
  onAction,
  secondaryActionLabel = "",
  onSecondaryAction,
  align = "center",
}) {
  return (
    <div className={`empty-panel ${align === "left" ? "empty-panel-left" : ""}`.trim()}>
      {eyebrow ? <span className="empty-panel-kicker">{eyebrow}</span> : null}
      <strong>{title}</strong>
      {message ? <p>{message}</p> : null}
      {actionLabel || secondaryActionLabel ? (
        <div className="empty-panel-actions">
          {actionLabel ? (
            <button className="button button-small" onClick={onAction} type="button">
              {actionLabel}
            </button>
          ) : null}
          {secondaryActionLabel ? (
            <button
              className="button button-secondary button-small"
              onClick={onSecondaryAction}
              type="button"
            >
              {secondaryActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
