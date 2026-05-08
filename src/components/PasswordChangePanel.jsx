import React from "react";
import { getPasswordPolicyHint } from "../utils/passwordPolicy.js";

export default function PasswordChangePanel({
  currentUser,
  form,
  errors,
  feedback,
  isBusy = false,
  isRequired = false,
  onFieldChange,
  onSubmit,
  onClose,
}) {
  const passwordHint = getPasswordPolicyHint();

  return (
    <section className="card">
      <div className="card-header card-header-spread">
        <div>
          <div className="section-kicker">Account Security</div>
          <h2>{isRequired ? "Change your temporary password" : "Change password"}</h2>
          <p>
            {isRequired
              ? "Your account was created or reset with a temporary password. Change it before continuing."
              : `Signed in as ${currentUser?.name || currentUser?.email || "current user"}.`}
          </p>
        </div>
        {!isRequired && onClose ? (
          <button className="button button-secondary" onClick={onClose} type="button">
            Close
          </button>
        ) : null}
      </div>

      {feedback ? (
        <div className={`alert-banner alert-${feedback.tone}`}>{feedback.message}</div>
      ) : null}

      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit?.();
        }}
      >
        <label className="field">
          <span>Current Password</span>
          <input
            className="input"
            type="password"
            value={form.currentPassword}
            onChange={(event) => onFieldChange?.("currentPassword", event.target.value)}
          />
          {errors.currentPassword ? <small>{errors.currentPassword}</small> : null}
        </label>

        <label className="field">
          <span>New Password</span>
          <input
            className="input"
            type="password"
            value={form.newPassword}
            onChange={(event) => onFieldChange?.("newPassword", event.target.value)}
          />
          {errors.newPassword ? <small>{errors.newPassword}</small> : <small>{passwordHint}</small>}
        </label>

        <label className="field">
          <span>Confirm New Password</span>
          <input
            className="input"
            type="password"
            value={form.confirmPassword}
            onChange={(event) => onFieldChange?.("confirmPassword", event.target.value)}
          />
          {errors.confirmPassword ? <small>{errors.confirmPassword}</small> : null}
        </label>

        <div className="button-row">
          <button className="button" type="submit" disabled={isBusy}>
            {isBusy ? "Updating..." : "Update Password"}
          </button>
        </div>
      </form>
    </section>
  );
}
