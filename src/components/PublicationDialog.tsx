import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { IconX } from "@tabler/icons-react";
import { type SyntheticEvent, useEffect, useState } from "react";
import { type BrandProfile, listBrandProfiles } from "../lib/brand-profiles";
import {
  type DocumentExportFormat,
  type DocumentPublicationOptions,
  listPublicationRecords,
  type PublicationOrientation,
  type PublicationPageFurniture,
  type PublicationPaperSize,
  type PublicationRecord,
  type PublicationSelectionOption,
  type PublicationStatus,
  reproducePublication,
} from "../lib/documents";
import type { TlpMarking } from "../lib/projects";
import { DialogFrame } from "./DialogFrame";
import { SelectField, type SelectFieldOption } from "./SelectField";
import { tlpSelectOptions } from "./TlpBadge";
import { useVaultNotices } from "./VaultNotices";

interface PublicationDialogProps {
  busy: boolean;
  defaultTlpMarking: TlpMarking;
  initialFileName: string;
  onOpenChange: (open: boolean) => void;
  onPublish: (options: DocumentPublicationOptions) => Promise<void>;
  open: boolean;
  projectId: string;
  sourceId: string;
  sections?: readonly PublicationSelectionOption[];
  appendices?: readonly PublicationSelectionOption[];
  title?: string;
}

const defaultPageFurniture: PublicationPageFurniture = {
  header: true,
  footer: true,
  marking: true,
  page_numbers: true,
};
const emptySelectionOptions: readonly PublicationSelectionOption[] = [];

const paperSizeOptions: readonly SelectFieldOption[] = [
  { value: "a4", label: "A4", secondary: "210 × 297 mm" },
  { value: "letter", label: "Letter", secondary: "US Letter" },
];

const orientationOptions: readonly SelectFieldOption[] = [
  { value: "portrait", label: "Portrait", secondary: "Tall pages" },
  { value: "landscape", label: "Landscape", secondary: "Wide pages" },
];

export function PublicationDialog({
  busy,
  defaultTlpMarking,
  initialFileName,
  onOpenChange,
  onPublish,
  open,
  projectId,
  sourceId,
  sections = emptySelectionOptions,
  appendices = emptySelectionOptions,
  title = "Publish report",
}: PublicationDialogProps) {
  const notices = useVaultNotices();
  const [format, setFormat] = useState<DocumentExportFormat>("html");
  const [paperSize, setPaperSize] = useState<PublicationPaperSize>("a4");
  const [orientation, setOrientation] = useState<PublicationOrientation>("portrait");
  const [tlpMarking, setTlpMarking] = useState<TlpMarking>(defaultTlpMarking);
  const [fileName, setFileName] = useState(initialFileName);
  const [profiles, setProfiles] = useState<BrandProfile[]>([]);
  const [brandProfileId, setBrandProfileId] = useState<string | null>(null);
  const [brandProfileRevision, setBrandProfileRevision] = useState<number | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(open);
  const [releaseVersion, setReleaseVersion] = useState("1.0");
  const [publicationStatus, setPublicationStatus] = useState<PublicationStatus>("draft");
  const [includeReleaseHistory, setIncludeReleaseHistory] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [pageFurniture, setPageFurniture] =
    useState<PublicationPageFurniture>(defaultPageFurniture);
  const [includedSections, setIncludedSections] = useState<string[]>(() =>
    sections.map((section) => section.key),
  );
  const [includedAppendices, setIncludedAppendices] = useState<string[]>(() =>
    appendices.map((appendix) => appendix.key),
  );
  const [publicationRecords, setPublicationRecords] = useState<PublicationRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(open);
  const [reproducingId, setReproducingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void listBrandProfiles(projectId)
      .then((items) => {
        if (!active) return;
        setProfiles(items);
        const first = items[0];
        if (first) {
          setBrandProfileId(first.id);
          setBrandProfileRevision(first.revision);
          setPaperSize(first.default_paper_size);
          setOrientation(first.default_orientation);
          setPageFurniture(first.page_furniture);
        }
      })
      .catch(() => {
        if (active) {
          setProfiles([]);
          notices.add({
            title: "Brand Profiles not loaded",
            description: "The built-in Sheut publication style remains available.",
            type: "info",
          });
        }
      })
      .finally(() => {
        if (active) setProfilesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notices, open, projectId]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void listPublicationRecords(projectId)
      .then((records) => {
        if (!active) return;
        setPublicationRecords(records.filter((record) => publicationSourceId(record) === sourceId));
      })
      .catch(() => {
        if (active) {
          setPublicationRecords([]);
          notices.add({
            title: "Publication history not loaded",
            description: "You can still create a new publication.",
            type: "info",
          });
        }
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notices, open, projectId, sourceId]);

  const reproduce = async (record: PublicationRecord) => {
    setReproducingId(record.id);
    try {
      const outcome = await reproducePublication(projectId, record.id);
      if (outcome.saved) {
        notices.add({
          title: "Historical publication reproduced",
          description: `${record.snapshot.output_file_name} matched its SHA-256 fingerprint.`,
          type: "success",
        });
      }
    } catch {
      notices.add({
        title: "Publication not reproduced",
        description:
          "Its saved revision, assets, or exact output fingerprint could not be verified.",
        type: "info",
      });
    } finally {
      setReproducingId(null);
    }
  };

  const selectedProfile = profiles.find((profile) => profile.id === brandProfileId) ?? null;
  const brandOptions: readonly SelectFieldOption[] = [
    { value: "builtin", label: "Sheut built-in", secondary: "No project Brand Profile" },
    ...profiles.map((profile) => ({
      value: profile.id,
      label: profile.name,
      secondary: `Revision ${profile.revision}`,
    })),
  ];
  const revisionOptions: readonly SelectFieldOption[] = selectedProfile
    ? [
        {
          value: String(selectedProfile.revision),
          label: `Revision ${selectedProfile.revision}`,
          secondary: "Immutable publication selection",
        },
      ]
    : [{ value: "builtin", label: "Built-in style" }];

  const submit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    const reportValidation = (description: string) => {
      notices.add({
        title: "Publication settings need attention",
        description,
        type: "info",
      });
    };
    const trimmed = fileName.trim();
    if (!trimmed) {
      reportValidation("Enter a file name.");
      return;
    }
    const version = normalizeReleaseVersion(releaseVersion);
    if (!version) {
      reportValidation("Use a report version such as 1.0, 1.1, or 2.0.");
      return;
    }
    if (version !== "1.0" && !changeNote.trim()) {
      reportValidation("Describe what changed in this release.");
      return;
    }
    if (sections.length > 0 && includedSections.length === 0) {
      reportValidation("Include at least one report section.");
      return;
    }
    try {
      await onPublish({
        format,
        paperSize,
        orientation,
        tlpMarking,
        brandProfileId,
        brandProfileRevision,
        releaseVersion: version,
        publicationStatus,
        includeReleaseHistory: version === "1.0" ? false : includeReleaseHistory,
        changeNote: version === "1.0" ? null : changeNote.trim(),
        pageFurniture,
        includedSections,
        appendices:
          appendices.length > 0 && includedAppendices.length === 0 ? ["none"] : includedAppendices,
        fileName: trimmed,
      });
      onOpenChange(false);
    } catch {
      // The caller reports the bounded export error through the shared notice host.
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogFrame width="publication">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 text-sm font-semibold">{title}</Dialog.Title>
          <Dialog.Close
            render={<Button className="icon-control" />}
            aria-label="Close"
            disabled={busy}
          >
            <IconX size={16} stroke={1.7} aria-hidden="true" />
          </Dialog.Close>
        </header>
        <form
          className="grid max-h-[82vh] gap-4 overflow-y-auto p-4"
          onSubmit={(event) => void submit(event)}
        >
          <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
            These settings apply to this publication only. They do not mutate report content or
            project defaults.
          </Dialog.Description>
          <section
            className="grid gap-2 rounded-sm border border-panel-border bg-panel-deep p-3"
            aria-labelledby="publication-history-title"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="m-0 text-sm font-semibold" id="publication-history-title">
                Publication history
              </h3>
              <span className="text-copy-faint text-xs">{publicationRecords.length} saved</span>
            </div>
            {historyLoading ? (
              <p className="m-0 text-copy-faint text-xs">Loading history…</p>
            ) : null}
            {!historyLoading && publicationRecords.length === 0 ? (
              <p className="m-0 text-copy-faint text-xs">
                No publications have been generated from this report yet.
              </p>
            ) : null}
            {publicationRecords.slice(0, 8).map((record) => (
              <article
                className="grid gap-2 rounded-sm border border-panel-border bg-panel-base p-2.5"
                key={record.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <strong className="block text-copy-primary text-xs">
                      v{record.snapshot.release_version} · {record.snapshot.format.toUpperCase()} ·{" "}
                      {record.snapshot.publication_status}
                    </strong>
                    <span className="mt-0.5 block text-copy-faint text-[11px]">
                      {record.snapshot.paper_size.toUpperCase()} · {record.snapshot.orientation} ·
                      source revision {record.snapshot.source.revision}
                    </span>
                  </span>
                  <Button
                    className="control-button shrink-0"
                    type="button"
                    disabled={busy || reproducingId !== null}
                    onClick={() => void reproduce(record)}
                  >
                    {reproducingId === record.id ? "Verifying…" : "Reproduce"}
                  </Button>
                </div>
                <span className="truncate text-copy-faint text-[11px]" title={record.sha256}>
                  SHA-256 fingerprint {record.sha256}
                </span>
              </article>
            ))}
          </section>
          <div className="grid gap-1.5">
            <span className="font-medium text-copy-secondary text-xs">Format</span>
            <ToggleGroup
              className="export-format-group"
              aria-label="Export format"
              value={[format]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "html" || next === "pdf" || next === "docx") setFormat(next);
              }}
            >
              {(["html", "pdf", "docx"] as const).map((value) => (
                <Toggle className="export-format-option" value={value} disabled={busy} key={value}>
                  {value.toUpperCase()}
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              ariaLabel="Brand Profile"
              disabled={busy || profilesLoading}
              label="Brand Profile"
              onChange={(value) => {
                if (value === "builtin") {
                  setBrandProfileId(null);
                  setBrandProfileRevision(null);
                  setPageFurniture(defaultPageFurniture);
                  return;
                }
                const profile = profiles.find((item) => item.id === value);
                if (!profile) return;
                setBrandProfileId(profile.id);
                setBrandProfileRevision(profile.revision);
                setPaperSize(profile.default_paper_size);
                setOrientation(profile.default_orientation);
                setPageFurniture(profile.page_furniture);
              }}
              options={brandOptions}
              placeholder={profilesLoading ? "Loading Brand Profiles…" : "Choose Brand Profile"}
              value={brandProfileId ?? "builtin"}
            />
            <SelectField
              ariaLabel="Brand Profile revision"
              disabled
              label="Profile revision"
              onChange={() => undefined}
              options={revisionOptions}
              placeholder="Revision"
              value={selectedProfile ? String(selectedProfile.revision) : "builtin"}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              ariaLabel="Paper size"
              disabled={busy}
              label="Paper size"
              onChange={(value) => {
                if (value === "a4" || value === "letter") setPaperSize(value);
              }}
              options={paperSizeOptions}
              placeholder="Choose paper size"
              value={paperSize}
            />
            <SelectField
              ariaLabel="Orientation"
              disabled={busy}
              label="Orientation"
              onChange={(value) => {
                if (value === "portrait" || value === "landscape") setOrientation(value);
              }}
              options={orientationOptions}
              placeholder="Choose orientation"
              value={orientation}
            />
          </div>
          <SelectField
            ariaLabel="TLP marking"
            disabled={busy}
            label="TLP marking"
            onChange={(value) => {
              if (isTlpMarking(value)) setTlpMarking(value);
            }}
            options={tlpSelectOptions}
            placeholder="Choose TLP marking"
            value={tlpMarking}
          />
          <fieldset className="grid gap-2 rounded-sm border border-panel-border bg-panel-deep p-3">
            <legend className="px-1 font-medium text-copy-secondary text-xs">Page furniture</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["header", "Header"],
                  ["footer", "Footer"],
                  ["marking", "TLP marking"],
                  ["page_numbers", "Page numbers"],
                ] as const
              ).map(([key, label]) => (
                <div
                  className="flex items-center justify-between gap-3 text-copy-secondary text-xs"
                  key={key}
                >
                  <span id={`page-furniture-${key}`}>{label}</span>
                  <Switch.Root
                    nativeButton
                    render={<button type="button" />}
                    checked={pageFurniture[key]}
                    onCheckedChange={(checked) =>
                      setPageFurniture((current) => ({ ...current, [key]: checked }))
                    }
                    className="settings-switch"
                    aria-label={`Include ${label.toLocaleLowerCase("en")}`}
                    disabled={busy}
                  >
                    <Switch.Thumb className="settings-switch-thumb" />
                  </Switch.Root>
                </div>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PublicationSelectionList
              emptyLabel="This report has no selectable body sections."
              label="Included sections"
              onChange={setIncludedSections}
              options={sections}
              selected={includedSections}
            />
            <PublicationSelectionList
              emptyLabel="No evidence appendices are currently attached."
              label="Included appendices"
              onChange={setIncludedAppendices}
              options={appendices}
              selected={includedAppendices}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 font-medium text-copy-secondary text-xs">
              Report version
              <input
                className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-sm outline-none focus:border-accent"
                value={releaseVersion}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setReleaseVersion(value);
                  if (normalizeReleaseVersion(value) !== "1.0") setIncludeReleaseHistory(true);
                }}
                placeholder="1.0"
                maxLength={17}
                disabled={busy}
              />
            </label>
            <div className="grid gap-1.5">
              <span className="font-medium text-copy-secondary text-xs">Publication status</span>
              <ToggleGroup
                className="export-format-group"
                aria-label="Publication status"
                value={[publicationStatus]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "draft" || next === "final") setPublicationStatus(next);
                }}
              >
                <Toggle className="export-format-option" value="draft" disabled={busy}>
                  Draft
                </Toggle>
                <Toggle className="export-format-option" value="final" disabled={busy}>
                  Final
                </Toggle>
              </ToggleGroup>
            </div>
          </div>
          {normalizeReleaseVersion(releaseVersion) !== "1.0" ? (
            <div className="grid gap-3 rounded-sm border border-panel-border bg-panel-deep p-3">
              <label className="grid gap-1.5 font-medium text-copy-secondary text-xs">
                What changed
                <textarea
                  className="min-h-20 resize-y rounded-sm border border-panel-border bg-panel-base px-2.5 py-2 text-copy-primary text-sm outline-none focus:border-accent"
                  value={changeNote}
                  onChange={(event) => setChangeNote(event.currentTarget.value)}
                  maxLength={2_000}
                  required
                  disabled={busy}
                />
              </label>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="m-0 font-medium text-copy-secondary text-xs">
                    Include release history
                  </p>
                  <p className="mt-1 mb-0 text-copy-faint text-xs">
                    Place the version table before the table of contents.
                  </p>
                </div>
                <Switch.Root
                  nativeButton
                  render={<button type="button" />}
                  checked={includeReleaseHistory}
                  onCheckedChange={setIncludeReleaseHistory}
                  className="settings-switch"
                  aria-label="Include release history"
                  disabled={busy}
                >
                  <Switch.Thumb className="settings-switch-thumb" />
                </Switch.Root>
              </div>
            </div>
          ) : null}
          <label className="grid gap-1.5 font-medium text-copy-secondary text-xs">
            File name
            <span className="flex min-w-0 items-center rounded-sm border border-panel-border bg-panel-deep focus-within:border-accent">
              <input
                className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-copy-primary text-sm outline-none"
                type="text"
                value={fileName}
                onChange={(event) => setFileName(event.currentTarget.value)}
                maxLength={96}
                autoComplete="off"
                disabled={busy}
              />
              <span className="shrink-0 pr-2.5 text-copy-muted text-xs" aria-hidden="true">
                .{format}
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
            <Dialog.Close render={<Button className="control-button" />} disabled={busy}>
              Cancel
            </Dialog.Close>
            <Button className="primary-button" type="submit" disabled={busy || !fileName.trim()}>
              {busy ? "Publishing…" : "Choose save location"}
            </Button>
          </div>
        </form>
      </DialogFrame>
    </Dialog.Root>
  );
}

function PublicationSelectionList({
  emptyLabel,
  label,
  onChange,
  options,
  selected,
}: {
  emptyLabel: string;
  label: string;
  onChange: (keys: string[]) => void;
  options: readonly PublicationSelectionOption[];
  selected: readonly string[];
}) {
  return (
    <fieldset className="grid content-start gap-2 rounded-sm border border-panel-border bg-panel-deep p-3">
      <legend className="px-1 font-medium text-copy-secondary text-xs">{label}</legend>
      {options.length === 0 ? <p className="m-0 text-copy-faint text-xs">{emptyLabel}</p> : null}
      {options.map((option) => (
        <div
          className="flex items-start justify-between gap-3 text-copy-secondary text-xs"
          key={option.key}
        >
          <span id={`publication-option-${option.key}`}>{option.label}</span>
          <Switch.Root
            nativeButton
            render={<button type="button" />}
            checked={selected.includes(option.key)}
            onCheckedChange={(checked) =>
              onChange(
                checked ? [...selected, option.key] : selected.filter((key) => key !== option.key),
              )
            }
            className="settings-switch"
            aria-label={`Include ${option.label}`}
          >
            <Switch.Thumb className="settings-switch-thumb" />
          </Switch.Root>
        </div>
      ))}
    </fieldset>
  );
}

function isTlpMarking(value: string): value is TlpMarking {
  return (
    value === "red" ||
    value === "amber_strict" ||
    value === "amber" ||
    value === "green" ||
    value === "clear"
  );
}

function normalizeReleaseVersion(value: string): string | null {
  const normalized = value.trim().replace(/^[vV]/, "");
  if (!/^\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/.test(normalized)) return null;
  return normalized
    .split(".")
    .map((part) => String(Number(part)))
    .join(".");
}

function publicationSourceId(record: PublicationRecord): string {
  return record.snapshot.source.type === "freeform_document"
    ? record.snapshot.source.document_id
    : record.snapshot.source.report_id;
}
