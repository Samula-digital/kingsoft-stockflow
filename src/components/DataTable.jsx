import React, { useEffect, useMemo, useState } from "react";

export default function DataTable({
  columns,
  rows,
  rowKey,
  emptyMessage = "No records found.",
  rowClassName,
  pageSize = null,
  resetKey = "",
  onRowClick,
  rowAriaLabel,
}) {
  function shouldIgnoreRowInteraction(target) {
    return Boolean(
      target instanceof Element &&
        target.closest("button, a, input, select, textarea, label, summary")
    );
  }

  const hasPagination = Number.isFinite(pageSize) && pageSize > 0;
  const totalPages = hasPagination ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [resetKey]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const visibleRows = useMemo(() => {
    if (!hasPagination) return rows;

    const startIndex = (currentPage - 1) * pageSize;
    return rows.slice(startIndex, startIndex + pageSize);
  }, [currentPage, hasPagination, pageSize, rows]);

  const fromRow = rows.length ? (currentPage - 1) * (pageSize || rows.length) + 1 : 0;
  const toRow = hasPagination
    ? Math.min(currentPage * pageSize, rows.length)
    : rows.length;

  return (
    <div className="table-shell">
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.align === "right" ? "align-right" : ""}
                  scope="col"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!visibleRows.length ? (
              <tr>
                <td className="empty-cell" colSpan={columns.length}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => (
                <tr
                  key={rowKey ? rowKey(row, index) : index}
                  className={[
                    rowClassName ? rowClassName(row) : "",
                    onRowClick ? "row-interactive" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={
                    onRowClick
                      ? (event) => {
                          if (shouldIgnoreRowInteraction(event.target)) return;
                          onRowClick(row);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (shouldIgnoreRowInteraction(event.target)) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={rowAriaLabel ? rowAriaLabel(row) : undefined}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.align === "right" ? "align-right" : ""}
                      data-label={column.label || "Actions"}
                    >
                      {column.render ? column.render(row) : row[column.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasPagination && rows.length > pageSize ? (
        <div className="table-pagination">
          <span className="table-page-status">
            Showing {fromRow}-{toRow} of {rows.length}
          </span>

          <div className="table-page-actions">
            <button
              className="button button-secondary button-small"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              type="button"
            >
              Previous
            </button>
            <span className="table-page-status">
              Page {currentPage} of {totalPages}
            </span>
            <button
              className="button button-secondary button-small"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
