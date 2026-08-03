import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import {
  IconDeviceFloppy,
  IconFileExport,
  IconHelp,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isWorkspaceActionEvent, WORKSPACE_ACTION_EVENT } from "../lib/desktopActions";
import {
  type DocumentPublicationOptions,
  type DocumentRoot,
  publicationSelectionsFromRoots,
} from "../lib/documents";
import {
  type GuidedReport,
  type GuidedReportFieldValue,
  type GuidedReportRowReference,
  getGuidedReportReadiness,
  guidedReportErrorMessage,
  type ProjectDataSelection,
  type ReportReadinessWarning,
  type ReportSectionDisposition,
  type ReportTemplateDefinition,
  type ReportTemplateField,
  type ReportTemplateSection,
  saveGuidedReport,
  updateGuidedReportSectionDisposition,
} from "../lib/guided-reports";
import type { TlpMarking } from "../lib/projects";
import { reportFieldProjectSource } from "../lib/reportHelp";
import { AlertDialogFrame } from "./AlertDialogFrame";
import { AutocompleteField } from "./AutocompleteField";
import { DialogFrame } from "./DialogFrame";
import { GuidedReportNarrativeInput } from "./GuidedReportNarrativeInput";
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

const AUTOSAVE_DELAY_MS = 2_500;

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
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [readinessWarnings, setReadinessWarnings] = useState<ReportReadinessWarning[]>([]);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
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

  const openPublication = useCallback(async () => {
    setValidationAttempted(true);
    const issues = publicationHardValidationIssues(
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
            guidedFieldHardValidationMessage(field, fieldsRef.current[field.key]),
          ),
      );
      if (firstInvalidSection) setActiveSectionKey(firstInvalidSection.key);
      notices.add({ title: "Report not published", description: issues[0].message, type: "info" });
      window.setTimeout(() => focusReportField(issues[0].fieldKey), 0);
      return;
    }
    if (saveState !== "saved") {
      notices.add({
        title: "Save before publishing",
        description: "Save the current report revision before checking readiness.",
        type: "info",
      });
      return;
    }
    setCheckingReadiness(true);
    try {
      const warnings = await getGuidedReportReadiness(projectId, report.id);
      setReadinessWarnings(warnings);
      if (warnings.length > 0) setReadinessOpen(true);
      else setPublicationOpen(true);
    } catch (cause) {
      notices.add({
        title: "Readiness could not be checked",
        description: guidedReportErrorMessage(cause),
        type: "info",
      });
    } finally {
      setCheckingReadiness(false);
    }
  }, [
    includedTemplateSections,
    notices,
    projectId,
    report.id,
    report.included_sections,
    saveState,
    sectionDispositions,
    template,
  ]);

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
        void openPublication();
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
                  status.kind === "in-progress"
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

      <article className="grid min-w-0 content-start gap-5">
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
              disabled={!onPublish || saveState === "saving" || publishing || checkingReadiness}
              onClick={() => void openPublication()}
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

        <Dialog.Root open={readinessOpen} onOpenChange={setReadinessOpen}>
          <DialogFrame width="standard">
            <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
              <Dialog.Title className="m-0 text-sm font-semibold">
                Recommended content is missing
              </Dialog.Title>
              <Dialog.Close render={<Button className="icon-control" />} aria-label="Close">
                <IconX size={16} stroke={1.7} aria-hidden="true" />
              </Dialog.Close>
            </header>
            <div className="grid gap-4 p-4">
              <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
                You can publish now. Review these recommendations or return to the report.
              </Dialog.Description>
              <ul className="m-0 grid max-h-64 gap-2 overflow-y-auto pl-5 text-copy-secondary text-xs leading-5">
                {readinessWarnings.map((warning) => (
                  <li key={`${warning.section_key}:${warning.field_key}`}>
                    <span className="font-medium">
                      {template.sections.find((section) => section.key === warning.section_key)
                        ?.title ?? warning.section_key}
                      :
                    </span>{" "}
                    {warning.message}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <Dialog.Close render={<Button className="control-button" />} type="button">
                  Return to report
                </Dialog.Close>
                <Button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    setReadinessOpen(false);
                    setPublicationOpen(true);
                  }}
                >
                  Continue to Publish
                </Button>
              </div>
            </div>
          </DialogFrame>
        </Dialog.Root>

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
                  {section.guidance ? (
                    <SectionHelp title={section.title} guidance={section.guidance} />
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
                      status.kind === "in-progress"
                        ? `${section.optional ? "" : "ml-auto"} text-[11px] text-accent-hover`
                        : `${section.optional ? "" : "ml-auto"} text-[11px] text-copy-faint`
                    }
                  >
                    {status.label}
                  </span>
                </header>
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
  const scalarFields = section.fields.filter((field) => isScalarField(field));
  const secondaryFields = section.fields.filter(
    (field) => field.key !== primaryNarrative?.key && !isScalarField(field),
  );
  const detailsVisible = scalarFields.some(
    (field) =>
      field.required ||
      revealedFieldKeys.has(field.key) ||
      guidedFieldHasPublicationContent(fields[field.key]),
  );
  const visibleSecondaryFields = secondaryFields.filter(
    (field) =>
      field.required ||
      revealedFieldKeys.has(field.key) ||
      guidedFieldHasPublicationContent(fields[field.key]),
  );
  const hiddenFields = secondaryFields.filter(
    (field) => !visibleSecondaryFields.some((visibleField) => visibleField.key === field.key),
  );
  const canAddDetails = scalarFields.length > 0 && !detailsVisible;
  const renderField = (field: ReportTemplateField) => (
    <div className="grid gap-2" key={field.key}>
      <GuidedField
        field={field}
        projectId={projectId}
        value={fields[field.key]}
        validationAttempted={validationAttempted}
        onChange={(value) => onChange(field.key, value)}
      />
      {!field.required &&
      revealedFieldKeys.has(field.key) &&
      !guidedFieldHasPublicationContent(fields[field.key]) ? (
        <Button
          className="control-button justify-self-start"
          type="button"
          onClick={() =>
            setRevealedFieldKeys((current) => {
              const next = new Set(current);
              next.delete(field.key);
              return next;
            })
          }
        >
          Dismiss {field.label}
        </Button>
      ) : null}
    </div>
  );
  return (
    <div className="grid gap-4">
      {primaryNarrative ? renderField(primaryNarrative) : null}
      {detailsVisible ? (
        <GuidedDetails
          fields={scalarFields}
          values={fields}
          validationAttempted={validationAttempted}
          onChange={onChange}
        />
      ) : null}
      {visibleSecondaryFields.map(renderField)}
      {hiddenFields.length > 0 || canAddDetails ? (
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
                    {canAddDetails ? (
                      <Menu.Item
                        className="grid cursor-default grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-sm px-2 py-1.5 text-copy-secondary text-xs outline-none data-highlighted:bg-panel-hover data-highlighted:text-copy-primary"
                        onClick={() =>
                          setRevealedFieldKeys(
                            (current) =>
                              new Set([...current, ...scalarFields.map((field) => field.key)]),
                          )
                        }
                      >
                        <IconPlus size={13} stroke={1.7} aria-hidden="true" />
                        <span>Details</span>
                      </Menu.Item>
                    ) : null}
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

function isScalarField(field: ReportTemplateField): boolean {
  return ["short_text", "long_text", "date", "confidence", "choice"].includes(field.kind);
}

function sectionFieldMenuLabel(field: ReportTemplateField): string {
  if (field.kind === "repeatable_rows") return `${field.label} table`;
  if (field.kind === "project_references") return `${field.label} references`;
  return field.label;
}

function GuidedDetails({
  fields,
  onChange,
  validationAttempted,
  values,
}: {
  fields: ReportTemplateField[];
  onChange: (key: string, value: GuidedReportFieldValue) => void;
  validationAttempted: boolean;
  values: Record<string, GuidedReportFieldValue>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const populated = fields.filter((field) => {
    const value = values[field.key];
    return value?.type === "text" && Boolean(value.value.trim());
  });
  const resetDraft = () =>
    setDraft(
      Object.fromEntries(
        fields.map((field) => {
          const value = values[field.key];
          return [field.key, value?.type === "text" ? value.value : ""];
        }),
      ),
    );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) resetDraft();
        setOpen(nextOpen);
      }}
    >
      <section className="grid gap-2 rounded-sm border border-panel-border bg-panel-deep p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 font-medium text-copy-secondary text-xs">Details</h3>
          <Dialog.Trigger
            render={<Button className="control-button" />}
            type="button"
            data-details-fields={fields.map((field) => field.key).join(" ")}
          >
            Edit details
          </Dialog.Trigger>
        </div>
        {populated.length > 0 ? (
          <dl className="m-0 grid gap-2 sm:grid-cols-2">
            {populated.map((field) => {
              const value = values[field.key];
              return (
                <div className="min-w-0" key={field.key}>
                  <dt className="text-[10px] text-copy-faint uppercase tracking-wide">
                    {field.label}
                  </dt>
                  <dd className="m-0 truncate text-copy-primary text-xs">
                    {value?.type === "text" ? value.value : ""}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p className="m-0 text-copy-faint text-xs">No details added.</p>
        )}
      </section>
      <DialogFrame width="wide">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 text-sm font-semibold">Edit details</Dialog.Title>
          <Dialog.Close render={<Button className="icon-control" />} aria-label="Close">
            <IconX size={16} stroke={1.7} aria-hidden="true" />
          </Dialog.Close>
        </header>
        <Dialog.Description className="sr-only">
          Edit the compact structured details for this report section.
        </Dialog.Description>
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-4 sm:grid-cols-2">
          {fields.map((field) => {
            const issue = guidedFieldHardValidationMessage(field, {
              type: "text",
              value: draft[field.key] ?? "",
            });
            return (
              <div className="grid content-start gap-1.5" key={field.key}>
                <ScalarFieldControl
                  field={field}
                  value={draft[field.key] ?? ""}
                  onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
                />
                <p className="m-0 text-copy-faint text-[11px] leading-4">
                  {field.help_text ?? reportFieldProjectSource(field.label)}
                </p>
                {validationAttempted && issue ? (
                  <p className="m-0 text-danger text-xs" role="alert">
                    {issue}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 border-panel-border border-t p-4">
          <Dialog.Close render={<Button className="control-button" />} type="button">
            Cancel
          </Dialog.Close>
          <Button
            className="primary-button"
            type="button"
            onClick={() => {
              for (const field of fields) {
                onChange(field.key, { type: "text", value: draft[field.key] ?? "" });
              }
              setOpen(false);
            }}
          >
            Save details
          </Button>
        </div>
      </DialogFrame>
    </Dialog.Root>
  );
}

function ScalarFieldControl({
  field,
  onChange,
  value,
}: {
  field: ReportTemplateField;
  onChange: (value: string) => void;
  value: string;
}) {
  const labelClassName = "grid gap-1.5 font-medium text-copy-secondary text-xs";
  if (field.kind === "confidence" || field.kind === "choice") {
    const options =
      field.kind === "confidence"
        ? confidenceOptions
        : (field.options ?? []).map((option) => ({ value: option, label: option }));
    return (
      <div className={labelClassName} data-report-field-key={field.key}>
        <span>{field.label}</span>
        <SelectField
          ariaLabel={field.label}
          onChange={onChange}
          options={options}
          placeholder={`Choose ${field.label.toLowerCase()}`}
          value={value || null}
        />
      </div>
    );
  }
  if (field.kind === "long_text") {
    return (
      <label className={`${labelClassName} sm:col-span-2`}>
        {field.label}
        <textarea
          aria-label={field.label}
          autoComplete="off"
          className="min-h-28 resize-y rounded-sm border border-panel-border bg-panel-deep px-2.5 py-2 font-normal text-copy-primary text-sm leading-6 outline-none focus:border-accent"
          data-report-field-key={field.key}
          maxLength={100_000}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    );
  }
  return (
    <label className={labelClassName}>
      {field.label}
      <input
        aria-label={field.label}
        autoComplete="off"
        className="control-input"
        data-report-field-key={field.key}
        maxLength={field.kind === "short_text" ? 500 : undefined}
        type={field.kind === "date" ? "date" : "text"}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
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
  const label = field.label;
  const validationMessage = guidedFieldHardValidationMessage(field, value);
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
        <GuidedReportNarrativeInput
          ariaLabel={label}
          projectId={projectId}
          value={root}
          onChange={(next) => onChange({ type: "narrative", value: next })}
        />
        <GuidedFieldDescription field={field} />
        <GuidedFieldError message={validationMessage} visible={showValidation} />
      </Field.Root>
    );
  }
  if (field.kind === "repeatable_rows") {
    const rows =
      value?.type === "rows" ? value.value : value?.type === "linked_rows" ? value.value.rows : [];
    const references = value?.type === "linked_rows" ? value.value.references : [];
    return (
      <div className="grid gap-1.5" onBlurCapture={() => setTouched(true)}>
        <GuidedRows
          field={field}
          projectId={projectId}
          rows={rows}
          references={references}
          onChange={(nextRows, nextReferences) =>
            onChange(
              nextReferences.length > 0
                ? {
                    type: "linked_rows",
                    value: { rows: nextRows, references: nextReferences },
                  }
                : { type: "rows", value: nextRows },
            )
          }
        />
        <p className="m-0 text-copy-faint text-[11px] leading-4">
          {field.help_text ?? reportFieldProjectSource(field.label)}
        </p>
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
        {references.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={field.label}>
            {references.map((reference) => (
              <li
                className="flex items-center gap-1 rounded-sm border border-panel-border bg-panel-deep px-2 py-1 text-copy-secondary text-xs"
                key={`${reference.kind}:${reference.id}`}
              >
                <span>{reference.label}</span>
                <Button
                  className="icon-control h-6 w-6"
                  type="button"
                  aria-label={`Remove project reference ${reference.label}`}
                  onClick={() =>
                    onChange({
                      type: "project_references",
                      value: references.filter(
                        (existing) =>
                          existing.kind !== reference.kind || existing.id !== reference.id,
                      ),
                    })
                  }
                >
                  <IconX size={12} stroke={1.7} aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 rounded-sm border border-dashed border-panel-border bg-panel-deep px-3 py-2 text-copy-muted text-xs leading-5">
            No project references added.
          </p>
        )}
        <GuidedFieldDescription field={field} />
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

function publicationHardValidationIssues(
  title: string,
  template: ReportTemplateDefinition,
  includedSections: readonly string[],
  dispositions: Record<string, ReportSectionDisposition>,
  fields: Record<string, GuidedReportFieldValue>,
): Array<{ fieldKey: string; message: string }> {
  const messages: Array<{ fieldKey: string; message: string }> = [];
  const titleMessage = reportTitleValidationMessage(title);
  if (titleMessage) messages.push({ fieldKey: "report_title", message: titleMessage });
  const included = new Set(includedSections);
  for (const section of template.sections) {
    if (!included.has(section.key)) continue;
    if ((dispositions[section.key] ?? "active") === "not_applicable") continue;
    for (const field of section.fields) {
      const message = guidedFieldHardValidationMessage(field, fields[field.key]);
      if (message) messages.push({ fieldKey: field.key, message });
    }
  }
  return messages;
}

function guidedSectionStatus(
  section: ReportTemplateSection,
  fields: Record<string, GuidedReportFieldValue>,
  disposition: ReportSectionDisposition,
): { kind: "ready" | "in-progress" | "empty" | "not-applicable"; label: string } {
  if (disposition === "not_applicable") {
    return { kind: "not-applicable", label: "Not applicable" };
  }
  const hasContent = section.fields.some((field) =>
    guidedFieldHasPublicationContent(fields[field.key]),
  );
  if (!hasContent) return { kind: "empty", label: "Empty" };
  const needsRecommendation = section.fields.some(
    (field) =>
      guidedFieldRecommendedMissing(field, fields[field.key]) ||
      guidedFieldHardValidationMessage(field, fields[field.key]),
  );
  if (needsRecommendation) return { kind: "in-progress", label: "In progress" };
  return { kind: "ready", label: "Ready" };
}

function guidedFieldHasPublicationContent(value: GuidedReportFieldValue | undefined): boolean {
  if (!value) return false;
  if (value.type === "text") return Boolean(value.value.trim());
  if (value.type === "narrative") return narrativeHasPublicationContent(value.value);
  if (value.type === "project_references") return value.value.length > 0;
  const rows = value.type === "linked_rows" ? value.value.rows : value.value;
  return rows.some((row) => Object.values(row).some((cell) => Boolean(cell.trim())));
}

function guidedFieldRecommendedMissing(
  field: ReportTemplateField,
  value: GuidedReportFieldValue | undefined,
): boolean {
  if (!field.required) return false;
  if (field.kind === "narrative") {
    const root = value?.type === "narrative" ? value.value : emptyNarrative();
    return !narrativeHasText(root);
  }
  if (field.kind === "repeatable_rows") {
    const rows =
      value?.type === "rows" ? value.value : value?.type === "linked_rows" ? value.value.rows : [];
    return !rows.some((row) => Object.values(row).some((cell) => Boolean(cell.trim())));
  }
  if (field.kind === "project_references") {
    const references = value?.type === "project_references" ? value.value : [];
    return references.length === 0;
  }
  const text = value?.type === "text" ? value.value : "";
  return !text.trim();
}

function guidedFieldHardValidationMessage(
  field: ReportTemplateField,
  value: GuidedReportFieldValue | undefined,
): string | null {
  if (field.kind === "repeatable_rows") {
    const rows =
      value?.type === "rows" ? value.value : value?.type === "linked_rows" ? value.value.rows : [];
    return rows.some((row) => Object.values(row).some((cell) => cell.length > 100_000))
      ? `Keep each ${field.label} table cell to 100,000 characters or fewer.`
      : null;
  }
  if (field.kind === "narrative" || field.kind === "project_references") return null;
  const text = value?.type === "text" ? value.value : "";
  if (field.kind === "date") {
    if (!text.trim()) return null;
    return isValidCalendarDate(text) ? null : `Choose a valid date for ${field.label}.`;
  }
  if (field.kind === "confidence") {
    if (!text.trim()) return null;
    return confidenceOptions.some((option) => option.value === text)
      ? null
      : `Choose a valid value for ${field.label}.`;
  }
  if (field.kind === "choice" && text.trim() && !field.options?.includes(text)) {
    return `Choose a valid value for ${field.label}.`;
  }
  const limit = field.kind === "short_text" ? 500 : 100_000;
  return text.length > limit
    ? `Keep ${field.label} to ${limit.toLocaleString("en")} characters or fewer.`
    : null;
}

function focusReportField(fieldKey: string): void {
  if (fieldKey === "report_title") {
    document.querySelector<HTMLElement>('[aria-label="Report title"]')?.focus();
    return;
  }
  const direct = document.querySelector<HTMLElement>(`[data-report-field-key="${fieldKey}"]`);
  const focusable = direct?.matches("input, textarea, button, [contenteditable='true']")
    ? direct
    : direct?.querySelector<HTMLElement>("input, textarea, button, [contenteditable='true']");
  if (focusable) {
    focusable.focus();
    return;
  }
  const detailsTrigger = [...document.querySelectorAll<HTMLElement>("[data-details-fields]")].find(
    (element) => element.dataset.detailsFields?.split(" ").includes(fieldKey),
  );
  if (!detailsTrigger) return;
  detailsTrigger.click();
  window.setTimeout(
    () => document.querySelector<HTMLElement>(`[data-report-field-key="${fieldKey}"]`)?.focus(),
    0,
  );
}

function SectionHelp({ guidance, title }: { guidance: string; title: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className="control-button px-2 py-1 text-[10px]"
        aria-label={`Help for ${title}`}
      >
        <IconHelp size={13} stroke={1.7} aria-hidden="true" />
        Help
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" className="z-50" sideOffset={6}>
          <Popover.Popup className="max-w-sm rounded-sm border border-panel-border bg-panel-raised p-3 text-copy-muted text-xs leading-5 shadow-xl outline-none">
            <Popover.Title className="mb-1 font-medium text-copy-primary text-xs">
              {title}
            </Popover.Title>
            <Popover.Description className="m-0">{guidance}</Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
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

function GuidedRows({
  field,
  onChange,
  projectId,
  references,
  rows,
}: {
  field: ReportTemplateField;
  onChange: (rows: Array<Record<string, string>>, references: GuidedReportRowReference[]) => void;
  projectId: string;
  references: GuidedReportRowReference[];
  rows: Array<Record<string, string>>;
}) {
  const nextRowKey = useRef(rows.length);
  const [rowKeys, setRowKeys] = useState(() =>
    rows.map((_, position) => `${field.key}-record-${position}`),
  );
  const [open, setOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [draftReferences, setDraftReferences] = useState<
    Record<string, GuidedReportRowReference["reference"]>
  >({});
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const noun = structuredRecordNoun(field.label);
  const startAdd = () => {
    setEditingIndex(null);
    setDraft(Object.fromEntries(field.columns.map((column) => [column, ""])));
    setDraftReferences({});
  };
  const startEdit = (rowIndex: number) => {
    setEditingIndex(rowIndex);
    setDraft(
      Object.fromEntries(field.columns.map((column) => [column, rows[rowIndex]?.[column] ?? ""])),
    );
    setDraftReferences(
      Object.fromEntries(
        references
          .filter((reference) => reference.rowIndex === rowIndex)
          .map((reference) => [reference.column, reference.reference]),
      ),
    );
  };
  const dialogRowIndex = editingIndex ?? rows.length;
  const removeRecord = () => {
    if (removingIndex === null) return;
    setRowKeys((current) => current.filter((_, index) => index !== removingIndex));
    onChange(
      rows.filter((_, index) => index !== removingIndex),
      references
        .filter((reference) => reference.rowIndex !== removingIndex)
        .map((reference) => ({
          ...reference,
          rowIndex:
            reference.rowIndex > removingIndex ? reference.rowIndex - 1 : reference.rowIndex,
        })),
    );
    setRemovingIndex(null);
    window.setTimeout(() => addButtonRef.current?.focus(), 0);
  };
  const removingTitle = removingIndex === null ? "" : structuredRecordTitle(rows[removingIndex]);
  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setEditingIndex(null);
        }}
      >
        <div className="grid gap-2" data-report-field-key={field.key}>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-copy-secondary text-xs">{field.label}</span>
            <Dialog.Trigger
              render={<Button className="control-button" ref={addButtonRef} />}
              type="button"
              onClick={startAdd}
            >
              <IconPlus size={14} stroke={1.7} aria-hidden="true" />
              Add {noun}
            </Dialog.Trigger>
          </div>
          {rows.length === 0 ? (
            <p className="m-0 rounded-sm border border-dashed border-panel-border px-3 py-3 text-copy-faint text-xs">
              No {structuredRecordNoun(field.label, true)} added. Add one when it strengthens the
              section.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0" aria-label={field.label}>
              {rows.map((row, rowIndex) => {
                const rowKey = rowKeys.at(rowIndex);
                const populated = Object.entries(row).filter(([, value]) => value.trim());
                const title = structuredRecordTitle(row);
                const summary = populated.filter(([, value]) => value !== title).slice(0, 3);
                const linkedReferences = references.filter(
                  (reference) => reference.rowIndex === rowIndex,
                );
                return (
                  <li
                    className="rounded-sm border border-panel-border bg-panel-deep p-3 transition-colors hover:border-panel-strong"
                    key={rowKey}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h4 className="m-0 truncate font-medium text-copy-primary text-sm">
                          {title}
                        </h4>
                        <p className="mt-0.5 mb-2 text-[10px] text-copy-faint uppercase tracking-wide">
                          {noun} {rowIndex + 1}
                        </p>
                        {linkedReferences.length > 0 ? (
                          <p className="mt-0 mb-2 text-[11px] text-accent">
                            {linkedReferences.length} linked project reference
                            {linkedReferences.length === 1 ? "" : "s"} · included in publication
                            provenance
                          </p>
                        ) : null}
                        <dl className="m-0 grid gap-1 sm:grid-cols-3">
                          {summary.length > 0 ? (
                            summary.map(([column, cell]) => (
                              <div className="min-w-0" key={column}>
                                <dt className="text-[10px] text-copy-faint uppercase tracking-wide">
                                  {column}
                                </dt>
                                <dd className="m-0 truncate text-copy-primary text-xs">{cell}</dd>
                              </div>
                            ))
                          ) : (
                            <div className="sm:col-span-3">
                              <dt className="sr-only">Record status</dt>
                              <dd className="m-0 text-copy-faint text-xs">
                                Open the record to add supporting attributes.
                              </dd>
                            </div>
                          )}
                        </dl>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Dialog.Trigger
                          render={<Button className="control-button" />}
                          type="button"
                          aria-label={`Edit ${noun} ${title}`}
                          onClick={() => startEdit(rowIndex)}
                        >
                          Edit
                        </Dialog.Trigger>
                        <Button
                          className="icon-control"
                          type="button"
                          aria-label={`Remove ${noun} ${title}`}
                          onClick={() => setRemovingIndex(rowIndex)}
                        >
                          <IconTrash size={14} stroke={1.7} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFrame width="wide">
          <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
            <Dialog.Title className="m-0 text-sm font-semibold">
              {editingIndex === null ? `Add ${noun}` : `Edit ${noun}`}
            </Dialog.Title>
            <Dialog.Close render={<Button className="icon-control" />} aria-label="Close">
              <IconX size={16} stroke={1.7} aria-hidden="true" />
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            Edit one structured record. Cancel closes the dialog without changing the report.
          </Dialog.Description>
          <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            {field.columns.map((column) => (
              <div className="grid min-w-0 content-start gap-1.5" key={column}>
                <GuidedRowCellControl
                  column={column}
                  fieldLabel={field.label}
                  onChange={(value) => {
                    setDraft((current) => ({ ...current, [column]: value }));
                    setDraftReferences((current) => {
                      const next = { ...current };
                      delete next[column];
                      return next;
                    });
                  }}
                  rowIndex={dialogRowIndex}
                  value={draft[column] ?? ""}
                />
                {columnProjectDataConstraint(field.label, column) ? (
                  <div className="grid gap-1.5">
                    <ProjectDataPicker
                      {...columnProjectDataConstraint(field.label, column)}
                      contextLabel={`${field.label} — ${column}`}
                      projectId={projectId}
                      triggerLabel={`Choose project data for ${field.label} row ${dialogRowIndex + 1} ${column}`}
                      triggerText={`Choose ${column.toLocaleLowerCase()}`}
                      onInsert={(reference) => {
                        setDraft((current) => ({
                          ...current,
                          [column]: reportValueForColumn(reference, column, true),
                        }));
                        setDraftReferences((current) => ({
                          ...current,
                          [column]: {
                            kind: reference.kind,
                            id: reference.id,
                            label: reference.label,
                          },
                        }));
                      }}
                    />
                    {draftReferences[column] ? (
                      <p className="m-0 text-[11px] text-accent">
                        Linked to {draftReferences[column].label}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <p className="m-0 text-copy-faint text-[11px] leading-4">
                  {reportFieldProjectSource(`${field.label} — ${column}`)}
                </p>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-panel-border border-t p-4">
            <Dialog.Close render={<Button className="control-button" />} type="button">
              Cancel
            </Dialog.Close>
            <Button
              className="primary-button"
              type="button"
              onClick={() => {
                if (editingIndex === null) {
                  const key = `${field.key}-record-${nextRowKey.current}`;
                  nextRowKey.current += 1;
                  setRowKeys((current) => [...current, key]);
                  const rowIndex = rows.length;
                  onChange(
                    [...rows, draft],
                    [
                      ...references,
                      ...Object.entries(draftReferences).map(([column, reference]) => ({
                        rowIndex,
                        column,
                        reference,
                      })),
                    ],
                  );
                } else {
                  onChange(
                    rows.map((row, index) => (index === editingIndex ? draft : row)),
                    [
                      ...references.filter((reference) => reference.rowIndex !== editingIndex),
                      ...Object.entries(draftReferences).map(([column, reference]) => ({
                        rowIndex: editingIndex,
                        column,
                        reference,
                      })),
                    ],
                  );
                }
                setOpen(false);
              }}
            >
              Save record
            </Button>
          </div>
        </DialogFrame>
      </Dialog.Root>
      <AlertDialog.Root
        open={removingIndex !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRemovingIndex(null);
        }}
      >
        <AlertDialogFrame width="compact">
          <div className="grid gap-4 p-4">
            <AlertDialog.Title className="m-0 text-sm font-semibold">
              Remove {noun}?
            </AlertDialog.Title>
            <AlertDialog.Description className="m-0 text-copy-muted text-xs leading-5">
              This removes “{removingTitle}” from the report section. The underlying project
              intelligence or evidence is not deleted.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
              <AlertDialog.Close render={<Button className="control-button" />}>
                Cancel
              </AlertDialog.Close>
              <Button className="danger-button" type="button" onClick={removeRecord}>
                Remove {noun}
              </Button>
            </div>
          </div>
        </AlertDialogFrame>
      </AlertDialog.Root>
    </>
  );
}

function structuredRecordTitle(row: Record<string, string> | undefined): string {
  return (
    Object.values(row ?? {})
      .find((value) => value.trim())
      ?.trim() ?? "Untitled record"
  );
}

function structuredRecordNoun(label: string, plural = false): string {
  const normalized = normalizeReportColumn(label);
  const singular = normalized.includes("site")
    ? "site"
    : normalized.includes("timeline")
      ? "event"
      : normalized.includes("source")
        ? "source"
        : normalized.includes("profile")
          ? "profile"
          : normalized.includes("identit")
            ? "identity"
            : normalized.includes("relationship")
              ? "relationship"
              : normalized.includes("certificate")
                ? "certificate"
                : normalized.includes("finding")
                  ? "finding"
                  : normalized.includes("requirement")
                    ? "requirement"
                    : normalized.includes("recommend")
                      ? "recommendation"
                      : "record";
  if (!plural) return singular;
  if (singular === "identity") return "identities";
  return `${singular}s`;
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
          autoComplete="off"
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
          autoComplete="off"
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
