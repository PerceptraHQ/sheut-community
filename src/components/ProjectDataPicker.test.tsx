import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { listReportProjectData } from "../lib/report-data";
import { ProjectDataPicker } from "./ProjectDataPicker";

vi.mock("../lib/report-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/report-data")>()),
  listReportProjectData: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(listReportProjectData).mockResolvedValue([]);
});

it("inserts a human-readable TTP label while retaining its local reference", async () => {
  const user = userEvent.setup();
  const onInsert = vi.fn();
  vi.mocked(listReportProjectData).mockResolvedValue([
    {
      id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
      kind: "catalog_reference",
      objectType: "attack-pattern",
      label: "T1566.002 — Spearphishing Link",
      summary: "Credential collection link observed in delivery messages.",
      values: {
        technique_label: "T1566.002 — Spearphishing Link",
        explanation: "Credential collection link observed in delivery messages.",
      },
    },
  ]);
  render(
    <ProjectDataPicker
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      onInsert={onInsert}
      triggerLabel="Insert TTP"
    />,
  );

  await user.click(screen.getByRole("button", { name: "Insert TTP" }));
  await user.click(await screen.findByRole("button", { name: /T1566\.002/ }));

  expect(onInsert).toHaveBeenCalledWith({
    kind: "catalog_reference",
    id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
    label: "T1566.002 — Spearphishing Link",
    values: {
      technique_label: "T1566.002 — Spearphishing Link",
      explanation: "Credential collection link observed in delivery messages.",
    },
  });
});

it("loads Evidence directly from the library without adding it to graph sources", async () => {
  const user = userEvent.setup();
  const onInsert = vi.fn();
  vi.mocked(listReportProjectData).mockResolvedValue([
    {
      id: "21a6b93a-06ac-4f91-b0a3-46b58af592d1",
      kind: "evidence",
      objectType: "image/png",
      label: "captured-storefront.png",
      summary: "Evidence file",
      values: { name: "captured-storefront.png", type: "image/png" },
    },
  ]);
  render(
    <ProjectDataPicker
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      onInsert={onInsert}
      triggerLabel="Insert evidence"
    />,
  );

  await user.click(screen.getByRole("button", { name: "Insert evidence" }));
  await user.click(await screen.findByRole("button", { name: /captured-storefront\.png/ }));

  expect(onInsert).toHaveBeenCalledWith({
    kind: "evidence",
    id: "21a6b93a-06ac-4f91-b0a3-46b58af592d1",
    label: "captured-storefront.png",
    values: { name: "captured-storefront.png", type: "image/png" },
  });
});

it("shows only project data compatible with the current report column", async () => {
  const user = userEvent.setup();
  vi.mocked(listReportProjectData).mockResolvedValue([
    {
      id: "domain-local-id",
      kind: "intelligence",
      objectType: "domain-name",
      label: "stream-hub.example",
      summary: "Domain Name",
      values: { value: "stream-hub.example" },
    },
    {
      id: "identity-local-id",
      kind: "intelligence",
      objectType: "identity",
      label: "Example Ad Network",
      summary: "Identity",
      values: { name: "Example Ad Network" },
    },
    {
      id: "evidence-local-id",
      kind: "evidence",
      objectType: "image/png",
      label: "capture.png",
      summary: "Evidence file",
      values: { name: "capture.png" },
    },
  ]);

  render(
    <ProjectDataPicker
      allowedKinds={["intelligence"]}
      allowedObjectTypes={["domain-name", "url"]}
      contextLabel="Sites — Domain or site"
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      onInsert={vi.fn()}
      triggerLabel="Choose site"
    />,
  );

  await user.click(screen.getByRole("button", { name: "Choose site" }));

  expect(await screen.findByRole("button", { name: /stream-hub\.example/u })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Example Ad Network/u })).toBeNull();
  expect(screen.queryByRole("button", { name: /capture\.png/u })).toBeNull();
  expect(screen.getByText(/compatible with Sites — Domain or site/u)).toBeVisible();
});
