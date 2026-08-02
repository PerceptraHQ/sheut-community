import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const appCss = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");

it("keeps desktop chrome non-selectable while preserving editor and input selection", () => {
  expect(appCss).toMatch(/\.workbench\s*\{[^}]*user-select:\s*none;/su);
  expect(appCss).toMatch(/\.document-editor[^{]*\{[^}]*user-select:\s*text;/su);
  expect(appCss).toMatch(/input[^{]*\{[^}]*user-select:\s*text;/su);
});
