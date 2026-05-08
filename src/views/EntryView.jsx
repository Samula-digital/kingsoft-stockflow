import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import DismissibleNotice from "../components/DismissibleNotice";
import StatusPill from "../components/StatusPill";
import { STANDARD_ITEM_CATEGORIES } from "../data/itemCategories";
import { openRequisitionPreview } from "../utils/export";
import { projectWeightedAverageCost } from "../utils/calculations";
import {
  formatDate,
  formatNumber,
  formatRequisitionNumber,
  getTodayDateValue,
  normalizeSearchValue,
  searchItemRecords,
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

export default function EntryView({
  form,
  editingMovementId = "",
  hotelName = "",
  productName = "",
  brandLogoUrl = "",
  brandAccentColor = "",
  brandSidebarColor = "",
  currentUserName = "",
  errors,
  showErrors,
  feedback,
  warnings,
  departments,
  items,
  currentItem,
  currentSummary,
  projectedStock,
  nextRequisitionNumber,
  recentItems = [],
  requisitionPageOptions = [],
  currentRequisitionLines = [],
  onFieldChange,
  onTypeChange,
  onReset,
  onSubmit,
  onCreateItem,
  canCreateItems = false,
  nextItemCode = "",
  onEditCurrentLine,
  onDeleteCurrentLine,
  onOpenHistory,
  onOpenFinance,
}) {
  function buildQuickCreateForm() {
    return {
      code: nextItemCode || "",
      name: "",
      category: "",
      uom: "",
      openingBalance: 0,
      unitCost: "",
      sellingPrice: "",
      minStock: "",
      maxStock: "",
      isActive: true,
    };
  }

  function formatItemLabel(item) {
    if (!item) return "";
    return `${item.code} • ${item.name} [${formatItemUom(item)}]`;
  }

  function renderFieldLabel(label, isRequired = true) {
    return (
      <>
        {label}
        {isRequired ? <span className="required-mark"> *</span> : null}
      </>
    );
  }

  function formatItemUom(item) {
    return String(item?.uom ?? "").trim() || "each";
  }

  const movementMeta = {
    IN: {
      departmentLabel: "Receive Into",
      quantityLabel: "Quantity",
      referenceLabel: "Reference",
      actionLabel: "Save Receipt",
      actionHint: "Add the received stock into the selected store item.",
      referencePlaceholder: "Invoice, delivery note, or receiving reference",
      notesPlaceholder: "Optional note for supplier, delivery, or return details",
    },
    OUT: {
      departmentLabel: "Issue To",
      quantityLabel: "Quantity",
      referenceLabel: "Requisition",
      actionLabel: "Save Issue",
      actionHint: "Save this item line under the department requisition page.",
      referencePlaceholder: "Enter the page number from the department requisition book",
      notesPlaceholder: "Optional note for request purpose, event, or usage details",
    },
    ADJ: {
      departmentLabel: "Adjust In",
      quantityLabel: "Quantity",
      referenceLabel: "Reference",
      actionLabel: "Save Adjustment",
      actionHint: "Apply the stock adjustment to the selected item.",
      referencePlaceholder: "Stock count note, approval, or adjustment reference",
      notesPlaceholder: "Explain the reason for the adjustment or variance found",
    },
  }[form.type];

  const movementTypes = [
    { id: "IN", label: "Receive" },
    { id: "OUT", label: "Issue" },
    { id: "ADJ", label: "Adjust" },
  ];

  const [itemSearch, setItemSearch] = useState("");
  const [showFeedbackNotice, setShowFeedbackNotice] = useState(true);
  const [showWarningNotice, setShowWarningNotice] = useState(true);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [isItemPickerOpen, setIsItemPickerOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickCreateForm, setQuickCreateForm] = useState(() => buildQuickCreateForm());
  const [quickCreateError, setQuickCreateError] = useState("");
  const [quickCreateBusy, setQuickCreateBusy] = useState(false);
  const itemSearchRef = useRef(null);
  const quantityInputRef = useRef(null);
  const previousItemIdRef = useRef(form.itemId);
  const keepSearchTextOnDeselectRef = useRef(false);
  const deferredSearch = useDeferredValue(itemSearch);

  useEffect(() => {
    setShowFeedbackNotice(true);
  }, [feedback?.message, feedback?.tone]);

  useEffect(() => {
    setShowWarningNotice(true);
  }, [warnings[0]]);

  useEffect(() => {
    if (form.notes) {
      setShowMoreOptions(true);
    }
  }, [form.notes]);

  useEffect(() => {
    itemSearchRef.current?.focus();
  }, []);

  useEffect(() => {
    setQuickCreateForm((currentForm) => ({
      ...currentForm,
      code: currentForm.code || nextItemCode || "",
    }));
  }, [nextItemCode]);

  useEffect(() => {
    const previousItemId = previousItemIdRef.current;

    if (form.itemId && form.itemId !== previousItemId && currentItem) {
      setItemSearch(formatItemLabel(currentItem));
      setIsItemPickerOpen(false);
      setActiveSuggestionIndex(0);
      quantityInputRef.current?.focus();
      quantityInputRef.current?.select?.();
    }

    if (!form.itemId && previousItemId) {
      if (keepSearchTextOnDeselectRef.current) {
        keepSearchTextOnDeselectRef.current = false;
      } else {
        setItemSearch("");
      }

      setIsItemPickerOpen(true);
      itemSearchRef.current?.focus();
    }

    previousItemIdRef.current = form.itemId;
  }, [currentItem, form.itemId]);

  const filteredItems = useMemo(
    () => searchItemRecords(items, deferredSearch),
    [deferredSearch, items]
  );

  const quickMatches = useMemo(
    () => searchItemRecords(items, deferredSearch, { limit: 6 }),
    [deferredSearch, items]
  );

  const matchingItemCount = filteredItems.length;
  const searchHasValue = Boolean(normalizeSearchValue(itemSearch));
  const canOfferQuickCreate =
    canCreateItems && searchHasValue && !matchingItemCount && !currentItem;
  const hasMinStock = currentItem?.minStock !== null && currentItem?.minStock !== undefined;
  const hasMaxStock = currentItem?.maxStock !== null && currentItem?.maxStock !== undefined;
  const currentAverageUnitCost =
    currentSummary.unitCost === null || currentSummary.unitCost === undefined
      ? null
      : Number(currentSummary.unitCost);
  const lastPurchaseCost =
    currentSummary.lastPurchaseCost === null || currentSummary.lastPurchaseCost === undefined
      ? null
      : Number(currentSummary.lastPurchaseCost);
  const receiptUnitCost =
    String(form.unitCost ?? "").trim() === "" ? null : Number(form.unitCost);
  const hasReceiptUnitCost =
    receiptUnitCost !== null && Number.isFinite(receiptUnitCost) && receiptUnitCost >= 0;
  const projectedAverageUnitCost =
    form.type === "IN"
      ? projectWeightedAverageCost(
          currentSummary.stockOnHand,
          currentAverageUnitCost,
          form.quantity,
          hasReceiptUnitCost ? receiptUnitCost : null
        )
      : currentAverageUnitCost;
  const availableIssueQty = Math.max(0, Number(currentSummary.stockOnHand) || 0);
  const quantityValue = Number(form.quantity);
  const limitsByAvailableStock =
    form.type === "OUT" ||
    (form.type === "ADJ" && form.adjustmentMode === "DECREASE");
  const quantityExceedsAvailable =
    limitsByAvailableStock &&
    currentItem &&
    Number.isFinite(quantityValue) &&
    quantityValue > availableIssueQty;
  const projectedBelowMin = hasMinStock && projectedStock < Number(currentItem.minStock);
  const projectedAboveMax = hasMaxStock && projectedStock > Number(currentItem.maxStock);
  const documentValue = form.type === "OUT" ? form.requisitionNumber : form.referenceNumber;
  const documentError =
    form.type === "OUT" ? errors.requisitionNumber : errors.referenceNumber;
  const selectedItemLabel = currentItem ? formatItemLabel(currentItem) : "";
  const activeCurrentRequisitionLines = currentRequisitionLines.filter((line) => !line.isDeleted);
  const deletedCurrentRequisitionLines = currentRequisitionLines.filter((line) => line.isDeleted);
  const currentRequisitionQuantityEntries = buildQuantityEntries(
    activeCurrentRequisitionLines,
    (line) => line.itemUom,
    (line) => line.quantity
  );
  const projectedStatus = currentItem
    ? projectedStock < 0
      ? {
          tone: "warning",
          label: limitsByAvailableStock ? "Above available stock" : "After save negative",
        }
      : projectedBelowMin
        ? { tone: "warning", label: "After save below min" }
        : projectedAboveMax
          ? { tone: "info", label: "After save above max" }
          : { tone: "success", label: "After save OK" }
    : null;
  const currentStatus = currentItem
    ? currentSummary.stockOnHand < 0
      ? { tone: "danger", label: "Current negative" }
      : currentSummary.stockOnHand === 0
        ? { tone: "warning", label: "Current zero" }
        : null
    : null;
  const itemSuggestions = searchHasValue
    ? quickMatches
    : recentItems.length
      ? recentItems
      : items.slice(0, 6);
  const quickQuantityOptions = useMemo(() => {
    if (!currentItem) return [];

    const baseOptions = [1, 2, 5, 10];
    const scopedOptions = limitsByAvailableStock
      ? baseOptions.filter((value) => value <= availableIssueQty)
      : baseOptions;

    if (
      limitsByAvailableStock &&
      availableIssueQty > 0 &&
      !scopedOptions.some((value) => value === availableIssueQty)
    ) {
      scopedOptions.push(availableIssueQty);
    }

    return Array.from(new Set(scopedOptions)).sort((left, right) => left - right);
  }, [availableIssueQty, currentItem, limitsByAvailableStock]);
  const quantityShortcutHint =
    form.type === "OUT"
      ? "Press Enter in quantity to add the line quickly."
      : "Press Enter in quantity to save the movement quickly.";

  function handleQuantityShortcut(value) {
    onFieldChange("quantity", String(value));
    quantityInputRef.current?.focus();
    quantityInputRef.current?.select?.();
  }

  function handleQuantityKeyDown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onSubmit?.();
  }

  function handleResetLine() {
    setItemSearch("");
    setIsItemPickerOpen(false);
    setActiveSuggestionIndex(0);
    onReset();
  }

  function handleStartNextIssuePage() {
    if (form.type !== "OUT") return;

    setItemSearch("");
    setIsItemPickerOpen(false);
    setActiveSuggestionIndex(0);
    onFieldChange("requisitionNumber", formatRequisitionNumber(nextRequisitionNumber));
    onFieldChange("itemId", "");
    onFieldChange("quantity", "");
    onFieldChange("notes", "");
    itemSearchRef.current?.focus();
  }

  function handlePreviewRequisition() {
    if (form.type !== "OUT") return;

    const departmentName =
      departments.find((department) => department.id === form.departmentId)?.name || "";

    openRequisitionPreview({
      companyName: hotelName,
      systemName: productName,
      logoSrc: brandLogoUrl,
      accentColor: brandAccentColor,
      sidebarColor: brandSidebarColor,
      preparedBy: currentUserName || form.enteredBy || "",
      pageNumber: documentValue,
      movementDate: form.date,
      departmentName,
      lines: activeCurrentRequisitionLines,
    });
  }

  function handleFeedbackAction(actionId) {
    if (actionId === "preview_requisition") {
      handlePreviewRequisition();
      return;
    }

    if (actionId === "next_issue_page") {
      handleStartNextIssuePage();
      return;
    }

    if (actionId === "open_history") {
      onOpenHistory?.();
      return;
    }

    if (actionId === "open_finance") {
      onOpenFinance?.();
    }
  }

  const feedbackActions = useMemo(
    () =>
      (feedback?.actions ?? []).map((action) => ({
        ...action,
        onClick: () => handleFeedbackAction(action.id),
      })),
    [feedback?.actions, onOpenFinance, onOpenHistory]
  );

  function handleItemSearchChange(value) {
    setItemSearch(value);
    setIsItemPickerOpen(true);
    setActiveSuggestionIndex(0);

    if (currentItem && value !== selectedItemLabel) {
      keepSearchTextOnDeselectRef.current = true;
      onFieldChange("itemId", "");
    }
  }

  function handleItemSelection(item) {
    keepSearchTextOnDeselectRef.current = false;
    setItemSearch(formatItemLabel(item));
    setIsItemPickerOpen(false);
    setActiveSuggestionIndex(0);
    setShowQuickCreate(false);
    setQuickCreateError("");
    onFieldChange("itemId", item.id);
  }

  function handleStartQuickCreate() {
    setShowQuickCreate(true);
    setQuickCreateError("");
    setQuickCreateForm((currentForm) => ({
      ...buildQuickCreateForm(),
      code: nextItemCode || currentForm.code || "",
      name: itemSearch.trim(),
      category: currentForm.category,
      uom: currentForm.uom,
      openingBalance: currentForm.openingBalance,
      unitCost: currentForm.unitCost,
      sellingPrice: currentForm.sellingPrice,
      minStock: currentForm.minStock,
      maxStock: currentForm.maxStock,
      isActive: true,
    }));
  }

  async function handleCreateItemFromEntry() {
    if (!onCreateItem || quickCreateBusy) return;

    setQuickCreateBusy(true);
    setQuickCreateError("");

    try {
      const savedItem = await onCreateItem({
        ...quickCreateForm,
        code: quickCreateForm.code || nextItemCode || "",
        name: quickCreateForm.name || itemSearch.trim(),
      });
      handleItemSelection(savedItem);
    } catch (error) {
      setQuickCreateError(
        error instanceof Error ? error.message : "The new item could not be created."
      );
    } finally {
      setQuickCreateBusy(false);
    }
  }

  function handleItemSearchFocus(event) {
    setIsItemPickerOpen(true);

    if (currentItem && itemSearch === selectedItemLabel) {
      event.target.select();
    }
  }

  function handleItemSearchBlur() {
    setTimeout(() => {
      setIsItemPickerOpen(false);
    }, 120);
  }

  function handleItemSearchKeyDown(event) {
    if (!itemSuggestions.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsItemPickerOpen(true);
      setActiveSuggestionIndex((currentIndex) =>
        Math.min(currentIndex + 1, itemSuggestions.length - 1)
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((currentIndex) => Math.max(currentIndex - 1, 0));
      return;
    }

    if (event.key === "Enter" && isItemPickerOpen) {
      event.preventDefault();
      handleItemSelection(itemSuggestions[activeSuggestionIndex] ?? itemSuggestions[0]);
      return;
    }

    if (event.key === "Escape") {
      setIsItemPickerOpen(false);
    }
  }

  const isEditingCurrentLine = Boolean(editingMovementId);
  const submitLabel =
    form.type === "OUT" && isEditingCurrentLine ? "Update Issue" : movementMeta.actionLabel;
  const lineSubmitLabel = submitLabel;
  const clearLabel =
    form.type === "OUT" && isEditingCurrentLine ? "Cancel Edit" : form.type === "OUT" ? "Clear Line" : "Clear";
  const actionHint =
    form.type === "OUT" && documentValue
      ? `Saves the selected item under requisition page ${documentValue}.`
      : movementMeta.actionHint;
  const pageRequiredFieldStatus = [
    { label: "date", isReady: Boolean(form.date) },
    { label: movementMeta.departmentLabel.toLowerCase(), isReady: Boolean(form.departmentId) },
    {
      label: form.type === "OUT" ? "requisition page" : "reference",
      isReady: Boolean(String(documentValue ?? "").trim()),
    },
  ];
  const lineRequiredFieldStatus = [
    { label: "item", isReady: Boolean(form.itemId) },
    {
      label: "quantity",
      isReady: Boolean(String(form.quantity ?? "").trim()) && Number(form.quantity) > 0,
    },
    ...(form.type === "ADJ"
      ? [{ label: "direction", isReady: Boolean(form.adjustmentMode) }]
      : []),
  ];
  const missingRequiredFields = [...pageRequiredFieldStatus, ...lineRequiredFieldStatus]
    .filter((field) => !field.isReady)
    .map((field) => field.label);
  const missingPageFields = pageRequiredFieldStatus
    .filter((field) => !field.isReady)
    .map((field) => field.label);
  const missingLineFields = lineRequiredFieldStatus
    .filter((field) => !field.isReady)
    .map((field) => field.label);
  const readinessTone = quantityExceedsAvailable || missingRequiredFields.length ? "warning" : "success";
  const readinessTitle =
    form.type === "OUT"
      ? documentValue
        ? `Issue page ${documentValue} is open`
        : "Start with the issue header"
      : form.type === "IN"
        ? "Receipt is ready to review"
        : "Adjustment is ready to review";
  const readinessCopy = quantityExceedsAvailable
    ? `Above available stock for ${currentItem?.name || "this item"}.`
    : form.type === "OUT" && missingPageFields.length
      ? `Missing: ${missingPageFields.join(", ")}.`
      : form.type === "OUT" && missingLineFields.length
        ? `Add line: ${missingLineFields.join(", ")}.`
        : missingRequiredFields.length
          ? `Missing: ${missingRequiredFields.join(", ")}.`
          : form.type === "OUT"
            ? "Add items. Move page only when the paper page changes."
            : "Ready. Review once, then save.";
  const issueWorkspaceTitle =
    form.type === "OUT"
      ? documentValue
        ? `Issue page ${documentValue}`
        : "Issue stock"
      : "Store Desk";
  const signedInUserLabel = form.enteredBy || "Signed-in user";
  const moreOptionsLabel = showMoreOptions
    ? "Hide Note & Totals"
    : form.notes
      ? "Show Note & Totals"
      : "Add Note";
  const formattedNextRequisitionNumber = formatRequisitionNumber(nextRequisitionNumber);
  const issuePageActionLabel =
    documentValue && String(documentValue) !== String(formattedNextRequisitionNumber)
      ? `Move To Next Page (${formattedNextRequisitionNumber})`
      : `Use Next Page (${formattedNextRequisitionNumber})`;
  const movementGuideSteps =
    form.type === "OUT"
      ? [
          {
            title: "1. Page",
            detail: "Date, department, book page.",
          },
          {
            title: "2. Line",
            detail: "Item and quantity.",
          },
          {
            title: "3. Preview",
            detail: "Confirm before next page.",
          },
        ]
      : form.type === "IN"
        ? [
            {
              title: "1. Item",
              detail: "Store and item.",
            },
            {
              title: "2. Qty / cost",
              detail: "Actual received values.",
            },
            {
              title: "3. Save",
              detail: "Cost updates after save.",
            },
          ]
        : [
            {
              title: "1. Item",
              detail: "Item to correct.",
            },
            {
              title: "2. Direction",
              detail: "Add or reduce.",
            },
            {
              title: "3. Reason",
              detail: "Short audit note.",
            },
          ];
  const issueCurrentPageSummary = documentValue
    ? `${activeCurrentRequisitionLines.length} active line(s) • Qty by UOM ${formatQuantityEntries(
        currentRequisitionQuantityEntries
      )}`
    : "No requisition page selected yet.";

  const pageStatusPills = form.type === "OUT"
    ? [
        documentValue ? { tone: "neutral", label: `Page ${documentValue}` } : null,
        { tone: "info", label: `${activeCurrentRequisitionLines.length} active line(s)` },
        deletedCurrentRequisitionLines.length
          ? { tone: "warning", label: `${deletedCurrentRequisitionLines.length} deleted line(s)` }
          : null,
      ].filter(Boolean)
    : [];

  const alternativeRequisitionPages = requisitionPageOptions.filter(
    (page) => String(page.requisitionNumber) !== String(documentValue)
  );

  const dateField = (
    <label className={`field ${showErrors && errors.date ? "is-invalid" : ""}`}>
      <span>{renderFieldLabel("Date")}</span>
      <input
        className={`input ${showErrors && errors.date ? "is-invalid" : ""}`}
        type="date"
        aria-invalid={showErrors && errors.date ? "true" : "false"}
        value={form.date}
        onChange={(event) => onFieldChange("date", event.target.value)}
      />
      {showErrors && errors.date ? <small>{errors.date}</small> : null}
    </label>
  );

  const departmentField = (
    <label className={`field ${showErrors && errors.departmentId ? "is-invalid" : ""}`}>
      <span>{renderFieldLabel(movementMeta.departmentLabel)}</span>
      <select
        className={`input ${showErrors && errors.departmentId ? "is-invalid" : ""}`}
        aria-invalid={showErrors && errors.departmentId ? "true" : "false"}
        value={form.departmentId}
        onChange={(event) => onFieldChange("departmentId", event.target.value)}
      >
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
          </option>
        ))}
      </select>
      {showErrors && errors.departmentId ? <small>{errors.departmentId}</small> : null}
    </label>
  );

  const itemField = (
    <label className={`field ${showErrors && errors.itemId ? "is-invalid" : ""}`}>
      <span>{renderFieldLabel("Item")}</span>
      <div className="item-picker-field">
        <input
          ref={itemSearchRef}
          className={`input ${showErrors && errors.itemId ? "is-invalid" : ""}`}
          aria-invalid={showErrors && errors.itemId ? "true" : "false"}
          value={itemSearch}
          onBlur={handleItemSearchBlur}
          onChange={(event) => handleItemSearchChange(event.target.value)}
          onFocus={handleItemSearchFocus}
          onKeyDown={handleItemSearchKeyDown}
          placeholder="Type item code, name, or UOM"
          aria-expanded={isItemPickerOpen}
          aria-label="Search and select item"
        />
        {isItemPickerOpen ? (
          <div className="item-picker-panel">
            {itemSuggestions.length ? (
              itemSuggestions.map((item, index) => (
                <button
                  key={item.id}
                  className={`item-picker-option ${
                    form.itemId === item.id ? "is-active" : ""
                  } ${activeSuggestionIndex === index ? "is-highlighted" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    handleItemSelection(item);
                  }}
                  type="button"
                >
                  <strong>{item.name}</strong>
                  <span>
                    {item.code} • {formatItemUom(item)}
                  </span>
                </button>
              ))
            ) : (
              <div className="item-picker-empty">
                No matching items found. Keep typing another code or name.
              </div>
            )}
          </div>
        ) : null}
      </div>
      {showErrors && errors.itemId ? <small>{errors.itemId}</small> : null}
      <div className="field-action-row">
        <div className="field-note">
          {currentItem
            ? `${currentItem.code} selected.`
            : searchHasValue
              ? `${formatNumber(matchingItemCount)} matching item(s). Press Enter to select the top match.`
              : "Type and select the item in this same field."}
        </div>
        {currentItem || searchHasValue || String(form.quantity ?? "").trim() || String(form.notes ?? "").trim() ? (
          <button
            className="button button-secondary button-small"
            onClick={handleResetLine}
            type="button"
          >
            Clear Line
          </button>
        ) : null}
      </div>
      {canOfferQuickCreate ? (
        <div className="detail-block detail-block-compact movement-inline-create">
          <strong>{showQuickCreate ? "Add this as a new stock item" : "No matching item yet"}</strong>
          <p>
            {showQuickCreate
              ? "Create the item once here, then continue with this same movement."
              : `“${itemSearch.trim()}” is not in the item list yet. You can create it here without leaving the movement page.`}
          </p>
          <div className="field-note">
            Storekeeper can add a missing new item here. Only admin can edit, deactivate, or clean up existing item records later.
          </div>
          {!showQuickCreate ? (
            <button
              className="button button-secondary button-small"
              onClick={handleStartQuickCreate}
              type="button"
            >
              Create New Item
            </button>
          ) : (
            <div className="view-stack">
              <div className="movement-inline-create-grid">
                <label className="field">
                  <span>Item code</span>
                  <input
                    className="input"
                    value={quickCreateForm.code}
                    onChange={(event) =>
                      setQuickCreateForm((currentForm) => ({
                        ...currentForm,
                        code: event.target.value,
                      }))
                    }
                    placeholder="Auto-generated code"
                  />
                </label>
                <label className="field">
                  <span>Item name</span>
                  <input
                    className="input"
                    value={quickCreateForm.name}
                    onChange={(event) =>
                      setQuickCreateForm((currentForm) => ({
                        ...currentForm,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Enter the stock item name"
                  />
                </label>
                <label className="field">
                  <span>Category</span>
                  <input
                    className="input"
                    list="entry-item-category-options"
                    value={quickCreateForm.category}
                    onChange={(event) =>
                      setQuickCreateForm((currentForm) => ({
                        ...currentForm,
                        category: event.target.value,
                      }))
                    }
                    placeholder="e.g. Beverages, Housekeeping, Food"
                  />
                </label>
                <label className="field">
                  <span>UOM</span>
                  <input
                    className="input"
                    value={quickCreateForm.uom}
                    onChange={(event) =>
                      setQuickCreateForm((currentForm) => ({
                        ...currentForm,
                        uom: event.target.value,
                      }))
                    }
                    placeholder="PCS, KGS, BTL, PKT"
                  />
                </label>
                <label className="field">
                  <span>Opening balance</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={quickCreateForm.openingBalance}
                    onChange={(event) =>
                      setQuickCreateForm((currentForm) => ({
                        ...currentForm,
                        openingBalance: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Unit cost</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={quickCreateForm.unitCost}
                    onChange={(event) =>
                      setQuickCreateForm((currentForm) => ({
                        ...currentForm,
                        unitCost: event.target.value,
                      }))
                    }
                    placeholder="Optional"
                  />
                </label>
              </div>
              <datalist id="entry-item-category-options">
                {STANDARD_ITEM_CATEGORIES.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
              {quickCreateError ? <div className="field-note danger-text">{quickCreateError}</div> : null}
              <div className="button-row">
                <button
                  className="button button-small"
                  onClick={() => void handleCreateItemFromEntry()}
                  disabled={quickCreateBusy}
                  type="button"
                >
                  {quickCreateBusy ? "Creating Item..." : "Create And Use Item"}
                </button>
                <button
                  className="button button-secondary button-small"
                  onClick={() => {
                    setShowQuickCreate(false);
                    setQuickCreateError("");
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </label>
  );

  const currentItemSummary = currentItem ? (
    <div className="detail-block movement-summary-strip">
      <div className="movement-summary-meta">
        <strong>{currentItem.name}</strong>
        <span>
          {currentItem.code} • {formatItemUom(currentItem)}
          {!currentItem.uom ? " (UOM missing)" : ""}
        </span>
      </div>
      <div className="movement-summary-stat">
        <span>Current</span>
        <strong>{formatNumber(currentSummary.stockOnHand)}</strong>
      </div>
      <div className="movement-summary-stat">
        <span>After Save</span>
        <strong>{formatNumber(projectedStock)}</strong>
      </div>
      <div className="movement-summary-pills">
        {currentStatus ? (
          <StatusPill tone={currentStatus.tone}>{currentStatus.label}</StatusPill>
        ) : null}
        {projectedStatus ? (
          <StatusPill tone={projectedStatus.tone}>{projectedStatus.label}</StatusPill>
        ) : null}
        {currentSummary.lastMovementDate ? (
          <StatusPill tone="neutral">
            Last move {formatDate(currentSummary.lastMovementDate)}
          </StatusPill>
        ) : null}
      </div>
    </div>
  ) : null;

  const quantityField = (
    <label className={`field ${showErrors && errors.quantity ? "is-invalid" : ""}`}>
      <span>{renderFieldLabel(movementMeta.quantityLabel)}</span>
      <input
        ref={quantityInputRef}
        className={`input ${showErrors && errors.quantity ? "is-invalid" : ""}`}
        type="number"
        min="0"
        step="0.01"
        aria-invalid={showErrors && errors.quantity ? "true" : "false"}
        value={form.quantity}
        onChange={(event) => onFieldChange("quantity", event.target.value)}
        onKeyDown={handleQuantityKeyDown}
        placeholder="Enter quantity"
      />
      <div className="field-note">{quantityShortcutHint}</div>
      {currentItem ? (
        <div className="quantity-shortcut-row">
          {quickQuantityOptions.map((value) => (
            <button
              key={`${currentItem.id}-${value}`}
              className="button button-secondary button-small"
              onClick={() => handleQuantityShortcut(value)}
              type="button"
            >
              {formatNumber(value)}
            </button>
          ))}
          {limitsByAvailableStock && availableIssueQty > 0 && quantityExceedsAvailable ? (
            <button
              className="button button-secondary button-small"
              onClick={() => handleQuantityShortcut(availableIssueQty)}
              type="button"
            >
              Use Available
            </button>
          ) : null}
        </div>
      ) : null}
      {limitsByAvailableStock && currentItem ? (
        <div className="field-action-row">
          <div className="field-note">
            {availableIssueQty > 0
              ? `Available now: ${formatNumber(availableIssueQty)} ${formatItemUom(currentItem)}`
              : "No stock available right now."}
          </div>
        </div>
      ) : null}
      {showErrors && errors.quantity ? <small>{errors.quantity}</small> : null}
    </label>
  );

  const documentField = (
    <label className={`field ${showErrors && documentError ? "is-invalid" : ""}`}>
      <span>{renderFieldLabel(movementMeta.referenceLabel)}</span>
      {form.type === "OUT" ? (
        <>
          <input
            className={`input ${showErrors && documentError ? "is-invalid" : ""}`}
            aria-invalid={showErrors && documentError ? "true" : "false"}
            value={documentValue}
            onChange={(event) => onFieldChange("requisitionNumber", event.target.value)}
            placeholder={movementMeta.referencePlaceholder}
          />
        </>
      ) : (
        <input
          className={`input ${showErrors && documentError ? "is-invalid" : ""}`}
          aria-invalid={showErrors && documentError ? "true" : "false"}
          value={documentValue}
          onChange={(event) => onFieldChange("referenceNumber", event.target.value)}
          placeholder={movementMeta.referencePlaceholder}
        />
      )}
      {showErrors && documentError ? <small>{documentError}</small> : null}
      {form.type === "OUT" ? (
        <div className="field-note">
          Use the page number from the paper requisition book.
        </div>
      ) : null}
    </label>
  );

  const receiptUnitCostField =
    form.type === "IN" ? (
      <label className={`field ${showErrors && errors.unitCost ? "is-invalid" : ""}`}>
        <span>Received Unit Cost</span>
        <input
          className={`input ${showErrors && errors.unitCost ? "is-invalid" : ""}`}
          type="number"
          min="0"
          step="0.01"
          aria-invalid={showErrors && errors.unitCost ? "true" : "false"}
          value={form.unitCost ?? ""}
          onChange={(event) => onFieldChange("unitCost", event.target.value)}
          placeholder="Enter the cost for this receipt line"
        />
        {showErrors && errors.unitCost ? <small>{errors.unitCost}</small> : null}
        <div className="field-note">
          Use the actual purchase cost for this receipt. The system will update the running
          average cost for future stock value and issue reports.
        </div>
      </label>
    ) : null;

  const receiptCostSummary =
    form.type === "IN" && currentItem ? (
      <div className="detail-block">
        <strong>Receipt Costing</strong>
        <div className="summary-grid">
          <div>
            <span>Current Avg Cost</span>
            <strong>{currentAverageUnitCost === null ? "-" : formatNumber(currentAverageUnitCost)}</strong>
          </div>
          <div>
            <span>Last Receipt Cost</span>
            <strong>{lastPurchaseCost === null ? "-" : formatNumber(lastPurchaseCost)}</strong>
          </div>
          <div>
            <span>This Receipt Cost</span>
            <strong>{hasReceiptUnitCost ? formatNumber(receiptUnitCost) : "-"}</strong>
          </div>
          <div>
            <span>New Avg After Save</span>
            <strong>
              {projectedAverageUnitCost === null ? "-" : formatNumber(projectedAverageUnitCost)}
            </strong>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className="view-stack">
      <section className="card movement-desk-card">
        <div className="card-header card-header-spread">
          <h2>{issueWorkspaceTitle}</h2>
          <div className="movement-header-actions">
            <StatusPill tone="info">Work date {formatDate(form.date || getTodayDateValue())}</StatusPill>
            <StatusPill tone="neutral">Recorded as {signedInUserLabel}</StatusPill>
            <StatusPill tone={readinessTone}>
              {missingRequiredFields.length || quantityExceedsAvailable ? "Needs review" : "Ready"}
            </StatusPill>
            {pageStatusPills.map((pill) => (
              <StatusPill key={pill.label} tone={pill.tone}>
                {pill.label}
              </StatusPill>
            ))}
            {form.type !== "OUT" ? (
              <button className="button button-small" onClick={onSubmit} type="button">
                {submitLabel}
              </button>
            ) : null}
          </div>
        </div>

        <div className="field-note">* required</div>

        <div className="detail-block detail-block-compact movement-flow-card">
          <strong>Flow</strong>
          <div className="compact-action-strip">
            {movementGuideSteps.map((step) => (
              <div key={step.title} className="compact-action-link compact-info">
                <span>{step.title}</span>
                <small>{step.detail}</small>
              </div>
            ))}
          </div>
        </div>

        {feedback && showFeedbackNotice ? (
          <DismissibleNotice
            tone={feedback.tone}
            actions={feedbackActions}
            onClose={() => setShowFeedbackNotice(false)}
          >
            {feedback.message}
          </DismissibleNotice>
        ) : null}

        {!!warnings.length && !feedback && showWarningNotice ? (
          <DismissibleNotice tone="warning" onClose={() => setShowWarningNotice(false)}>
            {warnings[0]}
          </DismissibleNotice>
        ) : null}

        <div className="detail-block movement-readiness-card">
          <div className="movement-readiness-header">
            <div className="movement-readiness-copy">
              <strong>{readinessTitle}</strong>
              <span>{readinessCopy}</span>
            </div>
            <div className="movement-readiness-pills">
              <StatusPill tone={readinessTone}>
                {missingRequiredFields.length || quantityExceedsAvailable
                  ? "Check before save"
                  : "Ready to save"}
              </StatusPill>
              {documentValue ? <StatusPill tone="neutral">{documentValue}</StatusPill> : null}
            </div>
          </div>
        </div>

        <div className="movement-toolbar-row">
          <div className="field movement-mode-field">
            <span>Type</span>
            <div className="segmented-control">
              {movementTypes.map((typeOption) => (
                <button
                  key={typeOption.id}
                  className={form.type === typeOption.id ? "is-active" : ""}
                  onClick={() => onTypeChange(typeOption.id)}
                  type="button"
                >
                  {typeOption.label}
                </button>
              ))}
            </div>
          </div>

          {form.type === "ADJ" ? (
            <div className={`field movement-mode-field ${showErrors && errors.adjustmentMode ? "is-invalid" : ""}`}>
              <span>{renderFieldLabel("Direction")}</span>
              <div className={`segmented-control ${showErrors && errors.adjustmentMode ? "is-invalid" : ""}`}>
                <button
                  className={form.adjustmentMode === "INCREASE" ? "is-active" : ""}
                  onClick={() => onFieldChange("adjustmentMode", "INCREASE")}
                  type="button"
                >
                  Add stock
                </button>
                <button
                  className={form.adjustmentMode === "DECREASE" ? "is-active" : ""}
                  onClick={() => onFieldChange("adjustmentMode", "DECREASE")}
                  type="button"
                >
                  Reduce stock
                </button>
              </div>
              {showErrors && errors.adjustmentMode ? <small>{errors.adjustmentMode}</small> : null}
            </div>
          ) : null}
        </div>

        {form.type === "OUT" ? (
          <div className="view-stack">
            <div className="detail-block movement-group-card">
              <div className="movement-group-header">
                <strong>Issue Header</strong>
                <span>Set the department book page first, then keep adding items under it.</span>
              </div>
              <div className="movement-document-grid">
                {dateField}
                {departmentField}
                {documentField}
              </div>
              <div className="movement-page-tools">
                <div className="button-row">
                  <button
                    className="button button-secondary button-small"
                    onClick={handleStartNextIssuePage}
                    type="button"
                  >
                    {issuePageActionLabel}
                  </button>
                  <button
                    className="button button-secondary button-small"
                    onClick={handlePreviewRequisition}
                    type="button"
                    disabled={!documentValue || !activeCurrentRequisitionLines.length}
                  >
                    Preview Requisition
                  </button>
                </div>
                {alternativeRequisitionPages.length ? (
                  <div className="movement-page-options">
                    <span className="field-note">Continue another page already used today:</span>
                    <div className="pill-row">
                      {alternativeRequisitionPages.slice(0, 6).map((page) => (
                        <button
                          key={page.id}
                          className="button button-secondary button-small"
                          onClick={() => onFieldChange("requisitionNumber", page.requisitionNumber)}
                          type="button"
                        >
                          Page {page.requisitionNumber} • {page.lineCount} item(s)
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="detail-block movement-group-card">
              <div className="movement-group-header">
                <strong>Add Item To This Issue</strong>
                <span>
                  {isEditingCurrentLine
                    ? "Update the selected item on this requisition page."
                    : "Select the item and quantity, then save the issue onto the open requisition page."}
                </span>
              </div>

              {isEditingCurrentLine ? (
                <div className="field-note">You are editing an existing issue line on this page.</div>
              ) : null}

              <div className="movement-line-grid">
                <div className="movement-line-item">{itemField}</div>
                <div>{quantityField}</div>
                {receiptUnitCostField ? <div>{receiptUnitCostField}</div> : null}
                <div className="movement-line-actions">
                  <button className="button" onClick={onSubmit} type="button">
                    {lineSubmitLabel}
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={handleResetLine}
                    type="button"
                  >
                    {clearLabel}
                  </button>
                </div>
              </div>

              {currentItemSummary}
              {receiptCostSummary}

              <div className="movement-form-footer">
                <button
                  className="button button-secondary button-small"
                  onClick={() => setShowMoreOptions((currentValue) => !currentValue)}
                  type="button"
                >
                  {moreOptionsLabel}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="movement-core-grid">
              {dateField}
              {departmentField}
              <div className="field-span-full">{itemField}</div>
              {currentItemSummary ? (
                <div className="field-span-full">{currentItemSummary}</div>
              ) : null}
              {quantityField}
              {documentField}
              {receiptUnitCostField}
              {receiptCostSummary ? <div className="field-span-full">{receiptCostSummary}</div> : null}
            </div>

            <div className="movement-form-footer">
              <button
                className="button button-secondary button-small"
                onClick={() => setShowMoreOptions((currentValue) => !currentValue)}
                type="button"
              >
                {moreOptionsLabel}
              </button>
            </div>
          </>
        )}

        {form.type === "OUT" ? (
          <div className="detail-block document-session-card">
            <div className="document-session-header">
              <div className="document-session-title">
                <strong>Items Already On This Page</strong>
                <span>{documentValue ? `Page ${documentValue}` : "No requisition page entered yet"}</span>
              </div>

              <div className="document-session-stats">
                <StatusPill tone="info">{currentRequisitionLines.length} line(s)</StatusPill>
                <StatusPill tone="neutral">
                  Qty by UOM {formatQuantityEntries(currentRequisitionQuantityEntries)}
                </StatusPill>
                {deletedCurrentRequisitionLines.length ? (
                  <StatusPill tone="warning">
                    {deletedCurrentRequisitionLines.length} deleted
                  </StatusPill>
                ) : null}
                <button
                  className="button button-secondary button-small"
                  onClick={handlePreviewRequisition}
                  type="button"
                  disabled={!documentValue || !activeCurrentRequisitionLines.length}
                >
                  Preview
                </button>
              </div>
            </div>

            <div className="field-note">{issueCurrentPageSummary}</div>

            {currentRequisitionLines.length ? (
              <div className="document-line-list">
                {currentRequisitionLines.map((line, index) => (
                  <div
                    key={line.id}
                    className={`document-line ${line.isDeleted ? "is-deleted" : ""}`}
                  >
                    <div className="document-line-main">
                      <strong>
                        {index + 1}. {line.itemName}
                      </strong>
                      <span>
                        {line.itemCode} • {line.enteredBy || "Storekeeper"}
                      </span>
                      {line.isDeleted ? (
                        <small>
                          Deleted by {line.deletedBy || "-"} on {formatDate(line.deletedAt)}.
                          {line.deletedReason ? ` Reason: ${line.deletedReason}` : ""}
                        </small>
                      ) : null}
                    </div>
                    <div className="document-line-metric">
                      <span>Qty</span>
                      <strong>
                        {formatNumber(line.quantity)} {line.itemUom || ""}
                      </strong>
                    </div>
                    <div className="document-line-note">
                      <span>Note</span>
                      <strong>{line.notes || "-"}</strong>
                    </div>
                    <div className="document-line-actions">
                      <StatusPill tone={line.isDeleted ? "warning" : "success"}>
                        {line.isDeleted ? "Deleted" : "Active"}
                      </StatusPill>
                      {!line.isDeleted ? (
                        <>
                          <button
                            className="button button-secondary button-small"
                            onClick={() => onEditCurrentLine?.(line.id)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="button button-secondary button-small"
                            onClick={() => onDeleteCurrentLine?.(line.id)}
                            type="button"
                          >
                            Mark Deleted
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="field-note">
                Save the first item, then keep adding the next items under this same page.
              </div>
            )}
          </div>
        ) : null}

        {form.type === "OUT" ? (
          showMoreOptions ? (
            <div className="view-stack">
              <div className="form-grid">
                <label className="field">
                  <span>Optional Note</span>
                  <textarea
                    className="input textarea"
                    value={form.notes}
                    onChange={(event) => onFieldChange("notes", event.target.value)}
                    placeholder={movementMeta.notesPlaceholder}
                  />
                </label>
              </div>

              {currentItem ? (
                <div className="detail-block">
                  <strong>Selected Item Totals</strong>
                  <div className="summary-grid">
                    <div>
                      <span>Opening</span>
                      <strong>{formatNumber(currentSummary.openingBalance)}</strong>
                    </div>
                    <div>
                      <span>Total IN</span>
                      <strong>{formatNumber(currentSummary.inQty)}</strong>
                    </div>
                    <div>
                      <span>Total OUT</span>
                      <strong>{formatNumber(currentSummary.outQty)}</strong>
                    </div>
                    <div>
                      <span>Total ADJ</span>
                      <strong>{formatNumber(currentSummary.adjQty)}</strong>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null
        ) : showMoreOptions ? (
          <div className="view-stack">
            <div className="form-grid">
              <label className="field">
                <span>Optional Note</span>
                <textarea
                  className="input textarea"
                  value={form.notes}
                  onChange={(event) => onFieldChange("notes", event.target.value)}
                  placeholder={movementMeta.notesPlaceholder}
                />
              </label>
            </div>

            {currentItem ? (
              <div className="detail-block">
                <strong>Item Totals</strong>
                <div className="summary-grid">
                  <div>
                    <span>Opening</span>
                    <strong>{formatNumber(currentSummary.openingBalance)}</strong>
                  </div>
                  <div>
                    <span>Total IN</span>
                    <strong>{formatNumber(currentSummary.inQty)}</strong>
                  </div>
                  <div>
                    <span>Total OUT</span>
                    <strong>{formatNumber(currentSummary.outQty)}</strong>
                  </div>
                  <div>
                    <span>Total ADJ</span>
                    <strong>{formatNumber(currentSummary.adjQty)}</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {form.type !== "OUT" ? (
          <div className="detail-block movement-action-panel">
            <div className="movement-action-copy">
              <strong>{movementMeta.actionLabel}</strong>
              <span>{actionHint}</span>
            </div>
            <div className="button-row">
              <button className="button" onClick={onSubmit} type="button">
                {movementMeta.actionLabel}
              </button>
              <button
                className="button button-secondary"
                onClick={handleResetLine}
                type="button"
              >
                {clearLabel}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
