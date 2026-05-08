import React from "react";

export default function DismissibleNotice({
  tone = "warning",
  onClose,
  actions = [],
  children,
}) {
  return (
    <div className={`alert-banner alert-${tone} alert-dismissible`}>
      <div className="alert-copy">
        {children}
        {actions.length ? (
          <div className="alert-actions">
            {actions.map((action) => (
              <button
                key={action.id ?? action.label}
                className={`button button-small ${
                  action.variant === "secondary" ? "button-secondary" : ""
                }`}
                onClick={action.onClick}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {onClose ? (
        <button className="alert-close-button" onClick={onClose} type="button">
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
