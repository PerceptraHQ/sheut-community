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
    expect(investigationsWorkspace).toContain(
      'className="document-workspace-grid grid h-full min-h-full"',
    );
    expect(appCss).toMatch(
      /\.document-workspace-grid\s*\{[^}]*grid-template-columns:\s*240px minmax\(0, 1fr\);/su,
    );
  });

  it("expands desktop rails at the supported large-screen breakpoints", () => {
    for (const [width, explorer, inspector, documents] of [
      [1440, 248, 256, 256],
      [1920, 272, 288, 280],
      [2560, 304, 320, 320],
    ]) {
      const breakpoint = new RegExp(
        `@media \\(width >= ${width}px\\)[\\s\\S]*?--explorer-width:\\s*${explorer}px;[\\s\\S]*?--inspector-width:\\s*${inspector}px;[\\s\\S]*?document-workspace-grid[^{]*\\{[^}]*grid-template-columns:\\s*${documents}px minmax\\(0, 1fr\\);`,
        "u",
      );
      expect(appCss).toMatch(breakpoint);
    }
  });

  it("shows report pages at bounded A4 and Letter dimensions", () => {
    expect(appCss).toMatch(/\.editor-toolbar-unified\s*\{[^}]*height:\s*3\.25rem;/su);
    expect(appCss).toMatch(/\.control-input\s*\{[^}]*width:\s*100%;/su);
    expect(appCss).toMatch(
      /\.report-page-surface\s*\{[^}]*width:\s*min\(calc\(100% - 3rem\), 210mm\);[^}]*min-height:\s*297mm;/su,
    );
    expect(appCss).toMatch(
      /data-paper-size="letter"[^}]*width:\s*min\(calc\(100% - 3rem\), 8\.5in\);[^}]*min-height:\s*11in;/su,
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
    expect(investigationsWorkspace).toContain('label="New Report"');
    expect(appCss).toMatch(/\.workspace-tab-actions\s*\{[^}]*order:\s*1;/su);
    expect(appCss).toMatch(/\.report-document-editor\s*\{[^}]*padding:\s*0 0 3rem;/su);
  });

  it("moves the activity rail and primary sidebar as one dock", () => {
    expect(appCss).toMatch(/data-activity-bar-position="right"[^}]*\.project-explorer\s*\{/u);
  });
});
