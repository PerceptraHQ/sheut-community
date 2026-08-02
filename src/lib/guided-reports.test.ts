import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCustomReportTemplate,
  createGuidedReport,
  deleteEvidenceFile,
  deleteGuidedReport,
  exportGuidedReport,
  importEvidenceFile,
  importEvidenceImage,
  listEvidenceFiles,
  listGuidedReports,
  listReportProjectData,
  listReportTemplates,
  loadEvidenceImage,
  restoreGuidedReport,
  saveGuidedReport,
  updateEvidenceMetadata,
  updateGuidedReportSectionDisposition,
  upgradeIllicitEcosystemReport,
} from "./guided-reports";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const PROJECT_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const REPORT_ID = "e7c44850-9f67-4d26-b7e3-0d4ee82339ef";
const TEMPLATE_ID = "4c8680ad-3f8c-53df-b94d-405cb3dc231f";
const ATTACHMENT_ID = "21a6b93a-06ac-4f91-b0a3-46b58af592d1";

describe("guided report command boundary", () => {
  beforeEach(() => vi.mocked(invoke).mockReset().mockResolvedValue({}));

  it("uses project-scoped recoverable deletion commands", async () => {
    await deleteGuidedReport(PROJECT_ID, REPORT_ID);
    await restoreGuidedReport(PROJECT_ID, REPORT_ID);

    expect(invoke).toHaveBeenNthCalledWith(1, "delete_guided_report", {
      projectId: PROJECT_ID,
      reportId: REPORT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "restore_guided_report", {
      projectId: PROJECT_ID,
      reportId: REPORT_ID,
    });
  });

  it("uses bounded commands for section disposition and explicit template upgrade", async () => {
    await updateGuidedReportSectionDisposition(
      PROJECT_ID,
      REPORT_ID,
      4,
      "attack_mappings",
      "not_applicable",
    );
    await upgradeIllicitEcosystemReport(PROJECT_ID, REPORT_ID, 5);

    expect(invoke).toHaveBeenNthCalledWith(1, "update_guided_report_section_disposition", {
      projectId: PROJECT_ID,
      reportId: REPORT_ID,
      expectedRevision: 4,
      sectionKey: "attack_mappings",
      disposition: "not_applicable",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "upgrade_illicit_ecosystem_report", {
      projectId: PROJECT_ID,
      reportId: REPORT_ID,
      expectedRevision: 5,
    });
  });

  it("uses encrypted project-scoped commands and structured field values", async () => {
    await listReportTemplates(PROJECT_ID);
    await listGuidedReports(PROJECT_ID);
    await createGuidedReport(PROJECT_ID, TEMPLATE_ID);
    await saveGuidedReport(PROJECT_ID, REPORT_ID, 3, "Operation Midnight Echo", {
      campaign_name: { type: "text", value: "Operation Midnight Echo" },
      executive_summary: {
        type: "narrative",
        value: { type: "doc", content: [{ type: "paragraph" }] },
      },
    });
    await exportGuidedReport(PROJECT_ID, REPORT_ID, {
      format: "docx",
      paperSize: "a4",
      orientation: "portrait",
      tlpMarking: "clear",
      brandProfileId: null,
      brandProfileRevision: null,
      releaseVersion: "1.0",
      publicationStatus: "draft",
      includeReleaseHistory: false,
      changeNote: null,
      pageFurniture: { header: true, footer: true, marking: true, page_numbers: true },
      includedSections: ["executive_summary"],
      appendices: [],
      fileName: "campaign-report",
    });
    await importEvidenceImage(PROJECT_ID);
    await importEvidenceFile(PROJECT_ID);
    await listEvidenceFiles(PROJECT_ID);
    await loadEvidenceImage(PROJECT_ID, ATTACHMENT_ID);
    await updateEvidenceMetadata(PROJECT_ID, ATTACHMENT_ID, 2, {
      title: "Capture",
      description: "Redirect evidence",
      source: "Analyst capture",
      capturedAt: "2026-07-31",
      sourceUrl: "https://piracy.example/",
      tags: ["piracy"],
      analystNotes: "Retain original bytes.",
    });
    await deleteEvidenceFile(PROJECT_ID, ATTACHMENT_ID, 3);

    expect(invoke).toHaveBeenNthCalledWith(1, "list_report_templates", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "list_guided_reports", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "create_guided_report", {
      projectId: PROJECT_ID,
      templateId: TEMPLATE_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "save_guided_report", {
      projectId: PROJECT_ID,
      reportId: REPORT_ID,
      expectedRevision: 3,
      title: "Operation Midnight Echo",
      fields: {
        campaign_name: { type: "text", value: "Operation Midnight Echo" },
        executive_summary: {
          type: "narrative",
          value: { type: "doc", content: [{ type: "paragraph" }] },
        },
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "export_guided_report", {
      projectId: PROJECT_ID,
      reportId: REPORT_ID,
      options: {
        format: "docx",
        paperSize: "a4",
        orientation: "portrait",
        tlpMarking: "clear",
        brandProfileId: null,
        brandProfileRevision: null,
        releaseVersion: "1.0",
        publicationStatus: "draft",
        includeReleaseHistory: false,
        changeNote: null,
        pageFurniture: { header: true, footer: true, marking: true, page_numbers: true },
        includedSections: ["executive_summary"],
        appendices: [],
        fileName: "campaign-report",
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "import_evidence_image", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(7, "import_evidence_file", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(8, "list_evidence_files", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(9, "load_evidence_image", {
      projectId: PROJECT_ID,
      evidenceId: ATTACHMENT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(10, "update_evidence_metadata", {
      projectId: PROJECT_ID,
      evidenceId: ATTACHMENT_ID,
      expectedRevision: 2,
      input: {
        title: "Capture",
        description: "Redirect evidence",
        source: "Analyst capture",
        capturedAt: "2026-07-31",
        sourceUrl: "https://piracy.example/",
        tags: ["piracy"],
        analystNotes: "Retain original bytes.",
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(11, "delete_evidence_file", {
      projectId: PROJECT_ID,
      evidenceId: ATTACHMENT_ID,
      expectedRevision: 3,
    });
  });

  it("loads typed report data without using graph commands", async () => {
    await listReportProjectData(PROJECT_ID);

    expect(invoke).toHaveBeenCalledWith("list_report_project_data", {
      projectId: PROJECT_ID,
    });
  });

  it("creates a project-local custom template through a typed command", async () => {
    await createCustomReportTemplate(
      PROJECT_ID,
      TEMPLATE_ID,
      "Piracy Ecosystem Report",
      "Tracks sites and infrastructure.",
      [
        {
          key: "social_profiles",
          title: "Social profiles",
          optional: true,
          fields: [
            {
              key: "social_profiles_table",
              label: "Social profiles",
              help_text: null,
              kind: "repeatable_rows",
              required: false,
              columns: ["Platform", "Handle", "Profile link"],
            },
          ],
        },
      ],
    );

    expect(invoke).toHaveBeenCalledWith("create_custom_report_template", {
      projectId: PROJECT_ID,
      baseTemplateId: TEMPLATE_ID,
      name: "Piracy Ecosystem Report",
      description: "Tracks sites and infrastructure.",
      additionalSections: [
        {
          key: "social_profiles",
          title: "Social profiles",
          optional: true,
          fields: [
            {
              key: "social_profiles_table",
              label: "Social profiles",
              help_text: null,
              kind: "repeatable_rows",
              required: false,
              columns: ["Platform", "Handle", "Profile link"],
            },
          ],
        },
      ],
    });
  });
});
