import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as mitreApi from "../lib/mitre";
import { MitreCatalogUpdateDialog } from "./MitreCatalogUpdateDialog";

vi.mock("../lib/mitre", async (importOriginal) => {
  const original = await importOriginal<typeof mitreApi>();
  return {
    ...original,
    listMitreCatalogStatuses: vi.fn(),
    previewMitreCatalogUpdate: vi.fn(),
    commitMitreCatalogUpdate: vi.fn(),
    resetMitreCatalog: vi.fn(),
  };
});

const noticePromise = vi.fn(<T,>(operation: () => Promise<T>): Promise<T> => operation());
vi.mock("./VaultNotices", () => ({
  useVaultNotices: () => ({ add: vi.fn(), promise: noticePromise }),
}));

const updatedEnterprise: mitreApi.MitreCatalogSnapshot = {
  schemaVersion: 2,
  catalog: "attack_enterprise",
  version: "20.0",
  source: {
    url: "https://github.com/mitre-attack/attack-stix-data/releases/download/v20.0/enterprise-attack.json",
    sha256: "a".repeat(64),
  },
  tactics: [{ id: "TA0002", name: "Execution", shortName: "execution", description: "Run code" }],
  techniques: [],
};

describe("MITRE catalog update dialog", () => {
  beforeEach(() => {
    noticePromise.mockClear();
    vi.mocked(mitreApi.listMitreCatalogStatuses).mockResolvedValue([
      { catalog: "attack_enterprise", version: "19.1", origin: "bundled" },
      { catalog: "attack_mobile", version: "19.1", origin: "bundled" },
      { catalog: "attack_ics", version: "19.1", origin: "bundled" },
      { catalog: "atlas", version: "2026.06", origin: "bundled" },
    ]);
    vi.mocked(mitreApi.previewMitreCatalogUpdate).mockResolvedValue({
      previewId: "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
      catalog: "attack_enterprise",
      currentVersion: "19.1",
      candidateVersion: "20.0",
      relation: "upgrade",
      sourceUrl: updatedEnterprise.source.url,
      sha256: updatedEnterprise.source.sha256,
      tacticCount: 15,
      techniqueCount: 700,
    });
    vi.mocked(mitreApi.commitMitreCatalogUpdate).mockResolvedValue(updatedEnterprise);
    vi.mocked(mitreApi.resetMitreCatalog).mockResolvedValue({
      ...updatedEnterprise,
      version: "19.1",
    });
  });

  it("previews an official STIX catalog before installing it", async () => {
    const user = userEvent.setup();
    const onCatalogChanged = vi.fn();
    render(
      <MitreCatalogUpdateDialog open onOpenChange={vi.fn()} onCatalogChanged={onCatalogChanged} />,
    );

    const dialog = await screen.findByRole("dialog", { name: "MITRE catalogs" });
    expect(within(dialog).getByText("Enterprise ATT&CK")).toBeVisible();
    expect(within(dialog).getAllByText("Bundled").length).toBeGreaterThan(0);

    await user.click(within(dialog).getByRole("button", { name: "Choose STIX file" }));
    expect(await within(dialog).findByText("19.1 → 20.0")).toBeVisible();
    expect(within(dialog).getByText("700 techniques · 15 tactics")).toBeVisible();
    expect(within(dialog).getByText(`SHA-256 ${"a".repeat(64)}`)).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Install catalog" }));

    await waitFor(() =>
      expect(mitreApi.commitMitreCatalogUpdate).toHaveBeenCalledWith(
        "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
        false,
      ),
    );
    expect(onCatalogChanged).toHaveBeenCalledWith(updatedEnterprise);
  });

  it("requires explicit confirmation before installing a downgrade", async () => {
    const user = userEvent.setup();
    vi.mocked(mitreApi.previewMitreCatalogUpdate).mockResolvedValue({
      previewId: "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
      catalog: "attack_enterprise",
      currentVersion: "19.1",
      candidateVersion: "18.1",
      relation: "downgrade",
      sourceUrl: updatedEnterprise.source.url,
      sha256: updatedEnterprise.source.sha256,
      tacticCount: 14,
      techniqueCount: 650,
    });
    render(<MitreCatalogUpdateDialog open onOpenChange={vi.fn()} onCatalogChanged={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: "MITRE catalogs" });
    await user.click(within(dialog).getByRole("button", { name: "Choose STIX file" }));

    const install = await within(dialog).findByRole("button", { name: "Install catalog" });
    expect(install).toBeDisabled();
    await user.click(
      within(dialog).getByRole("checkbox", { name: /Install older catalog version/u }),
    );
    expect(install).toBeEnabled();
  });
});
