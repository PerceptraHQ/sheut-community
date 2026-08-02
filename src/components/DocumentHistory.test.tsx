import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentEnvelope } from "../lib/documents";
import * as documentsApi from "../lib/documents";
import { DocumentHistory } from "./DocumentHistory";

vi.mock("../lib/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/documents")>();
  return {
    ...actual,
    compareDocumentRevisions: vi.fn(),
    listDocumentActivity: vi.fn(),
    listDocumentRevisions: vi.fn(),
    restoreDocumentRevision: vi.fn(),
  };
});

vi.mock("./VaultNotices", () => ({
  useVaultNotices: () => ({
    add: vi.fn(),
    promise: vi.fn((operation: () => Promise<unknown>): Promise<unknown> => operation()),
  }),
}));

const document: DocumentEnvelope = {
  schema_version: 1,
  id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
  kind: "analyst_note",
  revision: 2,
  root: { type: "doc", content: [] },
};

describe("DocumentHistory", () => {
  beforeEach(() => {
    vi.mocked(documentsApi.listDocumentRevisions)
      .mockReset()
      .mockResolvedValue([
        { revision: 2, savedAtUnixMs: 2_000 },
        { revision: 1, savedAtUnixMs: 1_000 },
      ]);
    vi.mocked(documentsApi.listDocumentActivity)
      .mockReset()
      .mockResolvedValue([
        {
          sequence: 2,
          kind: "edited",
          revision: 2,
          sourceRevision: null,
          occurredAtUnixMs: 2_000,
        },
        {
          sequence: 1,
          kind: "created",
          revision: 1,
          sourceRevision: null,
          occurredAtUnixMs: 1_000,
        },
      ]);
    vi.mocked(documentsApi.compareDocumentRevisions)
      .mockReset()
      .mockResolvedValue({
        fromRevision: 1,
        toRevision: 2,
        segments: [
          { kind: "removed", text: "Initial" },
          { kind: "added", text: "Changed" },
          { kind: "unchanged", text: " finding" },
        ],
        simplified: false,
      });
    vi.mocked(documentsApi.restoreDocumentRevision)
      .mockReset()
      .mockResolvedValue({ ...document, revision: 3 });
  });

  it("shows revision activity, compares snapshots, and restores as a new revision", async () => {
    const user = userEvent.setup();
    const onRestored = vi.fn();
    render(
      <DocumentHistory
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onRestored={onRestored}
      />,
    );

    expect(await screen.findByText("Edited · r2")).toBeVisible();
    expect(screen.queryByText("Saved revisions")).not.toBeInTheDocument();
    const currentActivity = screen.getByText("Edited · r2").closest("li");
    const savedActivity = screen.getByText("Created · r1").closest("li");
    expect(currentActivity).not.toBeNull();
    expect(savedActivity).not.toBeNull();
    if (!currentActivity || !savedActivity) throw new Error("Document activity entries not found");
    expect(within(currentActivity).queryByRole("button", { name: /revision 2/u })).toBeNull();
    await user.click(
      within(savedActivity).getByRole("button", {
        name: "Compare revision 1 with revision 2",
      }),
    );
    const comparison = await screen.findByRole("dialog", {
      name: "Compare revision 1 with current revision 2",
    });
    expect(within(comparison).getByText("Initial", { selector: "del" })).toBeVisible();
    expect(within(comparison).getByText("Changed", { selector: "ins" })).toBeVisible();
    expect(within(comparison).getByText("finding")).toBeVisible();
    expect(within(comparison).queryByText("/content/0")).not.toBeInTheDocument();
    expect(within(comparison).getByText("Removed from the earlier version")).toBeVisible();
    expect(within(comparison).getByText("Added in the current version")).toBeVisible();
    await user.click(within(comparison).getByRole("button", { name: "Close comparison" }));

    await user.click(within(savedActivity).getByRole("button", { name: "Restore revision 1" }));
    const dialog = screen.getByRole("alertdialog", { name: "Restore revision 1" });
    await user.click(within(dialog).getByRole("button", { name: "Restore as revision 3" }));

    await waitFor(() =>
      expect(documentsApi.restoreDocumentRevision).toHaveBeenCalledWith(
        "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
        document.id,
        1,
        2,
      ),
    );
    expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }));
  });

  it("clears a deleted-document error when the same revision is restored", async () => {
    vi.mocked(documentsApi.listDocumentActivity)
      .mockRejectedValueOnce({ code: "document_not_found" })
      .mockResolvedValueOnce([
        {
          sequence: 3,
          kind: "restored",
          revision: 2,
          sourceRevision: null,
          occurredAtUnixMs: 3_000,
        },
      ]);
    vi.mocked(documentsApi.listDocumentRevisions)
      .mockRejectedValueOnce({ code: "document_not_found" })
      .mockResolvedValueOnce([{ revision: 2, savedAtUnixMs: 2_000 }]);

    const { rerender } = render(
      <DocumentHistory
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onRestored={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That document is no longer available.",
    );

    rerender(
      <DocumentHistory
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={{ ...document }}
        onRestored={vi.fn()}
      />,
    );

    expect(await screen.findByText("Restored · r2")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows one restore action when several activity events refer to the same snapshot", async () => {
    vi.mocked(documentsApi.listDocumentActivity).mockResolvedValue([
      {
        sequence: 3,
        kind: "restored",
        revision: 1,
        sourceRevision: null,
        occurredAtUnixMs: 3_000,
      },
      {
        sequence: 2,
        kind: "deleted",
        revision: 1,
        sourceRevision: null,
        occurredAtUnixMs: 2_000,
      },
      {
        sequence: 1,
        kind: "created",
        revision: 1,
        sourceRevision: null,
        occurredAtUnixMs: 1_000,
      },
    ]);

    render(
      <DocumentHistory
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onRestored={vi.fn()}
      />,
    );

    expect(await screen.findByText("Restored · r1")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Restore revision 1" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Compare revision 1/u })).toHaveLength(1);
  });
});
