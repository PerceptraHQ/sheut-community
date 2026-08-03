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

  it("keeps launch-time update checks under user control", async () => {
    const user = userEvent.setup();
    const onSoftwareUpdateConsentChange = vi.fn().mockResolvedValue(undefined);
    const onCheckForSoftwareUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsWorkspace
        layout={DEFAULT_WORKBENCH_LAYOUT}
        onLayoutChange={vi.fn()}
        softwareUpdateConsent="enabled"
        softwareUpdateStatus="current"
        onSoftwareUpdateConsentChange={onSoftwareUpdateConsentChange}
        onCheckForSoftwareUpdate={onCheckForSoftwareUpdate}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Data & security" }));
    const automaticChecks = screen.getByRole("switch", {
      name: "Check for updates when Sheut starts",
    });
    expect(automaticChecks).toBeChecked();
    expect(screen.getByText(/does not include anything from your projects/i)).toBeVisible();
    expect(screen.getByText("Sheut is up to date.")).toBeVisible();

    await user.click(automaticChecks);
    await user.click(screen.getByRole("button", { name: "Check now" }));

    expect(onSoftwareUpdateConsentChange).toHaveBeenCalledWith(false);
    expect(onCheckForSoftwareUpdate).toHaveBeenCalledOnce();
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

  it("provides offline help for every guided template and freeform documents", async () => {
    const user = userEvent.setup();
    render(<SettingsWorkspace layout={DEFAULT_WORKBENCH_LAYOUT} onLayoutChange={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: "Help & guides" }));

    expect(screen.getByRole("tab", { name: "Investigations and analyst notes" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Threat Actor Profile" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Intrusion Analysis" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Campaign Report" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Executive Report" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Blank Guided Report" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Illicit Ecosystem Report" })).toBeVisible();
  });

  it("opens a requested report guide directly", () => {
    render(
      <SettingsWorkspace
        initialHelpTopic="illicit-ecosystem-report"
        initialSection="help"
        layout={DEFAULT_WORKBENCH_LAYOUT}
        onLayoutChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Illicit Ecosystem Report" })).toBeVisible();
    expect(screen.getByText(/sites, infrastructure, certificates, identities/i)).toBeVisible();
    expect(
      screen.getByRole("table", { name: "Illicit Ecosystem Report field examples" }),
    ).toBeVisible();
    expect(screen.getByText("Site inventory — Domain or URL")).toBeVisible();
    expect(screen.getAllByText("stream-hub[.]example").length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "STIX or project source" })).toBeVisible();
    expect(
      screen.getAllByText(/Create in Intelligence as Domain Name or URL/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Do not create one STIX object per cell/i)).toBeVisible();
    expect(screen.getByText(/Start each section in the narrative canvas/i)).toBeVisible();
    expect(screen.getByText(/readiness recommendations are advisory/i)).toBeVisible();
    expect(screen.queryByText("Report status")).not.toBeInTheDocument();
  });
});
