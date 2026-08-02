import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as documentsApi from "../lib/documents";
import * as reportsApi from "../lib/guided-reports";
import { InvestigationsWorkspace } from "./InvestigationsWorkspace";

const notices = vi.hoisted(() => ({
  add: vi.fn(),
  promise: vi.fn(async (operation: () => Promise<unknown>) => operation()),
}));

vi.mock("./VaultNotices", () => ({ useVaultNotices: () => notices }));
vi.mock("./GuidedReportEditor", () => ({
  GuidedReportEditor: ({
    report,
    template,
  }: {
    report: reportsApi.GuidedReport;
    template: reportsApi.ReportTemplateDefinition;
  }) => (
    <div>
      Editing {report.title} with template revision {template.revision}
    </div>
  ),
}));
vi.mock("../lib/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof documentsApi>()),
  listDocuments: vi.fn(),
}));
vi.mock("../lib/guided-reports", async (importOriginal) => ({
  ...(await importOriginal<typeof reportsApi>()),
  deleteGuidedReport: vi.fn(),
  listGuidedReports: vi.fn(),
  listReportTemplates: vi.fn(),
  restoreGuidedReport: vi.fn(),
}));

const PROJECT_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const report: reportsApi.GuidedReport = {
  schema_version: 1,
  id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
  revision: 3,
  template_id: "4c8680ad-3f8c-53df-b94d-405cb3dc231f",
  template_revision: 1,
  title: "Underground Economy Assessment",
  included_sections: ["summary"],
  fields: {},
  created_at_unix_ms: 1,
  updated_at_unix_ms: 2,
  deleted_at_unix_ms: null,
};
const template: reportsApi.ReportTemplateDefinition = {
  schema_version: 1,
  id: report.template_id,
  revision: 1,
  builtin: null,
  name: "Illicit Ecosystem Report",
  description: "Tracks an illicit online ecosystem.",
  sections: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  notices.promise.mockImplementation(async (operation: () => Promise<unknown>) => operation());
  vi.mocked(documentsApi.listDocuments).mockResolvedValue([]);
  vi.mocked(reportsApi.listGuidedReports).mockResolvedValue([report]);
  vi.mocked(reportsApi.listReportTemplates).mockResolvedValue([template]);
  vi.mocked(reportsApi.deleteGuidedReport).mockResolvedValue();
  vi.mocked(reportsApi.restoreGuidedReport).mockResolvedValue(report);
});

it("renders report identity on two lines and deletes through a confirmation dialog", async () => {
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
    name: `Open ${report.title}`,
  });
  expect(within(openReport).getByText(report.title)).toHaveClass("document-row-title");
  expect(within(openReport).getByText(`${template.name} · r${report.revision}`)).toHaveClass(
    "document-row-meta",
  );

  await user.click(screen.getByRole("button", { name: `Delete ${report.title}` }));
  const dialog = screen.getByRole("alertdialog", { name: `Delete ${report.title}` });
  await user.click(within(dialog).getByRole("button", { name: "Delete report" }));

  await waitFor(() =>
    expect(reportsApi.deleteGuidedReport).toHaveBeenCalledWith(PROJECT_ID, report.id),
  );
  expect(screen.queryByRole("button", { name: `Open ${report.title}` })).toBeNull();
});

it("opens an existing report with its pinned template revision", async () => {
  const user = userEvent.setup();
  vi.mocked(reportsApi.listReportTemplates).mockResolvedValue([
    { ...template, revision: 2, description: "Latest investigation layout." },
    template,
  ]);
  render(
    <InvestigationsWorkspace
      projectId={PROJECT_ID}
      externalDocument={null}
      onBusyChange={vi.fn()}
      onSelectedDocumentChange={vi.fn()}
    />,
  );

  await user.click(await screen.findByRole("button", { name: `Open ${report.title}` }));

  expect(screen.getByText(`Editing ${report.title} with template revision 1`)).toBeVisible();
});
