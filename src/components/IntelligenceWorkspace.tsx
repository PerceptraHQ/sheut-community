import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Input } from "@base-ui/react/input";
import {
  IconDownload,
  IconEdit,
  IconGitFork,
  IconLink,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  commitStixExport,
  commitStixImport,
  createStixDraft,
  createStixRelationshipDraft,
  createStixRevisionDraft,
  type DuplicateDecision,
  deleteStixDraft,
  deleteStixObject,
  discardStixExportPreview,
  discardStixImportPreview,
  listStixDrafts,
  listStixObjects,
  previewStixExport,
  previewStixImport,
  type StixDraftSummary,
  type StixExportPreview,
  type StixImportPreview,
  type StixObjectSummary,
  stixErrorMessage,
  updateStixDraft,
  updateStixRelationshipDraft,
} from "../lib/stix";
import { buildStixConnections, draftDisplayName } from "../lib/stixConnections";
import { isRelationshipEndpointType, readableStixName } from "../lib/stixSchemas";
import { AlertDialogFrame } from "./AlertDialogFrame";
import { DialogFrame } from "./DialogFrame";
import { SelectField } from "./SelectField";
import { StixConnectionsDialog, type StixRelationshipCreateInput } from "./StixConnectionsDialog";
import { StixDraftDialog, type StixDraftSaveInput } from "./StixDraftDialog";
import { StixTypeIcon } from "./StixTypeIcon";
import { useVaultNotices } from "./VaultNotices";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";
import { WorkspaceLoadingState } from "./WorkspaceState";

const duplicateOptions: ReadonlyArray<{ value: DuplicateDecision; label: string }> = [
  { value: "keep_existing", label: "Keep existing" },
  { value: "replace_version", label: "Replace version" },
  { value: "merge_supported_fields", label: "Merge custom fields" },
];

interface IntelligenceWorkspaceProps {
  projectId: string;
}

function loadIntelligence(projectId: string) {
  return Promise.all([listStixObjects(projectId), listStixDrafts(projectId)]);
}

function intelligenceMatchesSearch(
  item: StixObjectSummary | StixDraftSummary,
  search: string,
): boolean {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return true;
  const displayName = "displayName" in item ? item.displayName : draftDisplayName(item);
  const stixId = "stixId" in item ? item.stixId : "";
  return [displayName, item.objectType, readableStixName(item.objectType), stixId].some((value) =>
    value.toLocaleLowerCase().includes(query),
  );
}

export function IntelligenceWorkspace({ projectId }: IntelligenceWorkspaceProps) {
  const notices = useVaultNotices();
  const [objects, setObjects] = useState<StixObjectSummary[]>([]);
  const [drafts, setDrafts] = useState<StixDraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<StixImportPreview | null>(null);
  const [decisions, setDecisions] = useState<DuplicateDecision[]>([]);
  const [exportPreview, setExportPreview] = useState<StixExportPreview | null>(null);
  const [exportFileName, setExportFileName] = useState("stix-bundle");
  const [draftEditorOpen, setDraftEditorOpen] = useState(false);
  const [activeDraft, setActiveDraft] = useState<StixDraftSummary | null>(null);
  const [draftToDelete, setDraftToDelete] = useState<StixDraftSummary | null>(null);
  const [objectToDelete, setObjectToDelete] = useState<StixObjectSummary | null>(null);
  const [connectionsEndpoint, setConnectionsEndpoint] = useState<{
    localId: string;
    objectType: string;
    displayName: string;
  } | null>(null);
  const [search, setSearch] = useState("");

  const filteredObjects = useMemo(
    () => objects.filter((object) => intelligenceMatchesSearch(object, search)),
    [objects, search],
  );
  const filteredDrafts = useMemo(
    () => drafts.filter((draft) => intelligenceMatchesSearch(draft, search)),
    [drafts, search],
  );
  const connections = useMemo(() => buildStixConnections(objects, drafts), [objects, drafts]);

  const refresh = useCallback(async () => {
    try {
      const [nextObjects, nextDrafts] = await loadIntelligence(projectId);
      setObjects(nextObjects);
      setDrafts(nextDrafts);
    } catch (cause) {
      setError(stixErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void loadIntelligence(projectId).then(
      ([nextObjects, nextDrafts]) => {
        if (cancelled) return;
        setObjects(nextObjects);
        setDrafts(nextDrafts);
        setLoading(false);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(stixErrorMessage(cause));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleSaveDraft = async ({ objectType, properties, relationship }: StixDraftSaveInput) => {
    if (relationship && activeDraft) {
      await updateStixRelationshipDraft(
        projectId,
        activeDraft.localId,
        relationship.sourceId,
        relationship.targetId,
        relationship.relationshipType,
        properties,
      );
    } else if (relationship) {
      await createStixRelationshipDraft(
        projectId,
        relationship.sourceId,
        relationship.targetId,
        relationship.relationshipType,
        properties,
      );
    } else if (activeDraft) {
      await updateStixDraft(projectId, activeDraft.localId, objectType, properties);
    } else {
      await createStixDraft(projectId, objectType, properties);
    }
    await refresh();
    notices.add({
      title: activeDraft ? "STIX draft updated" : "STIX draft created",
      description: "The structured draft was saved to the encrypted project database.",
      type: "success",
    });
  };

  const relationshipEndpoints = [
    ...objects
      .filter((object) => isRelationshipEndpointType(object.objectType))
      .map((object) => ({
        localId: object.localId,
        objectType: object.objectType,
        displayName: object.displayName,
      })),
    ...drafts
      .filter((draft) => isRelationshipEndpointType(draft.objectType))
      .map((draft) => ({
        localId: draft.localId,
        objectType: draft.objectType,
        displayName: draftDisplayName(draft),
      })),
  ];

  const handleCreateConnection = async ({
    sourceId,
    targetId,
    relationshipType,
    properties,
  }: StixRelationshipCreateInput) => {
    try {
      await createStixRelationshipDraft(
        projectId,
        sourceId,
        targetId,
        relationshipType,
        properties,
      );
      await refresh();
      notices.add({
        title: "STIX relationship draft created",
        description: "The directed relationship was saved to the encrypted project database.",
        type: "success",
      });
    } catch (cause) {
      throw new Error(stixErrorMessage(cause), { cause });
    }
  };

  const handleDeleteDraft = async () => {
    if (!draftToDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteStixDraft(projectId, draftToDelete.localId);
      setDraftToDelete(null);
      await refresh();
      notices.add({
        title: "STIX draft deleted",
        description: "The local draft was removed from this project.",
        type: "success",
      });
    } catch (cause) {
      setError(stixErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleEditObject = async (object: StixObjectSummary) => {
    const openRevision = drafts.find((draft) => draft.localId === object.localId);
    if (openRevision) {
      setActiveDraft(openRevision);
      setDraftEditorOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const draft = await createStixRevisionDraft(projectId, object.localId);
      setDrafts((current) => [...current, draft]);
      setActiveDraft(draft);
      setDraftEditorOpen(true);
      notices.add({
        title: "STIX revision opened",
        description: "Changes remain a local draft until a validated export is confirmed.",
        type: "success",
      });
    } catch (cause) {
      setError(stixErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteObject = async () => {
    if (!objectToDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteStixObject(projectId, objectToDelete.localId);
      setObjectToDelete(null);
      await refresh();
      notices.add({
        title: "STIX object deleted",
        description:
          "The object was removed from All intelligence graphs. Named workspaces preserve an unavailable placeholder.",
        type: "success",
      });
    } catch (cause) {
      setError(stixErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const closeImportPreview = () => {
    const preview = importPreview;
    setImportPreview(null);
    setDecisions([]);
    if (preview) void discardStixImportPreview(projectId, preview.previewId);
  };

  const closeExportPreview = () => {
    const preview = exportPreview;
    setExportPreview(null);
    if (preview) void discardStixExportPreview(projectId, preview.previewId);
  };

  const handlePreviewImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const preview = await previewStixImport(projectId);
      if (preview) {
        setImportPreview(preview);
        setDecisions(preview.duplicates.map(() => "keep_existing"));
      }
    } catch (cause) {
      setError(stixErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleCommitImport = async () => {
    if (!importPreview) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await commitStixImport(projectId, importPreview.previewId, decisions);
      setImportPreview(null);
      setDecisions([]);
      await refresh();
      notices.add({
        title: "STIX import complete",
        description: `${outcome.imported} imported, ${outcome.skipped} kept unchanged.`,
        type: "success",
      });
    } catch (cause) {
      setImportPreview(null);
      setDecisions([]);
      setError(stixErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const handlePreviewExport = async () => {
    setBusy(true);
    setError(null);
    try {
      setExportPreview(await previewStixExport(projectId));
    } catch (cause) {
      setError(stixErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleCommitExport = async () => {
    if (!exportPreview) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await commitStixExport(projectId, exportPreview.previewId, exportFileName);
      if (outcome.saved) {
        setExportPreview(null);
        await refresh();
        notices.add({
          title: "STIX bundle exported",
          description: `${exportPreview.objectCount} objects were written locally.`,
          type: "success",
        });
      }
    } catch (cause) {
      setExportPreview(null);
      setError(stixErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="mx-auto flex w-full flex-col px-5 py-5 xl:px-8 xl:py-7 2xl:px-10 2xl:py-8"
      aria-labelledby="intel-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-panel-border border-b pb-4">
        <div>
          <p className="m-0 text-[11px] text-copy-faint uppercase tracking-[0.12em]">STIX 2.1</p>
          <h1 className="mt-1 mb-0 text-base font-semibold" id="intel-title">
            Intelligence
          </h1>
          <p className="mt-1 mb-0 max-w-2xl text-copy-muted text-xs leading-5">
            Validated local objects. STIX 2.0 and invalid bundles never mutate the project.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => {
              setActiveDraft(null);
              setDraftEditorOpen(true);
            }}
          >
            <IconPlus size={14} stroke={1.7} aria-hidden="true" />
            New draft
          </Button>
          <Button
            className="control-button"
            type="button"
            disabled={busy}
            onClick={() => void handlePreviewImport()}
          >
            <IconUpload size={14} stroke={1.7} aria-hidden="true" />
            Import bundle
          </Button>
          <Button
            className="control-button"
            type="button"
            disabled={busy || objects.length + drafts.length === 0}
            onClick={() => void handlePreviewExport()}
          >
            <IconDownload size={14} stroke={1.7} aria-hidden="true" />
            Export bundle
          </Button>
        </div>
      </header>

      {error ? (
        <p className="error-message mt-4" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && objects.length + drafts.length > 0 ? (
        <label
          className="mt-4 flex h-9 min-w-0 items-center gap-2 rounded-sm border border-panel-border bg-panel-base px-2.5 text-copy-faint focus-within:border-accent"
          htmlFor="intelligence-search"
        >
          <IconSearch size={14} aria-hidden="true" />
          <Input
            id="intelligence-search"
            className="min-w-0 flex-1 border-0 bg-transparent text-copy-primary text-xs outline-none placeholder:text-copy-faint"
            type="search"
            aria-label="Search intelligence by name or type"
            placeholder="Search by name or STIX type"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          {search.trim() ? (
            <span className="shrink-0 text-[11px] text-copy-faint" aria-live="polite">
              {filteredObjects.length + filteredDrafts.length} results
            </span>
          ) : null}
        </label>
      ) : null}

      {loading ? (
        <WorkspaceLoadingState
          icon={<IconGitFork size={26} aria-hidden="true" />}
          title="Loading intelligence"
          description="Reading encrypted STIX objects and local drafts."
        />
      ) : objects.length === 0 && drafts.length === 0 ? (
        <div className="py-16 text-center">
          <p className="m-0 text-copy-secondary text-sm">No STIX objects in this project</p>
          <p className="mt-2 mb-0 text-copy-faint text-xs">
            Create a local draft or import a validated STIX 2.1 Bundle to begin.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          {filteredDrafts.length ? (
            <section
              className="overflow-hidden rounded-sm border border-panel-border bg-panel-base"
              aria-labelledby="stix-drafts-title"
            >
              <div className="flex items-center justify-between border-panel-border border-b bg-panel-deep px-3 py-2">
                <h2
                  className="m-0 text-[11px] text-copy-faint uppercase tracking-wider"
                  id="stix-drafts-title"
                >
                  Local drafts
                </h2>
                <span className="text-copy-faint text-[11px]">
                  New objects gain IDs on export; revisions preserve identity
                </span>
              </div>
              <ul className="m-0 list-none p-0">
                {filteredDrafts.map((draft) => (
                  <WorkspaceContextMenu
                    key={draft.localId}
                    trigger={
                      <li className="grid grid-cols-[minmax(10rem,0.7fr)_minmax(16rem,1.4fr)_auto] items-center gap-3 border-panel-border border-b px-3 py-2.5 last:border-b-0">
                        <span className="flex min-w-0 items-center gap-2 text-copy-primary text-xs">
                          <span className="text-accent-bright">
                            <StixTypeIcon objectType={draft.objectType} />
                          </span>
                          <span className="truncate">{readableStixName(draft.objectType)}</span>
                          {draft.replacesStixId ? (
                            <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent-bright uppercase tracking-wide">
                              Revision
                            </span>
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-copy-secondary text-xs">
                            {draftDisplayName(draft)}
                          </span>
                          <code
                            className="mt-0.5 block truncate text-[11px] text-copy-faint"
                            title={draft.localId}
                          >
                            {draft.localId}
                          </code>
                        </span>
                        <span className="flex items-center gap-1">
                          {isRelationshipEndpointType(draft.objectType) ? (
                            <Button
                              className="icon-control"
                              type="button"
                              aria-label={`Connections for ${draftDisplayName(draft)}`}
                              disabled={busy}
                              onClick={() =>
                                setConnectionsEndpoint({
                                  localId: draft.localId,
                                  objectType: draft.objectType,
                                  displayName: draftDisplayName(draft),
                                })
                              }
                            >
                              <IconLink size={14} aria-hidden="true" />
                            </Button>
                          ) : null}
                          <Button
                            className="icon-control"
                            type="button"
                            aria-label={`Edit ${draft.objectType} draft`}
                            onClick={() => {
                              setActiveDraft(draft);
                              setDraftEditorOpen(true);
                            }}
                          >
                            <IconEdit size={14} aria-hidden="true" />
                          </Button>
                          <Button
                            className="icon-control"
                            type="button"
                            aria-label={`Delete ${draft.objectType} draft`}
                            onClick={() => setDraftToDelete(draft)}
                          >
                            <IconTrash size={14} aria-hidden="true" />
                          </Button>
                        </span>
                      </li>
                    }
                    items={[
                      ...(isRelationshipEndpointType(draft.objectType)
                        ? [
                            {
                              label: "View connections",
                              onSelect: () =>
                                setConnectionsEndpoint({
                                  localId: draft.localId,
                                  objectType: draft.objectType,
                                  displayName: draftDisplayName(draft),
                                }),
                            },
                          ]
                        : []),
                      {
                        label: "Edit draft",
                        onSelect: () => {
                          setActiveDraft(draft);
                          setDraftEditorOpen(true);
                        },
                      },
                      {
                        label: "Delete draft",
                        danger: true,
                        separatorBefore: true,
                        onSelect: () => setDraftToDelete(draft),
                      },
                    ]}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {filteredObjects.length ? (
            <section
              className="overflow-hidden rounded-sm border border-panel-border bg-panel-base"
              aria-labelledby="stix-objects-title"
            >
              <div className="grid grid-cols-[minmax(9rem,0.55fr)_minmax(10rem,0.85fr)_minmax(14rem,1.2fr)_minmax(9rem,0.6fr)_auto] gap-3 border-panel-border border-b bg-panel-deep px-3 py-2 text-[11px] text-copy-faint uppercase tracking-wider">
                <span id="stix-objects-title">Type</span>
                <span>Name</span>
                <span>STIX ID</span>
                <span>Modified</span>
                <span className="sr-only">Actions</span>
              </div>
              <ul className="m-0 list-none p-0">
                {filteredObjects.map((object) => {
                  const row = (
                    <li
                      className="grid grid-cols-[minmax(9rem,0.55fr)_minmax(10rem,0.85fr)_minmax(14rem,1.2fr)_minmax(9rem,0.6fr)_auto] items-center gap-3 border-panel-border border-b px-3 py-2.5 last:border-b-0"
                      key={object.localId}
                    >
                      <span className="flex min-w-0 items-center gap-2 text-copy-primary text-xs">
                        <span className="text-accent-bright">
                          <StixTypeIcon objectType={object.objectType} />
                        </span>
                        <span className="truncate">{readableStixName(object.objectType)}</span>
                      </span>
                      <span
                        className="truncate text-copy-secondary text-xs"
                        title={object.displayName}
                      >
                        {object.displayName}
                      </span>
                      <code className="truncate text-copy-muted text-xs" title={object.stixId}>
                        {object.stixId}
                      </code>
                      <span className="truncate text-copy-faint text-xs">
                        {object.modified ?? "Immutable"}
                      </span>
                      <span className="flex items-center gap-1">
                        {isRelationshipEndpointType(object.objectType) ? (
                          <Button
                            className="icon-control"
                            type="button"
                            aria-label={`Connections for ${object.displayName}`}
                            disabled={busy}
                            onClick={() =>
                              setConnectionsEndpoint({
                                localId: object.localId,
                                objectType: object.objectType,
                                displayName: object.displayName,
                              })
                            }
                          >
                            <IconLink size={14} aria-hidden="true" />
                          </Button>
                        ) : null}
                        {object.modified ? (
                          <Button
                            className="icon-control"
                            type="button"
                            aria-label={`Edit ${readableStixName(object.objectType)}`}
                            disabled={busy}
                            onClick={() => void handleEditObject(object)}
                          >
                            <IconEdit size={14} aria-hidden="true" />
                          </Button>
                        ) : null}
                        <Button
                          className="icon-control"
                          type="button"
                          aria-label={`Delete ${readableStixName(object.objectType)}`}
                          disabled={busy}
                          onClick={() => setObjectToDelete(object)}
                        >
                          <IconTrash size={14} aria-hidden="true" />
                        </Button>
                      </span>
                    </li>
                  );
                  return (
                    <WorkspaceContextMenu
                      key={object.localId}
                      trigger={row}
                      items={[
                        ...(isRelationshipEndpointType(object.objectType)
                          ? [
                              {
                                label: "View connections",
                                disabled: busy,
                                onSelect: () =>
                                  setConnectionsEndpoint({
                                    localId: object.localId,
                                    objectType: object.objectType,
                                    displayName: object.displayName,
                                  }),
                              },
                            ]
                          : []),
                        ...(object.modified
                          ? [
                              {
                                label: "Create revision draft",
                                disabled: busy,
                                onSelect: () => void handleEditObject(object),
                              },
                            ]
                          : []),
                        {
                          label: "Delete object",
                          danger: true,
                          separatorBefore: object.modified !== null,
                          disabled: busy,
                          onSelect: () => setObjectToDelete(object),
                        },
                      ]}
                    />
                  );
                })}
              </ul>
            </section>
          ) : null}
          {filteredObjects.length + filteredDrafts.length === 0 ? (
            <div className="rounded-sm border border-panel-border bg-panel-base px-4 py-12 text-center">
              <p className="m-0 text-copy-secondary text-sm">No matching intelligence</p>
              <p className="mt-1 mb-0 text-copy-faint text-xs">
                Try a display name or STIX type such as Indicator or threat-actor.
              </p>
            </div>
          ) : null}
        </div>
      )}

      {draftEditorOpen ? (
        <StixDraftDialog
          key={activeDraft?.localId ?? "new"}
          draft={activeDraft}
          endpoints={relationshipEndpoints}
          open
          onOpenChange={setDraftEditorOpen}
          onSave={handleSaveDraft}
          referenceObjects={objects}
        />
      ) : null}

      {connectionsEndpoint ? (
        <StixConnectionsDialog
          key={connectionsEndpoint.localId}
          connections={connections}
          endpoint={connectionsEndpoint}
          endpoints={relationshipEndpoints}
          onCreate={handleCreateConnection}
          onOpenChange={(open) => {
            if (!open) setConnectionsEndpoint(null);
          }}
          open
        />
      ) : null}

      <AlertDialog.Root
        open={draftToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDraftToDelete(null);
        }}
      >
        <AlertDialogFrame width="compact">
          <div className="grid gap-4 p-4">
            <AlertDialog.Title className="m-0 text-sm font-semibold">
              Delete STIX draft?
            </AlertDialog.Title>
            <AlertDialog.Description className="m-0 text-copy-muted text-xs leading-5">
              This removes the local draft from the encrypted project. It does not affect previously
              exported files.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
              <AlertDialog.Close render={<Button className="control-button" />} disabled={busy}>
                Cancel
              </AlertDialog.Close>
              <Button
                className="danger-button"
                type="button"
                disabled={busy}
                onClick={() => void handleDeleteDraft()}
              >
                {busy ? "Deleting…" : "Delete draft"}
              </Button>
            </div>
          </div>
        </AlertDialogFrame>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={objectToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setObjectToDelete(null);
        }}
      >
        <AlertDialogFrame width="compact">
          <div className="grid gap-4 p-4">
            <AlertDialog.Title className="m-0 text-sm font-semibold">
              Delete STIX object?
            </AlertDialog.Title>
            <AlertDialog.Description className="m-0 text-copy-muted text-xs leading-5">
              This permanently removes the validated object from the encrypted project. Graph
              projections named All intelligence remove it; named workspaces keep an unavailable
              placeholder. Objects still used by STIX relationships, references, or revision drafts
              cannot be deleted.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
              <AlertDialog.Close render={<Button className="control-button" />} disabled={busy}>
                Cancel
              </AlertDialog.Close>
              <Button
                className="danger-button"
                type="button"
                disabled={busy}
                onClick={() => void handleDeleteObject()}
              >
                {busy ? "Deleting…" : "Delete object"}
              </Button>
            </div>
          </div>
        </AlertDialogFrame>
      </AlertDialog.Root>

      <Dialog.Root
        open={importPreview !== null}
        onOpenChange={(open) => {
          if (!open) closeImportPreview();
        }}
      >
        <DialogFrame>
          <div className="border-panel-border border-b px-4 py-3">
            <Dialog.Title className="m-0 text-sm font-semibold">Review STIX import</Dialog.Title>
            <Dialog.Description className="mt-1 mb-0 text-copy-muted text-xs leading-5">
              {importPreview?.objectCount ?? 0} objects passed bounded STIX 2.1 validation.
            </Dialog.Description>
          </div>
          <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
            {importPreview?.duplicates.length ? (
              <>
                <p className="m-0 text-copy-secondary text-xs">
                  Choose an explicit outcome for every matching STIX version.
                </p>
                {importPreview.duplicates.map((duplicate, index) => (
                  <div
                    className="rounded-sm border border-panel-border p-2.5"
                    key={duplicate.stixId}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <StixTypeIcon objectType={duplicate.objectType} size={14} />
                      <code className="truncate text-[11px] text-copy-muted">
                        {duplicate.stixId}
                      </code>
                    </div>
                    <div className="mt-2">
                      <SelectField
                        ariaLabel={`Import action for ${duplicate.stixId}`}
                        onChange={(decision) => {
                          setDecisions((current) =>
                            current.map((value, decisionIndex) =>
                              decisionIndex === index ? (decision as DuplicateDecision) : value,
                            ),
                          );
                        }}
                        options={duplicateOptions}
                        placeholder="Choose import action"
                        value={decisions[index]}
                      />
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <p className="m-0 text-copy-secondary text-xs">No duplicate versions were found.</p>
            )}
          </div>
          <footer className="flex justify-end gap-2 border-panel-border border-t px-4 py-3">
            <Button className="control-button" type="button" onClick={closeImportPreview}>
              Cancel
            </Button>
            <Button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void handleCommitImport()}
            >
              Import {importPreview?.objectCount ?? 0}{" "}
              {importPreview?.objectCount === 1 ? "object" : "objects"}
            </Button>
          </footer>
        </DialogFrame>
      </Dialog.Root>

      <Dialog.Root
        open={exportPreview !== null}
        onOpenChange={(open) => {
          if (!open) closeExportPreview();
        }}
      >
        <DialogFrame width="compact">
          <div className="border-panel-border border-b px-4 py-3">
            <Dialog.Title className="m-0 text-sm font-semibold">Export STIX bundle</Dialog.Title>
            <Dialog.Description className="mt-1 mb-0 text-copy-muted text-xs leading-5">
              Validate and export {exportPreview?.objectCount ?? 0} current objects as STIX 2.1.
            </Dialog.Description>
          </div>
          <div className="px-4 py-3">
            <label className="block text-copy-muted text-xs" htmlFor="stix-export-name">
              File name
            </label>
            <input
              className="mt-1 h-8 w-full rounded-sm border border-panel-border bg-panel-deep px-2 text-copy-primary text-xs outline-none focus:border-accent"
              id="stix-export-name"
              value={exportFileName}
              maxLength={96}
              onChange={(event) => setExportFileName(event.currentTarget.value)}
            />
          </div>
          <footer className="flex justify-end gap-2 border-panel-border border-t px-4 py-3">
            <Button className="control-button" type="button" onClick={closeExportPreview}>
              Cancel
            </Button>
            <Button
              className="primary-button"
              type="button"
              disabled={busy || exportFileName.trim().length === 0}
              onClick={() => void handleCommitExport()}
            >
              Choose save location
            </Button>
          </footer>
        </DialogFrame>
      </Dialog.Root>
    </section>
  );
}
