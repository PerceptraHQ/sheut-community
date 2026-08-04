import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as documentsApi from "../lib/documents";
import { InvestigationsWorkspace } from "./InvestigationsWorkspace";

const notices = vi.hoisted(() => ({
  add: vi.fn(),
  promise: vi.fn(async (operation: () => Promise<unknown>) => operation()),
}));

vi.mock("./VaultNotices", () => ({ useVaultNotices: () => notices }));
vi.mock("./DocumentEditor", () => ({ DocumentEditor: () => <div>Document editor</div> }));
vi.mock("../lib/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof documentsApi>()),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  listDocuments: vi.fn(),
  restoreDocument: vi.fn(),
}));

const PROJECT_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const report: documentsApi.DocumentEnvelope = {
  schema_version: 1,
  id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
  kind: "report",
  revision: 3,
  root: { type: "doc", content: [{ type: "paragraph" }] },
  reportProperties: {
    reportId: "RPT-0007",
    title: "Underground Economy Assessment",
    authors: [],
    producingOrganisation: null,
    issueDate: "2026-08-03",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  notices.promise.mockImplementation(async (operation: () => Promise<unknown>) => operation());
  vi.mocked(documentsApi.listDocuments).mockResolvedValue([report]);
  vi.mocked(documentsApi.deleteDocument).mockResolvedValue();
  vi.mocked(documentsApi.createDocument).mockResolvedValue(report);
  vi.mocked(documentsApi.restoreDocument).mockResolvedValue(report);
});

it("lists document-native reports and deletes them through the document contract", async () => {
  const user = userEvent.setup();
  render(
    <InvestigationsWorkspace
      projectId={PROJECT_ID}
      externalDocument={null}
      onBusyChange={vi.fn()}
      onSelectedDocumentChange={vi.fn()}
    />,
  );

  const openReport = await screen.findByRole("button", {
    name: "Open Underground Economy Assessment",
  });
  expect(within(openReport).getByText("Underground Economy Assessment")).toBeVisible();
  expect(within(openReport).getByText("Report · r3")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Delete Underground Economy Assessment" }));
  const dialog = screen.getByRole("alertdialog", { name: "Delete Underground Economy Assessment" });
  await user.click(within(dialog).getByRole("button", { name: "Delete document" }));

  await waitFor(() =>
    expect(documentsApi.deleteDocument).toHaveBeenCalledWith(PROJECT_ID, report.id),
  );
});

it("creates reports directly as blank versioned documents", async () => {
  const host = document.createElement("div");
  host.id = "workspace-tabs";
  document.body.append(host);
  const user = userEvent.setup();
  render(
    <InvestigationsWorkspace
      projectId={PROJECT_ID}
      externalDocument={null}
      onBusyChange={vi.fn()}
      onSelectedDocumentChange={vi.fn()}
    />,
  );

  await user.click(await within(host).findByRole("button", { name: "New Report" }));
  await waitFor(() =>
    expect(documentsApi.createDocument).toHaveBeenCalledWith(PROJECT_ID, "report"),
  );
  host.remove();
});

it("does not claim a committed document restore failed when post-restore UI feedback throws", async () => {
  const user = userEvent.setup();
  render(
    <InvestigationsWorkspace
      projectId={PROJECT_ID}
      externalDocument={null}
      onBusyChange={vi.fn()}
      onSelectedDocumentChange={vi.fn()}
    />,
  );

  await user.click(
    await screen.findByRole("button", { name: "Delete Underground Economy Assessment" }),
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete document" }),
  );
  const [, options] = notices.promise.mock.calls[0] as never as [
    unknown,
    {
      success: { action: { onClick: () => Promise<void> } };
    },
  ];
  notices.add.mockImplementationOnce(() => {
    throw new Error("toast host unavailable");
  });

  await expect(options.success.action.onClick()).rejects.toThrow("toast host unavailable");
  expect(documentsApi.restoreDocument).toHaveBeenCalledWith(PROJECT_ID, report.id);
  expect(notices.add).toHaveBeenCalledWith(expect.objectContaining({ title: "Document restored" }));
  expect(notices.add).not.toHaveBeenCalledWith(
    expect.objectContaining({ title: "Document not restored" }),
  );
});
