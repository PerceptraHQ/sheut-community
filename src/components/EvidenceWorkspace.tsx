import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@base-ui/react/button";
import {
  IconArchive,
  IconEdit,
  IconFile,
  IconFileImport,
  IconPhoto,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { cloneElement, type ReactElement, useEffect, useId, useMemo, useState } from "react";
import {
  deleteEvidenceFile,
  type EvidenceFileMetadata,
  type EvidenceMetadataInput,
  evidenceErrorMessage,
  importEvidenceFile,
  listEvidenceFiles,
  loadEvidenceImage,
  updateEvidenceMetadata,
} from "../lib/guided-reports";
import { AlertDialogFrame } from "./AlertDialogFrame";
import { useVaultNotices } from "./VaultNotices";
import { WorkspaceEmptyState, WorkspaceLoadingState } from "./WorkspaceState";

interface EvidenceWorkspaceProps {
  projectId: string;
}

export function EvidenceWorkspace({ projectId }: EvidenceWorkspaceProps) {
  const notices = useVaultNotices();
  const [files, setFiles] = useState<EvidenceFileMetadata[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ evidenceId: string; url: string } | null>(null);
  const [query, setQuery] = useState("");
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<EvidenceMetadataInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [evidenceToDelete, setEvidenceToDelete] = useState<EvidenceFileMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listEvidenceFiles(projectId)
      .then((items) => {
        if (!active) return;
        setFiles(items);
        setSelectedId((current) => current ?? items[0]?.id ?? null);
        setError(null);
      })
      .catch((cause) => {
        if (active) setError(evidenceErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoadedProjectId(projectId);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (!selectedId) return () => undefined;
    const selected = files.find((file) => file.id === selectedId);
    if (!selected?.mediaType.startsWith("image/")) return () => undefined;
    void loadEvidenceImage(projectId, selectedId)
      .then((bytes) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: selected.mediaType }));
        setPreview({ evidenceId: selectedId, url: objectUrl });
      })
      .catch(() => {
        if (active) setPreview(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [files, projectId, selectedId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return files;
    return files.filter((file) =>
      `${file.title} ${file.fileName} ${file.description} ${file.source} ${file.tags.join(" ")} ${file.mediaType} ${file.sha256}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [files, query]);
  const selected = files.find((file) => file.id === selectedId) ?? null;
  const previewUrl = preview?.evidenceId === selectedId ? preview.url : null;
  const loading = loadedProjectId !== projectId;

  const saveMetadata = async () => {
    if (!selected || !editing) return;
    if (!editing.title.trim()) {
      setError("Evidence title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateEvidenceMetadata(projectId, selected.id, selected.revision, {
        ...editing,
        title: editing.title.trim(),
        description: editing.description.trim(),
        source: editing.source.trim(),
        sourceUrl: editing.sourceUrl.trim(),
        tags: normalizeTags(editing.tags),
        analystNotes: editing.analystNotes.trim(),
      });
      setFiles((current) => current.map((file) => (file.id === updated.id ? updated : file)));
      setEditing(null);
      notices.add({
        title: "Evidence metadata updated",
        description: "The analyst metadata was saved in the encrypted project.",
        type: "success",
      });
    } catch (cause) {
      setError(evidenceErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!evidenceToDelete) return;
    setSaving(true);
    setError(null);
    try {
      await deleteEvidenceFile(projectId, evidenceToDelete.id, evidenceToDelete.revision);
      setFiles((current) => current.filter((file) => file.id !== evidenceToDelete.id));
      setSelectedId((current) =>
        current === evidenceToDelete.id
          ? (files.find((file) => file.id !== evidenceToDelete.id)?.id ?? null)
          : current,
      );
      setEditing(null);
      setEvidenceToDelete(null);
      notices.add({
        title: "Evidence deleted",
        description: "The encrypted evidence file and its metadata were permanently removed.",
        type: "success",
      });
    } catch (cause) {
      setError(evidenceErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const importFile = async () => {
    setImporting(true);
    setError(null);
    try {
      const imported = await importEvidenceFile(projectId);
      if (!imported) return;
      setFiles((current) => [imported, ...current.filter((file) => file.id !== imported.id)]);
      setSelectedId(imported.id);
      notices.add({
        title: "Evidence imported",
        description: `${imported.fileName} is stored in the encrypted project Evidence library.`,
        type: "success",
      });
    } catch (cause) {
      const description = evidenceErrorMessage(cause);
      setError(description);
      notices.add({ title: "Evidence not imported", description, type: "info" });
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <WorkspaceLoadingState
        icon={<IconPhoto size={26} aria-hidden="true" />}
        title="Loading evidence"
        description="Reading encrypted project Evidence metadata."
      />
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_1fr]" aria-labelledby="evidence-title">
      <header className="flex flex-wrap items-center gap-3 border-panel-border border-b bg-panel-base px-4 py-3">
        <div className="min-w-0">
          <h1 className="m-0 text-sm font-semibold" id="evidence-title">
            Evidence
          </h1>
          <p className="m-0 mt-0.5 text-copy-faint text-xs">
            {files.length} encrypted {files.length === 1 ? "file" : "files"}
          </p>
        </div>
        <label className="relative ml-auto min-w-52 flex-1 sm:max-w-sm">
          <span className="sr-only">Search evidence</span>
          <IconSearch
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-copy-faint"
            size={14}
            aria-hidden="true"
          />
          <input
            aria-label="Search evidence"
            className="h-8 w-full rounded-sm border border-panel-border bg-panel-deep pr-2.5 pl-8 text-copy-primary text-xs outline-none focus:border-accent"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <Button
          className="primary-button"
          disabled={importing}
          type="button"
          onClick={() => void importFile()}
          aria-label="Import evidence file"
        >
          <IconFileImport size={15} aria-hidden="true" />
          {importing ? "Importing…" : "Import file"}
        </Button>
      </header>

      {error ? (
        <p className="error-message m-4" role="alert">
          {error}
        </p>
      ) : files.length === 0 ? (
        <WorkspaceEmptyState
          icon={<IconPhoto size={26} aria-hidden="true" />}
          title="No evidence files yet"
          description="Import images, video, documents, or inert archives. Each file is encrypted, stored once, and reusable across reports."
          action={
            <Button className="primary-button" type="button" onClick={() => void importFile()}>
              <IconFileImport size={15} aria-hidden="true" />
              Import evidence file
            </Button>
          }
        />
      ) : (
        <div className="grid min-h-0 grid-cols-1 min-[860px]:grid-cols-[minmax(15rem,1fr)_minmax(20rem,0.8fr)]">
          <div className="min-h-0 overflow-y-auto p-3">
            {filtered.length === 0 ? (
              <p className="list-message">No matching evidence.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
                {filtered.map((file) => (
                  <Button
                    aria-label={`${file.fileName} evidence file`}
                    aria-pressed={selectedId === file.id}
                    className="grid min-h-28 content-between gap-4 rounded-sm border border-panel-border bg-panel-base p-3 text-left hover:bg-panel-hover aria-pressed:border-accent aria-pressed:bg-selection"
                    key={file.id}
                    type="button"
                    onClick={() => setSelectedId(file.id)}
                  >
                    <EvidenceIcon mediaType={file.mediaType} />
                    <span className="grid min-w-0 gap-1">
                      <span className="truncate text-copy-primary text-xs">{file.title}</span>
                      <span className="truncate text-[10px] text-copy-faint">{file.fileName}</span>
                      <span className="text-[10px] text-copy-faint uppercase tracking-wide">
                        {displayMediaType(file.mediaType)} · {formatBytes(file.byteLen)}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
          <aside
            className="min-h-0 overflow-y-auto border-panel-border border-t bg-panel-deep p-4 min-[860px]:border-t-0 min-[860px]:border-l"
            aria-label="Evidence details"
          >
            {selected ? (
              <div className="grid gap-4">
                <div className="grid min-h-56 place-items-center overflow-hidden rounded-sm border border-panel-border bg-black/20 p-3">
                  {previewUrl ? (
                    <img
                      className="max-h-80 max-w-full object-contain"
                      src={previewUrl}
                      alt={selected.fileName}
                    />
                  ) : selected.mediaType.startsWith("image/") ? (
                    <IconPhoto size={40} className="text-copy-faint" aria-hidden="true" />
                  ) : (
                    <EvidenceIcon mediaType={selected.mediaType} size={48} />
                  )}
                </div>
                {editing ? (
                  <EvidenceMetadataForm
                    disabled={saving}
                    input={editing}
                    onCancel={() => setEditing(null)}
                    onChange={setEditing}
                    onSave={() => void saveMetadata()}
                  />
                ) : (
                  <div className="grid gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="m-0 break-words text-sm font-semibold">{selected.title}</h2>
                        <p className="mt-1 mb-0 break-words text-copy-faint text-[11px]">
                          {selected.fileName}
                        </p>
                      </div>
                      <Button
                        aria-label="Edit evidence metadata"
                        className="icon-control shrink-0"
                        onClick={() => setEditing(evidenceInput(selected))}
                        type="button"
                      >
                        <IconEdit size={14} aria-hidden="true" />
                      </Button>
                    </div>
                    {selected.description ? (
                      <p className="m-0 whitespace-pre-wrap text-copy-secondary text-xs leading-5">
                        {selected.description}
                      </p>
                    ) : null}
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                      {selected.source ? (
                        <>
                          <dt className="text-copy-faint">Source</dt>
                          <dd className="m-0 text-copy-secondary">{selected.source}</dd>
                        </>
                      ) : null}
                      {selected.capturedAt ? (
                        <>
                          <dt className="text-copy-faint">Captured</dt>
                          <dd className="m-0 text-copy-secondary">{selected.capturedAt}</dd>
                        </>
                      ) : null}
                      {selected.sourceUrl ? (
                        <>
                          <dt className="text-copy-faint">Source URL</dt>
                          <dd className="m-0 min-w-0 break-all text-copy-secondary">
                            {selected.sourceUrl}
                          </dd>
                        </>
                      ) : null}
                      <dt className="text-copy-faint">Type</dt>
                      <dd className="m-0 text-copy-secondary">{selected.mediaType}</dd>
                      <dt className="text-copy-faint">Size</dt>
                      <dd className="m-0 text-copy-secondary">{formatBytes(selected.byteLen)}</dd>
                      <dt className="text-copy-faint">Imported</dt>
                      <dd className="m-0 text-copy-secondary">
                        {new Date(selected.createdAtUnixMs).toLocaleString()}
                      </dd>
                      <dt className="text-copy-faint">SHA-256 fingerprint</dt>
                      <dd className="m-0 break-all font-mono text-[10px] text-copy-secondary">
                        {selected.sha256}
                      </dd>
                    </dl>
                    {selected.tags.length ? (
                      <ul
                        className="m-0 flex list-none flex-wrap gap-1 p-0"
                        aria-label="Evidence tags"
                      >
                        {selected.tags.map((tag) => (
                          <li
                            className="rounded-full border border-panel-border px-2 py-0.5 text-[10px] text-copy-muted"
                            key={tag}
                          >
                            {tag}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {selected.analystNotes ? (
                      <div className="grid gap-1">
                        <h3 className="m-0 text-copy-primary text-xs font-semibold">
                          Analyst notes
                        </h3>
                        <p className="m-0 whitespace-pre-wrap text-copy-secondary text-xs leading-5">
                          {selected.analystNotes}
                        </p>
                      </div>
                    ) : null}
                    <div className="border-panel-border border-t pt-3">
                      <Button
                        className="danger-button"
                        id="evidence-delete-trigger"
                        onClick={() => setEvidenceToDelete(selected)}
                        type="button"
                      >
                        <IconTrash size={14} aria-hidden="true" />
                        Delete evidence
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </aside>
        </div>
      )}
      <AlertDialog.Root
        open={evidenceToDelete !== null}
        triggerId={evidenceToDelete ? "evidence-delete-trigger" : null}
        onOpenChange={(open) => {
          if (!open && !saving) setEvidenceToDelete(null);
        }}
      >
        <AlertDialogFrame width="compact">
          <div className="grid gap-4 p-4">
            <AlertDialog.Title className="m-0 text-sm font-semibold">
              Delete evidence file?
            </AlertDialog.Title>
            <AlertDialog.Description className="m-0 text-copy-muted text-xs leading-5">
              This permanently removes the encrypted original file and its analyst metadata.
              Existing report references keep their recorded label but can no longer open the file.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
              <AlertDialog.Close render={<Button className="control-button" />} disabled={saving}>
                Cancel
              </AlertDialog.Close>
              <Button
                className="danger-button"
                disabled={saving}
                onClick={() => void confirmDelete()}
                type="button"
              >
                {saving ? "Deleting…" : "Delete evidence"}
              </Button>
            </div>
          </div>
        </AlertDialogFrame>
      </AlertDialog.Root>
    </section>
  );
}

function EvidenceMetadataForm({
  disabled,
  input,
  onCancel,
  onChange,
  onSave,
}: {
  disabled: boolean;
  input: EvidenceMetadataInput;
  onCancel: () => void;
  onChange: (input: EvidenceMetadataInput) => void;
  onSave: () => void;
}) {
  const fieldClass =
    "w-full rounded-sm border border-panel-border bg-panel-base px-2.5 py-2 text-copy-primary text-xs outline-none focus:border-accent";
  const set = <Key extends keyof EvidenceMetadataInput>(
    key: Key,
    value: EvidenceMetadataInput[Key],
  ) => onChange({ ...input, [key]: value });
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h2 className="m-0 text-sm font-semibold">Edit evidence metadata</h2>
      <EvidenceInputLabel label="Title" help="Use a short analyst-friendly name for reports.">
        <input
          className={`${fieldClass} h-9`}
          disabled={disabled}
          onChange={(event) => set("title", event.currentTarget.value)}
          required
          value={input.title}
        />
      </EvidenceInputLabel>
      <EvidenceInputLabel label="Description" help="Describe what the file proves or contains.">
        <textarea
          className={`${fieldClass} min-h-20 resize-y`}
          disabled={disabled}
          onChange={(event) => set("description", event.currentTarget.value)}
          value={input.description}
        />
      </EvidenceInputLabel>
      <EvidenceInputLabel label="Source" help="Who or what produced the evidence.">
        <input
          className={`${fieldClass} h-9`}
          disabled={disabled}
          onChange={(event) => set("source", event.currentTarget.value)}
          value={input.source}
        />
      </EvidenceInputLabel>
      <EvidenceInputLabel label="Capture date" help="The calendar date the evidence was obtained.">
        <input
          className={`${fieldClass} h-9`}
          disabled={disabled}
          onChange={(event) => set("capturedAt", event.currentTarget.value || null)}
          type="date"
          value={input.capturedAt ?? ""}
        />
      </EvidenceInputLabel>
      <EvidenceInputLabel
        label="Source URL"
        help="Optional origin URL; the imported file remains the evidence."
      >
        <input
          className={`${fieldClass} h-9`}
          disabled={disabled}
          onChange={(event) => set("sourceUrl", event.currentTarget.value)}
          type="url"
          value={input.sourceUrl}
        />
      </EvidenceInputLabel>
      <EvidenceInputLabel label="Tags" help="Separate tags with commas.">
        <input
          className={`${fieldClass} h-9`}
          disabled={disabled}
          onChange={(event) => set("tags", event.currentTarget.value.split(","))}
          value={input.tags.join(", ")}
        />
      </EvidenceInputLabel>
      <EvidenceInputLabel
        label="Analyst notes"
        help="Record caveats, handling notes, or why this matters."
      >
        <textarea
          className={`${fieldClass} min-h-24 resize-y`}
          disabled={disabled}
          onChange={(event) => set("analystNotes", event.currentTarget.value)}
          value={input.analystNotes}
        />
      </EvidenceInputLabel>
      <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
        <Button className="control-button" disabled={disabled} onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button className="primary-button" disabled={disabled} type="submit">
          {disabled ? "Saving…" : "Save evidence metadata"}
        </Button>
      </div>
    </form>
  );
}

function EvidenceInputLabel({
  children,
  help,
  label,
}: {
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
  help: string;
  label: string;
}) {
  const inputId = useId();
  const helpId = useId();
  return (
    <div className="grid gap-1.5 text-copy-secondary text-xs">
      <label htmlFor={inputId}>{label}</label>
      {cloneElement(children, { id: inputId, "aria-describedby": helpId })}
      <span className="text-[11px] text-copy-faint leading-4" id={helpId}>
        {help}
      </span>
    </div>
  );
}

function evidenceInput(evidence: EvidenceFileMetadata): EvidenceMetadataInput {
  return {
    title: evidence.title,
    description: evidence.description,
    source: evidence.source,
    capturedAt: evidence.capturedAt,
    sourceUrl: evidence.sourceUrl,
    tags: [...evidence.tags],
    analystNotes: evidence.analystNotes,
  };
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean))];
}

function EvidenceIcon({ mediaType, size = 28 }: { mediaType: string; size?: number }) {
  if (mediaType.startsWith("image/")) {
    return <IconPhoto size={size} stroke={1.4} className="text-accent" aria-hidden="true" />;
  }
  if (
    mediaType.includes("zip") ||
    mediaType.includes("gzip") ||
    mediaType.includes("rar") ||
    mediaType.includes("7z")
  ) {
    return <IconArchive size={size} stroke={1.4} className="text-accent" aria-hidden="true" />;
  }
  return <IconFile size={size} stroke={1.4} className="text-accent" aria-hidden="true" />;
}

function displayMediaType(mediaType: string): string {
  return (
    mediaType.split("/").at(-1)?.replace("vnd.openxmlformats-officedocument.", "") ?? mediaType
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
