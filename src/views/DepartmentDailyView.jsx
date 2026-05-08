import React, { useEffect, useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import TextPromptDialog from "../components/TextPromptDialog";
import { downloadCsv, openRequisitionPreview } from "../utils/export";
import {
  formatDate,
  formatNumber,
  formatRequisitionNumber,
  normalizeRequisitionNumber,
  parseRequisitionNumber,
} from "../utils/formatters";

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

function getRequisitionKey(line) {
  const value = normalizeRequisitionNumber(line.requisitionNumber ?? line.reference ?? "");
  return value || `UNSPECIFIED-${line.id}`;
}

function getRequisitionLabel(line) {
  const value = String(line.requisitionNumber ?? line.reference ?? "").trim();
  return value ? formatRequisitionNumber(value) : "No Requisition";
}

export default function DepartmentDailyView({
  departmentDate,
  onDateChange,
  departments,
  issueLines,
  hotelName = "",
  productName = "",
  brandLogoUrl = "",
  brandAccentColor = "",
  brandSidebarColor = "",
  currentUserName = "",
  canManageIssueLines = false,
  canDeleteIssueLines = false,
  onEditIssueLine,
  onDeleteIssueLine,
}) {
  const [feedback, setFeedback] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState({
    lineId: "",
    itemName: "",
    requisitionNumber: "",
    reason: "",
    error: "",
  });
  const departmentRows = useMemo(
    () =>
      departments
        .map((department) => {
          const lines = issueLines.filter((line) => line.departmentId === department.id);
          const activeLines = lines.filter((line) => !line.isDeleted);

          return {
            ...department,
            lineCount: activeLines.length,
            deletedLineCount: lines.length - activeLines.length,
            quantityMix: formatQuantityEntries(
              buildQuantityEntries(activeLines, (line) => line.itemUom, (line) => line.quantity)
            ),
            uniqueItems: new Set(lines.map((line) => line.itemId)).size,
            topItems: activeLines
              .slice(0, 3)
              .map((line) => line.itemName)
              .join(", ") || "-",
            hasDeletedLines: lines.some((line) => line.isDeleted),
            requisitionCount: new Set(lines.map((line) => getRequisitionKey(line))).size,
          };
        })
        .filter((row) => row.lineCount > 0 || row.deletedLineCount > 0)
        .map((row) => ({
          ...row,
          requisitionCount: new Set(
            issueLines
              .filter((line) => line.departmentId === row.id)
              .map((line) => getRequisitionKey(line))
          ).size,
        })),
    [departments, issueLines]
  );
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(
    departmentRows[0]?.id ?? ""
  );

  useEffect(() => {
    if (!departmentRows.some((row) => row.id === selectedDepartmentId)) {
      setSelectedDepartmentId(departmentRows[0]?.id ?? "");
    }
  }, [departmentRows, selectedDepartmentId]);

  const selectedDepartment =
    departmentRows.find((row) => row.id === selectedDepartmentId) ?? null;

  const departmentLines = useMemo(
    () => issueLines.filter((line) => line.departmentId === selectedDepartmentId),
    [issueLines, selectedDepartmentId]
  );

  const requisitionRows = useMemo(() => {
    const requisitionMap = new Map();

    for (const line of departmentLines) {
      const key = getRequisitionKey(line);
      const existing = requisitionMap.get(key);

        if (existing) {
        if (!line.isDeleted) {
          existing.lineCount += 1;
        } else {
          existing.deletedLineCount += 1;
        }
        existing.itemIds.add(line.itemId);
        existing.enteredBySet.add(line.enteredBy || "-");
        existing.activeLines.push(line);
        if (line.isDeleted) {
          existing.deletedBySet.add(line.deletedBy || "-");
        }
        continue;
      }

        requisitionMap.set(key, {
          id: key,
          requisitionNumber: getRequisitionLabel(line),
          date: line.date,
          lineCount: line.isDeleted ? 0 : 1,
          deletedLineCount: line.isDeleted ? 1 : 0,
          itemIds: new Set([line.itemId]),
          enteredBySet: new Set([line.enteredBy || "-"]),
          deletedBySet: new Set(line.isDeleted ? [line.deletedBy || "-"] : []),
          activeLines: line.isDeleted ? [] : [line],
        });
      }

    return Array.from(requisitionMap.values())
      .map((row) => ({
        ...row,
        itemCount: row.itemIds.size,
        quantityMix: formatQuantityEntries(
          buildQuantityEntries(row.activeLines, (line) => line.itemUom, (line) => line.quantity)
        ),
        enteredBy:
          row.enteredBySet.size === 1 ? Array.from(row.enteredBySet)[0] : "Multiple Users",
        deletedBy:
          row.deletedBySet.size === 1 ? Array.from(row.deletedBySet)[0] : row.deletedBySet.size ? "Multiple Users" : "",
        status:
          row.lineCount > 0 && row.deletedLineCount > 0
            ? "Mixed"
            : row.deletedLineCount > 0
              ? "Deleted Only"
              : "Active",
      }))
      .sort((left, right) => {
        const leftNumber = parseRequisitionNumber(left.requisitionNumber);
        const rightNumber = parseRequisitionNumber(right.requisitionNumber);

        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
          return leftNumber - rightNumber;
        }

        if (Number.isFinite(leftNumber)) return -1;
        if (Number.isFinite(rightNumber)) return 1;

        return left.requisitionNumber.localeCompare(right.requisitionNumber);
      });
  }, [departmentLines]);

  const [selectedRequisitionId, setSelectedRequisitionId] = useState(
    requisitionRows[0]?.id ?? ""
  );

  useEffect(() => {
    if (!requisitionRows.some((row) => row.id === selectedRequisitionId)) {
      setSelectedRequisitionId(requisitionRows[0]?.id ?? "");
    }
  }, [requisitionRows, selectedRequisitionId]);

  const selectedRequisition =
    requisitionRows.find((row) => row.id === selectedRequisitionId) ?? null;

  const requisitionLines = useMemo(
    () =>
      departmentLines
        .filter((line) => getRequisitionKey(line) === selectedRequisitionId)
        .sort((left, right) => left.itemName.localeCompare(right.itemName)),
    [departmentLines, selectedRequisitionId]
  );
  const activeRequisitionLines = useMemo(
    () => requisitionLines.filter((line) => !line.isDeleted),
    [requisitionLines]
  );

  const totalIssuedQty = useMemo(
    () =>
      formatQuantityEntries(
        buildQuantityEntries(
          issueLines.filter((line) => !line.isDeleted),
          (line) => line.itemUom,
          (line) => line.quantity
        )
      ),
    [issueLines]
  );
  const totalRequisitionCount = useMemo(
    () => new Set(issueLines.map((line) => `${line.departmentId}:${getRequisitionKey(line)}`)).size,
    [issueLines]
  );

  const summaryColumns = [
    { key: "name", label: "Department" },
    { key: "requisitionCount", label: "Pages", align: "right" },
    {
      key: "quantityMix",
      label: "Issued By UOM",
      render: (row) => row.quantityMix,
    },
    { key: "lineCount", label: "Lines", align: "right" },
    {
      key: "deletedLineCount",
      label: "Deleted",
      align: "right",
      render: (row) => formatNumber(row.deletedLineCount),
    },
    { key: "uniqueItems", label: "Items", align: "right" },
    {
      key: "action",
      label: "",
      render: (row) => (
        <button
          className="button button-secondary button-small"
          onClick={() => setSelectedDepartmentId(row.id)}
          type="button"
        >
          Open
        </button>
      ),
    },
  ];

  const requisitionColumns = [
    { key: "requisitionNumber", label: "Requisition Page" },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusPill tone={row.status === "Active" ? "success" : "warning"}>{row.status}</StatusPill>
      ),
    },
    { key: "itemCount", label: "Items", align: "right" },
    { key: "lineCount", label: "Lines", align: "right" },
    { key: "deletedLineCount", label: "Deleted", align: "right" },
    {
      key: "quantityMix",
      label: "Issued By UOM",
      render: (row) => row.quantityMix,
    },
    { key: "enteredBy", label: "Entered By" },
    {
      key: "action",
      label: "",
      render: (row) => (
        <button
          className="button button-secondary button-small"
          onClick={() => setSelectedRequisitionId(row.id)}
          type="button"
        >
          Open
        </button>
      ),
    },
  ];

  const detailColumns = [
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusPill tone={row.isDeleted ? "warning" : "success"}>
          {row.isDeleted ? "Deleted" : "Active"}
        </StatusPill>
      ),
    },
    { key: "itemCode", label: "Code" },
    { key: "itemName", label: "Item" },
    { key: "itemUom", label: "UOM" },
    {
      key: "quantity",
      label: "Qty",
      align: "right",
      render: (row) => formatNumber(row.quantity),
    },
    { key: "enteredBy", label: "Recorded By" },
    {
      key: "audit",
      label: "Audit",
      render: (row) =>
        row.isDeleted
          ? `Deleted by ${row.deletedBy || "-"}${row.deletedReason ? ` • ${row.deletedReason}` : ""}`
          : row.updatedBy && row.updatedBy !== row.createdBy
            ? `Updated by ${row.updatedBy}`
            : `Created by ${row.createdBy || row.enteredBy || "-"}`,
    },
    {
      key: "action",
      label: "",
      render: (row) =>
        row.isDeleted ? null : (
          <div className="document-line-actions">
            {canManageIssueLines ? (
              <button
                className="button button-secondary button-small"
                onClick={() => onEditIssueLine?.(row.id)}
                type="button"
              >
                Edit
              </button>
            ) : null}
            {canDeleteIssueLines ? (
              <button
                className="button button-secondary button-small"
                onClick={() => handleDeleteIssueLine(row)}
                type="button"
              >
                Mark Deleted
              </button>
            ) : null}
          </div>
        ),
    },
  ];

  async function handleDeleteIssueLine(line) {
    if (!line || !canDeleteIssueLines || !onDeleteIssueLine) return;
    setDeleteDialog({
      lineId: line.id,
      itemName: line.itemName,
      requisitionNumber: getRequisitionLabel(line),
      reason: "",
      error: "",
    });
  }

  async function handleConfirmDeleteIssueLine() {
    if (!deleteDialog.lineId || !canDeleteIssueLines || !onDeleteIssueLine) return;

    if (!String(deleteDialog.reason ?? "").trim()) {
      setDeleteDialog((currentDialog) => ({
        ...currentDialog,
        error: "A delete reason is required so the requisition audit trail remains complete.",
      }));
      return;
    }

    try {
      await onDeleteIssueLine(deleteDialog.lineId, deleteDialog.reason);
      setDeleteDialog({
        lineId: "",
        itemName: "",
        requisitionNumber: "",
        reason: "",
        error: "",
      });
      setFeedback({
        tone: "warning",
        message: `${deleteDialog.itemName} was marked deleted and kept on the requisition audit trail.`,
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message:
          error instanceof Error ? error.message : "The requisition line could not be marked deleted.",
      });
    }
  }

  function handleExport() {
    downloadCsv(`department-issues-${departmentDate}.csv`, [
      [
        "Date",
        "Department",
        "Requisition Page",
        "Status",
        "Item Code",
        "Item",
        "UOM",
        "Qty",
        "Recorded By",
        "Deleted By",
        "Deleted At",
        "Delete Reason",
      ],
      ...issueLines.map((line) => [
        line.date,
        line.departmentName,
        getRequisitionLabel(line),
        line.isDeleted ? "Deleted" : "Active",
        line.itemCode,
        line.itemName,
        line.itemUom,
        line.quantity,
        line.enteredBy,
        line.deletedBy,
        line.deletedAt,
        line.deletedReason,
      ]),
    ]);
  }

  function handlePreviewRequisition() {
    if (!selectedRequisition) return;

    openRequisitionPreview({
      companyName: hotelName,
      systemName: productName,
      logoSrc: brandLogoUrl,
      accentColor: brandAccentColor,
      sidebarColor: brandSidebarColor,
      preparedBy: currentUserName,
      pageNumber: selectedRequisition.requisitionNumber,
      movementDate: departmentDate,
      departmentName: selectedDepartment?.name || "",
      lines: activeRequisitionLines,
    });
  }

  if (!departmentRows.length) {
    return (
      <section className="card">
        <div className="card-header card-header-spread">
          <div>
            <div className="section-kicker">Department Use</div>
            <h2>Department requisitions for the selected date</h2>
            <p>Selected date: {formatDate(departmentDate)}</p>
          </div>
          <input
            className="input"
            type="date"
            value={departmentDate}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </div>

        <EmptyState
          eyebrow="Department Use"
          title="No department issues on this date."
          message="When stores records OUT movements, requisition pages will appear here for review."
        />
      </section>
    );
  }

  return (
    <div className="view-stack">
      <TextPromptDialog
        isOpen={Boolean(deleteDialog.lineId)}
        title="Mark requisition line deleted"
        description={
          deleteDialog.lineId
            ? `This keeps ${deleteDialog.itemName} visible on page ${deleteDialog.requisitionNumber} for audit review while removing it from active stock totals.`
            : ""
        }
        label="Delete reason"
        value={deleteDialog.reason}
        error={deleteDialog.error}
        placeholder="Explain why this requisition line is being removed from the live page totals."
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
            lineId: "",
            itemName: "",
            requisitionNumber: "",
            reason: "",
            error: "",
          })
        }
        onSubmit={handleConfirmDeleteIssueLine}
      />

      <section className="card">
        <div className="card-header card-header-spread">
          <div>
            <div className="section-kicker">Department Use</div>
            <h2>Department requisitions for the selected date</h2>
            <p>Selected date: {formatDate(departmentDate)}</p>
          </div>
          <div className="toolbar">
            <input
              className="input"
              type="date"
              value={departmentDate}
              onChange={(event) => onDateChange(event.target.value)}
            />
            <button className="button button-secondary" onClick={handleExport} type="button">
              Export CSV
            </button>
          </div>
        </div>

        <div className="compact-metric-grid">
          <div className="compact-metric-tile">
            <span>Departments</span>
            <strong>{formatNumber(departmentRows.length)}</strong>
          </div>
          <div className="compact-metric-tile">
            <span>Requisition Pages</span>
            <strong>{formatNumber(totalRequisitionCount)}</strong>
          </div>
          <div className="compact-metric-tile">
            <span>Issue Lines</span>
            <strong>{formatNumber(issueLines.filter((line) => !line.isDeleted).length)}</strong>
          </div>
          <div className="compact-metric-tile">
            <span>Total Issued By UOM</span>
            <strong>{totalIssuedQty}</strong>
          </div>
          <div className="compact-metric-tile">
            <span>Deleted Lines</span>
            <strong>{formatNumber(issueLines.filter((line) => line.isDeleted).length)}</strong>
          </div>
        </div>
        {feedback ? (
          <div className={`alert-banner alert-${feedback.tone}`}>{feedback.message}</div>
        ) : null}
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <div className="section-kicker">Department summary</div>
            <h2>Departments that took stock on this date</h2>
          </div>
        </div>

        <DataTable
          columns={summaryColumns}
          rows={departmentRows}
          rowKey={(row) => row.id}
          rowClassName={(row) => (row.id === selectedDepartmentId ? "row-selected" : "")}
        />
      </section>

      <div className="split-layout">
        <section className="card">
          <div className="card-header">
            <div>
              <div className="section-kicker">Selected department</div>
              <h2>{selectedDepartment?.name ?? "Department"}</h2>
              <p>Open a requisition page to see the item lines recorded under it.</p>
            </div>
          </div>

          {selectedDepartment ? (
            <>
              <div className="compact-metric-grid">
                <div className="compact-metric-tile">
                  <span>Pages</span>
                  <strong>{formatNumber(selectedDepartment.requisitionCount)}</strong>
                </div>
                <div className="compact-metric-tile">
                  <span>Items</span>
                  <strong>{formatNumber(selectedDepartment.uniqueItems)}</strong>
                </div>
                <div className="compact-metric-tile">
                  <span>Lines</span>
                  <strong>{formatNumber(selectedDepartment.lineCount)}</strong>
                </div>
                <div className="compact-metric-tile">
                  <span>Deleted</span>
                  <strong>{formatNumber(selectedDepartment.deletedLineCount)}</strong>
                </div>
                <div className="compact-metric-tile">
                  <span>Issued By UOM</span>
                  <strong>{selectedDepartment.quantityMix}</strong>
                </div>
              </div>

              <DataTable
                columns={requisitionColumns}
                rows={requisitionRows}
                rowKey={(row) => row.id}
                rowClassName={(row) => (row.id === selectedRequisitionId ? "row-selected" : "")}
                emptyMessage="No requisition pages are recorded for this department on the selected date."
              />
            </>
          ) : (
            <EmptyState
              eyebrow="Department Detail"
              title="Choose a department to continue."
              message="Pick one department from the summary table to review its requisition pages."
              align="left"
            />
          )}
        </section>

        <section className="card">
          <div className="card-header card-header-spread">
            <div>
              <div className="section-kicker">Requisition page detail</div>
              <h2>{selectedRequisition?.requisitionNumber ?? "Select a requisition page"}</h2>
              <p>
                This shows the item lines that were issued on the selected department requisition
                page.
              </p>
            </div>
            {selectedRequisition ? (
              <button
                className="button button-secondary"
                onClick={handlePreviewRequisition}
                type="button"
                disabled={!activeRequisitionLines.length}
              >
                Preview Requisition
              </button>
            ) : null}
          </div>

          {selectedRequisition ? (
            <>
              <div className="compact-metric-grid">
                <div className="compact-metric-tile">
                  <span>Items</span>
                  <strong>{formatNumber(selectedRequisition.itemCount)}</strong>
                </div>
                <div className="compact-metric-tile">
                  <span>Lines</span>
                  <strong>{formatNumber(selectedRequisition.lineCount)}</strong>
                </div>
                <div className="compact-metric-tile">
                  <span>Deleted</span>
                  <strong>{formatNumber(selectedRequisition.deletedLineCount)}</strong>
                </div>
                <div className="compact-metric-tile">
                  <span>Issued By UOM</span>
                  <strong>{selectedRequisition.quantityMix}</strong>
                </div>
                <div className="compact-metric-tile">
                  <span>Entered By</span>
                  <strong>{selectedRequisition.enteredBy}</strong>
                </div>
              </div>

              <DataTable
                columns={detailColumns}
                rows={requisitionLines}
                rowKey={(row) => row.id}
                rowClassName={(row) => (row.isDeleted ? "row-deleted" : "")}
                emptyMessage="No item lines are recorded on this requisition page."
              />
            </>
          ) : (
            <EmptyState
              eyebrow="Requisition Page"
              title="Choose a requisition page to continue."
              message="Pick one page from the selected department to review its item lines."
              align="left"
            />
          )}
        </section>
      </div>
    </div>
  );
}
