import React, { useEffect, useState } from "react";
import BrandMark from "./BrandMark";
import { buildBrandStyles } from "../utils/branding";
import { formatDateTime } from "../utils/formatters";

const roleLabels = {
  admin: "Administrator",
  finance: "Finance",
  store: "Storekeeper",
};

export default function AppShell({
  tabs,
  activeTab,
  onTabChange,
  lastSavedAt,
  saveError,
  currentUser,
  onSignOut,
  onOpenPasswordChange,
  onInstallApp,
  canInstallApp = false,
  isInstalledApp = false,
  passwordChangeRequired = false,
  hotelName,
  productName,
  brandLogoUrl,
  brandAccentColor,
  brandSidebarColor,
  children,
}) {
  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0] ?? null;
  const currentTabHint = currentTab?.hint || "Work in the selected area.";
  const workspaceLabel = currentTab?.label ?? productName;
  const operatorLabel = currentUser?.name || currentUser?.email || "Guest";
  const roleLabel = currentUser ? roleLabels[currentUser.role] || currentUser.role : "No user";
  const saveDetail = lastSavedAt ? formatDateTime(lastSavedAt) : "";
  const saveLabel = lastSavedAt ? "Saved" : "Unsaved";
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(
    () => (typeof navigator === "undefined" ? true : navigator.onLine)
  );
  const brandStyles = buildBrandStyles({
    accentColor: brandAccentColor,
    sidebarColor: brandSidebarColor,
  });

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const syncOnlineState = () => {
      setIsOnline(window.navigator.onLine);
    };

    syncOnlineState();

    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);

    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

  return (
    <div className="app-shell" style={brandStyles}>
      <div className="page-backdrop" />

      <aside
        className={`system-sidebar ${isMobileMenuOpen ? "is-mobile-open" : ""}`}
        aria-label="Primary navigation"
        >
        <div className="sidebar-brand-block">
          <div className="sidebar-brand-top">
            <BrandMark
              title={hotelName}
              subtitle={productName}
              logoSrc={brandLogoUrl}
            />
            <button
              className="sidebar-menu-toggle"
              onClick={() => setIsMobileMenuOpen((currentValue) => !currentValue)}
              type="button"
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-main-menu"
            >
              {isMobileMenuOpen ? "Close" : "Workstations"}
            </button>
          </div>
        </div>

        <div className="sidebar-mobile-panel" id="mobile-main-menu">
          <div className="sidebar-section">
            <div className="section-kicker sidebar-section-kicker">Workstations</div>
            <div className="menu-list">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`menu-button ${activeTab === tab.id ? "is-active" : ""}`}
                  onClick={() => onTabChange(tab.id)}
                  type="button"
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  aria-label={`${tab.label}: ${tab.hint}`}
                >
                  <strong>{tab.label}</strong>
                  {activeTab === tab.id ? <span>{tab.hint}</span> : null}
                </button>
              ))}
            </div>
          </div>

          {currentUser ? (
            <div className="sidebar-user-card">
              <span>Operator</span>
              <strong>{operatorLabel}</strong>
              <small title={currentUser.email}>{roleLabel}</small>
              <button
                className="button button-secondary button-small"
                onClick={() => onOpenPasswordChange?.()}
                type="button"
              >
                Security
              </button>
              <button
                className="sidebar-logout-button"
                onClick={() => void onSignOut?.()}
                type="button"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-copy">
            <div className="topbar-overline">Control Center</div>
            <div className="topbar-title-row">
              <h1>{workspaceLabel}</h1>
              {currentUser ? (
                <span className="topbar-badge topbar-badge-user">{roleLabel}</span>
              ) : null}
              {passwordChangeRequired ? (
                <span className="topbar-badge topbar-badge-offline">Password change required</span>
              ) : null}
            </div>
            <div className="topbar-subtitle">{currentTabHint}</div>
          </div>

          <div className="topbar-status-strip" aria-label="System status">
            <span className={`topbar-badge ${isOnline ? "topbar-badge-online" : "topbar-badge-offline"}`}>
              {isOnline ? "Online" : "Offline"}
            </span>
            {isInstalledApp ? <span className="topbar-badge">Desktop</span> : null}
            {!isInstalledApp && canInstallApp ? (
              <button className="topbar-action-button" onClick={() => void onInstallApp?.()} type="button">
                Install
              </button>
            ) : null}
            {currentUser ? (
              <button
                className="topbar-action-button"
                onClick={() => onOpenPasswordChange?.()}
                type="button"
              >
                Security
              </button>
            ) : null}
            <span className="topbar-badge" title={saveDetail}>{saveLabel}</span>
          </div>
        </header>

        <main className="view-stack">
          {saveError ? <div className="alert-banner alert-danger">{saveError}</div> : null}
          {children}
        </main>

        <footer className="app-footer">
          <a
            className="app-footer-link"
            href="https://www.kingsoftonlinesolutions.com"
            rel="noreferrer"
            target="_blank"
          >
            Kingsoft Online Solutions
          </a>
        </footer>
      </div>
    </div>
  );
}
