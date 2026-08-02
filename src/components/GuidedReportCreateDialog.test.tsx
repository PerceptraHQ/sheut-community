import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { ReportTemplateDefinition } from "../lib/guided-reports";
import { GuidedReportCreateDialog } from "./GuidedReportCreateDialog";

const names = [
  "Threat Actor Profile",
  "Intrusion Analysis",
  "Campaign Report",
  "Executive Report",
  "Blank Guided Report",
];

const templates = names.map(
  (name, index): ReportTemplateDefinition => ({
    schema_version: 1,
    id: `00000000-0000-4000-8000-00000000000${index}`,
    revision: 1,
    builtin: [
      "threat_actor_profile",
      "intrusion_analysis",
      "campaign_report",
      "executive_report",
      "blank_guided_report",
    ][index] as ReportTemplateDefinition["builtin"],
    name,
    description: `${name} description`,
    sections: [],
  }),
);

it("offers every built-in report type by its actual name", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(
    <GuidedReportCreateDialog
      creating={false}
      onCreate={onCreate}
      onOpenChange={vi.fn()}
      open
      templates={templates}
    />,
  );

  for (const name of names) {
    expect(screen.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  }

  await user.click(screen.getByRole("button", { name: /^Campaign Report/ }));
  expect(onCreate).toHaveBeenCalledWith(templates[2]);
});

it("copies a report structure and adds a project-local custom table", async () => {
  const user = userEvent.setup();
  const onCreateCustom = vi.fn().mockResolvedValue({
    ...templates[2],
    id: "00000000-0000-4000-8000-000000000099",
    builtin: null,
    name: "Piracy Ecosystem Report",
  });
  render(
    <GuidedReportCreateDialog
      creating={false}
      onCreate={vi.fn().mockResolvedValue(undefined)}
      onCreateCustom={onCreateCustom}
      onOpenChange={vi.fn()}
      open
      templates={templates}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Create custom template" }));
  await user.type(screen.getByLabelText("Template name"), "Piracy Ecosystem Report");
  await user.type(
    screen.getByLabelText("Description"),
    "Tracks sites, infrastructure, identities, and social profiles.",
  );
  await user.type(screen.getByLabelText("Section title"), "Social profiles");
  await user.click(screen.getByRole("combobox", { name: "Section content type" }));
  await user.click(screen.getByRole("option", { name: "Structured table" }));
  expect(screen.getByRole("combobox", { name: "Section content type" })).toHaveTextContent(
    "Structured table",
  );
  await user.type(
    screen.getByPlaceholderText("Platform, Handle, Profile link, Confidence, Source"),
    "Platform, Handle, Profile link, Source",
  );
  await user.click(screen.getByRole("button", { name: "Add section" }));
  await user.click(screen.getByRole("button", { name: "Create template" }));

  expect(onCreateCustom).toHaveBeenCalledWith(
    templates[2].id,
    "Piracy Ecosystem Report",
    "Tracks sites, infrastructure, identities, and social profiles.",
    [
      {
        key: "custom_social_profiles",
        title: "Social profiles",
        optional: true,
        fields: [
          {
            key: "custom_social_profiles_table",
            label: "Social profiles",
            help_text: null,
            kind: "repeatable_rows",
            required: false,
            columns: ["Platform", "Handle", "Profile link", "Source"],
          },
        ],
      },
    ],
  );
});
