import * as XLSX from "../vendor/xlsx.js";
import { normalizeHexColor } from "./branding.js";
import { formatDate, formatNumber, formatRequisitionNumber } from "./formatters.js";

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildQuantityEntries(lines, getUom, getQuantity) {
  const totals = new Map();

  (lines ?? []).forEach((line) => {
    const uom = String(getUom(line) ?? "-").trim() || "-";
    const quantity = Math.abs(Number(getQuantity(line)) || 0);
    if (!quantity) return;
    totals.set(uom, (totals.get(uom) ?? 0) + quantity);
  });

  return Array.from(totals.entries())
    .map(([uom, quantity]) => ({ uom, quantity }))
    .sort((left, right) => right.quantity - left.quantity || left.uom.localeCompare(right.uom));
}

function formatQuantityEntries(entries) {
  if (!entries.length) return "-";
  return entries.map((entry) => `${formatNumber(entry.quantity)} ${entry.uom}`).join(" | ");
}

export function rowsToCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export function downloadCsv(filename, rows) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function sanitizeSheetName(name, fallback = "Sheet") {
  const cleaned = String(name ?? "")
    .replace(/[\\/?*\[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || fallback).slice(0, 31);
}

export async function downloadWorkbook(filename, sheets) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const workbook = XLSX.utils.book_new();

  for (const [index, sheet] of (sheets ?? []).entries()) {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    const sheetName = sanitizeSheetName(sheet?.name, `Sheet ${index + 1}`);
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }

  if (!workbook.SheetNames.length) return;
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

export function openEmailDraft({ to = "", subject = "", body = "", cc = "" }) {
  if (typeof window === "undefined") return;

  const queryParts = [];
  if (subject) queryParts.push(`subject=${encodeURIComponent(subject)}`);
  if (cc) queryParts.push(`cc=${encodeURIComponent(cc)}`);
  if (body) queryParts.push(`body=${encodeURIComponent(body)}`);

  const query = queryParts.length ? `?${queryParts.join("&")}` : "";
  window.location.href = `mailto:${encodeURIComponent(to)}${query}`;
}

function buildColorRgbTuple(hexColor) {
  const normalizedHex = normalizeHexColor(hexColor).slice(1);
  const red = Number.parseInt(normalizedHex.slice(0, 2), 16);
  const green = Number.parseInt(normalizedHex.slice(2, 4), 16);
  const blue = Number.parseInt(normalizedHex.slice(4, 6), 16);

  return `${red}, ${green}, ${blue}`;
}

export function openPrintReport({
  title = "",
  subtitle = "",
  summary = [],
  sections = [],
  companyName = "",
  systemName = "",
  logoSrc = "",
  accentColor = "#c3922e",
  sidebarColor = "#1a2f4d",
  generatedAt = new Date().toLocaleString(),
  preparedBy = "",
  footerNote = "Powered by Kingsoft Online Solutions",
}) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const printWindow = window.open("", "_blank", "width=1200,height=900");
  if (!printWindow) return;

  const normalizedAccent = normalizeHexColor(accentColor, "#c3922e");
  const normalizedSidebar = normalizeHexColor(sidebarColor, "#1a2f4d");
  const accentRgb = buildColorRgbTuple(normalizedAccent);
  const sidebarRgb = buildColorRgbTuple(normalizedSidebar);
  const hasLogo = Boolean(String(logoSrc ?? "").trim());

  const summaryHtml = summary.length
    ? `<div class="summary-grid">${summary
        .map(
          (entry) =>
            `<div class="summary-card"><span>${escapeHtml(entry.label)}</span><strong>${escapeHtml(
              entry.value
            )}</strong>${
              entry.note ? `<small>${escapeHtml(entry.note)}</small>` : ""
            }</div>`
        )
        .join("")}</div>`
    : "";

  const sectionsHtml = sections
    .map((section) => {
      const rows = section.rows ?? [];
      const columns = section.columns ?? [];

      const tableHtml = rows.length
        ? `<table><thead><tr>${columns
            .map((column) => `<th>${escapeHtml(column)}</th>`)
            .join("")}</tr></thead><tbody>${rows
            .map(
              (row) =>
                `<tr>${row
                  .map((value) => `<td>${escapeHtml(value)}</td>`)
                  .join("")}</tr>`
            )
            .join("")}</tbody></table>`
        : `<p class="empty-state">${escapeHtml(section.emptyMessage ?? "No data for this section.")}</p>`;

      return `<section class="report-section">
        <h2>${escapeHtml(section.title ?? "")}</h2>
        ${section.description ? `<p class="section-copy">${escapeHtml(section.description)}</p>` : ""}
        ${tableHtml}
      </section>`;
    })
    .join("");

  const brandHeaderHtml = `
    <div class="report-brand-shell">
      <div class="report-brand-top">
        <div class="report-brand-lockup">
          ${
            hasLogo
              ? `<div class="report-logo-frame"><img class="report-logo" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(companyName || systemName || "Company Logo")}" /></div>`
              : `<div class="report-logo-fallback">${escapeHtml(
                  String(companyName || systemName || "SF")
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((word) => word[0] ?? "")
                    .join("")
                    .toUpperCase() || "SF"
                )}</div>`
          }
          <div class="report-brand-copy">
            ${companyName ? `<div class="report-company-name">${escapeHtml(companyName)}</div>` : ""}
            ${systemName ? `<div class="report-system-name">${escapeHtml(systemName)}</div>` : ""}
          </div>
        </div>

        <div class="report-meta-card">
          <span>Generated</span>
          <strong>${escapeHtml(generatedAt)}</strong>
        </div>
      </div>

      <div class="report-title-block">
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
    </div>
  `;

  const documentHtml = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <style>
        :root {
          color-scheme: light;
          --report-accent: ${normalizedAccent};
          --report-accent-rgb: ${accentRgb};
          --report-sidebar: ${normalizedSidebar};
          --report-sidebar-rgb: ${sidebarRgb};
        }

        body {
          margin: 0;
          padding: 32px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #0f172a;
          background: #ffffff;
        }

        header {
          margin-bottom: 24px;
        }

        .report-brand-shell {
          display: grid;
          gap: 18px;
          margin-bottom: 20px;
        }

        .report-brand-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px;
          border: 1px solid rgba(var(--report-sidebar-rgb), 0.08);
          border-radius: 16px;
          background: linear-gradient(180deg, rgba(var(--report-sidebar-rgb), 0.03), rgba(var(--report-sidebar-rgb), 0.01));
        }

        .report-brand-lockup {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
        }

        .report-logo-frame,
        .report-logo-fallback {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 78px;
          min-height: 78px;
          padding: 10px;
          border-radius: 14px;
          background: #ffffff;
          border: 1px solid #d7e0eb;
          overflow: hidden;
        }

        .report-logo {
          display: block;
          max-width: 150px;
          max-height: 72px;
          width: auto;
          height: auto;
        }

        .report-logo-fallback {
          background: rgba(var(--report-accent-rgb), 0.12);
          color: var(--report-sidebar);
          font-size: 24px;
          font-weight: 800;
          letter-spacing: 0.08em;
        }

        .report-brand-copy {
          display: grid;
          gap: 4px;
        }

        .report-company-name {
          font-size: 24px;
          font-weight: 800;
          line-height: 1.1;
        }

        .report-system-name {
          color: #475569;
          font-size: 14px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          font-weight: 700;
        }

        .report-meta-card {
          display: grid;
          gap: 6px;
          min-width: 180px;
          padding: 12px 14px;
          border: 1px solid #d7e0eb;
          border-radius: 14px;
          background: #ffffff;
          text-align: right;
        }

        .report-meta-card span {
          color: #64748b;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
        }

        .report-meta-card strong {
          font-size: 15px;
        }

        .report-title-block {
          display: grid;
          gap: 8px;
        }

        .report-actions {
          position: fixed;
          top: 18px;
          right: 18px;
          z-index: 20;
          display: inline-flex;
          gap: 10px;
          padding: 8px;
          border: 1px solid #d7e0eb;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
          backdrop-filter: blur(12px);
        }

        .report-button-row {
          display: inline-flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .report-button {
          appearance: none;
          border: 1px solid #cbd5e1;
          border-radius: 999px;
          padding: 10px 14px;
          background: #ffffff;
          color: #0f172a;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
        }

        .report-button-primary {
          border-color: var(--report-sidebar);
          background: var(--report-sidebar);
          color: #ffffff;
        }

        h1 {
          margin: 0 0 6px;
          font-size: 28px;
        }

        h2 {
          margin: 0 0 8px;
          font-size: 18px;
        }

        p {
          margin: 0;
          color: #475569;
          line-height: 1.5;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 24px;
        }

        .summary-card {
          padding: 12px 14px;
          border: 1px solid #d7e0eb;
          border-radius: 12px;
          background: linear-gradient(180deg, #ffffff, rgba(var(--report-sidebar-rgb), 0.02));
        }

        .summary-card span {
          display: block;
          color: #64748b;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
        }

        .summary-card strong {
          display: block;
          margin-top: 8px;
          font-size: 22px;
        }

        .summary-card small {
          display: block;
          margin-top: 8px;
          color: #64748b;
          font-size: 12px;
          line-height: 1.45;
        }

        .report-section + .report-section {
          margin-top: 24px;
        }

        .report-section {
          break-inside: avoid;
        }

        .section-copy,
        .empty-state {
          margin-bottom: 12px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          border: 1px solid #d7e0eb;
          border-radius: 12px;
          overflow: hidden;
        }

        thead {
          background: rgba(var(--report-sidebar-rgb), 0.06);
        }

        th,
        td {
          padding: 10px 12px;
          border-bottom: 1px solid #d7e0eb;
          text-align: left;
          vertical-align: top;
          font-size: 13px;
        }

        th {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #475569;
        }

        .report-signoff {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 24px;
          margin-top: 32px;
        }

        .report-signoff-block {
          padding-top: 18px;
          border-top: 1px solid #cbd5e1;
          font-size: 13px;
          color: #475569;
        }

        .report-footer-note {
          margin-top: 18px;
          color: #64748b;
          font-size: 12px;
          text-align: center;
        }

        @media print {
          body {
            padding: 18px;
          }

          .report-actions {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <div class="report-actions">
        <button class="report-button report-button-primary" type="button" onclick="window.print()">Print / Save PDF</button>
        <button class="report-button" type="button" onclick="window.close()">Close</button>
      </div>
      <header>${brandHeaderHtml}</header>
      ${summaryHtml}
      ${sectionsHtml}
      <div class="report-signoff">
        <div class="report-signoff-block">Prepared by: ${escapeHtml(preparedBy || "______________________________")}</div>
        <div class="report-signoff-block">Reviewed by: ______________________________</div>
      </div>
      <div class="report-footer-note">${escapeHtml(footerNote)}</div>
    </body>
  </html>`;

  printWindow.document.open();
  printWindow.document.write(documentHtml);
  printWindow.document.close();
  printWindow.focus();
}

export function openRequisitionPreview({
  companyName = "",
  systemName = "",
  logoSrc = "",
  accentColor = "#c3922e",
  sidebarColor = "#1a2f4d",
  preparedBy = "",
  pageNumber = "",
  movementDate = "",
  departmentName = "",
  lines = [],
}) {
  const quantityEntries = buildQuantityEntries(
    lines,
    (line) => line.itemUom,
    (line) => line.quantity
  );
  const resolvedPageNumber = formatRequisitionNumber(pageNumber || "Not Set");
  const formattedDate = movementDate ? formatDate(movementDate) : "-";

  openPrintReport({
    title: "Requisition Preview",
    subtitle: [
      departmentName ? `Department: ${departmentName}` : "",
      movementDate ? `Date: ${formattedDate}` : "",
      pageNumber ? `Page ${resolvedPageNumber}` : "",
    ]
      .filter(Boolean)
      .join(" • "),
    companyName,
    systemName,
    logoSrc,
    accentColor,
    sidebarColor,
    preparedBy,
    summary: [
      { label: "Department", value: departmentName || "-" },
      { label: "Page", value: pageNumber ? resolvedPageNumber : "-" },
      { label: "Item Lines", value: formatNumber(lines.length) },
      { label: "Issued By UOM", value: formatQuantityEntries(quantityEntries) },
    ],
    sections: [
      {
        title: "Requisition Items",
        description: "This preview shows the items currently saved under the selected requisition page.",
        columns: ["#", "Code", "Item", "UOM", "Qty", "Note", "Recorded By"],
        rows: lines.map((line, index) => [
          String(index + 1),
          line.itemCode || "",
          line.itemName || "",
          line.itemUom || "",
          formatNumber(line.quantity),
          line.notes || "-",
          line.enteredBy || preparedBy || "-",
        ]),
        emptyMessage: "No item lines are saved on this requisition page yet.",
      },
    ],
  });
}
