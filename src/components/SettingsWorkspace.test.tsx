import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKBENCH_LAYOUT } from "../lib/workbenchLayout";
import { SettingsWorkspace } from "./SettingsWorkspace";

const noticeSpies = vi.hoisted(() => ({
  add: vi.fn(),
  promise: vi.fn(<T,>(operation: () => Promise<T>): Promise<T> => operation()),
}));

vi.mock("./VaultNotices", () => ({ useVaultNotices: () => noticeSpies }));

vi.mock("../lib/brand-profiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/brand-profiles")>()),
  listBrandProfiles: vi.fn().mockResolvedValue([]),
}));

describe("SettingsWorkspace", () => {
  beforeEach(() => localStorage.clear());

  it("persists layout changes through accessible Base UI controls", async () => {
    const user = userEvent.setup();
    const onLayoutChange = vi.fn();
    render(<SettingsWorkspace layout={DEFAULT_WORKBENCH_LAYOUT} onLayoutChange={onLayoutChange} />);

    const activityBar = screen.getByRole("switch", { name: "Activity bar" });
    expect(activityBar).toBeChecked();
    await user.click(activityBar);

    expect(onLayoutChange).toHaveBeenCalledWith({
      ...DEFAULT_WORKBENCH_LAYOUT,
      activityBarVisible: false,
    });
    expect(localStorage.getItem("sheut.workbench-layout.v1")).toContain(
      '"activityBarVisible":false',
    );
  });

  it("places complete third-party notices in About settings", async () => {
    const user = userEvent.setup();
    render(<SettingsWorkspace layout={DEFAULT_WORKBENCH_LAYOUT} onLayoutChange={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "About & notices" }));
    expect(screen.getByRole("heading", { name: "Third-party notices" })).toBeVisible();
    expect(screen.getByRole("button", { name: "D3 graph modules" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Geist and Geist Mono variable fonts" }),
    ).toBeVisible();
  });

  it("shows the exact telemetry boundary and supports immediate opt-out", async () => {
    const user = userEvent.setup();
    const onTelemetryPreferenceChange = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsWorkspace
        layout={DEFAULT_WORKBENCH_LAYOUT}
        onLayoutChange={vi.fn()}
        telemetryConsent="enabled"
        onTelemetryPreferenceChange={onTelemetryPreferenceChange}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Data & security" }));
    const telemetry = screen.getByRole("switch", { name: "Anonymous diagnostics and usage" });
    expect(telemetry).toBeChecked();
    expect(
      screen.getByText(/graph data; report titles, sections, fields, rows, or prose/i),
    ).toBeVisible();

    await user.click(telemetry);
    expect(onTelemetryPreferenceChange).toHaveBeenCalledWith(false);
  });

  it("exposes project-local Brand Studio only when a project is open", async () => {
    const user = userEvent.setup();
    render(
      <SettingsWorkspace
        layout={DEFAULT_WORKBENCH_LAYOUT}
        onLayoutChange={vi.fn()}
        projectId="project-1"
        projectName="Analyst Lab"
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Brand Studio" }));

    expect(screen.getByRole("heading", { name: "Brand Studio" })).toBeVisible();
    expect(screen.getByText("No Brand Profiles yet.")).toBeVisible();
  });

  it("provides offline help for document-native reports", async () => {
    const user = userEvent.setup();
    render(<SettingsWorkspace layout={DEFAULT_WORKBENCH_LAYOUT} onLayoutChange={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "Help & guides" }));

    expect(screen.getByRole("heading", { name: "Document-native reports" })).toBeVisible();
  });

  it("opens a requested report guide directly", () => {
    render(
      <SettingsWorkspace
        initialHelpTopic="document-native-reports"
        initialSection="help"
        layout={DEFAULT_WORKBENCH_LAYOUT}
        onLayoutChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Document-native reports" })).toBeVisible();
    expect(screen.getByText(/Reports are blank, revisioned documents/i)).toBeVisible();
    expect(screen.getByText(/Typst produces the only publication format: PDF/i)).toBeVisible();
  });
});
