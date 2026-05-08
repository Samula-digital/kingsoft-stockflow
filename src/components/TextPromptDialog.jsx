import React, { useEffect, useRef } from "react";

export default function TextPromptDialog({
  isOpen = false,
  title = "",
  description = "",
  label = "",
  value = "",
  error = "",
  helperText = "",
  placeholder = "",
  submitLabel = "Save",
  cancelLabel = "Cancel",
  inputType = "text",
  multiline = false,
  isBusy = false,
  onChange,
  onClose,
  onSubmit,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    inputRef.current?.select?.();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="dialog-overlay"
      onClick={() => {
        if (isBusy) return;
        onClose?.();
      }}
      role="presentation"
    >
      <section
        className="card dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="card-header">
          <div>
            <div className="section-kicker">Confirm Action</div>
            <h2 id="dialog-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
        </div>

        <form
          className="view-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit?.();
          }}
        >
          <label className={`field ${error ? "is-invalid" : ""}`}>
            <span>{label}</span>
            {multiline ? (
              <textarea
                ref={inputRef}
                className={`input textarea ${error ? "is-invalid" : ""}`}
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange?.(event.target.value)}
              />
            ) : (
              <input
                ref={inputRef}
                className={`input ${error ? "is-invalid" : ""}`}
                type={inputType}
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange?.(event.target.value)}
              />
            )}
            {error ? <small>{error}</small> : helperText ? <small>{helperText}</small> : null}
          </label>

          <div className="dialog-actions">
            <button
              className="button button-secondary"
              onClick={() => onClose?.()}
              type="button"
              disabled={isBusy}
            >
              {cancelLabel}
            </button>
            <button className="button" type="submit" disabled={isBusy}>
              {isBusy ? "Saving..." : submitLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
