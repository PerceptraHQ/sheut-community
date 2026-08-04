import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as evidenceApi from "../lib/evidence";
import { EvidencePickerDialog } from "./EvidencePickerDialog";

vi.mock("../lib/evidence", async (importOriginal) => ({
  ...(await importOriginal<typeof evidenceApi>()),
  listEvidenceFiles: vi.fn(),
}));

const evidence: evidenceApi.EvidenceFileMetadata = {
  id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
  revision: 2,
  mediaType: "image/png",
  fileName: "capture.png",
  byteLen: 128,
  sha256: "a".repeat(64),
  title: "Command output",
  description: "Validated capture",
  source: "Incident response",
  capturedAt: "2026-08-03",
  sourceUrl: "",
  tags: ["host"],
  analystNotes: "",
  createdAtUnixMs: 1,
  updatedAtUnixMs: 2,
};

beforeEach(() => {
  vi.mocked(evidenceApi.listEvidenceFiles).mockReset().mockResolvedValue([evidence]);
});

it("inserts stable Evidence citations or supported figures from the vault", async () => {
  const user = userEvent.setup();
  const onInsert = vi.fn();
  render(
    <EvidencePickerDialog open projectId="project-id" onOpenChange={vi.fn()} onInsert={onInsert} />,
  );

  await user.click(await screen.findByRole("button", { name: "Cite" }));
  expect(onInsert).toHaveBeenCalledWith({ kind: "citation", evidence });

  await user.click(screen.getByRole("button", { name: "Figure" }));
  expect(onInsert).toHaveBeenLastCalledWith({ kind: "figure", evidence });
});
