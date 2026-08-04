import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as evidenceApi from "../lib/evidence";
import { EvidenceWorkspace } from "./EvidenceWorkspace";

const noticeSpies = vi.hoisted(() => ({ add: vi.fn(), promise: vi.fn() }));

vi.mock("./VaultNotices", () => ({ useVaultNotices: () => noticeSpies }));

vi.mock("../lib/evidence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/evidence")>()),
  importEvidenceFile: vi.fn(),
  importEvidenceImage: vi.fn(),
  deleteEvidenceFile: vi.fn(),
  listEvidenceFiles: vi.fn(),
  loadEvidenceImage: vi.fn(),
  updateEvidenceMetadata: vi.fn(),
}));

const existing = {
  id: "21a6b93a-06ac-4f91-b0a3-46b58af592d1",
  mediaType: "image/png" as const,
  fileName: "captured-storefront.png",
  byteLen: 1_024,
  sha256: "a".repeat(64),
  createdAtUnixMs: 1_000,
  updatedAtUnixMs: 1_000,
  revision: 1,
  title: "Captured storefront",
  description: "Landing page shown before the redirect.",
  source: "Analyst capture",
  capturedAt: "2026-07-31",
  sourceUrl: "https://piracy.example/",
  tags: ["piracy", "redirect"],
  analystNotes: "Preserve the original archive.",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(evidenceApi.listEvidenceFiles).mockResolvedValue([existing]);
  vi.mocked(evidenceApi.loadEvidenceImage).mockRejectedValue(new Error("preview unavailable"));
  vi.mocked(evidenceApi.deleteEvidenceFile).mockResolvedValue();
});

it("edits analyst metadata with semantic controls and confirms deletion with Base UI", async () => {
  const user = userEvent.setup();
  vi.mocked(evidenceApi.updateEvidenceMetadata).mockImplementation(
    (_projectId, _evidenceId, _revision, input) =>
      Promise.resolve({
        ...existing,
        ...input,
        revision: 2,
        updatedAtUnixMs: 2_000,
      }),
  );
  render(<EvidenceWorkspace projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9" />);

  expect(await screen.findByRole("heading", { name: "Captured storefront" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit evidence metadata" }));
  const title = screen.getByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "Storefront redirect capture");
  expect(screen.getByLabelText("Capture date")).toHaveAttribute("type", "date");
  expect(screen.getByRole("textbox", { name: "Description" }).tagName).toBe("TEXTAREA");
  expect(screen.getByRole("textbox", { name: "Analyst notes" }).tagName).toBe("TEXTAREA");
  await user.click(screen.getByRole("button", { name: "Save evidence metadata" }));

  await waitFor(() =>
    expect(evidenceApi.updateEvidenceMetadata).toHaveBeenCalledWith(
      "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
      existing.id,
      1,
      expect.objectContaining({
        title: "Storefront redirect capture",
        capturedAt: "2026-07-31",
        tags: ["piracy", "redirect"],
      }),
    ),
  );

  const deleteTrigger = document.getElementById("evidence-delete-trigger");
  expect(deleteTrigger).toBeInstanceOf(HTMLButtonElement);
  await user.click(deleteTrigger as HTMLButtonElement);
  const alert = screen.getByRole("alertdialog", { name: "Delete evidence file?" });
  expect(evidenceApi.deleteEvidenceFile).not.toHaveBeenCalled();
  await user.click(within(alert).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(deleteTrigger).toHaveFocus());
  await user.click(deleteTrigger as HTMLButtonElement);
  await user.click(
    within(screen.getByRole("alertdialog", { name: "Delete evidence file?" })).getByRole("button", {
      name: "Delete evidence",
    }),
  );
  await waitFor(() =>
    expect(evidenceApi.deleteEvidenceFile).toHaveBeenCalledWith(
      "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
      existing.id,
      2,
    ),
  );
});

it("lists encrypted project evidence and imports general files from the library toolbar", async () => {
  const user = userEvent.setup();
  vi.mocked(evidenceApi.importEvidenceFile).mockResolvedValue({
    ...existing,
    id: "04c230e7-e13f-4f68-a8b4-da72a31bcb13",
    fileName: "site-backup.zip",
    mediaType: "application/zip",
  });

  render(<EvidenceWorkspace projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9" />);

  expect(await screen.findByRole("button", { name: /captured-storefront\.png/i })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Import evidence file" }));
  expect(await screen.findByRole("button", { name: /site-backup\.zip/i })).toBeVisible();
  expect(evidenceApi.importEvidenceFile).toHaveBeenCalledWith(
    "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
  );
});
