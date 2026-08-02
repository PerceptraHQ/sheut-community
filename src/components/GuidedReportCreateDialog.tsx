import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import {
  IconArrowLeft,
  IconFileDescription,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { type SyntheticEvent, useRef, useState } from "react";
import type { ReportTemplateDefinition, ReportTemplateSection } from "../lib/guided-reports";
import { DialogFrame } from "./DialogFrame";
import { SelectField } from "./SelectField";

interface GuidedReportCreateDialogProps {
  creating: boolean;
  onCreate: (template: ReportTemplateDefinition) => Promise<void>;
  onCreateCustom?: (
    baseTemplateId: string,
    name: string,
    description: string,
    additionalSections: ReportTemplateSection[],
  ) => Promise<ReportTemplateDefinition>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  templates: readonly ReportTemplateDefinition[];
}

export function GuidedReportCreateDialog({
  creating,
  onCreate,
  onCreateCustom,
  onOpenChange,
  open,
  templates,
}: GuidedReportCreateDialogProps) {
  const [customizing, setCustomizing] = useState(false);
  const [savingCustom, setSavingCustom] = useState(false);
  const [baseTemplateId, setBaseTemplateId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sections, setSections] = useState<CustomSectionDraft[]>([]);
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionKind, setSectionKind] = useState<"narrative" | "table">("table");
  const [columns, setColumns] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nextSectionId = useRef(1);
  const busy = creating || savingCustom;
  const selectedBaseTemplateId =
    baseTemplateId ??
    templates.find((template) => template.builtin === "campaign_report")?.id ??
    templates[0]?.id ??
    null;

  const addSection = () => {
    const title = sectionTitle.trim();
    const parsedColumns = columns
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
    if (!title) {
      setError("Enter a section title.");
      return;
    }
    if (sectionKind === "table" && parsedColumns.length === 0) {
      setError("Add at least one comma-separated table column.");
      return;
    }
    setSections((current) => [
      ...current,
      {
        id: `custom-section-${nextSectionId.current++}`,
        title,
        kind: sectionKind,
        columns: sectionKind === "table" ? parsedColumns : [],
      },
    ]);
    setSectionTitle("");
    setColumns("");
    setError(null);
  };

  const createCustom = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    if (!onCreateCustom || !selectedBaseTemplateId || !name.trim() || !description.trim()) {
      setError("Choose a base template and enter a name and description.");
      return;
    }
    if (sections.length === 0) {
      setError("Add at least one custom section.");
      return;
    }
    setSavingCustom(true);
    setError(null);
    try {
      await onCreateCustom(
        selectedBaseTemplateId,
        name.trim(),
        description.trim(),
        customTemplateSections(
          sections,
          templates.find((template) => template.id === selectedBaseTemplateId),
        ),
      );
      setCustomizing(false);
      setName("");
      setDescription("");
      setSections([]);
    } catch {
      setError("The custom template could not be created.");
    } finally {
      setSavingCustom(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogFrame width="wide">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <div className="flex items-center gap-2">
            {customizing ? (
              <Button
                className="icon-control"
                type="button"
                aria-label="Back to report templates"
                disabled={busy}
                onClick={() => setCustomizing(false)}
              >
                <IconArrowLeft size={16} aria-hidden="true" />
              </Button>
            ) : null}
            <Dialog.Title className="m-0 text-sm font-semibold">
              {customizing ? "Create custom report template" : "New guided report"}
            </Dialog.Title>
          </div>
          <Dialog.Close
            render={<Button className="icon-control" />}
            aria-label="Close"
            disabled={busy}
          >
            <IconX size={16} stroke={1.7} aria-hidden="true" />
          </Dialog.Close>
        </header>
        {customizing ? (
          <form
            className="grid max-h-[75vh] gap-4 overflow-y-auto p-4"
            onSubmit={(event) => void createCustom(event)}
          >
            <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
              Copy a proven report structure, then add project-specific narrative or table sections.
              The saved template remains local to this encrypted project.
            </Dialog.Description>
            <SelectField
              ariaLabel="Base report template"
              label="Copy from"
              onChange={setBaseTemplateId}
              options={templates.map((template) => ({
                value: template.id,
                label: template.name,
              }))}
              placeholder="Choose a base template"
              required
              value={selectedBaseTemplateId}
            />
            <label className="grid gap-1.5 text-copy-secondary text-xs">
              Template name
              <input
                className="control-input"
                maxLength={120}
                required
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <label className="grid gap-1.5 text-copy-secondary text-xs">
              Description
              <textarea
                className="min-h-20 resize-y rounded-sm border border-panel-border bg-panel-deep px-2.5 py-2 text-copy-primary text-sm outline-none focus:border-accent"
                maxLength={500}
                required
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
            </label>
            <section
              className="grid gap-3 rounded-sm border border-panel-border bg-panel-deep p-3"
              aria-labelledby="custom-section-title"
            >
              <h3 className="m-0 text-sm font-semibold" id="custom-section-title">
                Additional sections
              </h3>
              {sections.map((section) => (
                <div
                  className="flex items-center gap-3 rounded-sm bg-panel-base px-3 py-2"
                  key={section.id}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-copy-primary text-xs">
                      {section.title}
                    </span>
                    <span className="block text-copy-faint text-[11px]">
                      {section.kind === "table"
                        ? `Table · ${section.columns.join(", ")}`
                        : "Narrative"}
                    </span>
                  </span>
                  <Button
                    className="icon-control"
                    type="button"
                    aria-label={`Remove ${section.title}`}
                    onClick={() =>
                      setSections((current) => current.filter((item) => item.id !== section.id))
                    }
                  >
                    <IconTrash size={14} aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-copy-secondary text-xs">
                  Section title
                  <input
                    className="control-input"
                    maxLength={120}
                    value={sectionTitle}
                    onChange={(event) => setSectionTitle(event.currentTarget.value)}
                  />
                </label>
                <SelectField
                  ariaLabel="Section content type"
                  label="Content type"
                  onChange={(value) => setSectionKind(value as "narrative" | "table")}
                  options={[
                    { value: "table", label: "Structured table" },
                    { value: "narrative", label: "Rich-text narrative" },
                  ]}
                  placeholder="Choose content type"
                  value={sectionKind}
                />
              </div>
              {sectionKind === "table" ? (
                <label className="grid gap-1.5 text-copy-secondary text-xs">
                  Table columns
                  <input
                    className="control-input"
                    maxLength={500}
                    placeholder="Platform, Handle, Profile link, Confidence, Source"
                    value={columns}
                    onChange={(event) => setColumns(event.currentTarget.value)}
                  />
                  <span className="text-copy-faint text-[11px]">
                    Separate column names with commas.
                  </span>
                </label>
              ) : null}
              <Button
                className="control-button justify-self-start"
                type="button"
                onClick={addSection}
              >
                <IconPlus size={14} aria-hidden="true" />
                Add section
              </Button>
            </section>
            {error ? (
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                className="control-button"
                type="button"
                disabled={busy}
                onClick={() => setCustomizing(false)}
              >
                Cancel
              </Button>
              <Button className="primary-button" type="submit" disabled={busy}>
                {savingCustom ? "Creating…" : "Create template"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="grid gap-4 p-4">
            <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
              Choose the report structure. The template controls editorial fields; branding and page
              settings remain publication choices.
            </Dialog.Description>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {templates.map((template) => (
                <Button
                  className="grid min-h-24 grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-3 rounded-sm border border-panel-border bg-panel-deep p-3 text-left outline-none hover:border-accent hover:bg-panel-hover focus-visible:border-accent disabled:opacity-60"
                  type="button"
                  disabled={busy}
                  key={template.id}
                  onClick={() => void onCreate(template)}
                  aria-label={`${template.name} — ${template.description}`}
                >
                  <IconFileDescription
                    className="mt-0.5 text-accent"
                    size={18}
                    stroke={1.7}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-copy-primary text-sm">
                      {template.name}
                    </span>
                    <span className="mt-1 block text-copy-muted text-xs leading-5">
                      {template.description}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
            {templates.length === 0 ? (
              <p className="list-message" role="status">
                Report templates are unavailable. Reopen the project and try again.
              </p>
            ) : null}
            {onCreateCustom ? (
              <div className="flex justify-end border-panel-border border-t pt-3">
                <Button
                  className="control-button"
                  type="button"
                  onClick={() => setCustomizing(true)}
                >
                  <IconPlus size={14} aria-hidden="true" />
                  Create custom template
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </DialogFrame>
    </Dialog.Root>
  );
}

interface CustomSectionDraft {
  id: string;
  title: string;
  kind: "narrative" | "table";
  columns: string[];
}

function customTemplateSections(
  sections: readonly CustomSectionDraft[],
  baseTemplate: ReportTemplateDefinition | undefined,
): ReportTemplateSection[] {
  const usedSectionKeys = new Set(baseTemplate?.sections.map((section) => section.key) ?? []);
  const usedFieldKeys = new Set(
    baseTemplate?.sections.flatMap((section) => section.fields.map((field) => field.key)) ?? [],
  );
  return sections.map((section, index) => {
    const base = `custom_${slug(section.title) || `section_${index + 1}`}`;
    let key = base;
    let suffix = 2;
    let fieldKey = `${key}_${section.kind === "table" ? "table" : "narrative"}`;
    while (usedSectionKeys.has(key) || usedFieldKeys.has(fieldKey)) {
      key = `${base}_${suffix}`;
      fieldKey = `${key}_${section.kind === "table" ? "table" : "narrative"}`;
      suffix += 1;
    }
    usedSectionKeys.add(key);
    usedFieldKeys.add(fieldKey);
    return {
      key,
      title: section.title,
      optional: true,
      fields: [
        {
          key: fieldKey,
          label: section.title,
          help_text: null,
          kind: section.kind === "table" ? "repeatable_rows" : "narrative",
          required: false,
          columns: section.columns,
        },
      ],
    };
  });
}

function slug(value: string): string {
  return value
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}
