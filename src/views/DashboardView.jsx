import React, { useEffect, useMemo, useState } from "react";

import DataTable from "../components/DataTable";
import EmptyState from "../components/EmptyState";
import StatusPill from "../components/StatusPill";
import {
  formatCompactDate,
  formatDate,
  formatMovementType,
  formatNumber,
} from "../utils/formatters";

export default function DashboardView({
  metrics,
  dailySupportPlan,
  stockAlerts,
  recentMovements,
  departmentRows,
  operationalInsights,
  workflowGuides,
  improvementRoadmap,
  movementTrend = [],
  availableModules,
  onOpenModule,
  onStartTour,
}) {
  const [activePanel, setActivePanel] = useState("overview");
  const [dismissedInsightTitles, setDismissedInsightTitles] = useState([]);
  const [dismissedAlertIds, setDismissedAlertIds] = useState([]);
  const canOpenEntry = availableModules.some((module) => module.id === "entry");
  const canOpenStock = availableModules.some((module) => module.id === "stock");

  useEffect(() => {
    setDismissedInsightTitles((currentTitles) =>
      currentTitles.filter((title) =>
        operationalInsights.some((insight) => insight.title === title)
      )
    );
  }, [operationalInsights]);

  useEffect(() => {
    setDismissedAlertIds((currentIds) =>
      currentIds.filter((id) => stockAlerts.some((row) => row.id === id))
    );
  }, [stockAlerts]);

  const quickActions = [
    {
      id: "entry",
      label: "Open Store Desk",
      description: "Issue / receive / adjust",
      value: formatNumber(metrics.todayLines),
      valueLabel: "today",
    },
    {
      id: "stock",
      label: "Check Item Ledger",
      description: "Balances and limits",
      value: formatNumber(metrics.belowMinItems + metrics.aboveMaxItems + metrics.negativeItems),
      valueLabel: "need review",
    },
    {
      id: "finance",
      label: "Open Finance Pack",
      description: "Period totals",
      value: formatNumber(metrics.totalItems),
      valueLabel: "items tracked",
    },
    {
      id: "history",
      label: "Audit Trail",
      description: "Find entries",
      value: formatNumber(metrics.totalMovements),
      valueLabel: "all lines",
    },
  ].filter((action) => availableModules.some((module) => module.id === action.id));

  const heroSummary = `${formatNumber(metrics.totalItems)} items / ${formatNumber(
    metrics.todayLines
  )} today / ${formatNumber(
    metrics.negativeItems + metrics.belowMinItems + metrics.aboveMaxItems
  )} to review.`;

  const visibleInsights = useMemo(
    () =>
      operationalInsights.filter(
        (insight) => !dismissedInsightTitles.includes(insight.title)
      ),
    [dismissedInsightTitles, operationalInsights]
  );

  const visibleAlerts = useMemo(
    () => stockAlerts.filter((row) => !dismissedAlertIds.includes(row.id)),
    [dismissedAlertIds, stockAlerts]
  );

  const hiddenWarningCount =
    operationalInsights.length -
      visibleInsights.length +
    stockAlerts.length -
      visibleAlerts.length;

  function handleRestoreHiddenWarnings() {
    setDismissedAlertIds([]);
    setDismissedInsightTitles([]);
  }

  const dashboardHeadlineStats = [
    {
      label: "Items",
      value: formatNumber(metrics.totalItems),
    },
    {
      label: "Movements",
      value: formatNumber(metrics.totalMovements),
    },
    {
      label: "Below Min",
      value: formatNumber(metrics.belowMinItems),
    },
    {
      label: "Today",
      value: formatNumber(metrics.todayLines),
    },
  ];

  const maxTrendLines = Math.max(
    1,
    ...movementTrend.map((day) => day.lineCount)
  );

  const alertColumns = [
    { key: "code", label: "Code" },
    { key: "name", label: "Item" },
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
    {
      key: "stockOnHand",
      label: "SOH",
      align: "right",
      render: (row) => formatNumber(row.stockOnHand),
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
    {
      key: "action",
      label: "",
      render: (row) => (
        <button
          className="button button-secondary button-small"
          onClick={() =>
            setDismissedAlertIds((currentIds) => [...currentIds, row.id])
          }
          type="button"
        >
          Dismiss
        </button>
      ),
    },
  ];

  const movementColumns = [
    { key: "date", label: "Date", render: (row) => formatDate(row.date) },
    {
      key: "type",
      label: "Type",
      render: (row) => (
        <StatusPill
          tone={row.type === "OUT" ? "warning" : row.type === "IN" ? "success" : "info"}
        >
          {formatMovementType(row.type)}
        </StatusPill>
      ),
    },
    { key: "itemName", label: "Item" },
    { key: "departmentName", label: "Department" },
    { key: "quantity", label: "Qty", align: "right", render: (row) => formatNumber(row.quantity) },
    { key: "reference", label: "Reference" },
  ];

  const departmentColumns = [
    { key: "name", label: "Department" },
    { key: "totalQty", label: "Issued Qty", align: "right", render: (row) => formatNumber(row.totalQty) },
    { key: "lineCount", label: "Lines", align: "right" },
    { key: "topItems", label: "First Items" },
  ];

  const dashboardPanels = [
    {
      id: "overview",
      label: "Control",
    },
    {
      id: "activity",
      label: "Flow",
    },
    {
      id: "guidance",
      label: "Next Steps",
    },
  ];

  const operationsQueue = [
    {
      id: "stock-review",
      moduleId: "stock",
      label: "Items to review",
      value: metrics.negativeItems + metrics.belowMinItems + metrics.aboveMaxItems,
      tone:
        metrics.negativeItems + metrics.belowMinItems + metrics.aboveMaxItems > 0
          ? "warning"
          : "success",
    },
    {
      id: "movement-work",
      moduleId: "entry",
      label: "Movements today",
      value: metrics.todayLines,
      tone: metrics.todayLines > 0 ? "info" : "success",
    },
    {
      id: "adjustment-review",
      moduleId: "history",
      label: "Adjustments today",
      value: metrics.todayAdjLines,
      tone: metrics.todayAdjLines > 0 ? "warning" : "success",
    },
    {
      id: "department-review",
      moduleId: "department",
      label: "Departments issued",
      value: metrics.departmentsWithIssuesToday,
      tone: metrics.departmentsWithIssuesToday > 0 ? "info" : "success",
    },
  ].filter((item) => availableModules.some((module) => module.id === item.moduleId));

  function restoreDismissedWarnings() {
    setDismissedInsightTitles([]);
    setDismissedAlertIds([]);
  }

  return (
    <div className="view-grid">
      <section className="card card-hero dashboard-hero-card">
        <div className="dashboard-hero-header">
          <div className="dashboard-hero-copy">
            <div className="section-kicker">Control room</div>
            <h2>Daily stock command center</h2>
            <p>{heroSummary}</p>
          </div>
          <div className="dashboard-hero-highlight">
            <span>Priority</span>
            <strong>
              {formatNumber(metrics.negativeItems + metrics.belowMinItems + metrics.aboveMaxItems)}
            </strong>
            <small>items currently need review</small>
          </div>
        </div>

        <div className="dashboard-kpi-grid">
          {dashboardHeadlineStats.map((stat) => (
            <div key={stat.label} className="dashboard-kpi-tile">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>

        {quickActions.length ? (
          <div className="dashboard-shortcut-row">
            {quickActions.map((action) => (
              <button
                key={action.id}
                className="dashboard-shortcut-button"
                onClick={() => onOpenModule(action.id)}
                type="button"
              >
                <strong>{action.label}</strong>
                <span>{action.description}</span>
                <small>
                  {action.value} {action.valueLabel}
                </small>
              </button>
            ))}
          </div>
        ) : null}

        <div className="dashboard-tour-row">
          <button
            className="button button-secondary"
            onClick={() => onStartTour?.()}
            type="button"
          >
            Tour
          </button>
        </div>

        <div className="dashboard-hero-actions">
          {canOpenEntry ? (
            <button
              className="button button-primary"
              onClick={() => onOpenModule("entry")}
              type="button"
            >
              Open store desk
            </button>
          ) : null}
          {canOpenStock ? (
            <button
              className="button button-secondary"
              onClick={() => onOpenModule("stock")}
              type="button"
            >
              Check item ledger
            </button>
          ) : null}
        </div>
        <div className="dashboard-panel-switcher dashboard-panel-switcher-compact">
          <div className="toolbar">
            {hiddenWarningCount ? (
              <button
                className="button button-secondary button-small"
                onClick={restoreDismissedWarnings}
                type="button"
              >
                Show {formatNumber(hiddenWarningCount)} hidden warning(s)
              </button>
            ) : null}

            <div className="segmented-control" role="tablist" aria-label="Dashboard pages">
              {dashboardPanels.map((panel) => (
                <button
                  key={panel.id}
                  className={activePanel === panel.id ? "is-active" : ""}
                  onClick={() => setActivePanel(panel.id)}
                  type="button"
                >
                  {panel.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {activePanel === "overview" ? (
        <>
          <section className="card card-full dashboard-briefing-card">
            <div className="card-header card-header-spread">
              <div>
                <div className="section-kicker">{dailySupportPlan.roleLabel}</div>
                <h2>{dailySupportPlan.headline}</h2>
                <p>{dailySupportPlan.summary}</p>
              </div>
              <StatusPill tone="info">Start Here</StatusPill>
            </div>

            <div className="knowledge-grid dashboard-briefing-grid">
              {dailySupportPlan.steps.map((step, index) => (
                <div key={step} className="detail-block detail-block-compact dashboard-briefing-step">
                  <span>Step {index + 1}</span>
                  <strong>{step}</strong>
                </div>
              ))}
            </div>

            <div className="compact-action-strip">
              {dailySupportPlan.shortcuts
                .filter((shortcut) =>
                  availableModules.some((module) => module.id === shortcut.moduleId)
                )
                .map((shortcut) => (
                  <button
                    key={shortcut.label}
                    className={`compact-action-link compact-${shortcut.tone}`}
                    onClick={() => onOpenModule(shortcut.moduleId)}
                    type="button"
                  >
                    <span>{shortcut.label}</span>
                    <strong>{shortcut.detail}</strong>
                  </button>
                ))}
            </div>
          </section>

          <section className="card card-full">
            <div className="card-header">
              <h2>Today</h2>
            </div>

            <div className="summary-grid dashboard-summary-grid">
              <div className="summary-tile">
                <span>Receive lines today</span>
                <strong>{formatNumber(metrics.todayInLines)}</strong>
              </div>
              <div className="summary-tile">
                <span>Issue lines today</span>
                <strong>{formatNumber(metrics.todayOutLines)}</strong>
              </div>
              <div className="summary-tile">
                <span>Adjustment lines today</span>
                <strong>{formatNumber(metrics.todayAdjLines)}</strong>
              </div>
              <div className="summary-tile">
                <span>Departments issued today</span>
                <strong>{formatNumber(metrics.departmentsWithIssuesToday)}</strong>
              </div>
            </div>

            {operationsQueue.length ? (
              <div className="compact-action-strip">
                {operationsQueue.map((item) => (
                  <button
                    key={item.id}
                    className={`compact-action-link compact-${item.tone}`}
                    onClick={() => onOpenModule(item.moduleId)}
                    type="button"
                  >
                    <span>{item.label}</span>
                    <strong>{formatNumber(item.value)}</strong>
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <div className="dashboard-overview-grid card-full">
            <div className="dashboard-column-stack">
              <section className="card card-compact">
                <div className="card-header">
                  <h2>Control Health</h2>
                </div>

                <div className="compact-metric-grid">
                  <div className="compact-metric-tile">
                    <span>Healthy items</span>
                    <strong>{formatNumber(metrics.healthyItems)}</strong>
                  </div>
                  <div className="compact-metric-tile">
                    <span>Items with min/max</span>
                    <strong>{formatNumber(metrics.itemsWithMinMax)}</strong>
                  </div>
                  <div className="compact-metric-tile">
                    <span>Below minimum</span>
                    <strong>{formatNumber(metrics.belowMinItems)}</strong>
                  </div>
                  <div className="compact-metric-tile">
                    <span>Above maximum</span>
                    <strong>{formatNumber(metrics.aboveMaxItems)}</strong>
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="card-header">
                  <h2>Exceptions</h2>
                </div>

                {visibleAlerts.length ? (
                  <DataTable
                    columns={alertColumns}
                    rows={visibleAlerts}
                    rowKey={(row) => row.id}
                    pageSize={6}
                    resetKey={`${activePanel}-${visibleAlerts.length}`}
                  />
                ) : (
                  <EmptyState
                    eyebrow="Exceptions"
                    title={
                      stockAlerts.length
                        ? "Current stock warnings are hidden."
                        : "No stock exceptions right now."
                    }
                    message={
                      stockAlerts.length
                        ? "Bring them back when you want to review the same warning list again."
                        : "Negative stock, zero stock, and control limits will show here when they need attention."
                    }
                    actionLabel={stockAlerts.length ? "Show Hidden Warnings" : canOpenStock ? "Open Item Ledger" : ""}
                    onAction={
                      stockAlerts.length
                        ? handleRestoreHiddenWarnings
                        : canOpenStock
                          ? () => onOpenModule("stock")
                          : undefined
                    }
                  />
                )}
              </section>
            </div>

            <div className="dashboard-column-stack">
              <section className="card">
                <div className="card-header card-header-spread">
                  <h2>7-Day Trend</h2>
                  <div className="pill-row">
                    <StatusPill tone="success">IN</StatusPill>
                    <StatusPill tone="warning">OUT</StatusPill>
                    <StatusPill tone="info">ADJ</StatusPill>
                  </div>
                </div>

                {movementTrend.length ? (
                  <>
                    <div className="trend-chart">
                      {movementTrend.map((day) => {
                        const columnHeight = day.lineCount
                          ? Math.max(32, Math.round((day.lineCount / maxTrendLines) * 110))
                          : 24;

                        return (
                          <div key={day.date} className="trend-day">
                            <div className="trend-bar-shell" style={{ height: `${columnHeight}px` }}>
                              {day.lineCount ? (
                                <>
                                  {day.inLines ? (
                                    <span
                                      className="trend-segment trend-in"
                                      style={{ flexGrow: day.inLines }}
                                    />
                                  ) : null}
                                  {day.outLines ? (
                                    <span
                                      className="trend-segment trend-out"
                                      style={{ flexGrow: day.outLines }}
                                    />
                                  ) : null}
                                  {day.adjLines ? (
                                    <span
                                      className="trend-segment trend-adj"
                                      style={{ flexGrow: day.adjLines }}
                                    />
                                  ) : null}
                                </>
                              ) : (
                                <span className="trend-segment trend-empty" style={{ flexGrow: 1 }} />
                              )}
                            </div>
                            <strong>{formatNumber(day.lineCount)}</strong>
                            <span>{formatCompactDate(day.date)}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="field-note">
                      Bar height shows total movement lines per day. Segment colors show IN, OUT, and ADJ mix.
                    </div>
                  </>
                ) : (
                  <EmptyState
                    eyebrow="7-Day Trend"
                    title="No movement trend yet."
                    message="Once receipts, issues, or adjustments are saved, the last seven days will start building here."
                    actionLabel={canOpenEntry ? "Open Store Desk" : ""}
                    onAction={canOpenEntry ? () => onOpenModule("entry") : undefined}
                  />
                )}
              </section>

              <section className="card">
                <div className="card-header">
                  <h2>Attention</h2>
                </div>

                {visibleInsights.length ? (
                  <div className="insight-grid">
                    {visibleInsights.map((insight) => (
                      <div key={insight.title} className={`insight-card insight-${insight.tone}`}>
                        <div className="insight-card-top">
                          <StatusPill tone={insight.tone}>{insight.tone}</StatusPill>
                          <button
                            className="card-dismiss-button"
                            onClick={() =>
                              setDismissedInsightTitles((currentTitles) => [
                                ...currentTitles,
                                insight.title,
                              ])
                            }
                            type="button"
                          >
                            Dismiss
                          </button>
                        </div>
                        <strong>{insight.title}</strong>
                        <p>{insight.message}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    eyebrow="Attention"
                    title={
                      operationalInsights.length
                        ? "Current attention items are hidden."
                        : "No control insights right now."
                    }
                    message={
                      operationalInsights.length
                        ? "Bring them back when you want the dashboard to surface them again."
                        : "As movement and stock data grows, the dashboard will point out the next issues worth checking."
                    }
                    actionLabel={
                      operationalInsights.length || stockAlerts.length
                        ? "Show Hidden Warnings"
                        : canOpenStock
                          ? "Open Item Ledger"
                          : ""
                    }
                    onAction={
                      operationalInsights.length || stockAlerts.length
                        ? handleRestoreHiddenWarnings
                        : canOpenStock
                          ? () => onOpenModule("stock")
                          : undefined
                    }
                  />
                )}
              </section>
            </div>
          </div>
        </>
      ) : null}

      {activePanel === "activity" ? (
        <>
          <section className="card">
            <div className="card-header">
              <h2>Recent Activity</h2>
            </div>

            {recentMovements.length ? (
              <DataTable
                columns={movementColumns}
                rows={recentMovements}
                rowKey={(row) => row.id}
                pageSize={8}
                resetKey={activePanel}
              />
            ) : (
              <EmptyState
                eyebrow="Recent Activity"
                title="No movement history yet."
                message="Start with a receipt, issue, or adjustment and the latest activity will appear here."
                actionLabel={canOpenEntry ? "Open Store Desk" : ""}
                onAction={canOpenEntry ? () => onOpenModule("entry") : undefined}
              />
            )}
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Department Use</h2>
            </div>
            <DataTable
              columns={departmentColumns}
              rows={departmentRows}
              rowKey={(row) => row.id}
              pageSize={8}
              resetKey={activePanel}
            />
          </section>
        </>
      ) : null}

      {activePanel === "guidance" ? (
        <>
          <section className="card card-full">
            <div className="card-header">
              <h2>Usage</h2>
            </div>

            <div className="knowledge-grid">
              {workflowGuides.map((guide) => (
                <div key={guide.title} className="detail-block">
                  <strong>{guide.title}</strong>
                  <ul className="simple-list">
                    {guide.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Next Steps</h2>
            </div>

            <ul className="simple-list">
              {improvementRoadmap.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
