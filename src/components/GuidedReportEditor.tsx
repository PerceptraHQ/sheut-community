import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { Menu } from "@base-ui/react/menu";
import {
  IconBold,
  IconDeviceFloppy,
  IconFileExport,
  IconItalic,
  IconLink,
  IconLinkOff,
  IconList,
  IconListNumbers,
  IconPhotoPlus,
  IconPlus,
  IconQuote,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defangUrls } from "../lib/defang";
import { isWorkspaceActionEvent, WORKSPACE_ACTION_EVENT } from "../lib/desktopActions";
import {
  type DocumentPublicationOptions,
  type DocumentRoot,
  publicationSelectionsFromRoots,
} from "../lib/documents";
import { normalizeEditorLink } from "../lib/editor-content";
import {
  type EvidenceFileMetadata,
  type GuidedReport,
  type GuidedReportFieldValue,
  guidedReportErrorMessage,
  importEvidenceImage,
  listEvidenceFiles,
  type ProjectDataSelection,
  type ReportSectionDisposition,
  type ReportTemplateDefinition,
  type ReportTemplateField,
  type ReportTemplateSection,
  saveGuidedReport,
  updateGuidedReportSectionDisposition,
} from "../lib/guided-reports";
import { createEvidenceImageExtension } from "../lib/image-attachment-extension";
import type { TlpMarking } from "../lib/projects";
import { reportFieldProjectSource } from "../lib/reportHelp";
import { AutocompleteField } from "./AutocompleteField";
import { DialogFrame } from "./DialogFrame";
import { ProjectDataPicker } from "./ProjectDataPicker";
import { PublicationDialog } from "./PublicationDialog";
import { SelectField, type SelectFieldOption } from "./SelectField";
import { useVaultNotices } from "./VaultNotices";

interface GuidedReportEditorProps {
  onBusyChange: (busy: boolean) => void;
  onPublish?: (options: DocumentPublicationOptions) => Promise<void>;
  onSaved: (report: GuidedReport) => void;
  onUpgrade?: () => Promise<void>;
  projectId: string;
  report: GuidedReport;
  template: ReportTemplateDefinition;
  latestTemplateRevision?: number;
  defaultTlpMarking?: TlpMarking;
}

const confidenceOptions: readonly SelectFieldOption[] = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
];

const rowStatusOptions = ["Active", "Inactive", "Unknown", "Suspended", "Seized"].map((value) => ({
  value,
  label: value,
}));

const sourceTypeOptions = [
  "First-party observation",
  "Evidence capture",
  "Open-source intelligence",
  "Commercial data",
  "Public record",
  "Interview",
  "Partner reporting",
  "Vendor reporting",
].map((value) => ({ value, label: value }));

type EvidenceImageDestination =
  | "inline"
  | "evidence_images"
  | "indicators_observables"
  | "sources_methodology"
  | "custom";

const evidencePlacementOptions: readonly SelectFieldOption[] = [
  { value: "inline", label: "Inline in this section" },
  { value: "evidence_images", label: "Appendix — Evidence images" },
  { value: "indicators_observables", label: "Appendix — Indicators and observables" },
  { value: "sources_methodology", label: "Appendix — Sources and methodology" },
  { value: "custom", label: "Custom appendix" },
];

const AUTOSAVE_DELAY_MS = 2_500;
let tableRowSequence = 0;

function nextTableRowKey(fieldKey: string): string {
  tableRowSequence += 1;
  return `${fieldKey}-row-${tableRowSequence}`;
}

export function GuidedReportEditor({
  onBusyChange,
  onPublish,
  onSaved,
  onUpgrade,
  projectId,
  report,
  template,
  latestTemplateRevision,
  defaultTlpMarking = "amber",
}: GuidedReportEditorProps) {
  const notices = useVaultNotices();
  const [title, setTitle] = useState(report.title);
  const [fields, setFields] = useState(report.fields);
  const [revision, setRevision] = useState(report.revision);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [publicationOpen, setPublicationOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [sectionDispositions, setSectionDispositions] = useState<
    Record<string, ReportSectionDisposition>
  >(report.section_dispositions ?? {});
  const [publishing, setPublishing] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const fieldsRef = useRef(fields);
  const titleRef = useRef(title);
  const revisionRef = useRef(report.revision);
  const savingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const includedTemplateSections = useMemo(
    () => template.sections.filter((section) => report.included_sections.includes(section.key)),
    [report.included_sections, template.sections],
  );
  const [activeSectionKey, setActiveSectionKey] = useState(
    report.included_sections[0] ?? template.sections[0]?.key ?? "",
  );
  const activeSection =
    includedTemplateSections.find((section) => section.key === activeSectionKey) ??
    includedTemplateSections[0];
  const publicationSections = useMemo(
    () =>
      includedTemplateSections
        .filter(
          (section) =>
            (sectionDispositions[section.key] ?? "active") === "active" &&
            section.fields.some((field) => guidedFieldHasPublicationContent(fields[field.key])),
        )
        .map((section) => ({ key: section.key, label: section.title })),
    [fields, includedTemplateSections, sectionDispositions],
  );
  const publicationAppendices = useMemo(
    () =>
      publicationSelectionsFromRoots(
        Object.values(fields).flatMap((value) => (value.type === "narrative" ? [value.value] : [])),
      ).appendices,
    [fields],
  );

  const save = useCallback(async () => {
    if (savingRef.current || saveState === "saved") return;
    const titleIssue = reportTitleValidationMessage(titleRef.current);
    if (titleIssue) {
      setTitleTouched(true);
      notices.add({ title: "Report not saved", description: titleIssue, type: "info" });
      return;
    }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    savingRef.current = true;
    const submittedFields = fieldsRef.current;
    setSaveState("saving");
    try {
      const saved = await saveGuidedReport(
        projectId,
        report.id,
        revisionRef.current,
        titleRef.current,
        submittedFields,
      );
      revisionRef.current = saved.revision;
      setRevision(saved.revision);
      onSaved(saved);
      if (fieldsRef.current === submittedFields) {
        setSaveState("saved");
        onBusyChange(false);
      } else {
        setSaveState("pending");
        timerRef.current = window.setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS);
      }
    } catch (cause) {
      setSaveState("error");
      const description = guidedReportErrorMessage(cause);
      notices.add({
        title: "Report not saved",
        description,
        type: "info",
      });
      onBusyChange(true);
    } finally {
      savingRef.current = false;
    }
  }, [notices, onBusyChange, onSaved, projectId, report.id, saveState]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      onBusyChange(false);
    },
    [onBusyChange],
  );

  const updateField = (key: string, value: GuidedReportFieldValue) => {
    setFields((current) => {
      const next = { ...current, [key]: value };
      fieldsRef.current = next;
      return next;
    });
    setSaveState("pending");
    onBusyChange(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS);
  };

  const updateTitle = (value: string) => {
    setTitle(value);
    titleRef.current = value;
    setSaveState("pending");
    onBusyChange(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS);
  };

  const openPublication = useCallback(() => {
    setValidationAttempted(true);
    const issues = publicationValidationMessages(
      titleRef.current,
      template,
      report.included_sections,
      sectionDispositions,
      fieldsRef.current,
    );
    if (issues.length > 0) {
      const firstInvalidSection = includedTemplateSections.find(
        (section) =>
          (sectionDispositions[section.key] ?? "active") === "active" &&
          section.fields.some((field) =>
            guidedFieldValidationMessage(field, fieldsRef.current[field.key]),
          ),
      );
      if (firstInvalidSection) setActiveSectionKey(firstInvalidSection.key);
      const description =
        issues.length === 1
          ? issues[0]
          : `${issues[0]} Fix ${issues.length - 1} more highlighted ${issues.length === 2 ? "field" : "fields"}.`;
      notices.add({ title: "Report not ready to publish", description, type: "info" });
      return;
    }
    setPublicationOpen(true);
  }, [includedTemplateSections, notices, report.included_sections, sectionDispositions, template]);

  const updateSectionDisposition = async (
    sectionKey: string,
    disposition: ReportSectionDisposition,
  ) => {
    onBusyChange(true);
    try {
      const saved = await notices.promise(
        () =>
          updateGuidedReportSectionDisposition(
            projectId,
            report.id,
            revisionRef.current,
            sectionKey,
            disposition,
          ),
        {
          loading: {
            title: "Updating section",
            description: "Saving the section completion state.",
            type: "info",
          },
          success: {
            title: disposition === "not_applicable" ? "Section not applicable" : "Section active",
            description: "The report revision was updated.",
            type: "success",
          },
          error: (cause) => ({
            title: "Section not updated",
            description: guidedReportErrorMessage(cause),
            type: "info",
          }),
        },
      );
      revisionRef.current = saved.revision;
      setRevision(saved.revision);
      setSectionDispositions(saved.section_dispositions ?? {});
      onSaved(saved);
    } finally {
      onBusyChange(false);
    }
  };

  useEffect(() => {
    const handleWorkspaceAction = (event: Event) => {
      if (!isWorkspaceActionEvent(event)) return;
      if (event.detail === "file.save") {
        if (saveState === "saved") {
          notices.add({
            title: "Already saved",
            description: `Revision ${revisionRef.current} is current.`,
            type: "info",
          });
        } else {
          void saveRef.current();
        }
        return;
      }
      if (event.detail === "file.publish" && onPublish) {
        if (saveState !== "saved") {
          notices.add({
            title: "Report not ready to publish",
            description: "Save the current report revision before opening Publish.",
            type: "info",
          });
          return;
        }
        openPublication();
      }
    };
    window.addEventListener(WORKSPACE_ACTION_EVENT, handleWorkspaceAction);
    return () => window.removeEventListener(WORKSPACE_ACTION_EVENT, handleWorkspaceAction);
  }, [notices, onPublish, openPublication, saveState]);

  const startUpgrade = () => {
    if (!onUpgrade) return;
    setUpgrading(true);
    void onUpgrade()
      .then(() => setUpgradeOpen(false))
      .catch(() => undefined)
      .finally(() => setUpgrading(false));
  };

  const titleValidation = reportTitleValidationMessage(title);

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 px-5 py-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav
        aria-label="Report sections"
        className="sticky top-0 z-20 -mx-1 flex gap-1 overflow-x-auto rounded-sm border border-panel-border bg-panel-raised p-2 lg:top-5 lg:mx-0 lg:grid lg:self-start lg:overflow-visible"
      >
        <p className="m-0 hidden px-2 pt-1 pb-1 text-[10px] text-copy-faint uppercase tracking-wider lg:block">
          Sections
        </p>
        {includedTemplateSections.map((section) => {
          const status = guidedSectionStatus(
            section,
            fields,
            sectionDispositions[section.key] ?? "active",
          );
          return (
            <button
              aria-current={activeSection?.key === section.key ? "page" : undefined}
              className={`flex min-w-max items-center justify-between gap-3 rounded-sm border-0 px-2 py-1.5 text-left text-copy-secondary text-xs hover:bg-panel-hover hover:text-copy-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent lg:min-w-0 ${
                activeSection?.key === section.key
                  ? "bg-panel-hover text-copy-primary"
                  : "bg-transparent"
              }`}
              key={section.key}
              onClick={() => setActiveSectionKey(section.key)}
              type="button"
            >
              <span className="truncate">{section.title}</span>
              <span
                className={
                  status.kind === "needs-input"
                    ? "shrink-0 text-[10px] text-accent-hover"
                    : "shrink-0 text-[10px] text-copy-faint"
                }
              >
                {status.label}
              </span>
            </button>
          );
        })}
      </nav>

      <article className="grid min-w-0 gap-5">
        {onUpgrade && latestTemplateRevision && latestTemplateRevision > template.revision ? (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-accent/40 bg-panel-raised px-4 py-3">
            <div>
              <p className="m-0 font-medium text-copy-primary text-sm">
                Updated Illicit Ecosystem structure available
              </p>
              <p className="mt-1 mb-0 text-copy-muted text-xs leading-5">
                Upgrade explicitly to revision {latestTemplateRevision}. The current encrypted
                revision remains available for historical publication and restoration.
              </p>
            </div>
            <Button
              className="primary-button"
              type="button"
              disabled={saveState !== "saved"}
              onClick={() => setUpgradeOpen(true)}
            >
              Upgrade structure
            </Button>
          </section>
        ) : null}
        <Dialog.Root open={upgradeOpen} onOpenChange={setUpgradeOpen}>
          <DialogFrame width="standard">
            <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
              <Dialog.Title className="m-0 text-sm font-semibold">
                Upgrade Illicit Ecosystem Report
              </Dialog.Title>
              <Dialog.Close render={<Button className="icon-control" />} aria-label="Close">
                <IconX size={16} stroke={1.7} aria-hidden="true" />
              </Dialog.Close>
            </header>
            <div className="grid gap-4 p-4">
              <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
                Equivalent fields and tables will move into the reconstructed structure. Ambiguous
                legacy values are preserved as labeled legacy metadata. Existing report revisions,
                evidence references, and publication history are not replaced.
              </Dialog.Description>
              <div className="flex justify-end gap-2">
                <Dialog.Close render={<Button className="control-button" />} type="button">
                  Cancel
                </Dialog.Close>
                <Button
                  className="primary-button"
                  disabled={upgrading}
                  type="button"
                  onClick={startUpgrade}
                >
                  {upgrading ? "Upgrading…" : "Create upgraded revision"}
                </Button>
              </div>
            </div>
          </DialogFrame>
        </Dialog.Root>
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 rounded-sm border border-panel-border bg-panel-raised px-4 py-3 shadow-lg">
          <div className="min-w-0">
            <p className="m-0 text-[11px] text-copy-faint uppercase tracking-[0.12em]">
              {template.name} · revision {revision}
            </p>
            <Field.Root
              className="grid gap-1"
              invalid={(titleTouched || validationAttempted) && Boolean(titleValidation)}
              onBlurCapture={() => setTitleTouched(true)}
            >
              <Field.Control
                aria-label="Report title"
                autoComplete="off"
                className="mt-1 min-h-8 w-full min-w-64 resize-none overflow-hidden border-0 bg-transparent p-0 text-lg font-semibold leading-8 outline-none focus:ring-1 focus:ring-accent"
                maxLength={200}
                render={<textarea rows={1} />}
                value={title}
                onValueChange={updateTitle}
              />
              <Field.Error
                className="m-0 text-danger text-xs"
                match={(titleTouched || validationAttempted) && Boolean(titleValidation)}
              >
                {titleValidation}
              </Field.Error>
            </Field.Root>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-copy-muted text-xs" role="status">
              {saveState === "saving"
                ? "Saving…"
                : saveState === "pending"
                  ? "Unsaved changes"
                  : saveState === "error"
                    ? "Save failed"
                    : "Saved"}
            </span>
            <Button
              className="primary-button"
              type="button"
              disabled={saveState === "saved" || saveState === "saving"}
              onClick={() => void save()}
              aria-label="Save report"
            >
              <IconDeviceFloppy size={15} stroke={1.7} aria-hidden="true" />
              Save report
            </Button>
            <Button
              className="control-button"
              type="button"
              disabled={!onPublish || saveState !== "saved" || publishing}
              onClick={openPublication}
              aria-label="Publish report"
            >
              <IconFileExport size={15} stroke={1.7} aria-hidden="true" />
              Publish
            </Button>
          </div>
        </header>

        {onPublish && publicationOpen ? (
          <PublicationDialog
            busy={publishing}
            defaultTlpMarking={defaultTlpMarking}
            initialFileName={report.title}
            onOpenChange={setPublicationOpen}
            onPublish={async (options) => {
              setPublishing(true);
              try {
                await onPublish(options);
              } finally {
                setPublishing(false);
              }
            }}
            open={publicationOpen}
            projectId={projectId}
            sourceId={report.id}
            sections={publicationSections}
            appendices={publicationAppendices}
          />
        ) : null}

        {includedTemplateSections
          .filter((section) => section.key === activeSection?.key)
          .map((section) => {
            const disposition = sectionDispositions[section.key] ?? "active";
            const status = guidedSectionStatus(section, fields, disposition);
            return (
              <section
                className="grid scroll-mt-20 gap-4 rounded-sm border border-panel-border bg-panel-base p-4"
                key={section.key}
                aria-labelledby={`report-section-${section.key}`}
              >
                <header className="flex items-center gap-2 border-panel-border border-b pb-3">
                  <h2 className="m-0 text-sm font-semibold" id={`report-section-${section.key}`}>
                    {section.title}
                  </h2>
                  {section.optional ? (
                    <span className="rounded-sm bg-panel-deep px-1.5 py-0.5 text-[10px] text-copy-faint uppercase tracking-wide">
                      Optional
                    </span>
                  ) : null}
                  {section.optional ? (
                    <Button
                      className="control-button ml-auto px-2 py-1 text-[10px]"
                      type="button"
                      disabled={saveState !== "saved"}
                      onClick={() =>
                        void updateSectionDisposition(
                          section.key,
                          disposition === "not_applicable" ? "active" : "not_applicable",
                        )
                      }
                    >
                      {disposition === "not_applicable" ? "Use section" : "Not applicable"}
                    </Button>
                  ) : null}
                  <span
                    className={
                      status.kind === "needs-input"
                        ? `${section.optional ? "" : "ml-auto"} text-[11px] text-accent-hover`
                        : `${section.optional ? "" : "ml-auto"} text-[11px] text-copy-faint`
                    }
                  >
                    {status.label}
                  </span>
                </header>
                {section.guidance ? (
                  <p className="m-0 rounded-sm border border-panel-border bg-panel-deep px-3 py-2 text-copy-muted text-xs leading-5">
                    {section.guidance}
                  </p>
                ) : null}
                {section.key === "report_administration" ? (
                  <p className="m-0 rounded-sm border border-panel-border bg-panel-deep px-3 py-2 text-copy-muted text-xs leading-5">
                    The report title is set above. Choose the release version and handling marking
                    in Publish; both are stored in the publication snapshot and reproduced in HTML,
                    DOCX, and PDF.
                  </p>
                ) : null}
                {disposition === "not_applicable" ? (
                  <p className="m-0 text-copy-muted text-sm">
                    This optional section is recorded as not applicable and will not be published.
                  </p>
                ) : (
                  <GuidedSectionFields
                    fields={fields}
                    projectId={projectId}
                    section={section}
                    validationAttempted={validationAttempted}
                    onChange={updateField}
                  />
                )}
              </section>
            );
          })}
      </article>
    </div>
  );
}

function GuidedSectionFields({
  fields,
  onChange,
  projectId,
  section,
  validationAttempted,
}: {
  fields: Record<string, GuidedReportFieldValue>;
  onChange: (key: string, value: GuidedReportFieldValue) => void;
  projectId: string;
  section: ReportTemplateSection;
  validationAttempted: boolean;
}) {
  const [revealedFieldKeys, setRevealedFieldKeys] = useState<ReadonlySet<string>>(() => new Set());
  const primaryNarrative = section.fields.find((field) => field.kind === "narrative");
  const visibleFields = section.fields.filter(
    (field) =>
      field.required ||
      field.key === primaryNarrative?.key ||
      revealedFieldKeys.has(field.key) ||
      guidedFieldHasPublicationContent(fields[field.key]),
  );
  const hiddenFields = section.fields.filter(
    (field) => !visibleFields.some((visibleField) => visibleField.key === field.key),
  );
  const renderField = (field: ReportTemplateField) => (
    <GuidedField
      field={field}
      key={field.key}
      projectId={projectId}
      value={fields[field.key]}
      validationAttempted={validationAttempted}
      onChange={(value) => onChange(field.key, value)}
    />
  );
  return (
    <div className="grid gap-4">
      {visibleFields.map(renderField)}
      {hiddenFields.length > 0 ? (
        <div className="flex items-center justify-between gap-3 border-panel-border border-t pt-3">
          <p className="m-0 text-copy-faint text-[11px] leading-4">
            Add only the structured content this section needs.
          </p>
          <Menu.Root>
            <Menu.Trigger
              aria-label={`Add content to ${section.title}`}
              className="control-button shrink-0"
            >
              <IconPlus size={14} stroke={1.7} aria-hidden="true" />
              Add to section
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner align="end" className="z-50 outline-none" sideOffset={5}>
                <Menu.Popup className="min-w-64 origin-[var(--transform-origin)] rounded-sm border border-panel-border bg-panel-raised p-1 shadow-xl ring-1 ring-white/5 outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
                  <Menu.Group>
                    <Menu.GroupLabel className="px-2 py-1 text-[11px] text-copy-faint uppercase tracking-wider">
                      Available content
                    </Menu.GroupLabel>
                    {hiddenFields.map((field) => (
                      <Menu.Item
                        className="grid cursor-default grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-sm px-2 py-1.5 text-copy-secondary text-xs outline-none data-highlighted:bg-panel-hover data-highlighted:text-copy-primary"
                        key={field.key}
                        onClick={() =>
                          setRevealedFieldKeys((current) => new Set(current).add(field.key))
                        }
                      >
                        <IconPlus size={13} stroke={1.7} aria-hidden="true" />
                        <span>{sectionFieldMenuLabel(field)}</span>
                      </Menu.Item>
                    ))}
                  </Menu.Group>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      ) : null}
    </div>
  );
}

function sectionFieldMenuLabel(field: ReportTemplateField): string {
  if (field.kind === "repeatable_rows") return `${field.label} table`;
  if (field.kind === "project_references") return `${field.label} references`;
  return field.label;
}

function GuidedField({
  field,
  onChange,
  projectId,
  validationAttempted,
  value,
}: {
  field: ReportTemplateField;
  onChange: (value: GuidedReportFieldValue) => void;
  projectId: string;
  validationAttempted: boolean;
  value: GuidedReportFieldValue | undefined;
}) {
  const [touched, setTouched] = useState(false);
  const label = field.required ? `${field.label} (required)` : field.label;
  const validationMessage = guidedFieldValidationMessage(field, value);
  const showValidation = (touched || validationAttempted) && Boolean(validationMessage);
  const commonRootProps = {
    invalid: showValidation,
    onBlurCapture: () => setTouched(true),
  };
  if (field.kind === "narrative") {
    const root = value?.type === "narrative" ? value.value : emptyNarrative();
    return (
      <Field.Root className="grid gap-1.5" {...commonRootProps}>
        <Field.Label
          className="font-medium text-copy-secondary text-xs"
          nativeLabel={false}
          render={<span />}
        >
          {label}
        </Field.Label>
        <GuidedNarrativeInput
          ariaLabel={label}
          projectId={projectId}
          value={root}
          onChange={(next) => onChange({ type: "narrative", value: next })}
        />
        <GuidedFieldDescription field={field} />
        <GuidedFieldReadiness
          field={field}
          validationMessage={validationMessage}
          validationVisible={showValidation}
        />
        <GuidedFieldError message={validationMessage} visible={showValidation} />
      </Field.Root>
    );
  }
  if (field.kind === "repeatable_rows") {
    const rows = value?.type === "rows" ? value.value : [];
    return (
      <div className="grid gap-1.5" onBlurCapture={() => setTouched(true)}>
        <GuidedRows
          field={field}
          projectId={projectId}
          rows={rows}
          onChange={(next) => onChange({ type: "rows", value: next })}
        />
        <p className="m-0 text-copy-faint text-[11px] leading-4">
          {field.help_text ?? reportFieldProjectSource(field.label)}
        </p>
        <GuidedFieldReadiness
          field={field}
          validationMessage={validationMessage}
          validationVisible={showValidation}
        />
        {showValidation ? (
          <p className="m-0 text-danger text-xs" role="alert">
            {validationMessage}
          </p>
        ) : null}
      </div>
    );
  }
  if (field.kind === "project_references") {
    const references = value?.type === "project_references" ? value.value : [];
    return (
      <Field.Root className="grid gap-1.5" {...commonRootProps}>
        <div className="flex items-center justify-between gap-3">
          <Field.Label
            className="font-medium text-copy-secondary text-xs"
            nativeLabel={false}
            render={<span />}
          >
            {label}
          </Field.Label>
          <ProjectDataPicker
            projectId={projectId}
            triggerLabel={`Add project reference to ${field.label}`}
            onInsert={(reference) =>
              onChange({
                type: "project_references",
                value: references.some(
                  (existing) => existing.kind === reference.kind && existing.id === reference.id,
                )
                  ? references
                  : [
                      ...references,
                      { kind: reference.kind, id: reference.id, label: reference.label },
                    ],
              })
            }
          />
        </div>
        <div className="rounded-sm border border-dashed border-panel-border bg-panel-deep px-3 py-2 text-copy-muted text-xs leading-5">
          {references.length > 0
            ? references.map((reference) => reference.label).join(", ")
            : "No project data referenced yet. Reference insertion is enabled with the evidence workflow."}
        </div>
        <GuidedFieldDescription field={field} />
        <GuidedFieldReadiness
          field={field}
          validationMessage={validationMessage}
          validationVisible={showValidation}
        />
        <GuidedFieldError message={validationMessage} visible={showValidation} />
      </Field.Root>
    );
  }
  const text = value?.type === "text" ? value.value : "";
  if (field.kind === "confidence") {
    return (
      <Field.Root className="grid gap-1.5" {...commonRootProps}>
        <Field.Label
          className="font-medium text-copy-secondary text-xs"
          nativeLabel={false}
          render={<span />}
        >
          {label}
        </Field.Label>
        <SelectField
          ariaLabel={label}
          onChange={(next) => onChange({ type: "text", value: next })}
          options={confidenceOptions}
          placeholder="Choose confidence"
          required={field.required}
          value={text || null}
        />
        <GuidedFieldDescription field={field} />
        <GuidedFieldReadiness
          field={field}
          validationMessage={validationMessage}
          validationVisible={showValidation}
        />
        <GuidedFieldError message={validationMessage} visible={showValidation} />
      </Field.Root>
    );
  }
  if (field.kind === "choice") {
    const options = (field.options ?? []).map((option) => ({ value: option, label: option }));
    return (
      <Field.Root className="grid gap-1.5" {...commonRootProps}>
        <Field.Label
          className="font-medium text-copy-secondary text-xs"
          nativeLabel={false}
          render={<span />}
        >
          {label}
        </Field.Label>
        <SelectField
          ariaLabel={label}
          onChange={(next) => onChange({ type: "text", value: next })}
          options={options}
          placeholder={`Choose ${field.label.toLowerCase()}`}
          required={field.required}
          value={text || null}
        />
        <GuidedFieldDescription field={field} />
        <GuidedFieldReadiness
          field={field}
          validationMessage={validationMessage}
          validationVisible={showValidation}
        />
        <GuidedFieldError message={validationMessage} visible={showValidation} />
      </Field.Root>
    );
  }
  if (field.kind === "long_text" || field.kind === "short_text") {
    return (
      <Field.Root className="grid gap-1.5" {...commonRootProps}>
        <Field.Label className="font-medium text-copy-secondary text-xs">{label}</Field.Label>
        <Field.Control
          aria-label={label}
          autoComplete="off"
          className={`${field.kind === "long_text" ? "min-h-28" : "min-h-16"} resize-y rounded-sm border border-panel-border bg-panel-deep px-2.5 py-2 font-normal text-copy-primary text-sm leading-6 outline-none focus:border-accent`}
          maxLength={field.kind === "short_text" ? 500 : 100_000}
          render={<textarea rows={field.kind === "long_text" ? 5 : 2} />}
          value={text}
          required={field.required}
          onValueChange={(next) => onChange({ type: "text", value: next })}
        />
        <GuidedFieldDescription field={field} />
        <GuidedFieldReadiness
          field={field}
          validationMessage={validationMessage}
          validationVisible={showValidation}
        />
        <GuidedFieldError message={validationMessage} visible={showValidation} />
      </Field.Root>
    );
  }
  if (field.kind === "date") {
    return (
      <Field.Root className="grid gap-1.5" {...commonRootProps}>
        <Field.Label className="font-medium text-copy-secondary text-xs">{label}</Field.Label>
        <Field.Control
          aria-label={label}
          autoComplete="off"
          className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 font-normal text-copy-primary text-sm outline-none focus:border-accent"
          type="date"
          value={text}
          required={field.required}
          onValueChange={(next) => onChange({ type: "text", value: next })}
        />
        <GuidedFieldDescription field={field} />
        <GuidedFieldReadiness
          field={field}
          validationMessage={validationMessage}
          validationVisible={showValidation}
        />
        <GuidedFieldError message={validationMessage} visible={showValidation} />
      </Field.Root>
    );
  }
  return null;
}

function GuidedFieldDescription({ field }: { field: ReportTemplateField }) {
  return (
    <Field.Description className="m-0 text-copy-faint text-[11px] leading-4">
      {field.help_text ?? reportFieldProjectSource(field.label)}
    </Field.Description>
  );
}

function GuidedFieldReadiness({
  field,
  validationMessage,
  validationVisible,
}: {
  field: ReportTemplateField;
  validationMessage: string | null;
  validationVisible: boolean;
}) {
  if (!field.required || !validationMessage || validationVisible) return null;
  return <span className="text-[11px] text-accent-hover">Required before publishing</span>;
}

function GuidedFieldError({ message, visible }: { message: string | null; visible: boolean }) {
  return (
    <Field.Error className="m-0 text-danger text-xs" match={visible}>
      {message}
    </Field.Error>
  );
}

function reportTitleValidationMessage(title: string): string | null {
  if (!title.trim()) return "Enter a report title.";
  if (title.length > 200) return "Keep the report title to 200 characters or fewer.";
  return null;
}

function publicationValidationMessages(
  title: string,
  template: ReportTemplateDefinition,
  includedSections: readonly string[],
  dispositions: Record<string, ReportSectionDisposition>,
  fields: Record<string, GuidedReportFieldValue>,
): string[] {
  const messages: string[] = [];
  const titleMessage = reportTitleValidationMessage(title);
  if (titleMessage) messages.push(titleMessage);
  const included = new Set(includedSections);
  for (const section of template.sections) {
    if (!included.has(section.key)) continue;
    if ((dispositions[section.key] ?? "active") === "not_applicable") continue;
    for (const field of section.fields) {
      const message = guidedFieldValidationMessage(field, fields[field.key]);
      if (message) messages.push(message);
    }
  }
  return messages;
}

function guidedSectionStatus(
  section: ReportTemplateSection,
  fields: Record<string, GuidedReportFieldValue>,
  disposition: ReportSectionDisposition,
): { kind: "complete" | "needs-input" | "optional" | "not-applicable"; label: string } {
  if (disposition === "not_applicable") {
    return { kind: "not-applicable", label: "Not applicable" };
  }
  const requiredIssues = section.fields.filter(
    (field) => field.required && guidedFieldValidationMessage(field, fields[field.key]),
  ).length;
  if (requiredIssues > 0) {
    return {
      kind: "needs-input",
      label: `${requiredIssues} required`,
    };
  }
  if (
    section.optional &&
    !section.fields.some((field) => guidedFieldHasPublicationContent(fields[field.key]))
  ) {
    return { kind: "optional", label: "Optional" };
  }
  return { kind: "complete", label: "Complete" };
}

function guidedFieldHasPublicationContent(value: GuidedReportFieldValue | undefined): boolean {
  if (!value) return false;
  if (value.type === "text") return Boolean(value.value.trim());
  if (value.type === "narrative") return narrativeHasPublicationContent(value.value);
  if (value.type === "project_references") return value.value.length > 0;
  return value.value.some((row) => Object.values(row).some((cell) => Boolean(cell.trim())));
}

function guidedFieldValidationMessage(
  field: ReportTemplateField,
  value: GuidedReportFieldValue | undefined,
): string | null {
  if (field.kind === "narrative") {
    const root = value?.type === "narrative" ? value.value : emptyNarrative();
    return field.required && !narrativeHasText(root) ? `Add content to ${field.label}.` : null;
  }
  if (field.kind === "repeatable_rows") {
    const rows = value?.type === "rows" ? value.value : [];
    if (
      field.required &&
      !rows.some((row) => Object.values(row).some((cell) => Boolean(cell.trim())))
    ) {
      return `Add at least one row to ${field.label}.`;
    }
    if (rows.some((row) => Object.values(row).some((cell) => cell.length > 100_000))) {
      return `Keep each ${field.label} table cell to 100,000 characters or fewer.`;
    }
    return null;
  }
  if (field.kind === "project_references") {
    const references = value?.type === "project_references" ? value.value : [];
    return field.required && references.length === 0
      ? `Add at least one project reference to ${field.label}.`
      : null;
  }

  const text = value?.type === "text" ? value.value : "";
  if (field.kind === "date") {
    if (!text.trim()) return field.required ? `Choose ${field.label}.` : null;
    return isValidCalendarDate(text) ? null : `Choose a valid date for ${field.label}.`;
  }
  if (field.kind === "confidence") {
    if (!text.trim()) return field.required ? `Choose ${field.label}.` : null;
    return confidenceOptions.some((option) => option.value === text)
      ? null
      : `Choose a valid value for ${field.label}.`;
  }
  if (field.required && !text.trim()) return `Enter ${field.label}.`;
  const limit = field.kind === "short_text" ? 500 : 100_000;
  return text.length > limit
    ? `Keep ${field.label} to ${limit.toLocaleString("en")} characters or fewer.`
    : null;
}

function narrativeHasText(
  node: DocumentRoot | NonNullable<DocumentRoot["content"]>[number],
): boolean {
  if (node.text?.trim()) return true;
  return node.content?.some((child) => narrativeHasText(child)) ?? false;
}

function narrativeHasPublicationContent(
  node: DocumentRoot | NonNullable<DocumentRoot["content"]>[number],
): boolean {
  if (node.type === "evidenceImage" && node.attrs?.placement !== "appendix") return true;
  if (node.text?.trim()) return true;
  return node.content?.some((child) => narrativeHasPublicationContent(child)) ?? false;
}

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1];
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function GuidedNarrativeInput({
  ariaLabel,
  onChange,
  projectId,
  value,
}: {
  ariaLabel: string;
  onChange: (value: DocumentRoot) => void;
  projectId: string;
  value: DocumentRoot;
}) {
  const notices = useVaultNotices();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFileMetadata[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceImporting, setEvidenceImporting] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceDestination, setEvidenceDestination] =
    useState<EvidenceImageDestination>("inline");
  const [customAppendixTitle, setCustomAppendixTitle] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { autolink: false, openOnClick: false } }),
      createEvidenceImageExtension(projectId),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: { "aria-label": ariaLabel, class: "guided-narrative-editor" },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as DocumentRoot),
  });
  const openEvidenceLink = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ").trim();
    const attributes: unknown = editor.getAttributes("link");
    const currentHref =
      typeof attributes === "object" &&
      attributes !== null &&
      typeof Reflect.get(attributes, "href") === "string"
        ? (Reflect.get(attributes, "href") as string)
        : "";
    setLinkLabel(selectedText);
    setLinkUrl(currentHref);
    setLinkError(null);
    setLinkOpen(true);
  };
  const insertEvidenceLink = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    const label = linkLabel.trim();
    const href = normalizeEditorLink(linkUrl);
    if (!label) {
      setLinkError("Enter the human-readable evidence label shown in the report.");
      return;
    }
    if (!href) {
      setLinkError("Use an HTTP, HTTPS, email, anchor, or local backup link.");
      return;
    }
    editor
      ?.chain()
      .focus()
      .deleteSelection()
      .insertContent({
        type: "text",
        text: label,
        marks: [{ type: "link", attrs: { href } }],
      })
      .run();
    setLinkOpen(false);
    setLinkError(null);
  };
  const openEvidenceImage = async () => {
    setEvidenceOpen(true);
    setEvidenceLoading(true);
    setEvidenceError(null);
    try {
      setEvidenceFiles(
        (await listEvidenceFiles(projectId)).filter((file) => file.mediaType.startsWith("image/")),
      );
    } catch (cause) {
      setEvidenceError(guidedReportErrorMessage(cause));
    } finally {
      setEvidenceLoading(false);
    }
  };
  const insertEvidenceImage = (evidence: EvidenceFileMetadata) => {
    const appendix = evidenceAppendix(evidenceDestination, customAppendixTitle);
    if (evidenceDestination !== "inline" && !appendix) {
      setEvidenceError("Enter a title for the custom appendix.");
      return;
    }
    editor
      ?.chain()
      .focus()
      .insertContent({
        type: "evidenceImage",
        attrs: {
          evidenceId: evidence.id,
          alt: evidence.title,
          title: null,
          placement: appendix ? "appendix" : "inline",
          appendixKey: appendix?.key ?? null,
          appendixTitle: appendix?.title ?? null,
        },
      })
      .run();
    setEvidenceOpen(false);
  };
  const importAndInsertEvidenceImage = async () => {
    setEvidenceImporting(true);
    setEvidenceError(null);
    try {
      const evidence = await importEvidenceImage(projectId);
      if (!evidence) return;
      insertEvidenceImage(evidence);
      notices.add({
        title: "Evidence image added",
        description: "The encrypted Evidence file is now referenced by this report.",
        type: "success",
      });
    } catch (cause) {
      const description = guidedReportErrorMessage(cause);
      setEvidenceError(description);
      notices.add({ title: "Evidence image not added", description, type: "info" });
    } finally {
      setEvidenceImporting(false);
    }
  };
  return (
    <>
      <div className="overflow-hidden rounded-sm border border-panel-border bg-panel-deep focus-within:border-accent">
        <div
          className="flex flex-wrap items-center gap-1 border-panel-border border-b bg-panel-base px-2 py-1.5"
          role="toolbar"
          aria-label={`${ariaLabel} formatting`}
        >
          <NarrativeTool
            label="Bold"
            active={editor?.isActive("bold") ?? false}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <IconBold size={15} aria-hidden="true" />
          </NarrativeTool>
          <NarrativeTool
            label="Italic"
            active={editor?.isActive("italic") ?? false}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <IconItalic size={15} aria-hidden="true" />
          </NarrativeTool>
          <NarrativeTool
            label="Bulleted list"
            active={editor?.isActive("bulletList") ?? false}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <IconList size={15} aria-hidden="true" />
          </NarrativeTool>
          <NarrativeTool
            label="Numbered list"
            active={editor?.isActive("orderedList") ?? false}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <IconListNumbers size={15} aria-hidden="true" />
          </NarrativeTool>
          <NarrativeTool
            label="Block quote"
            active={editor?.isActive("blockquote") ?? false}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <IconQuote size={15} aria-hidden="true" />
          </NarrativeTool>
          <span className="mx-1 h-5 w-px bg-panel-border" aria-hidden="true" />
          <NarrativeTool label="Add evidence link" onClick={openEvidenceLink}>
            <IconLink size={15} aria-hidden="true" />
            <span>Add evidence link</span>
          </NarrativeTool>
          <NarrativeTool label="Add evidence image" onClick={() => void openEvidenceImage()}>
            <IconPhotoPlus size={15} aria-hidden="true" />
            <span>Add evidence image</span>
          </NarrativeTool>
          <NarrativeTool label="Defang URLs" onClick={() => defangEditorUrls(editor)}>
            <IconLinkOff size={15} aria-hidden="true" />
            <span>Defang URLs</span>
          </NarrativeTool>
        </div>
        <div className="guided-narrative text-copy-primary text-sm leading-6">
          <EditorContent
            className="guided-narrative-editor-content prose prose-invert prose-sheut max-w-none"
            editor={editor}
          />
        </div>
      </div>
      <Dialog.Root open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogFrame width="compact">
          <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
            <Dialog.Title className="m-0 text-sm font-semibold">Add evidence link</Dialog.Title>
            <Dialog.Close render={<Button className="icon-control" />} aria-label="Close">
              <IconX size={16} stroke={1.7} aria-hidden="true" />
            </Dialog.Close>
          </header>
          <form className="grid gap-4 p-4" onSubmit={insertEvidenceLink}>
            <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
              Link to video evidence, an original source, or an exported local backup. The label is
              what readers see in the report.
            </Dialog.Description>
            <label className="grid gap-1.5 font-medium text-copy-secondary text-xs">
              Evidence label
              <input
                className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 font-normal text-copy-primary text-sm outline-none focus:border-accent"
                value={linkLabel}
                onChange={(event) => setLinkLabel(event.currentTarget.value)}
                maxLength={500}
              />
            </label>
            <label className="grid gap-1.5 font-medium text-copy-secondary text-xs">
              Evidence URL
              <input
                className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 font-normal text-copy-primary text-sm outline-none focus:border-accent"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.currentTarget.value)}
                maxLength={2_048}
                inputMode="url"
                placeholder="https://… or /evidence-backups/video.mp4"
              />
            </label>
            {linkError ? (
              <p className="m-0 text-danger text-xs" role="alert">
                {linkError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close render={<Button className="control-button" />} type="button">
                Cancel
              </Dialog.Close>
              <Button className="primary-button" type="submit">
                Insert evidence link
              </Button>
            </div>
          </form>
        </DialogFrame>
      </Dialog.Root>
      <Dialog.Root open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DialogFrame width="compact">
          <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
            <Dialog.Title className="m-0 text-sm font-semibold">Add evidence image</Dialog.Title>
            <Dialog.Close render={<Button className="icon-control" />} aria-label="Close">
              <IconX size={16} stroke={1.7} aria-hidden="true" />
            </Dialog.Close>
          </header>
          <div className="grid gap-3 p-4">
            <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
              Reuse an encrypted project Evidence file, or import a new image into Evidence once.
              The report stores only its reference.
            </Dialog.Description>
            <SelectField
              ariaLabel="Evidence image placement"
              label="Placement"
              onChange={(value) => setEvidenceDestination(value as EvidenceImageDestination)}
              options={evidencePlacementOptions}
              placeholder="Choose placement"
              value={evidenceDestination}
            />
            {evidenceDestination === "custom" ? (
              <label className="grid gap-1.5 text-copy-secondary text-xs">
                Appendix title
                <input
                  className="control-input"
                  maxLength={120}
                  placeholder="For example, Hosting provider records"
                  value={customAppendixTitle}
                  onChange={(event) => setCustomAppendixTitle(event.currentTarget.value)}
                />
              </label>
            ) : null}
            {evidenceLoading ? (
              <p className="m-0 text-copy-muted text-xs" role="status">
                Loading project evidence…
              </p>
            ) : evidenceFiles.length > 0 ? (
              <ul
                className="m-0 grid max-h-60 list-none gap-1 overflow-y-auto p-0"
                aria-label="Image evidence"
              >
                {evidenceFiles.map((evidence) => (
                  <li key={evidence.id}>
                    <Button
                      className="control-button w-full justify-start"
                      type="button"
                      onClick={() => insertEvidenceImage(evidence)}
                      aria-label={`Insert ${evidence.title}`}
                    >
                      <IconPhotoPlus size={15} aria-hidden="true" />
                      <span className="truncate">{evidence.title}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 rounded-sm border border-dashed border-panel-border bg-panel-deep p-3 text-copy-muted text-xs">
                No image evidence has been imported yet.
              </p>
            )}
            {evidenceError ? (
              <p className="m-0 text-danger text-xs" role="alert">
                {evidenceError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close render={<Button className="control-button" />} type="button">
                Cancel
              </Dialog.Close>
              <Button
                className="primary-button"
                disabled={evidenceImporting}
                type="button"
                onClick={() => void importAndInsertEvidenceImage()}
              >
                <IconPlus size={15} aria-hidden="true" />
                {evidenceImporting ? "Importing…" : "Import image as evidence"}
              </Button>
            </div>
          </div>
        </DialogFrame>
      </Dialog.Root>
    </>
  );
}

function evidenceAppendix(
  destination: EvidenceImageDestination,
  customTitle: string,
): { key: string; title: string } | null {
  if (destination === "inline") return null;
  const title =
    destination === "evidence_images"
      ? "Evidence images"
      : destination === "indicators_observables"
        ? "Indicators and observables"
        : destination === "sources_methodology"
          ? "Sources and methodology"
          : customTitle.trim();
  if (!title) return null;
  const key =
    destination === "custom"
      ? title
          .toLocaleLowerCase("en")
          .normalize("NFKD")
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 64) || "custom_appendix"
      : destination;
  return { key, title };
}

function NarrativeTool({
  active = false,
  children,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      className="control-button min-h-7 px-2"
      type="button"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function defangEditorUrls(editor: Editor | null): void {
  if (!editor) return;
  editor
    .chain()
    .focus()
    .command(({ state, tr }) => {
      const replacements: Array<{ from: number; to: number; value: string }> = [];
      state.doc.descendants((node, position) => {
        if (!node.isText || !node.text) return;
        const value = defangUrls(node.text);
        if (value !== node.text) {
          replacements.push({ from: position, to: position + node.nodeSize, value });
        }
      });
      for (const replacement of replacements.reverse()) {
        tr.insertText(replacement.value, replacement.from, replacement.to);
      }
      return replacements.length > 0;
    })
    .run();
}

function GuidedRows({
  field,
  onChange,
  projectId,
  rows,
}: {
  field: ReportTemplateField;
  onChange: (rows: Array<Record<string, string>>) => void;
  projectId: string;
  rows: Array<Record<string, string>>;
}) {
  const [rowKeys, setRowKeys] = useState(() => rows.map(() => nextTableRowKey(field.key)));
  const appendRow = (row: Record<string, string>) => {
    setRowKeys((current) => [...current, nextTableRowKey(field.key)]);
    onChange([...rows, row]);
  };
  const updateCell = (rowIndex: number, column: string, value: string) => {
    onChange(
      rows.map((existing, index) =>
        index === rowIndex ? { ...existing, [column]: value } : existing,
      ),
    );
  };
  const addRow = () => appendRow(Object.fromEntries(field.columns.map((column) => [column, ""])));
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-copy-secondary text-xs">
          {field.required ? `${field.label} (required)` : field.label}
        </span>
        <Button className="control-button" type="button" onClick={addRow}>
          <IconPlus size={14} stroke={1.7} aria-hidden="true" />
          Add row
        </Button>
      </div>
      <details className="rounded-sm border border-panel-border bg-panel-deep px-3 py-2 text-xs">
        <summary className="cursor-pointer text-copy-secondary">
          What belongs in each column?
        </summary>
        <dl className="mt-2 grid gap-2">
          {field.columns.map((column) => (
            <div className="grid gap-0.5" key={column}>
              <dt className="font-medium text-copy-secondary">{column}</dt>
              <dd className="m-0 text-copy-faint text-[11px] leading-4">
                {reportFieldProjectSource(`${field.label} — ${column}`)}
              </dd>
            </div>
          ))}
        </dl>
      </details>
      {rows.length === 0 ? (
        <p className="m-0 rounded-sm border border-dashed border-panel-border px-3 py-3 text-copy-faint text-xs">
          No rows yet.
        </p>
      ) : (
        <div className="guided-report-table-scroll grid gap-2 overflow-x-auto">
          {rows.map((row, rowIndex) => (
            <fieldset
              className="guided-report-table-row m-0 min-w-0 border-0 p-0"
              data-layout={
                normalizeReportColumn(field.label) === "datasourcesandcitations"
                  ? "source-citation"
                  : "table-row"
              }
              key={rowKeys[rowIndex]}
              aria-label={
                normalizeReportColumn(field.label) === "datasourcesandcitations"
                  ? `Data source ${rowIndex + 1}`
                  : `${field.label} row ${rowIndex + 1}`
              }
              style={
                normalizeReportColumn(field.label) === "datasourcesandcitations"
                  ? undefined
                  : {
                      gridTemplateColumns: `repeat(${Math.max(field.columns.length, 1)}, minmax(10rem, 1fr)) auto`,
                      minWidth: `${Math.max(field.columns.length, 1) * 10 + 4}rem`,
                    }
              }
            >
              {normalizeReportColumn(field.label) === "datasourcesandcitations" ? (
                <div className="guided-report-table-row-header">
                  <span>Data source {rowIndex + 1}</span>
                  <Button
                    className="workspace-tab-action"
                    type="button"
                    aria-label={`Remove ${field.label} row ${rowIndex + 1}`}
                    onClick={() => {
                      setRowKeys((current) => current.filter((_, index) => index !== rowIndex));
                      onChange(rows.filter((_, index) => index !== rowIndex));
                    }}
                  >
                    <IconTrash size={13} stroke={1.7} aria-hidden="true" />
                    Remove
                  </Button>
                </div>
              ) : null}
              {field.columns.map((column) => (
                <div
                  className="guided-report-table-cell grid min-w-0 gap-1"
                  data-column={normalizeReportColumn(column)}
                  key={column}
                >
                  <GuidedRowCellControl
                    column={column}
                    fieldLabel={field.label}
                    onChange={(value) => updateCell(rowIndex, column, value)}
                    rowIndex={rowIndex}
                    value={row[column] ?? ""}
                  />
                  {columnProjectDataConstraint(field.label, column) ? (
                    <div className="flex justify-start">
                      <ProjectDataPicker
                        {...columnProjectDataConstraint(field.label, column)}
                        contextLabel={`${field.label} — ${column}`}
                        projectId={projectId}
                        triggerLabel={`Choose project data for ${field.label} row ${rowIndex + 1} ${column}`}
                        triggerText={`Choose ${column.toLocaleLowerCase()}`}
                        onInsert={(reference) =>
                          updateCell(
                            rowIndex,
                            column,
                            reportValueForColumn(reference, column, true),
                          )
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ))}
              {normalizeReportColumn(field.label) !== "datasourcesandcitations" ? (
                <Button
                  className="control-button mt-5 self-start"
                  type="button"
                  aria-label={`Remove ${field.label} row ${rowIndex + 1}`}
                  onClick={() => {
                    setRowKeys((current) => current.filter((_, index) => index !== rowIndex));
                    onChange(rows.filter((_, index) => index !== rowIndex));
                  }}
                >
                  <IconTrash size={14} stroke={1.7} aria-hidden="true" />
                  Remove row
                </Button>
              ) : null}
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}

function GuidedRowCellControl({
  column,
  fieldLabel,
  onChange,
  rowIndex,
  value,
}: {
  column: string;
  fieldLabel: string;
  onChange: (value: string) => void;
  rowIndex: number;
  value: string;
}) {
  const ariaLabel = `${fieldLabel} row ${rowIndex + 1} ${column}`;
  const normalized = normalizeReportColumn(column);
  const isIncidentTimeline = normalizeReportColumn(fieldLabel) === "incidenttimeline";
  const isDataSources = normalizeReportColumn(fieldLabel) === "datasourcesandcitations";
  if (isIncidentTimeline && normalized === "time") {
    return (
      <label className="grid gap-1 text-copy-faint text-[11px]">
        {column}
        <input
          aria-label={ariaLabel}
          autoComplete="off"
          className="guided-report-table-input"
          maxLength={500}
          placeholder="YYYY-MM-DD HH:MM timezone"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    );
  }
  if (isIncidentTimeline && (normalized === "event" || normalized === "evidence")) {
    return (
      <label className="grid gap-1 text-copy-faint text-[11px]">
        {column}
        <textarea
          aria-label={ariaLabel}
          autoComplete="off"
          className="guided-report-table-textarea"
          maxLength={100_000}
          placeholder={
            normalized === "event" ? "Describe the verified event" : "Cite supporting evidence"
          }
          rows={3}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    );
  }
  if (isDataSources && (normalized === "source" || normalized === "reference")) {
    return (
      <label className="grid gap-1 text-copy-faint text-[11px]">
        {column}
        <textarea
          aria-label={ariaLabel}
          className="guided-report-table-textarea"
          maxLength={100_000}
          placeholder={
            normalized === "source" ? "Name the source" : "Add a stable citation or evidence link"
          }
          rows={3}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    );
  }
  if (isDataSources && normalized === "type") {
    return (
      <AutocompleteField
        ariaLabel={ariaLabel}
        label={column}
        onChange={onChange}
        options={sourceTypeOptions}
        placeholder="Choose or enter source type"
        value={value}
      />
    );
  }
  if (
    normalized.includes("firstseen") ||
    normalized.includes("lastseen") ||
    normalized.includes("firstobserved") ||
    normalized.includes("lastobserved") ||
    normalized === "capturedat" ||
    normalized === "collectiondate" ||
    normalized === "accessed" ||
    normalized === "validfrom" ||
    normalized === "validuntil"
  ) {
    return (
      <label className="grid gap-1 text-copy-faint text-[11px]">
        {column}
        <input
          aria-label={ariaLabel}
          className="guided-report-table-input"
          type="date"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    );
  }
  if (normalized.endsWith("confidence")) {
    return (
      <SelectField
        ariaLabel={ariaLabel}
        label={column}
        onChange={onChange}
        options={confidenceOptions}
        placeholder="Choose confidence"
        value={value || null}
      />
    );
  }
  if (normalized.endsWith("status")) {
    return (
      <AutocompleteField
        ariaLabel={ariaLabel}
        label={column}
        onChange={onChange}
        options={rowStatusOptions}
        placeholder="Choose or enter status"
        value={value}
      />
    );
  }
  return (
    <label className="grid gap-1 text-copy-faint text-[11px]">
      {column}
      <input
        aria-label={ariaLabel}
        autoComplete="off"
        className="guided-report-table-input"
        maxLength={100_000}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

interface ColumnProjectDataConstraint {
  allowedKinds?: readonly ("intelligence" | "evidence" | "document" | "catalog_reference")[];
  allowedObjectTypes?: readonly string[];
}

function columnProjectDataConstraint(
  fieldLabel: string,
  column: string,
): ColumnProjectDataConstraint | null {
  const field = normalizeReportColumn(fieldLabel);
  const normalized = normalizeReportColumn(column);
  if (field.includes("attack") || normalized.includes("technique")) {
    return { allowedKinds: ["catalog_reference"] };
  }
  if (field.includes("relationship")) {
    if (normalized === "source" || normalized === "target") {
      return { allowedKinds: ["intelligence"] };
    }
    if (normalized === "relationship") {
      return { allowedKinds: ["intelligence"], allowedObjectTypes: ["relationship"] };
    }
    if (normalized === "evidence") {
      return { allowedKinds: ["evidence", "document"] };
    }
  }
  if (
    normalized === "domain" ||
    normalized.includes("domainorsite") ||
    normalized.includes("profilelink") ||
    normalized.includes("urlorplatformidentifier")
  ) {
    return { allowedKinds: ["intelligence"], allowedObjectTypes: ["domain-name", "url"] };
  }
  if (normalized.includes("iporhost") || normalized.includes("ipaddressorhost")) {
    return {
      allowedKinds: ["intelligence"],
      allowedObjectTypes: ["ipv4-addr", "ipv6-addr", "domain-name", "infrastructure"],
    };
  }
  if (normalized.endsWith("asn")) {
    return { allowedKinds: ["intelligence"], allowedObjectTypes: ["autonomous-system"] };
  }
  if (normalized.includes("provider")) {
    return {
      allowedKinds: ["intelligence"],
      allowedObjectTypes: ["infrastructure", "identity"],
    };
  }
  if (
    normalized.includes("certificate") ||
    normalized.includes("fingerprint") ||
    normalized.includes("issuer") ||
    normalized.includes("commonname")
  ) {
    return { allowedKinds: ["intelligence"], allowedObjectTypes: ["x509-certificate"] };
  }
  if (
    normalized.includes("identity") ||
    normalized.includes("handle") ||
    normalized.includes("linkedsite") ||
    normalized.includes("reusedsite")
  ) {
    return {
      allowedKinds: ["intelligence"],
      allowedObjectTypes: ["identity", "user-account", "threat-actor", "domain-name", "url"],
    };
  }
  if (
    normalized.includes("evidence") ||
    normalized.includes("backupfile") ||
    normalized.includes("sourceorlink") ||
    normalized.endsWith("source") ||
    normalized.endsWith("sha256")
  ) {
    return { allowedKinds: ["evidence", "document"] };
  }
  return null;
}

function normalizeReportColumn(value: string): string {
  return value.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "");
}

function reportValueForColumn(
  reference: ProjectDataSelection,
  column: string,
  fallbackToLabel: boolean,
): string {
  const normalized = normalizeReportColumn(column);
  const candidates =
    normalized === "attribution"
      ? ["assessment", "attribution"]
      : normalized === "tactic"
        ? ["tactic_label", "tactic"]
        : normalized === "technique"
          ? ["parent_technique_label", "technique_label"]
          : normalized === "subtechnique"
            ? ["sub_technique_label"]
            : normalized === "procedure" || normalized === "explanation"
              ? ["explanation", "description"]
              : normalized === "defense"
                ? ["outcome"]
                : normalized === "confidence"
                  ? ["confidence"]
                  : normalized.includes("first") || normalized === "capturedat"
                    ? ["first_seen", "created", "captured_at"]
                    : normalized.includes("last") || normalized === "accessed"
                      ? ["last_seen", "modified", "accessed"]
                      : normalized === "type" || normalized === "category"
                        ? ["type"]
                        : normalized === "description"
                          ? ["description", "explanation"]
                          : normalized === "sha256"
                            ? ["sha256"]
                            : normalized === "source" || normalized === "reference"
                              ? ["source", "label"]
                              : normalized === "name" || normalized.includes("title")
                                ? ["name", "label"]
                                : ["value", "details", "artifact", "label"];
  for (const candidate of candidates) {
    const value = reference.values[candidate]?.trim();
    if (value) return value;
  }
  return fallbackToLabel ? reference.label : "";
}

function emptyNarrative(): DocumentRoot {
  return { type: "doc", content: [{ type: "paragraph" }] };
}
