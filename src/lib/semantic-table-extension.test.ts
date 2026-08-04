import { describe, expect, it } from "vitest";
import {
  LANDSCAPE_TABLE_MIN_COLUMNS,
  LANDSCAPE_TABLE_MIN_WIDTH,
  tableRequiresLandscape,
} from "./semantic-table-extension";

function table(columnWidths: Array<number | null>) {
  return {
    content: [
      {
        content: columnWidths.map((width) => ({
          attrs: { colspan: 1, colwidth: width === null ? null : [width] },
        })),
      },
    ],
  };
}

describe("tableRequiresLandscape", () => {
  it("keeps ordinary tables on the publication's default page orientation", () => {
    expect(tableRequiresLandscape(table([180, 220, 240]))).toBe(false);
    expect(tableRequiresLandscape(table([null, null, null, null, null]))).toBe(false);
  });

  it("allows a dedicated landscape page only for genuinely wide tables", () => {
    expect(tableRequiresLandscape(table([360, LANDSCAPE_TABLE_MIN_WIDTH - 360]))).toBe(true);
    expect(
      tableRequiresLandscape(
        table(Array.from({ length: LANDSCAPE_TABLE_MIN_COLUMNS }, () => null)),
      ),
    ).toBe(true);
  });
});
