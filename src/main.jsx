import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

const rootElement = document.getElementById("root");
const appRoot = rootElement ? ReactDOM.createRoot(rootElement) : null;
const showDeveloperErrorDetails = Boolean(import.meta.env.DEV);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app still works online without the install shell.
    });
  });
}

function FatalScreen({ title, detail }) {
  const visibleDetail = showDeveloperErrorDetails
    ? String(detail ?? "Unknown error")
    : "Refresh the app. If the problem continues, contact support and mention the time of failure.";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#edf0e7",
        color: "#102235",
        fontFamily: "'Avenir Next','Segoe UI',sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 920,
          width: "100%",
          background: "#fffdf7",
          border: "1px solid #d8ddcf",
          borderRadius: 24,
          boxShadow: "0 20px 45px rgba(15,23,42,0.08)",
          padding: 28,
        }}
      >
        <div
          style={{
            fontSize: 12,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            fontWeight: 700,
            color: "#b45309",
          }}
        >
          Store Control Center
        </div>
        <h1 style={{ margin: "12px 0 8px", fontSize: 30, lineHeight: 1.1 }}>{title}</h1>
        <p style={{ margin: "0 0 16px", color: "#475569" }}>
          The app hit a runtime error before it could finish loading.
        </p>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "#0f172a",
            color: "#e2e8f0",
            borderRadius: 16,
            padding: 16,
            overflow: "auto",
          }}
        >
          {visibleDetail}
        </pre>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#edf0e7",
        color: "#10253f",
        fontFamily: "'Avenir Next','Segoe UI',sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 12,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            fontWeight: 700,
            color: "#c28c19",
          }}
        >
          Store Control Center
        </div>
        <div style={{ marginTop: 10, fontSize: 20, fontWeight: 700 }}>
          Opening the store control workspace...
        </div>
      </div>
    </div>
  );
}

function renderFatalError(title, detail) {
  if (!appRoot) return;

  appRoot.render(<FatalScreen title={title} detail={detail} />);
}

window.addEventListener("error", (event) => {
  if (!event.error && !event.message) return;
  console.error("Stock Flow runtime error:", event.error || event.message);
  renderFatalError("Runtime Error", event.error?.stack || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  console.error("Stock Flow unhandled rejection:", reason);
  renderFatalError(
    "Unhandled Promise Rejection",
    reason?.stack || reason?.message || String(reason)
  );
});

async function bootstrap() {
  if (!appRoot) return;

  appRoot.render(<LoadingScreen />);

  try {
    const { default: App } = await import("./App.jsx");
    appRoot.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    renderFatalError("App Failed To Load", error?.stack || error?.message || error);
  }
}

bootstrap();
