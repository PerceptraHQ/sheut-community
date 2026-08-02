import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as mitreApi from "../lib/mitre";
import { MitreInterchangeDialog } from "./MitreInterchangeDialog";

vi.mock("../lib/mitre", async (importOriginal) => {
  const original = await importOriginal<typeof mitreApi>();
  return {
    ...original,
    previewMitreMappingImport: vi.fn(),
    commitMitreMappingImport: vi.fn(),
    exportMitreMapping: vi.fn(),
    previewNavigatorImport: vi.fn(),
    commitNavigatorImport: vi.fn(),
    exportNavigatorProjection: vi.fn(),
  };
});

const noticePromise = vi.fn(<T,>(operation: () => Promise<T>): Promise<T> => operation());
vi.mock("./VaultNotices", () => ({
  useVaultNotices: () => ({ add: vi.fn(), promise: noticePromise }),
}));

const PROJECT_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const PREVIEW_ID = "e7c44850-9f67-4d26-b7e3-0d4ee82339ef";

describe("MITRE mapping interchange", () => {
  beforeEach(() => {
    noticePromise.mockClear();
    vi.mocked(mitreApi.previewMitreMappingImport).mockResolvedValue({
      previewId: PREVIEW_ID,
      observationCount: 12,
      duplicateCount: 2,
    });
    vi.mocked(mitreApi.commitMitreMappingImport).mockResolvedValue({ imported: 12, skipped: 0 });
    vi.mocked(mitreApi.exportMitreMapping).mockResolvedValue({ saved: true });
    vi.mocked(mitreApi.previewNavigatorImport).mockResolvedValue({
      previewId: PREVIEW_ID,
      name: "Operation Northwind",
      catalog: "attack_enterprise",
      catalogVersion: "19.1",
      entryCount: 8,
      commentCount: 6,
      disabledCount: 1,
      scoredCount: 4,
    });
    vi.mocked(mitreApi.commitNavigatorImport).mockResolvedValue({ imported: 8, skipped: 0 });
    vi.mocked(mitreApi.exportNavigatorProjection).mockResolvedValue({ saved: true });
  });

  it("skips colliding IDs by default and replaces them only when selected", async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    render(
      <MitreInterchangeDialog
        open
        projectId={PROJECT_ID}
        onOpenChange={vi.fn()}
        onImported={onImported}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "MITRE interchange" });
    await user.click(within(dialog).getByRole("button", { name: "Choose mapping file" }));
    expect(await within(dialog).findByText("12 mappings · 2 existing IDs")).toBeVisible();
    const importButton = within(dialog).getByRole("button", { name: "Import mapping" });
    expect(importButton).toBeEnabled();

    await user.click(
      within(dialog).getByRole("checkbox", { name: /Replace mappings with matching IDs/u }),
    );
    await user.click(importButton);

    await waitFor(() =>
      expect(mitreApi.commitMitreMappingImport).toHaveBeenCalledWith(PROJECT_ID, PREVIEW_ID, true),
    );
    expect(onImported).toHaveBeenCalledOnce();
  });

  it("previews Navigator semantics before creating typed observations", async () => {
    const user = userEvent.setup();
    render(
      <MitreInterchangeDialog
        open
        projectId={PROJECT_ID}
        onOpenChange={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "MITRE interchange" });
    await user.click(within(dialog).getByRole("tab", { name: "ATT&CK Navigator" }));
    await user.click(within(dialog).getByRole("button", { name: "Choose Navigator layer" }));

    expect(await within(dialog).findByText("Operation Northwind")).toBeVisible();
    expect(within(dialog).getAllByText("Enterprise ATT&CK").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Mobile ATT&CK")).toBeVisible();
    expect(within(dialog).getByText("ICS ATT&CK")).toBeVisible();
    expect(within(dialog).getByText("ATLAS")).toBeVisible();
    expect(
      within(dialog).getByText("8 entries · 6 comments · 4 scored · 1 disabled"),
    ).toBeVisible();
    expect(
      within(dialog).getByText(/Scores, colors, and enabled state are not silently converted/u),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Create mappings" }));

    await waitFor(() =>
      expect(mitreApi.commitNavigatorImport).toHaveBeenCalledWith(PROJECT_ID, PREVIEW_ID, {
        assessment: "suspected",
        outcome: "unknown",
        confidence: "low",
        defaultNarrative: "Imported from the reviewed Navigator layer.",
        includeDisabled: false,
      }),
    );
  });
});
