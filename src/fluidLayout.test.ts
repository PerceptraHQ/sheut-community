import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appCss = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");
const investigationsWorkspace = readFileSync(
  resolve(process.cwd(), "src/components/InvestigationsWorkspace.tsx"),
  "utf8",
);
const tauriConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as { app: { windows: Array<Record<string, unknown>> } };

describe("fluid application shell", () => {
  it("does not impose a native or document-level minimum window size", () => {
    expect(tauriConfig.app.windows[0]).not.toHaveProperty("minWidth");
    expect(tauriConfig.app.windows[0]).not.toHaveProperty("minHeight");
    expect(appCss.match(/body\s*\{(?<body>[^}]*)\}/su)?.groups?.body).not.toMatch(/min-width/u);
  });

  it("reflows fixed panels away from the workspace at narrow widths", () => {
    expect(appCss).toMatch(
      /@media \(width <= 720px\)[^{]*\{[\s\S]*?\.inspector[^{]*\{[^}]*display:\s*none;/u,
    );
    expect(appCss).toMatch(
      /@media \(width <= 520px\)[^{]*\{[\s\S]*?\.project-explorer[^{]*\{[^}]*display:\s*none;/u,
    );
  });

  it("keeps docked sidebars fixed while the center workspace absorbs resize", () => {
    expect(appCss).toMatch(/--explorer-width:\s*224px;/u);
    expect(appCss).toMatch(/--inspector-width:\s*236px;/u);
    expect(appCss).toMatch(/\.workspace\s*\{[^}]*flex:\s*1 1 0;/su);
    expect(investigationsWorkspace).toContain('"grid-cols-[240px_minmax(0,1fr)]"');
  });

  it("styles custom-template and structured report inputs as full-width controls", () => {
    expect(appCss).toMatch(/\.control-input,[\s\S]*?width:\s*100%;/u);
    expect(appCss).toMatch(/\.guided-report-table-row\s*\{[^}]*width:\s*100%;/su);
    expect(appCss).toMatch(/\.guided-report-table-textarea\s*\{[^}]*min-height:\s*5rem;/su);
    expect(appCss).toMatch(
      /\.guided-report-table-row\[data-layout="source-citation"\]\s*\{[^}]*grid-template-areas:/su,
    );
  });

  it("removes the redundant command-row gap from the document workspace", () => {
    expect(appCss).toMatch(
      /\.workspace\[data-active-view="investigations"\]\s*\{[^}]*grid-template-rows:\s*36px minmax\(0, 1fr\);/su,
    );
    expect(appCss).toMatch(
      /\.workspace\[data-active-view="investigations"\] \.command-bar\s*\{[^}]*display:\s*none;/su,
    );
    expect(investigationsWorkspace).toContain('className="workspace-tab-actions"');
    expect(investigationsWorkspace).toContain('aria-label="New report"');
    expect(appCss).toMatch(/\.workspace-tab-actions\s*\{[^}]*order:\s*1;/su);
  });

  it("moves the activity rail and primary sidebar as one dock", () => {
    expect(appCss).toMatch(/data-activity-bar-position="right"[^}]*\.project-explorer\s*\{/u);
  });
});
