import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { listBrandProfiles } from "../lib/brand-profiles";
import { listPublicationRecords } from "../lib/documents";
import {
  type GuidedReport,
  importEvidenceImage,
  listEvidenceFiles,
  loadEvidenceImage,
  type ReportTemplateDefinition,
  saveGuidedReport,
  updateGuidedReportSectionDisposition,
} from "../lib/guided-reports";
import { GuidedReportEditor } from "./GuidedReportEditor";

const noticeSpies = vi.hoisted(() => ({ add: vi.fn(), promise: vi.fn() }));

vi.mock("./VaultNotices", () => ({ useVaultNotices: () => noticeSpies }));

vi.mock("../lib/guided-reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/guided-reports")>()),
  saveGuidedReport: vi.fn(),
  importEvidenceImage: vi.fn(),
  listEvidenceFiles: vi.fn(),
  loadEvidenceImage: vi.fn(),
  updateGuidedReportSectionDisposition: vi.fn(),
}));

vi.mock("../lib/brand-profiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/brand-profiles")>()),
  listBrandProfiles: vi.fn(),
}));

vi.mock("../lib/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/documents")>()),
  listPublicationRecords: vi.fn(),
}));

const template: ReportTemplateDefinition = {
  schema_version: 1,
  id: "4c8680ad-3f8c-53df-b94d-405cb3dc231f",
  revision: 1,
  builtin: "campaign_report",
  name: "Campaign Report",
  description: "Campaign structure",
  sections: [
    {
      key: "campaign_metadata",
      title: "Campaign metadata",
      optional: false,
      fields: [
        {
          key: "campaign_name",
          label: "Campaign name",
          help_text: null,
          kind: "short_text",
          required: true,
          columns: [],
        },
        {
          key: "analysis",
          label: "Analysis",
          help_text: null,
          kind: "narrative",
          required: false,
          columns: [],
        },
        {
          key: "publication_date",
          label: "Publication date",
          help_text: null,
          kind: "date",
          required: false,
          columns: [],
        },
      ],
    },
  ],
};

const report: GuidedReport = {
  schema_version: 1,
  id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
  revision: 1,
  template_id: template.id,
  template_revision: 1,
  title: "Untitled guided report",
  included_sections: ["campaign_metadata"],
  fields: {
    campaign_name: { type: "text", value: "" },
    publication_date: { type: "text", value: "" },
    analysis: { type: "narrative", value: { type: "doc", content: [] } },
  },
  created_at_unix_ms: 1,
  updated_at_unix_ms: 1,
  deleted_at_unix_ms: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  noticeSpies.promise.mockImplementation(
    <T,>(operation: () => Promise<T>): Promise<T> => operation(),
  );
  vi.mocked(listEvidenceFiles).mockResolvedValue([]);
  vi.mocked(loadEvidenceImage).mockRejectedValue(new Error("not rendered in this test"));
  vi.mocked(listBrandProfiles).mockResolvedValue([]);
  vi.mocked(listPublicationRecords).mockResolvedValue([]);
});

it("records optional sections as not applicable without making the report incomplete", async () => {
  const user = userEvent.setup();
  const optionalTemplate: ReportTemplateDefinition = {
    ...template,
    sections: [
      ...template.sections,
      {
        key: "detections",
        title: "Detections and Signatures",
        optional: true,
        guidance: "Include only validated detections.",
        fields: [
          {
            key: "detections",
            label: "Detections",
            help_text: null,
            kind: "repeatable_rows",
            required: false,
            columns: ["Name", "Rule"],
          },
        ],
      },
    ],
  };
  const optionalReport: GuidedReport = {
    ...report,
    template_id: optionalTemplate.id,
    included_sections: ["campaign_metadata", "detections"],
    section_dispositions: {},
    fields: { ...report.fields, detections: { type: "rows", value: [] } },
  };
  const savedReport = {
    ...optionalReport,
    revision: 2,
    section_dispositions: { detections: "not_applicable" as const },
  };
  const onSaved = vi.fn();
  vi.mocked(updateGuidedReportSectionDisposition).mockResolvedValue(savedReport);

  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={optionalReport}
      template={optionalTemplate}
      onBusyChange={vi.fn()}
      onSaved={onSaved}
    />,
  );

  await user.click(screen.getByRole("button", { name: /Detections and Signatures/u }));
  await user.click(screen.getByRole("button", { name: "Not applicable" }));

  expect(updateGuidedReportSectionDisposition).toHaveBeenCalledWith(
    "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
    optionalReport.id,
    1,
    "detections",
    "not_applicable",
  );
  expect(
    screen.getByText(
      "This optional section is recorded as not applicable and will not be published.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Use section" })).toBeVisible();
  expect(onSaved).toHaveBeenCalledWith(savedReport);
});

it("requires an explicit confirmation before upgrading an older Illicit Ecosystem revision", async () => {
  const user = userEvent.setup();
  const onUpgrade = vi.fn().mockResolvedValue(undefined);

  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={report}
      template={{ ...template, name: "Illicit Ecosystem Report" }}
      latestTemplateRevision={3}
      onBusyChange={vi.fn()}
      onSaved={vi.fn()}
      onUpgrade={onUpgrade}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Upgrade structure" }));
  expect(screen.getByRole("dialog", { name: "Upgrade Illicit Ecosystem Report" })).toBeVisible();
  expect(onUpgrade).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Create upgraded revision" }));
  expect(onUpgrade).toHaveBeenCalledOnce();
});

it("renders template fields and saves them as one revision", async () => {
  const user = userEvent.setup();
  vi.mocked(saveGuidedReport).mockResolvedValue({
    ...report,
    revision: 2,
    title: "Operation Midnight Echo",
  });
  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={report}
      template={template}
      onBusyChange={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  expect(screen.getByLabelText("Report title").tagName).toBe("TEXTAREA");
  expect(screen.getByLabelText("Report title")).toHaveAttribute("autocomplete", "off");
  expect(screen.getByLabelText("Campaign name (required)").tagName).toBe("TEXTAREA");
  expect(screen.getByLabelText("Campaign name (required)")).toHaveAttribute("autocomplete", "off");
  screen.getByRole("button", { name: "Add content to Campaign metadata" }).focus();
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitem", { name: "Publication date" }));
  expect(screen.getByLabelText("Publication date").tagName).toBe("INPUT");
  expect(screen.getByLabelText("Publication date")).toHaveAttribute("type", "date");
  expect(screen.getByLabelText("Publication date")).toHaveAttribute("autocomplete", "off");

  await user.type(screen.getByLabelText("Campaign name (required)"), "Operation Midnight Echo");
  await user.clear(screen.getByLabelText("Report title"));
  await user.type(screen.getByLabelText("Report title"), "Midnight Echo Campaign Assessment");
  await user.type(screen.getByLabelText("Publication date"), "2026-07-31");
  expect(screen.getByRole("button", { name: "Bold" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Defang URLs" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Save report" }));

  expect(saveGuidedReport).toHaveBeenCalledWith(
    "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
    report.id,
    1,
    "Midnight Echo Campaign Assessment",
    {
      campaign_name: { type: "text", value: "Operation Midnight Echo" },
      publication_date: { type: "text", value: "2026-07-31" },
      analysis: { type: "narrative", value: { type: "doc", content: [] } },
    },
  );
});

it("makes the complete narrative surface editable instead of leaving a one-line editor", () => {
  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={report}
      template={template}
      onBusyChange={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  const narrative = screen.getByLabelText("Analysis");
  expect(narrative).toHaveClass("guided-narrative-editor");
  expect(narrative.parentElement).toHaveClass(
    "guided-narrative-editor-content",
    "prose",
    "prose-invert",
    "prose-sheut",
  );
});

it("keeps unused secondary fields behind one section-level add menu", async () => {
  const user = userEvent.setup();
  const focusedTemplate: ReportTemplateDefinition = {
    ...template,
    sections: [
      {
        key: "assessment",
        title: "Assessment",
        optional: false,
        fields: [
          {
            key: "assessment",
            label: "Assessment",
            help_text: null,
            kind: "narrative",
            required: true,
            columns: [],
          },
          {
            key: "financial_relationships",
            label: "Financial relationships",
            help_text: null,
            kind: "narrative",
            required: false,
            columns: [],
          },
          {
            key: "structured_findings",
            label: "Structured findings",
            help_text: null,
            kind: "repeatable_rows",
            required: false,
            columns: ["Finding", "Evidence"],
          },
          {
            key: "supporting_intelligence",
            label: "Supporting intelligence",
            help_text: null,
            kind: "project_references",
            required: false,
            columns: [],
          },
        ],
      },
    ],
  };
  const focusedReport: GuidedReport = {
    ...report,
    template_id: focusedTemplate.id,
    included_sections: ["assessment"],
    fields: {
      assessment: { type: "narrative", value: { type: "doc", content: [] } },
      financial_relationships: { type: "narrative", value: { type: "doc", content: [] } },
      structured_findings: { type: "rows", value: [] },
      supporting_intelligence: { type: "project_references", value: [] },
    },
  };

  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={focusedReport}
      template={focusedTemplate}
      onBusyChange={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  expect(screen.getByLabelText("Assessment (required)")).toBeVisible();
  expect(screen.queryByLabelText("Financial relationships")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add row" })).not.toBeInTheDocument();
  expect(screen.queryByText("No project data referenced yet.")).not.toBeInTheDocument();

  screen.getByRole("button", { name: "Add content to Assessment" }).focus();
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitem", { name: "Financial relationships" }));
  expect(screen.getByLabelText("Financial relationships")).toBeVisible();

  screen.getByRole("button", { name: "Add content to Assessment" }).focus();
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitem", { name: "Structured findings table" }));
  expect(screen.getByRole("button", { name: "Add row" })).toBeVisible();
});

it("shows exact validation messages for every required field type before publication", async () => {
  const user = userEvent.setup();
  const validationTemplate: ReportTemplateDefinition = {
    ...template,
    sections: [
      {
        key: "validation",
        title: "Validation",
        optional: false,
        fields: [
          {
            key: "required_text",
            label: "Report name",
            help_text: "Use the human-readable report name.",
            kind: "short_text",
            required: true,
            columns: [],
          },
          {
            key: "required_date",
            label: "Report date",
            help_text: null,
            kind: "date",
            required: true,
            columns: [],
          },
          {
            key: "required_confidence",
            label: "Assessment confidence",
            help_text: null,
            kind: "confidence",
            required: true,
            columns: [],
          },
          {
            key: "required_narrative",
            label: "Executive summary",
            help_text: null,
            kind: "narrative",
            required: true,
            columns: [],
          },
          {
            key: "required_rows",
            label: "Infrastructure",
            help_text: null,
            kind: "repeatable_rows",
            required: true,
            columns: ["Host", "Provider"],
          },
          {
            key: "required_references",
            label: "Supporting intelligence",
            help_text: null,
            kind: "project_references",
            required: true,
            columns: [],
          },
        ],
      },
    ],
  };
  const validationReport: GuidedReport = {
    ...report,
    template_id: validationTemplate.id,
    included_sections: ["validation"],
    fields: {
      required_text: { type: "text", value: "" },
      required_date: { type: "text", value: "" },
      required_confidence: { type: "text", value: "" },
      required_narrative: { type: "narrative", value: { type: "doc", content: [] } },
      required_rows: { type: "rows", value: [] },
      required_references: { type: "project_references", value: [] },
    },
  };

  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={validationReport}
      template={validationTemplate}
      onBusyChange={vi.fn()}
      onPublish={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Publish report" }));

  expect(screen.getByText("Enter Report name.")).toBeVisible();
  expect(screen.getByText("Choose Report date.")).toBeVisible();
  expect(screen.getByText("Choose Assessment confidence.")).toBeVisible();
  expect(screen.getByText("Add content to Executive summary.")).toBeVisible();
  expect(screen.getByText("Add at least one row to Infrastructure.")).toBeVisible();
  expect(
    screen.getByText("Add at least one project reference to Supporting intelligence."),
  ).toBeVisible();
  expect(screen.queryByText("Complete the highlighted fields before publishing.")).toBeNull();
  expect(noticeSpies.add).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Report not ready to publish" }),
  );
  expect(screen.queryByRole("dialog", { name: "Publish document" })).not.toBeInTheDocument();
});

it("keeps empty sections in the editor but removes them from publication choices", async () => {
  const user = userEvent.setup();
  const publicationTemplate: ReportTemplateDefinition = {
    ...template,
    sections: [
      {
        key: "overview",
        title: "Overview",
        optional: false,
        fields: [
          {
            key: "overview",
            label: "Overview",
            help_text: null,
            kind: "narrative",
            required: true,
            columns: [],
          },
        ],
      },
      {
        key: "empty_notes",
        title: "Empty notes",
        optional: true,
        fields: [
          {
            key: "empty_notes",
            label: "Empty notes",
            help_text: null,
            kind: "narrative",
            required: false,
            columns: [],
          },
        ],
      },
      {
        key: "blank_inventory",
        title: "Blank inventory",
        optional: true,
        fields: [
          {
            key: "blank_inventory",
            label: "Blank inventory",
            help_text: null,
            kind: "repeatable_rows",
            required: false,
            columns: ["Item", "Evidence"],
          },
        ],
      },
    ],
  };
  const publicationReport: GuidedReport = {
    ...report,
    title: "Illicit ecosystem assessment",
    template_id: publicationTemplate.id,
    included_sections: ["overview", "empty_notes", "blank_inventory"],
    fields: {
      overview: {
        type: "narrative",
        value: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Verified analytical overview." }],
            },
          ],
        },
      },
      empty_notes: {
        type: "narrative",
        value: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }],
        },
      },
      blank_inventory: {
        type: "rows",
        value: [{ Item: " ", Evidence: "" }],
      },
    },
  };

  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={publicationReport}
      template={publicationTemplate}
      onBusyChange={vi.fn()}
      onPublish={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  const navigation = screen.getByRole("navigation", { name: "Report sections" });
  const emptyNotes = within(navigation).getByRole("button", { name: /Empty notes/u });
  const blankInventory = within(navigation).getByRole("button", { name: /Blank inventory/u });
  expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
  await user.click(emptyNotes);
  expect(screen.getByRole("heading", { name: "Empty notes" })).toBeVisible();
  await user.click(blankInventory);
  expect(screen.getByRole("heading", { name: "Blank inventory" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Publish report" }));

  const choices = screen.getByRole("group", { name: "Included sections" });
  expect(within(choices).getByRole("switch", { name: "Include Overview" })).toBeChecked();
  expect(within(choices).queryByText("Empty notes")).not.toBeInTheDocument();
  expect(within(choices).queryByText("Blank inventory")).not.toBeInTheDocument();
});

it("shows one selected section at a time with status visible in bounded navigation", async () => {
  const user = userEvent.setup();
  const metadataSection = template.sections[0];
  if (!metadataSection) throw new Error("Campaign metadata test section is missing");
  const navigableTemplate: ReportTemplateDefinition = {
    ...template,
    sections: [
      metadataSection,
      {
        key: "evidence",
        title: "Evidence",
        optional: true,
        fields: [
          {
            key: "evidence_notes",
            label: "Evidence notes",
            help_text: null,
            kind: "narrative",
            required: false,
            columns: [],
          },
        ],
      },
    ],
  };
  const navigableReport: GuidedReport = {
    ...report,
    template_id: navigableTemplate.id,
    included_sections: ["campaign_metadata", "evidence"],
    fields: {
      ...report.fields,
      evidence_notes: { type: "narrative", value: { type: "doc", content: [] } },
    },
  };

  render(
    <div className="canvas">
      <GuidedReportEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        report={navigableReport}
        template={navigableTemplate}
        onBusyChange={vi.fn()}
        onSaved={vi.fn()}
      />
    </div>,
  );

  const navigation = screen.getByRole("navigation", { name: "Report sections" });
  const metadataButton = within(navigation).getByRole("button", { name: /Campaign metadata/u });
  expect(metadataButton).toHaveAttribute("aria-current", "page");
  expect(within(navigation).getByText("1 required")).toBeVisible();
  const evidenceButton = within(navigation).getByRole("button", { name: /Evidence/u });
  expect(evidenceButton).not.toHaveAttribute("aria-current");
  expect(within(navigation).getByText("Optional")).toBeVisible();
  expect(screen.getByText("Required before publishing")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Campaign metadata" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Evidence" })).not.toBeInTheDocument();

  await user.click(evidenceButton);

  expect(evidenceButton).toHaveAttribute("aria-current", "page");
  expect(metadataButton).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("heading", { name: "Evidence" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Campaign metadata" })).not.toBeInTheDocument();
});

it("offers contextual controls and project data only for compatible structured columns", async () => {
  const ecosystemTemplate: ReportTemplateDefinition = {
    ...template,
    builtin: null,
    name: "Illicit Ecosystem Report",
    sections: [
      {
        key: "site_inventory",
        title: "Site inventory",
        optional: true,
        fields: [
          {
            key: "sites",
            label: "Sites",
            help_text: null,
            kind: "repeatable_rows",
            required: false,
            columns: [
              "Domain or site",
              "Category",
              "First seen",
              "Status",
              "Linked identity",
              "Confidence",
            ],
          },
        ],
      },
    ],
  };
  const ecosystemReport: GuidedReport = {
    ...report,
    template_id: ecosystemTemplate.id,
    included_sections: ["site_inventory"],
    fields: { sites: { type: "rows", value: [] } },
  };
  const user = userEvent.setup();

  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={ecosystemReport}
      template={ecosystemTemplate}
      onBusyChange={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  expect(
    screen.queryByRole("button", { name: /Insert project data as new Sites row/u }),
  ).toBeNull();
  screen.getByRole("button", { name: "Add content to Site inventory" }).focus();
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitem", { name: "Sites table" }));
  await user.click(screen.getByRole("button", { name: "Add row" }));

  expect(
    screen.getByRole("button", { name: "Choose project data for Sites row 1 Domain or site" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Choose project data for Sites row 1 Linked identity" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Choose project data for Sites row 1 Category" }),
  ).toBeNull();
  expect(screen.getByLabelText("Sites row 1 First seen")).toHaveAttribute("type", "date");
  expect(screen.getByRole("combobox", { name: "Sites row 1 Status" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Sites row 1 Confidence" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Insert project data into Campaign name" }),
  ).toBeNull();
});

it("makes incident timeline rows fill their container with readable controls", async () => {
  const timelineTemplate: ReportTemplateDefinition = {
    ...template,
    name: "Intrusion Analysis",
    sections: [
      {
        key: "incident_metadata",
        title: "Incident metadata",
        optional: false,
        fields: [
          {
            key: "timeline",
            label: "Incident timeline",
            help_text: null,
            kind: "repeatable_rows",
            required: false,
            columns: ["Time", "Event", "Evidence"],
          },
        ],
      },
    ],
  };
  const timelineReport: GuidedReport = {
    ...report,
    template_id: timelineTemplate.id,
    included_sections: ["incident_metadata"],
    fields: { timeline: { type: "rows", value: [] } },
  };
  const user = userEvent.setup();

  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={timelineReport}
      template={timelineTemplate}
      onBusyChange={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  screen.getByRole("button", { name: "Add content to Incident metadata" }).focus();
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitem", { name: "Incident timeline table" }));
  await user.click(screen.getByRole("button", { name: "Add row" }));

  expect(screen.getByLabelText("Incident timeline row 1 Time")).toHaveClass(
    "guided-report-table-input",
  );
  expect(screen.getByLabelText("Incident timeline row 1 Time")).toHaveAttribute(
    "placeholder",
    "YYYY-MM-DD HH:MM timezone",
  );
  expect(screen.getByLabelText("Incident timeline row 1 Event").tagName).toBe("TEXTAREA");
  expect(screen.getByLabelText("Incident timeline row 1 Evidence").tagName).toBe("TEXTAREA");
  expect(
    screen.getByRole("button", {
      name: "Choose project data for Incident timeline row 1 Evidence",
    }),
  ).toHaveTextContent("Choose evidence");
  expect(screen.getByRole("button", { name: "Remove Incident timeline row 1" })).toHaveTextContent(
    "Remove row",
  );
});

it("renders the shared data-sources table with source-aware controls", async () => {
  const dataSourcesTemplate: ReportTemplateDefinition = {
    ...template,
    sections: [
      {
        key: "data_sources",
        title: "Data sources",
        optional: false,
        fields: [
          {
            key: "data_sources",
            label: "Data sources and citations",
            help_text: null,
            kind: "repeatable_rows",
            required: false,
            columns: ["Source", "Type", "Reference", "Accessed"],
          },
        ],
      },
    ],
  };
  const dataSourcesReport: GuidedReport = {
    ...report,
    template_id: dataSourcesTemplate.id,
    included_sections: ["data_sources"],
    fields: { data_sources: { type: "rows", value: [] } },
  };
  const user = userEvent.setup();

  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={dataSourcesReport}
      template={dataSourcesTemplate}
      onBusyChange={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  screen.getByRole("button", { name: "Add content to Data sources" }).focus();
  await user.keyboard("{Enter}");
  await user.click(
    await screen.findByRole("menuitem", { name: "Data sources and citations table" }),
  );
  await user.click(screen.getByRole("button", { name: "Add row" }));

  expect(screen.getByLabelText("Data sources and citations row 1 Source").tagName).toBe("TEXTAREA");
  expect(screen.getByLabelText("Data sources and citations row 1 Reference").tagName).toBe(
    "TEXTAREA",
  );
  expect(
    screen.getByRole("combobox", { name: "Data sources and citations row 1 Type" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Data sources and citations row 1 Accessed")).toHaveAttribute(
    "type",
    "date",
  );
  expect(
    screen.getByRole("button", {
      name: "Choose project data for Data sources and citations row 1 Source",
    }),
  ).toHaveTextContent("Choose source");
  expect(screen.getByRole("group", { name: "Data source 1" })).toHaveAttribute(
    "data-layout",
    "source-citation",
  );
  expect(screen.getByText("Data source 1")).toBeVisible();
});

it("inserts a labeled evidence link into a guided narrative", async () => {
  const user = userEvent.setup();
  vi.mocked(saveGuidedReport).mockResolvedValue({ ...report, revision: 2 });
  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={report}
      template={template}
      onBusyChange={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Add evidence link" }));
  await user.type(screen.getByLabelText("Evidence label"), "Downloaded interview video");
  await user.type(
    screen.getByLabelText("Evidence URL"),
    "https://video.example/evidence/interview",
  );
  await user.click(screen.getByRole("button", { name: "Insert evidence link" }));
  await user.click(screen.getByRole("button", { name: "Save report" }));

  const savedFields = vi.mocked(saveGuidedReport).mock.calls.at(-1)?.[4];
  const savedAnalysis = savedFields?.analysis;
  expect(savedAnalysis?.type).toBe("narrative");
  expect(JSON.stringify(savedAnalysis)).toContain(
    '"href":"https://video.example/evidence/interview"',
  );
  expect(JSON.stringify(savedAnalysis)).toContain('"text":"Downloaded interview video"');
});

it("imports an image once as project evidence and inserts its reference", async () => {
  const user = userEvent.setup();
  vi.mocked(saveGuidedReport).mockResolvedValue({ ...report, revision: 2 });
  vi.mocked(importEvidenceImage).mockResolvedValue({
    id: "21a6b93a-06ac-4f91-b0a3-46b58af592d1",
    mediaType: "image/png",
    fileName: "captured-storefront.png",
    byteLen: 1_024,
    sha256: "a".repeat(64),
    revision: 1,
    title: "Captured storefront",
    description: "",
    source: "",
    capturedAt: null,
    sourceUrl: "",
    tags: [],
    analystNotes: "",
    createdAtUnixMs: 1_000,
    updatedAtUnixMs: 1_000,
  });
  render(
    <GuidedReportEditor
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      report={report}
      template={template}
      onBusyChange={vi.fn()}
      onSaved={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Add evidence image" }));
  expect(await screen.findByText("No image evidence has been imported yet.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Import image as evidence" }));
  await user.click(screen.getByRole("button", { name: "Save report" }));

  expect(importEvidenceImage).toHaveBeenCalledWith("019b0dc2-34c8-7c31-a2e5-c447222ce0b9");
  const savedFields = vi.mocked(saveGuidedReport).mock.calls.at(-1)?.[4];
  const savedAnalysis = savedFields?.analysis;
  expect(savedAnalysis?.type).toBe("narrative");
  expect(JSON.stringify(savedAnalysis)).toContain(
    '"evidenceId":"21a6b93a-06ac-4f91-b0a3-46b58af592d1"',
  );
  expect(JSON.stringify(savedAnalysis)).toContain('"alt":"Captured storefront"');
});
