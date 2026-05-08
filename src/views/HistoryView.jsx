import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "../components/DataTable";
import DismissibleNotice from "../components/DismissibleNotice";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import TextPromptDialog from "../components/TextPromptDialog";
import { filterHistoryRows } from "../utils/calculations";
import { downloadCsv, openEmailDraft } from "../utils/export";
import {
  formatDate,
  formatDateTime,
  formatDateRange,
  formatMovementType,
  formatNumber,
} from "../utils/formatters";
import { validateMovementEntry } from "../utils/validation";

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

function buildMovementForm(movement) {
  if (!movement) {
    return {
      date: "",
      type: "OUT",
      adjustmentMode: "INCREASE",
      departmentId: "",
      itemId: "",
      quantity: "",
      unitCost: "",
      requisitionNumber: "",
      referenceNumber: "",
      notes: "",
      enteredBy: "",
    };
  }

  return {
    date: movement.date,
    type: movement.type,
    adjustmentMode: movement.adjustmentMode ?? "INCREASE",
    departmentId: movement.departmentId,
    itemId: movement.itemId,
    quantity: movement.quantity,
    unitCost: movement.unitCost ?? "",
    requisitionNumber: movement.requisitionNumber ?? "",
    referenceNumber: movement.referenceNumber ?? "",
    notes: movement.notes ?? "",
    enteredBy: movement.enteredBy || "Historical Record",
  };
}

function buildHistorySupportMessage(mode, movement) {
  if (!movement) return "";

  if (mode === "updated") {
    return {
      tone: "success",
      message: "Movement updated.",
      actions: [
        { id: "review_audit", label: "Audit Trail" },
        { id: "reset_changes", label: "Reset Form", variant: "secondary" },
      ],
    };
  }

  if (mode === "already_deleted") {
    return {
      tone: "warning",
      message: "This movement is already deleted.",
      actions: [{ id: "review_audit", label: "Audit Trail" }],
    };
  }

  if (mode === "deleted") {
    return {
      tone: "warning",
      message: `${movement.itemName} marked deleted.`,
      actions: [{ id: "review_audit", label: "Audit Trail" }],
    };
  }

  return { tone: "info", message: "", actions: [] };
}

export default function HistoryView({
  departments,
  items,
  rows,
  hotelName,
  productName,
  defaultEmail,
  onSaveMovement,
  onDeleteMovement,
  canEditHistory = false,
  canDeleteHistory = false,
}) {
  const [filters, setFilters] = useState({
    search: "",
    type: "",
    status: "",
    departmentId: "",
    fromDate: "",
    toDate: "",
  });
  const [selectedMovementId, setSelectedMovementId] = useState("");
  const [editForm, setEditForm] = useState(() => buildMovementForm(rows[0]));
  const [showErrors, setShowErrors] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState({
    movementId: "",
    itemName: "",
    reason: "",
    error: "",
  });
  const auditTrailRef = useRef(null);

  const deferredSearch = useDeferredValue(filters.search);

  const filteredRows = useMemo(
    () => filterHistoryRows(rows, { ...filters, search: deferredSearch }),
    [
      deferredSearch,
      filters.departmentId,
      filters.fromDate,
      filters.status,
      filters.toDate,
      filters.type,
      rows,
    ]
  );

  useEffect(() => {
    if (!rows.length) {
      setSelectedMovementId("");
      return;
    }

    if (!rows.some((row) => row.id === selectedMovementId)) {
      setSelectedMovementId(rows[0].id);
    }
  }, [rows, selectedMovementId]);

  const selectedMovement =
    rows.find((row) => row.id === selectedMovementId) ??
    filteredRows.find((row) => row.id === selectedMovementId) ??
    null;

  useEffect(() => {
    setEditForm(buildMovementForm(selectedMovement));
  }, [selectedMovement]);

  const editValidation = useMemo(
    () =>
      validateMovementEntry(editForm, {
        movements: rows,
        currentMovementId: selectedMovement?.id ?? null,
      }),
    [editForm, rows, selectedMovement?.id]
  );

  const summary = useMemo(
    () => ({
      lineCount: filteredRows.length,
      quantityMix: formatQuantityEntries(
        buildQuantityEntries(filteredRows, (row) => row.itemUom, (row) => row.quantity)
      ),
      fromDate: filters.fromDate || filteredRows[filteredRows.length - 1]?.date || "",
      toDate: filters.toDate || filteredRows[0]?.date || "",
    }),
    [filteredRows, filters.fromDate, filters.toDate]
  );

  const historyEmptyMessage = useMemo(() => {
    if (!rows.length) {
      return "No movement history yet. Record or import movements to build the audit log.";
    }

    if (
      deferredSearch ||
      filters.type ||
      filters.status ||
      filters.departmentId ||
      filters.fromDate ||
      filters.toDate
    ) {
      return "No movements match the current filters.";
    }

    return "No movement history is available right now.";
  }, [
    deferredSearch,
    filters.departmentId,
    filters.fromDate,
    filters.status,
    filters.toDate,
    filters.type,
    rows.length,
  ]);

  const columns = [
    { key: "date", label: "Date", render: (row) => formatDate(row.date) },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusPill tone={row.isDeleted ? "warning" : "success"}>
          {row.isDeleted ? "Deleted" : "Active"}
        </StatusPill>
      ),
    },
    { key: "type", label: "Type", render: (row) => formatMovementType(row.type) },
    { key: "itemCode", label: "Code" },
    { key: "itemName", label: "Item" },
    { key: "departmentName", label: "Department" },
    { key: "quantity", label: "Qty", align: "right", render: (row) => formatNumber(row.quantity) },
    { key: "reference", label: "Reference" },
    { key: "enteredBy", label: "Entered By" },
    { key: "notes", label: "Notes" },
    {
      key: "action",
      label: "",
      render: (row) => (
        <button
          className="button button-secondary button-small"
          onClick={() => {
            setSelectedMovementId(row.id);
            setFeedback(null);
            setShowErrors(false);
          }}
          type="button"
        >
          {canEditHistory ? "Edit" : "View"}
        </button>
      ),
    },
  ];

  const auditTrailBlock = selectedMovement ? (
    <div className="detail-block" ref={auditTrailRef}>
      <strong>Audit Trail</strong>
      {selectedMovement.auditTrail?.length ? (
        <div className="audit-trail-list">
          {[...selectedMovement.auditTrail]
            .sort(
              (left, right) =>
                String(right.at ?? right.timestamp ?? "").localeCompare(
                  String(left.at ?? left.timestamp ?? "")
                )
            )
            .map((event, index) => (
              <div key={`${event.at ?? event.timestamp}-${index}`} className="audit-trail-item">
                <div className="audit-trail-heading">
                  <strong>{event.summary || event.action || "Movement event"}</strong>
                  <span>{formatDateTime(event.at ?? event.timestamp)}</span>
                </div>
                <small>
                  {event.by || event.actorName || "System"} •{" "}
                  {String(event.action ?? "").toUpperCase()}
                </small>
                {event.changes?.length ? (
                  <ul className="audit-trail-changes">
                    {event.changes.map((change, changeIndex) => (
                      <li key={`${change.field}-${changeIndex}`}>
                        {change.label || change.field}:{" "}
                        {String(change.before ?? change.from ?? "-")} to{" "}
                        {String(change.after ?? change.to ?? "-")}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
        </div>
      ) : (
        <EmptyState
          eyebrow="Audit Trail"
          title="No later audit events on this movement."
          message="This record has not been changed or deleted since it was first saved."
          align="left"
        />
      )}
    </div>
  ) : null;

  function updateFilter(field, value) {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [field]: value,
    }));
  }

  function handleExport() {
    downloadCsv("movement-history.csv", [
      [
        "Date",
        "Status",
        "Type",
        "Code",
        "Item",
        "Department",
        "Qty",
        "Reference",
        "Recorded By",
        "Notes",
        "Deleted By",
        "Deleted At",
        "Delete Reason",
      ],
      ...filteredRows.map((row) => [
        row.date,
        row.isDeleted ? "Deleted" : "Active",
        row.type,
        row.itemCode,
        row.itemName,
        row.departmentName,
        row.quantity,
        row.reference,
        row.enteredBy,
        row.notes,
        row.deletedBy,
        row.deletedAt,
        row.deletedReason,
      ]),
    ]);
  }

  function handleEmailExport() {
    const companyLabel = String(hotelName ?? "").trim() || "Stock Flow";
    const systemLabel = String(productName ?? "").trim() || "Stock Flow";

    openEmailDraft({
      to: defaultEmail,
      subject: `${companyLabel} Audit Trail ${formatDateRange(
        summary.fromDate,
        summary.toDate
      )}`,
      body: [
        `Audit trail summary from ${systemLabel}`,
        "",
        `Date range: ${formatDateRange(summary.fromDate, summary.toDate)}`,
        `Filtered lines: ${formatNumber(summary.lineCount)}`,
        `Quantity by UOM across filtered lines: ${summary.quantityMix}`,
        `Movement type filter: ${filters.type || "All"}`,
        `Department filter: ${
          departments.find((department) => department.id === filters.departmentId)?.name || "All"
        }`,
        "",
        "Attach the exported CSV manually if the recipient needs the full movement listing.",
      ].join("\n"),
    });
  }

  function handleEditFieldChange(field, value) {
    setFeedback(null);
    setEditForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function handleResetEditForm() {
    setShowErrors(false);
    setFeedback(null);
    setEditForm(buildMovementForm(selectedMovement));
  }

  function handleFeedbackAction(actionId) {
    if (actionId === "review_audit") {
      auditTrailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (actionId === "reset_changes") {
      handleResetEditForm();
    }
  }

  async function handleSaveMovement() {
    if (!selectedMovement || !canEditHistory || !onSaveMovement) return;

    const editPayload = {
      ...editForm,
      unitCost: editForm.unitCost ?? selectedMovement.unitCost ?? "",
      enteredBy: selectedMovement.enteredBy || editForm.enteredBy || "Historical Record",
    };

    const saveValidation = validateMovementEntry(editPayload, {
      movements: rows,
      currentMovementId: selectedMovement?.id ?? null,
    });

    if (!saveValidation.isValid) {
      setShowErrors(true);
      setFeedback({
        tone: "danger",
        message: "Please fix the required movement fields before saving changes.",
      });
      return;
    }

    setSaveBusy(true);

    try {
      await onSaveMovement(selectedMovement.id, saveValidation.normalizedEntry);
      setShowErrors(false);
      setFeedback(buildHistorySupportMessage("updated", selectedMovement));
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "The movement could not be updated.",
      });
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleDeleteMovement() {
    if (!selectedMovement || !canDeleteHistory || !onDeleteMovement) return;
    if (selectedMovement.isDeleted) {
      setFeedback(buildHistorySupportMessage("already_deleted", selectedMovement));
      return;
    }

    setDeleteDialog({
      movementId: selectedMovement.id,
      itemName: selectedMovement.itemName,
      reason: "",
      error: "",
    });
  }

  async function handleConfirmDeleteMovement() {
    if (!deleteDialog.movementId || !canDeleteHistory || !onDeleteMovement) return;

    if (!String(deleteDialog.reason ?? "").trim()) {
      setDeleteDialog((currentDialog) => ({
        ...currentDialog,
        error: "A delete reason is required for movement audit control.",
      }));
      return;
    }

    try {
      await onDeleteMovement(deleteDialog.movementId, deleteDialog.reason);
      setDeleteDialog({
        movementId: "",
        itemName: "",
        reason: "",
        error: "",
      });
      setFeedback(buildHistorySupportMessage("deleted", selectedMovement));
      setShowErrors(false);
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "The movement could not be deleted.",
      });
    }
  }

  return (
    <div className="split-layout">
      <TextPromptDialog
        isOpen={Boolean(deleteDialog.movementId)}
        title="Mark movement deleted"
        description={
          deleteDialog.movementId
            ? `This keeps ${deleteDialog.itemName} visible in history and audit while removing it from active stock calculations. Review the audit trail after delete so the reason is easy to explain later.`
            : ""
        }
        label="Delete reason"
        value={deleteDialog.reason}
        error={deleteDialog.error}
        placeholder="Explain why this movement is being removed from live stock records."
        submitLabel="Mark Deleted"
        cancelLabel="Cancel"
        multiline
        onChange={(value) =>
          setDeleteDialog((currentDialog) => ({
            ...currentDialog,
            reason: value,
            error: "",
          }))
        }
        onClose={() =>
          setDeleteDialog({
            movementId: "",
            itemName: "",
            reason: "",
            error: "",
          })
        }
        onSubmit={handleConfirmDeleteMovement}
      />

      <section className="card">
        <div className="card-header card-header-spread">
          <h2>Audit Trail</h2>
          <div className="toolbar">
            <button className="button button-secondary" onClick={handleEmailExport} type="button">
              Email Summary
            </button>
            <button className="button button-secondary" onClick={handleExport} type="button">
              Export Filtered CSV
            </button>
          </div>
        </div>

        <div className="pill-row">
          <StatusSummary label="Filtered lines" value={summary.lineCount} />
          <StatusSummary label="Qty by UOM" value={summary.quantityMix} />
        </div>

        <div className="filter-grid">
          <input
            className="input"
            placeholder="Search item, ref, department, note"
            value={filters.search}
            onChange={(event) => updateFilter("search", event.target.value)}
          />
          <select
            className="input"
            value={filters.type}
            onChange={(event) => updateFilter("type", event.target.value)}
          >
            <option value="">All types</option>
            <option value="IN">IN</option>
            <option value="OUT">OUT</option>
            <option value="ADJ">ADJ</option>
          </select>
          <select
            className="input"
            value={filters.status}
            onChange={(event) => updateFilter("status", event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="active">Active only</option>
            <option value="deleted">Deleted only</option>
          </select>
          <select
            className="input"
            value={filters.departmentId}
            onChange={(event) => updateFilter("departmentId", event.target.value)}
          >
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="date"
            value={filters.fromDate}
            onChange={(event) => updateFilter("fromDate", event.target.value)}
          />
          <input
            className="input"
            type="date"
            value={filters.toDate}
            onChange={(event) => updateFilter("toDate", event.target.value)}
          />
        </div>

        <DataTable
          columns={columns}
          rows={filteredRows}
          rowKey={(row) => row.id}
          emptyMessage={historyEmptyMessage}
          rowClassName={(row) =>
            [row.id === selectedMovementId ? "row-selected" : "", row.isDeleted ? "row-deleted" : ""]
              .filter(Boolean)
              .join(" ")
          }
        />
      </section>

      <section className="card">
        <div className="card-header card-header-spread">
          <h2>
            {selectedMovement
              ? canEditHistory
                ? "Edit Movement"
                : "Movement Details"
              : "Select a movement"}
          </h2>
        </div>

        {feedback?.message ? (
          <DismissibleNotice
            tone={feedback.tone}
            actions={(feedback.actions ?? []).map((action) => ({
              ...action,
              onClick: () => handleFeedbackAction(action.id),
            }))}
            onClose={() => setFeedback(null)}
          >
            {feedback.message}
          </DismissibleNotice>
        ) : null}

        {!selectedMovement ? (
          <EmptyState
            eyebrow="History"
            title="Choose a movement to continue."
            message={
              canEditHistory
                ? "Pick one row from history to review or correct its operational details."
                : "Pick one row from history to review its details."
            }
            align="left"
          />
        ) : canEditHistory && !selectedMovement.isDeleted ? (
          <>
            <div className="detail-block editor-context-card">
              <div className="editor-context-head">
                <div className="editor-context-copy">
                  <strong>{selectedMovement.itemName}</strong>
                  <p>
                    You are editing one recorded movement. The original recorder stays locked for
                    audit, even if you change the operational fields.
                  </p>
                </div>
                <StatusPill tone="info">Editing active movement</StatusPill>
              </div>
              <div className="pill-row">
                <StatusPill tone="neutral">{formatMovementType(selectedMovement.type)}</StatusPill>
                <StatusPill tone="neutral">{selectedMovement.departmentName}</StatusPill>
                <StatusPill tone="neutral">
                  Qty {formatNumber(selectedMovement.quantity)} {selectedMovement.itemUom || ""}
                </StatusPill>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Date</span>
                <input
                  className="input"
                  type="date"
                  value={editForm.date}
                  onChange={(event) => handleEditFieldChange("date", event.target.value)}
                />
                {showErrors && editValidation.errors.date ? <small>{editValidation.errors.date}</small> : null}
              </label>

              <label className="field">
                <span>Movement Type</span>
                <select
                  className="input"
                  value={editForm.type}
                  onChange={(event) => handleEditFieldChange("type", event.target.value)}
                >
                  <option value="IN">IN</option>
                  <option value="OUT">OUT</option>
                  <option value="ADJ">ADJ</option>
                </select>
              </label>
            </div>

            {editForm.type === "ADJ" ? (
              <div className="field">
                <span>Adjustment Direction</span>
                <div className="segmented-control">
                  <button
                    className={editForm.adjustmentMode === "INCREASE" ? "is-active" : ""}
                    onClick={() => handleEditFieldChange("adjustmentMode", "INCREASE")}
                    type="button"
                  >
                    Add stock
                  </button>
                  <button
                    className={editForm.adjustmentMode === "DECREASE" ? "is-active" : ""}
                    onClick={() => handleEditFieldChange("adjustmentMode", "DECREASE")}
                    type="button"
                  >
                    Reduce stock
                  </button>
                </div>
              </div>
            ) : null}

            <div className="form-grid">
              <label className="field">
                <span>Department</span>
                <select
                  className="input"
                  value={editForm.departmentId}
                  onChange={(event) => handleEditFieldChange("departmentId", event.target.value)}
                >
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
                {showErrors && editValidation.errors.departmentId ? <small>{editValidation.errors.departmentId}</small> : null}
              </label>

              <label className="field">
                <span>Item</span>
                <select
                  className="input"
                  value={editForm.itemId}
                  onChange={(event) => handleEditFieldChange("itemId", event.target.value)}
                >
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} • {item.name}
                    </option>
                  ))}
                </select>
                {showErrors && editValidation.errors.itemId ? <small>{editValidation.errors.itemId}</small> : null}
              </label>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Quantity</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.quantity}
                  onChange={(event) => handleEditFieldChange("quantity", event.target.value)}
                />
                {showErrors && editValidation.errors.quantity ? <small>{editValidation.errors.quantity}</small> : null}
              </label>

              <div className="field">
                <span>Recorded By</span>
                <div className="input input-readonly">{selectedMovement.enteredBy || "Historical Record"}</div>
              </div>
            </div>

            {editForm.type === "OUT" ? (
              <label className="field">
                <span>Requisition Number</span>
                <input
                  className="input"
                  value={editForm.requisitionNumber}
                  onChange={(event) =>
                    handleEditFieldChange("requisitionNumber", event.target.value)
                  }
                />
                {showErrors && editValidation.errors.requisitionNumber ? <small>{editValidation.errors.requisitionNumber}</small> : null}
              </label>
            ) : (
              <label className="field">
                <span>Reference Number</span>
                <input
                  className="input"
                  value={editForm.referenceNumber}
                  onChange={(event) =>
                    handleEditFieldChange("referenceNumber", event.target.value)
                  }
                />
                {showErrors && editValidation.errors.referenceNumber ? <small>{editValidation.errors.referenceNumber}</small> : null}
              </label>
            )}

            <label className="field">
              <span>Notes</span>
              <textarea
                className="input textarea"
                value={editForm.notes}
                onChange={(event) => handleEditFieldChange("notes", event.target.value)}
              />
            </label>

            <div className="detail-block editor-action-bar">
              <div className="editor-action-copy">
                <strong>Save these movement changes</strong>
                <p>
                  Use this only when the original movement was recorded with the wrong operational
                  details. Delete stays audit-safe and non-destructive.
                </p>
              </div>
              <div className="button-row">
                <button className="button" onClick={handleSaveMovement} type="button" disabled={saveBusy}>
                  {saveBusy ? "Saving..." : "Save Changes"}
                </button>
                <button
                  className="button button-secondary"
                  onClick={handleResetEditForm}
                  type="button"
                  disabled={saveBusy}
                >
                  Reset Changes
                </button>
                {canDeleteHistory ? (
                  <button
                    className="button button-secondary"
                    onClick={handleDeleteMovement}
                    type="button"
                    disabled={saveBusy}
                  >
                    Mark Deleted
                  </button>
                ) : null}
              </div>
            </div>

            {auditTrailBlock}
          </>
        ) : (
          <div className="view-stack">
            <div className="detail-block editor-context-card">
              <div className="editor-context-head">
                <div className="editor-context-copy">
                  <strong>{selectedMovement.itemName}</strong>
                  <p>
                    This movement is in read-only review mode
                    {selectedMovement.isDeleted ? " because it has already been marked deleted." : "."}
                  </p>
                </div>
                <StatusPill tone={selectedMovement.isDeleted ? "warning" : "neutral"}>
                  {selectedMovement.isDeleted ? "Deleted movement" : "Read-only review"}
                </StatusPill>
              </div>
            </div>

            <div className="summary-grid">
              <div className="summary-tile">
                <span>Date</span>
                <strong>{formatDate(selectedMovement.date)}</strong>
              </div>
              <div className="summary-tile">
                <span>Type</span>
                <strong>{formatMovementType(selectedMovement.type)}</strong>
              </div>
              <div className="summary-tile">
                <span>Department</span>
                <strong>{selectedMovement.departmentName}</strong>
              </div>
              <div className="summary-tile">
                <span>Item</span>
                <strong>{selectedMovement.itemName}</strong>
              </div>
              <div className="summary-tile">
                <span>Status</span>
                <strong>{selectedMovement.isDeleted ? "Deleted" : "Active"}</strong>
              </div>
              <div className="summary-tile">
                <span>Quantity</span>
                <strong>{formatNumber(selectedMovement.quantity)}</strong>
              </div>
              <div className="summary-tile">
                <span>Reference</span>
                <strong>{selectedMovement.reference || "-"}</strong>
              </div>
            </div>

            <div className="detail-block">
              <strong>Entered by</strong>
              <p>{selectedMovement.enteredBy || "-"}</p>
            </div>

            {selectedMovement.isDeleted ? (
              <div className="detail-block">
                <strong>Delete record</strong>
                <p>
                  Deleted by {selectedMovement.deletedBy || "-"} on{" "}
                  {selectedMovement.deletedAt ? formatDate(selectedMovement.deletedAt) : "-"}.
                </p>
                <small>{selectedMovement.deletedReason || "No delete reason was recorded."}</small>
              </div>
            ) : null}

            <div className="detail-block">
              <strong>Notes</strong>
              <p>{selectedMovement.notes || "No notes on this movement."}</p>
            </div>
            {auditTrailBlock}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusSummary({ label, value }) {
  return (
    <div className="summary-tile summary-tile-inline">
      <span>{label}</span>
      <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    </div>
  );
}
