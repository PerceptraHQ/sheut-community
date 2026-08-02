import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { listBrandProfiles } from "../lib/brand-profiles";
import { listDocuments } from "../lib/documents";
import { listGraphWorkspaces } from "../lib/graph";
import { listEvidenceFiles, listGuidedReports } from "../lib/guided-reports";
import { listStixDrafts, listStixObjects } from "../lib/stix";
import { ProjectOverview } from "./ProjectOverview";

vi.mock("../lib/documents", () => ({ listDocuments: vi.fn() }));
vi.mock("../lib/guided-reports", () => ({
  listEvidenceFiles: vi.fn(),
  listGuidedReports: vi.fn(),
}));
vi.mock("../lib/stix", () => ({ listStixDrafts: vi.fn(), listStixObjects: vi.fn() }));
vi.mock("../lib/graph", () => ({ listGraphWorkspaces: vi.fn() }));
vi.mock("../lib/brand-profiles", () => ({ listBrandProfiles: vi.fn() }));

beforeEach(() => {
  vi.mocked(listDocuments).mockResolvedValue([]);
  vi.mocked(listGuidedReports).mockResolvedValue([{} as never, {} as never]);
  vi.mocked(listEvidenceFiles).mockResolvedValue([
    {
      id: "21a6b93a-06ac-4f91-b0a3-46b58af592d1",
      mediaType: "image/png",
      fileName: "capture.png",
      byteLen: 2_048,
      sha256: "a".repeat(64),
      revision: 1,
      title: "Capture",
      description: "",
      source: "",
      capturedAt: null,
      sourceUrl: "",
      tags: [],
      analystNotes: "",
      createdAtUnixMs: 1_000,
      updatedAtUnixMs: 1_000,
    },
  ]);
  vi.mocked(listStixObjects).mockResolvedValue([{} as never, {} as never, {} as never]);
  vi.mocked(listStixDrafts).mockResolvedValue([{} as never]);
  vi.mocked(listGraphWorkspaces).mockResolvedValue([]);
  vi.mocked(listBrandProfiles).mockResolvedValue([{} as never]);
});

it("summarizes the unlocked project and offers workspace quick actions", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  render(
    <ProjectOverview
      project={{
        id: "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
        name: "Piracy investigation",
        locked: false,
        unlockMethod: "passphrase",
        defaultTlpMarking: "amber_strict",
      }}
      onNavigate={onNavigate}
    />,
  );

  expect(await screen.findByText("2 guided reports")).toBeVisible();
  expect(screen.getByText("1 evidence file")).toBeVisible();
  expect(screen.getByText("4 intelligence items")).toBeVisible();
  expect(screen.getByText("TLP:AMBER+STRICT")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Open Evidence" }));
  expect(onNavigate).toHaveBeenCalledWith("evidence");
});
