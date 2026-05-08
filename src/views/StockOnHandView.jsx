import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import DismissibleNotice from "../components/DismissibleNotice";
import StatusPill from "../components/StatusPill";
import { shouldShowOperationalItemRow } from "../utils/calculations";
import { downloadCsv } from "../utils/export";
import { formatDate, formatNumber, searchItemRecords } from "../utils/formatters";
import { validateItemForm } from "../utils/validation";

function buildLevelForm(item) {
  if (!item) {
    return {
      openingBalance: "0",
      minStock: "",
      maxStock: "",
    };
  }

  return {
    openingBalance: String(item.openingBalance ?? 0),
    minStock:
      item.minStock === null || item.minStock === undefined ? "" : String(item.minStock),
    maxStock:
      item.maxStock === null || item.maxStock === undefined ? "" : String(item.maxStock),
  };
}

export default function StockOnHandView({
  rows,
  onSaveItem,
  onOpenEntryForItem,
  canEditLevels = false,
  canOpenAdjustment = false,
  requestedSearch = "",
  requestedStatusFilter = "all",
  requestKey = "",
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingItemId, setEditingItemId] = useState("");
  const [levelForm, setLevelForm] = useState(() => buildLevelForm(null));
  const [showLevelErrors, setShowLevelErrors] = useState(false);
  const [levelErrors, setLevelErrors] = useState({});
  const [feedback, setFeedback] = useState(null);
  const deferredSearch = useDeferredValue(search);
  const visibleRows = useMemo(
    () => rows.filter(shouldShowOperationalItemRow),
    [rows]
  );

  const searchedRows = useMemo(
    () => searchItemRecords(visibleRows, deferredSearch),
    [deferredSearch, visibleRows]
  );

  const filteredRows = useMemo(() => {
    return searchedRows.filter((row) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "attention") {
        return row.stockOnHand <= 0 || row.belowMinStock || row.aboveMaxStock;
      }
      if (statusFilter === "missing-cost") {
        return row.unitCost === null || row.unitCost === undefined;
      }
      if (statusFilter === "missing-levels") {
        return row.minStock === null && row.maxStock === null;
      }
      if (statusFilter === "zero-opening") {
        return Number(row.openingBalance) === 0;
      }
      if (statusFilter === "negative") return row.stockOnHand < 0;
      if (statusFilter === "below-min") return row.belowMinStock;
      if (statusFilter === "above-max") return row.aboveMaxStock;
      if (statusFilter === "zero") return row.stockOnHand === 0;
      if (statusFilter === "healthy") {
        return row.stockOnHand > 0 && !row.belowMinStock && !row.aboveMaxStock;
      }
      return true;
    });
  }, [searchedRows, statusFilter]);

  const filterOptions = useMemo(
    () => [
      { id: "attention", label: "Needs Attention" },
      { id: "all", label: "All Items" },
      { id: "missing-cost", label: "Missing Cost" },
      { id: "missing-levels", label: "No Min / Max" },
      { id: "zero-opening", label: "Zero Opening" },
      { id: "below-min", label: "Below Min" },
      { id: "negative", label: "Negative" },
      { id: "zero", label: "Zero" },
      { id: "above-max", label: "Above Max" },
      { id: "healthy", label: "Healthy" },
    ],
    []
  );

  const filterCounts = useMemo(
    () => ({
      attention: searchedRows.filter(
        (row) => row.stockOnHand <= 0 || row.belowMinStock || row.aboveMaxStock
      ).length,
      all: searchedRows.length,
      "missing-cost": searchedRows.filter(
        (row) => row.unitCost === null || row.unitCost === undefined
      ).length,
      "missing-levels": searchedRows.filter(
        (row) => row.minStock === null && row.maxStock === null
      ).length,
      "zero-opening": searchedRows.filter((row) => Number(row.openingBalance) === 0).length,
      "below-min": searchedRows.filter((row) => row.belowMinStock).length,
      negative: searchedRows.filter((row) => row.stockOnHand < 0).length,
      zero: searchedRows.filter((row) => row.stockOnHand === 0).length,
      "above-max": searchedRows.filter((row) => row.aboveMaxStock).length,
      healthy: searchedRows.filter(
        (row) => row.stockOnHand > 0 && !row.belowMinStock && !row.aboveMaxStock
      ).length,
    }),
    [searchedRows]
  );

  const stockTableEmptyMessage = useMemo(() => {
    if (!rows.length) {
      return "No stock rows yet. Import opening balances or receive stock to start the stock sheet.";
    }

    if (deferredSearch || statusFilter !== "all") {
      return "No items match the current search or stock filter.";
    }

    return "No stock rows are available right now.";
  }, [deferredSearch, rows.length, statusFilter]);

  const fixableWarningSummary = useMemo(() => {
    const missingCostCount = visibleRows.filter(
      (row) => row.unitCost === null || row.unitCost === undefined
    ).length;
    const missingLevelsCount = visibleRows.filter(
      (row) => row.minStock === null && row.maxStock === null
    ).length;
    const zeroOpeningCount = visibleRows.filter(
      (row) => Number(row.openingBalance) === 0
    ).length;

    return {
      missingCostCount,
      missingLevelsCount,
      zeroOpeningCount,
      hasWarnings:
        missingCostCount > 0 || missingLevelsCount > 0 || zeroOpeningCount > 0,
    };
  }, [visibleRows]);

  const setupActionCards = useMemo(
    () => [
      {
        id: "missing-cost",
        title: "Add missing cost",
        count: fixableWarningSummary.missingCostCount,
        helper: "Needed for correct stock value and finance reports",
        tone: "warning",
      },
      {
        id: "missing-levels",
        title: "Set min and max",
        count: fixableWarningSummary.missingLevelsCount,
        helper: "Needed for early shortage and overstock warnings",
        tone: "info",
      },
      {
        id: "zero-opening",
        title: "Confirm opening balance",
        count: fixableWarningSummary.zeroOpeningCount,
        helper: "Needed where stock should not still be starting at zero",
        tone: "info",
      },
    ].filter((card) => card.count > 0),
    [fixableWarningSummary]
  );

  const editingItem = rows.find((row) => row.id === editingItemId) ?? null;

  useEffect(() => {
    if (editingItemId && !rows.some((row) => row.id === editingItemId)) {
      setEditingItemId("");
    }
  }, [editingItemId, rows]);

  useEffect(() => {
    if (editingItemId && !filteredRows.some((row) => row.id === editingItemId)) {
      setEditingItemId("");
    }
  }, [editingItemId, filteredRows]);

  useEffect(() => {
    setLevelForm(buildLevelForm(editingItem));
    setShowLevelErrors(false);
    setLevelErrors({});
  }, [
    editingItem?.id,
    editingItem?.openingBalance,
    editingItem?.minStock,
    editingItem?.maxStock,
  ]);

  useEffect(() => {
    if (!requestKey) return;
    setSearch(requestedSearch);
    setStatusFilter(requestedStatusFilter || "all");
    setEditingItemId("");
    setFeedback(null);
  }, [requestKey, requestedSearch, requestedStatusFilter]);

  const columns = [
    { key: "code", label: "Code" },
    { key: "name", label: "Item" },
    { key: "uom", label: "UOM" },
    {
      key: "openingBalance",
      label: "Opening",
      align: "right",
      render: (row) => formatNumber(row.openingBalance),
    },
    {
      key: "unitCost",
      label: "Unit Cost",
      align: "right",
      render: (row) => (row.unitCost === null ? "-" : formatNumber(row.unitCost)),
    },
    {
      key: "minStock",
      label: "Min",
      align: "right",
      render: (row) => (row.minStock === null ? "-" : formatNumber(row.minStock)),
    },
    {
      key: "maxStock",
      label: "Max",
      align: "right",
      render: (row) => (row.maxStock === null ? "-" : formatNumber(row.maxStock)),
    },
    { key: "inQty", label: "IN", align: "right", render: (row) => formatNumber(row.inQty) },
    { key: "outQty", label: "OUT", align: "right", render: (row) => formatNumber(row.outQty) },
    { key: "adjQty", label: "ADJ", align: "right", render: (row) => formatNumber(row.adjQty) },
    { key: "stockOnHand", label: "SOH", align: "right", render: (row) => formatNumber(row.stockOnHand) },
    {
      key: "stockValue",
      label: "Value",
      align: "right",
      render: (row) => (row.stockValue === null ? "-" : formatNumber(row.stockValue)),
    },
    { key: "lastMovementDate", label: "Last Move", render: (row) => formatDate(row.lastMovementDate) },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusPill
          tone={
            row.stockOnHand < 0
              ? "danger"
              : row.belowMinStock || row.stockOnHand === 0
                ? "warning"
                : row.aboveMaxStock
                  ? "info"
                  : "success"
          }
        >
          {row.stockOnHand < 0
            ? "Negative"
            : row.stockOnHand === 0
              ? "Zero"
              : row.belowMinStock
                ? "Below Min"
                : row.aboveMaxStock
                  ? "Above Max"
                  : "Healthy"}
        </StatusPill>
      ),
    },
  ];

  if (canEditLevels || canOpenAdjustment) {
    columns.push({
      key: "action",
      label: "",
      render: (row) => (
        <div className="inline-action">
          {canEditLevels ? (
            <button
              className="button button-secondary button-small"
              onClick={() => {
                setEditingItemId(row.id);
                setFeedback(null);
              }}
              type="button"
            >
              Edit Levels
            </button>
          ) : null}
          {canOpenAdjustment ? (
            <button
              className="button button-secondary button-small"
              onClick={() => handleOpenAdjustment(row)}
              type="button"
            >
              Adjustment
            </button>
          ) : null}
        </div>
      ),
    });
  }

  function handleExport() {
    downloadCsv("stock-on-hand.csv", [
      ["Code", "Item", "UOM", "Opening", "Unit Cost", "Min", "Max", "IN", "OUT", "ADJ", "SOH", "Value", "Last Move"],
      ...filteredRows.map((row) => [
        row.code,
        row.name,
        row.uom,
        row.openingBalance,
        row.unitCost ?? "",
        row.minStock ?? "",
        row.maxStock ?? "",
        row.inQty,
        row.outQty,
        row.adjQty,
        row.stockOnHand,
        row.stockValue ?? "",
        row.lastMovementDate,
      ]),
    ]);
  }

  async function handleSaveLevels() {
    if (!editingItem || !canEditLevels || !onSaveItem) return;

    const validation = validateItemForm(
      {
        code: editingItem.code,
        name: editingItem.name,
        uom: editingItem.uom,
        unitCost: editingItem.unitCost ?? "",
        isActive: editingItem.isActive,
        ...levelForm,
      },
      rows,
      editingItem.id
    );

    if (!validation.isValid) {
      setShowLevelErrors(true);
      setLevelErrors(validation.errors);
      setFeedback({
        tone: "danger",
        message: "Please fix the stock level fields before saving.",
      });
      return;
    }

    try {
      await onSaveItem(validation.normalizedItem, editingItem.id);
      setShowLevelErrors(false);
      setLevelErrors({});
      setFeedback({
        tone: "success",
        message: `${editingItem.name} levels updated successfully.`,
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "The stock levels could not be updated.",
      });
    }
  }

  function handleClearLimits() {
    setLevelForm((currentForm) => ({
      ...currentForm,
      minStock: "",
      maxStock: "",
    }));
  }

  function handleOpenAdjustment(item = null) {
    const targetItem = item ?? editingItem;
    if (!targetItem || !canOpenAdjustment || !onOpenEntryForItem) return;
    onOpenEntryForItem(targetItem.id, { type: "ADJ" });
  }

  function handleCloseEditor() {
    setEditingItemId("");
    setShowLevelErrors(false);
    setLevelErrors({});
    setFeedback(null);
  }

  function handleFocusSetupGroup(filterId) {
    setSearch("");
    setStatusFilter(filterId);
    setFeedback(null);

    if (filterId === "missing-cost") {
      setEditingItemId("");
      return;
    }

    const firstMatchingRow = visibleRows.find((row) => {
      if (filterId === "missing-levels") {
        return row.minStock === null && row.maxStock === null;
      }

      if (filterId === "zero-opening") {
        return Number(row.openingBalance) === 0;
      }

      return false;
    });

    setEditingItemId(firstMatchingRow?.id ?? "");
  }

  return (
    <section className="card">
      <div className="card-header card-header-spread">
        <h2>Item Ledger</h2>
        <div className="toolbar">
          <input
            className="input toolbar-search"
            placeholder="Search items"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className="button button-secondary" onClick={handleExport} type="button">
            Export CSV
          </button>
        </div>
      </div>

      {feedback ? (
        <DismissibleNotice tone={feedback.tone} onClose={() => setFeedback(null)}>
          {feedback.message}
        </DismissibleNotice>
      ) : null}

      {fixableWarningSummary.hasWarnings ? (
        <DismissibleNotice tone="warning">
          <strong>Setup warnings you can fix from the frontend.</strong>{" "}
          {fixableWarningSummary.missingCostCount
            ? `${formatNumber(fixableWarningSummary.missingCostCount)} item(s) have no unit cost. `
            : ""}
          {fixableWarningSummary.missingLevelsCount
            ? `${formatNumber(fixableWarningSummary.missingLevelsCount)} item(s) have no min/max levels. `
            : ""}
          {fixableWarningSummary.zeroOpeningCount
            ? `${formatNumber(fixableWarningSummary.zeroOpeningCount)} item(s) still show zero opening. `
            : ""}
          Use the filters below to isolate them, then edit levels here or update the full item record in Admin.
        </DismissibleNotice>
      ) : null}

      {setupActionCards.length ? (
        <div className="compact-action-strip">
          {setupActionCards.map((card) => (
            <button
              key={card.id}
              className={`compact-action-link compact-${card.tone}`}
              onClick={() => handleFocusSetupGroup(card.id)}
              type="button"
            >
              <span>{card.title}</span>
              <strong>{formatNumber(card.count)}</strong>
              <small>{card.helper}</small>
            </button>
          ))}
        </div>
      ) : null}

      <div className="pill-row stock-filter-row" aria-label="Stock filters">
        {filterOptions.map((option) => (
          <button
            key={option.id}
            className={`pill-button ${statusFilter === option.id ? "is-active" : ""}`}
            onClick={() => setStatusFilter(option.id)}
            type="button"
          >
            {option.label} {formatNumber(filterCounts[option.id] ?? 0)}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={filteredRows}
        rowKey={(row) => row.id}
        rowClassName={(row) => (row.id === editingItem?.id ? "row-selected" : "")}
        pageSize={20}
        resetKey={`${search}-${statusFilter}`}
        emptyMessage={stockTableEmptyMessage}
      />

      {canEditLevels && editingItem ? (
        <section className="quick-editor-card">
          <div className="card-header card-header-spread">
            <div>
              <h2>Edit Levels</h2>
              <div className="field-note">
                {editingItem.code} • {editingItem.name} [{editingItem.uom}]
              </div>
            </div>
            <div className="pill-row">
              <StatusPill tone={editingItem.stockOnHand < 0 ? "danger" : "info"}>
                SOH {formatNumber(editingItem.stockOnHand)}
              </StatusPill>
              <StatusPill tone="info">
                Cost {editingItem.unitCost === null ? "-" : formatNumber(editingItem.unitCost)}
              </StatusPill>
              <StatusPill tone="info">
                Value {editingItem.stockValue === null ? "-" : formatNumber(editingItem.stockValue)}
              </StatusPill>
              <StatusPill tone={editingItem.belowMinStock ? "warning" : "success"}>
                {editingItem.belowMinStock ? "Below Min" : "Min OK"}
              </StatusPill>
              <StatusPill tone={editingItem.aboveMaxStock ? "info" : "success"}>
                {editingItem.aboveMaxStock ? "Above Max" : "Max OK"}
              </StatusPill>
              <button
                className="button button-secondary button-small"
                onClick={handleCloseEditor}
                type="button"
              >
                Done
              </button>
            </div>
          </div>

          <div className="field-note">
            Last movement {formatDate(editingItem.lastMovementDate)}
          </div>

          <div className="stock-level-form-grid">
            <label className="field">
              <span>Opening Balance</span>
              <input
                className="input"
                min="0"
                step="0.01"
                type="number"
                value={levelForm.openingBalance}
                onChange={(event) =>
                  setLevelForm((currentForm) => ({
                    ...currentForm,
                    openingBalance: event.target.value,
                  }))
                }
              />
              {showLevelErrors && levelErrors.openingBalance ? (
                <small>{levelErrors.openingBalance}</small>
              ) : null}
            </label>

            <label className="field">
              <span>Minimum Stock</span>
              <input
                className="input"
                min="0"
                step="0.01"
                type="number"
                value={levelForm.minStock}
                onChange={(event) =>
                  setLevelForm((currentForm) => ({
                    ...currentForm,
                    minStock: event.target.value,
                  }))
                }
                placeholder="Optional"
              />
              {showLevelErrors && levelErrors.minStock ? (
                <small>{levelErrors.minStock}</small>
              ) : null}
            </label>

            <label className="field">
              <span>Maximum Stock</span>
              <input
                className="input"
                min="0"
                step="0.01"
                type="number"
                value={levelForm.maxStock}
                onChange={(event) =>
                  setLevelForm((currentForm) => ({
                    ...currentForm,
                    maxStock: event.target.value,
                  }))
                }
                placeholder="Optional"
              />
              {showLevelErrors && levelErrors.maxStock ? (
                <small>{levelErrors.maxStock}</small>
              ) : null}
            </label>
          </div>

          <div className="button-row">
            <button className="button" onClick={handleSaveLevels} type="button">
              Save Levels
            </button>
            {canOpenAdjustment ? (
              <button
                className="button button-secondary"
                onClick={() => handleOpenAdjustment(editingItem)}
                type="button"
              >
                Adjustment
              </button>
            ) : null}
            <button
              className="button button-secondary"
              onClick={handleClearLimits}
              type="button"
            >
              Clear Min / Max
            </button>
            <button
              className="button button-secondary"
              onClick={() => {
                setEditingItemId("");
                setFeedback(null);
              }}
              type="button"
            >
              Close
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
