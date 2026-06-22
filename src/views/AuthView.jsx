import React, { useState } from "react";
import BrandMark from "../components/BrandMark";
import { buildBrandStyles } from "../utils/branding";
import { getPasswordPolicyHint, validatePasswordStrength } from "../utils/passwordPolicy.js";
import { validateEmailAddress } from "../utils/validation";

function getDeploymentDiagnostic({ serverError, deploymentStatus, requiresBootstrap }) {
  const issue = deploymentStatus?.database?.issue ?? "";

  if (issue === "missing_database_url") {
    return {
      tone: "danger",
      title: "DATABASE_URL is missing",
      message:
        "The shared server is running, but this production deployment has no PostgreSQL connection string. Add DATABASE_URL in the host environment and redeploy.",
      detail:
        "On Render, set DATABASE_URL to the Supabase PostgreSQL connection string. Keep DATABASE_SSL=require for Supabase.",
      blocksAuth: true,
    };
  }

  if (issue === "postgres_ssl_error") {
    return {
      tone: "danger",
      title: "PostgreSQL SSL problem",
      message:
        "The shared server reached PostgreSQL, but the SSL/TLS settings were rejected.",
      detail:
        "For Supabase, use the pooler/session connection string and set DATABASE_SSL=require. If this is a local database, set DATABASE_SSL=disable.",
      blocksAuth: true,
    };
  }

  if (issue === "postgres_connection_error") {
    return {
      tone: "danger",
      title: "PostgreSQL connection failed",
      message:
        "The shared server is running, but it cannot connect to PostgreSQL.",
      detail:
        deploymentStatus?.database?.message ||
        "Check the DATABASE_URL username, password, host, port, database name, and provider network access.",
      blocksAuth: true,
    };
  }

  if (serverError) {
    return {
      tone: "danger",
      title: "Shared server not found",
      message: serverError,
      detail:
        "Use npm run dev for local work or npm run start after build. Opening the raw HTML file or hosting only the frontend will break login.",
      blocksAuth: true,
    };
  }

  if (requiresBootstrap) {
    return {
      tone: "info",
      title: "First admin needed",
      message: "The shared server and database are ready. Create the first admin account to finish setup.",
      detail: "",
      blocksAuth: false,
    };
  }

  return null;
}

export default function AuthView({
  onSignIn,
  onRequestAccess,
  onBootstrapAdmin,
  onInstallApp,
  canInstallApp = false,
  isInstalledApp = false,
  requiresBootstrap = false,
  hotelName,
  productName,
  brandLogoUrl,
  brandAccentColor,
  brandSidebarColor,
  serverError,
  deploymentStatus,
}) {
  const [mode, setMode] = useState("signin");
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [signInForm, setSignInForm] = useState({
    email: "",
    password: "",
  });
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [bootstrapForm, setBootstrapForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [registerForm, setRegisterForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "store",
  });
  const brandStyles = buildBrandStyles({
    accentColor: brandAccentColor,
    sidebarColor: brandSidebarColor,
  });
  const passwordHint = getPasswordPolicyHint();
  const deploymentDiagnostic = getDeploymentDiagnostic({
    serverError,
    deploymentStatus,
    requiresBootstrap,
  });
  const authBlocked = Boolean(deploymentDiagnostic?.blocksAuth);

  async function handleSignIn() {
    const emailValidation = validateEmailAddress(signInForm.email, { allowBlank: false });
    if (!emailValidation.isValid || !signInForm.password.trim()) {
      setFeedback({
        tone: "danger",
        message: "Enter a valid email and password to sign in.",
      });
      return;
    }

    setIsBusy(true);
    const result = await onSignIn(signInForm);
    setIsBusy(false);
    if (!result.ok) {
      setFeedback({
        tone: "danger",
        message: result.error,
      });
      return;
    }

    setFeedback(null);
  }

  async function handleBootstrap() {
    const emailValidation = validateEmailAddress(bootstrapForm.email, { allowBlank: false });
    const passwordCheck = validatePasswordStrength(bootstrapForm.password);
    if (
      !bootstrapForm.name.trim() ||
      !emailValidation.isValid ||
      !passwordCheck.isValid
    ) {
      setFeedback({
        tone: "danger",
        message: !bootstrapForm.name.trim()
          ? "Enter the admin name to continue."
          : emailValidation.error || passwordCheck.error,
      });
      return;
    }

    setIsBusy(true);
    const result = await onBootstrapAdmin({
      name: bootstrapForm.name,
      email: emailValidation.email,
      password: bootstrapForm.password,
    });
    setIsBusy(false);

    if (!result.ok) {
      setFeedback({
        tone: "danger",
        message: result.error,
      });
      return;
    }

    setFeedback(null);
  }

  async function handleRegister() {
    const emailValidation = validateEmailAddress(registerForm.email, { allowBlank: false });
    const passwordCheck = validatePasswordStrength(registerForm.password);
    if (
      !registerForm.name.trim() ||
      !emailValidation.isValid ||
      !passwordCheck.isValid
    ) {
      setFeedback({
        tone: "danger",
        message: !registerForm.name.trim()
          ? "Enter the full name to continue."
          : emailValidation.error || passwordCheck.error,
      });
      return;
    }

    setIsBusy(true);
    const result = await onRequestAccess(registerForm);
    setIsBusy(false);
    if (!result.ok) {
      setFeedback({
        tone: "danger",
        message: result.error,
      });
      return;
    }

    setFeedback({
      tone: "success",
      message: "Account request created. It now needs admin approval before sign-in.",
    });
    setMode("signin");
    setRegisterForm({
      name: "",
      email: "",
      password: "",
      role: "store",
    });
  }

  async function handleForgotPassword() {
    const emailValidation = validateEmailAddress(forgotPasswordEmail, { allowBlank: false });
    if (!emailValidation.isValid) {
      setFeedback({
        tone: "danger",
        message: emailValidation.error,
      });
      return;
    }

    setFeedback({
      tone: "success",
      message:
        "Password resets are handled by an admin. Ask them to reset your password using the user management panel.",
    });
  }

  return (
    <div className="auth-shell" style={brandStyles}>
      <div className="page-backdrop" />
      <section className="auth-panel">
        <div className="auth-hero">
          <BrandMark title={hotelName} subtitle={productName} logoSrc={brandLogoUrl} />
          <div className="eyebrow">{hotelName} • Stores and Finance</div>
          <h1>
            {requiresBootstrap
              ? `Set up ${productName}`
              : "Open the Store Control Center"}
          </h1>
          <p>
            {requiresBootstrap
              ? "Create the first admin account."
              : "Sign in to issue, receive, review stock, and prepare finance reports."}
          </p>
          <div className="auth-install-row">
            {isInstalledApp ? (
              <span className="topbar-badge">Installed</span>
            ) : canInstallApp ? (
              <button className="topbar-action-button" onClick={() => void onInstallApp?.()} type="button">
                Install
              </button>
            ) : (
              <span className="topbar-badge">Browser mode</span>
            )}
          </div>
        </div>

        <div className="card auth-card">
          {!requiresBootstrap ? (
            <div className="segmented-control">
              <button
                className={mode === "signin" ? "is-active" : ""}
                onClick={() => setMode("signin")}
                type="button"
              >
                Sign In
              </button>
              <button
                className={mode === "register" ? "is-active" : ""}
                onClick={() => setMode("register")}
                type="button"
              >
                Request Account
              </button>
            </div>
          ) : null}

          {feedback ? (
            <div className={`alert-banner alert-${feedback.tone}`}>{feedback.message}</div>
          ) : null}

          {deploymentDiagnostic ? (
            <div className={`detail-block detail-block-compact deployment-diagnostic deployment-diagnostic-${deploymentDiagnostic.tone}`}>
              <strong>{deploymentDiagnostic.title}</strong>
              <p>{deploymentDiagnostic.message}</p>
              {deploymentDiagnostic.detail ? <small>{deploymentDiagnostic.detail}</small> : null}
            </div>
          ) : null}

          {requiresBootstrap ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleBootstrap();
              }}
            >
              <label className="field">
                <span>Admin Name</span>
                <input
                  className="input"
                  value={bootstrapForm.name}
                  onChange={(event) =>
                    setBootstrapForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Admin Email</span>
                <input
                  className="input"
                  type="email"
                  value={bootstrapForm.email}
                  onChange={(event) =>
                    setBootstrapForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Password</span>
                <input
                  className="input"
                  type="password"
                  value={bootstrapForm.password}
                  onChange={(event) =>
                    setBootstrapForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
                <small>{passwordHint}</small>
              </label>

              <div className="button-row">
                <button className="button" type="submit" disabled={isBusy || authBlocked}>
                  {isBusy ? "Setting Up..." : "Create First Admin"}
                </button>
              </div>
            </form>
          ) : mode === "signin" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleSignIn();
              }}
            >
              <label className="field">
                <span>Email</span>
                <input
                  className="input"
                  type="email"
                  value={signInForm.email}
                  onChange={(event) =>
                    setSignInForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Password</span>
                <input
                  className="input"
                  type="password"
                  value={signInForm.password}
                  onChange={(event) =>
                    setSignInForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </label>

              <div className="button-row">
                <button className="button" type="submit" disabled={isBusy || authBlocked}>
                  {isBusy ? "Signing In..." : "Sign In"}
                </button>
              </div>
              <div className="field-note">
                No account? Request one. Forgot password? Ask admin.
              </div>
              <button
                className="button button-secondary button-small"
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setFeedback(null);
                }}
              >
                Forgot Password?
              </button>
            </form>
          ) : mode === "forgot" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleForgotPassword();
              }}
            >
              <div className="detail-block detail-block-compact">
                <strong>Forgot Password</strong>
                <p>
                  Password resets are managed by the system administrator. Enter your email and then contact an admin to complete the reset.
                </p>
              </div>

              <label className="field">
                <span>Email</span>
                <input
                  className="input"
                  type="email"
                  value={forgotPasswordEmail}
                  onChange={(event) => setForgotPasswordEmail(event.target.value)}
                />
              </label>

              <div className="button-row">
                <button className="button" type="submit" disabled={isBusy || authBlocked}>
                  {isBusy ? "Processing..." : "Request Reset"}
                </button>
              </div>
              <div className="field-note">
                If you do not know your admin, ask your store manager to help you get signed in.
              </div>
              <button
                className="button button-secondary button-small"
                type="button"
                onClick={() => {
                  setMode("signin");
                  setFeedback(null);
                }}
              >
                Back to Sign In
              </button>
            </form>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleRegister();
              }}
            >
              <label className="field">
                <span>Full Name</span>
                <input
                  className="input"
                  value={registerForm.name}
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Email</span>
                <input
                  className="input"
                  type="email"
                  value={registerForm.email}
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Password</span>
                <input
                  className="input"
                  type="password"
                  value={registerForm.password}
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
                <small>{passwordHint}</small>
              </label>

              <label className="field">
                <span>Requested Role</span>
                <select
                  className="input"
                  value={registerForm.role}
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, role: event.target.value }))
                  }
                >
                  <option value="store">Stores</option>
                  <option value="finance">Finance</option>
                </select>
              </label>

              <div className="button-row">
                <button className="button" type="submit" disabled={isBusy || authBlocked}>
                  {isBusy ? "Sending..." : "Request Account"}
                </button>
              </div>
              <div className="field-note">
                Storekeepers should request the "Stores" role. Your account must be approved by an admin before sign-in.
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
