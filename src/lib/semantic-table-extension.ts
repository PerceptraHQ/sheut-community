import { Table } from "@tiptap/extension-table";

export const LANDSCAPE_TABLE_MIN_COLUMNS = 6;
export const LANDSCAPE_TABLE_MIN_WIDTH = 720;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

export function tableRequiresLandscape(table: unknown): boolean {
  const tableRecord = asRecord(table);
  let widestColumns = 0;
  let widestExplicitWidth = 0;
  for (const rowValue of asUnknownArray(tableRecord?.content)) {
    const row = asRecord(rowValue);
    let columns = 0;
    let explicitWidth = 0;
    let hasCompleteWidths = true;
    for (const cellValue of asUnknownArray(row?.content)) {
      const cell = asRecord(cellValue);
      const attrs = asRecord(cell?.attrs);
      const colspanValue = attrs?.colspan;
      const colspan =
        typeof colspanValue === "number" && Number.isInteger(colspanValue)
          ? Math.max(1, colspanValue)
          : 1;
      columns += colspan;
      const widths = asUnknownArray(attrs?.colwidth);
      if (
        widths.length !== colspan ||
        !widths.every((width): width is number => typeof width === "number")
      ) {
        hasCompleteWidths = false;
      } else {
        explicitWidth += widths.reduce((sum, width) => sum + width, 0);
      }
    }
    widestColumns = Math.max(widestColumns, columns);
    widestExplicitWidth = Math.max(widestExplicitWidth, hasCompleteWidths ? explicitWidth : 0);
  }
  return (
    widestColumns >= LANDSCAPE_TABLE_MIN_COLUMNS || widestExplicitWidth >= LANDSCAPE_TABLE_MIN_WIDTH
  );
}

export const SemanticTable = Table.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      layout: {
        default: "fit-page",
        parseHTML: (element) =>
          element.getAttribute("data-layout") === "landscape-page" ? "landscape-page" : "fit-page",
        renderHTML: (attributes) => ({
          "data-layout": attributes.layout === "landscape-page" ? "landscape-page" : "fit-page",
        }),
      },
    };
  },
}).configure({
  resizable: true,
  lastColumnResizable: true,
  allowTableNodeSelection: true,
});
