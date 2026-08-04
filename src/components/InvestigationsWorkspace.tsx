import { Button } from "@base-ui/react/button";
import { IconLayoutSidebarLeftCollapse, IconNotes, IconTrash, IconX } from "@tabler/icons-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  dispatchWorkspaceAction,
  isWorkspaceActionEvent,
  WORKSPACE_ACTION_EVENT,
  type WorkspaceActionId,
} from "../lib/desktopActions";
import {
  createDocument,
  type DocumentEnvelope,
  type DocumentPublicationOptions,
  deleteDocument,
  documentErrorMessage,
  documentKindLabel,
  documentTitle,
  exportSavedDocument,
  listDocuments,
  loadDocument,
  type NewDocumentKind,
  restoreDocument,
} from "../lib/documents";
import type { TlpMarking } from "../lib/projects";
import { DeleteDocumentDialog } from "./DeleteDocumentDialog";
import { useVaultNotices } from "./VaultNotices";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";
import { WorkspaceLoadingState } from "./WorkspaceState";

const loadDocumentEditor = () => import("./DocumentEditor");
const DocumentEditor = lazy(loadDocumentEditor);

export function prefetchDocumentEditor(): Promise<unknown> {
  return loadDocumentEditor();
}

interface InvestigationsWorkspaceProps {
  actionRequest?: { action: WorkspaceActionId; requestKey: number } | null;
  projectId: string;
  onActionHandled?: (requestKey: number) => void;
  onBusyChange: (busy: boolean) => void;
  onSelectedDocumentChange: (document: DocumentEnvelope | null) => void;
  externalDocument: DocumentEnvelope | null;
  defaultTlpMarking?: TlpMarking;
}

export function InvestigationsWorkspace({
  actionRequest,
  projectId,
  onActionHandled,
  onBusyChange,
  onSelectedDocumentChange,
  externalDocument,
  defaultTlpMarking = "amber",
}: InvestigationsWorkspaceProps) {
  const notices = useVaultNotices();
  const [documents, setDocuments] = useState<DocumentEnvelope[]>(() =>
    externalDocument ? [externalDocument] : [],
  );
  const [selected, setSelected] = useState<DocumentEnvelope | null>(externalDocument);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocumentEnvelope | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [documentExplorerCollapsed, setDocumentExplorerCollapsed] = useState(false);
  const [openDocumentIds, setOpenDocumentIds] = useState<string[]>(() =>
    externalDocument ? [externalDocument.id] : [],
  );

  useEffect(() => {
    let active = true;
    listDocuments(projectId)
      .then((items) => {
        if (active) setDocuments(items);
      })
      .catch((cause: unknown) => {
        if (active) {
          notices.add({
            title: "Documents unavailable",
            description: documentErrorMessage(cause),
            type: "info",
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      onBusyChange(false);
    };
  }, [notices, onBusyChange, projectId]);

  useEffect(() => {
    onSelectedDocumentChange(selected);
  }, [onSelectedDocumentChange, selected]);

  const setBusy = useCallback(
    (busy: boolean) => {
      setEditorBusy(busy);
      onBusyChange(busy);
    },
    [onBusyChange],
  );

  const handleOpen = useCallback((document: DocumentEnvelope) => {
    setOpenDocumentIds((current) =>
      current.includes(document.id) ? current : [...current, document.id],
    );
    setSelected(document);
  }, []);

  const handleCreate = useCallback(
    async (kind: NewDocumentKind) => {
      setCreating(true);
      const kindLabel = documentKindLabel(kind);
      try {
        const created = await notices.promise(() => createDocument(projectId, kind), {
          loading: {
            title: `Creating ${kindLabel}`,
            description: "Preparing the encrypted document.",
            type: "info",
          },
          success: {
            title: `${kindLabel} created`,
            description: "The document is ready to edit.",
            type: "success",
          },
          error: (cause) => ({
            title: `${kindLabel} not created`,
            description: documentErrorMessage(cause),
            type: "info",
          }),
        });
        setDocuments((current) => [...current, created]);
        handleOpen(created);
      } catch {
        // The bounded notice promise reports the failure.
      } finally {
        setCreating(false);
      }
    },
    [handleOpen, notices, projectId],
  );

  useEffect(() => {
    const handleWorkspaceAction = (event: Event) => {
      if (!isWorkspaceActionEvent(event) || event.detail !== "file.new-report") return;
      void handleCreate("report");
    };
    window.addEventListener(WORKSPACE_ACTION_EVENT, handleWorkspaceAction);
    return () => window.removeEventListener(WORKSPACE_ACTION_EVENT, handleWorkspaceAction);
  }, [handleCreate]);

  useEffect(() => {
    if (!actionRequest) return;
    dispatchWorkspaceAction(actionRequest.action);
    onActionHandled?.(actionRequest.requestKey);
  }, [actionRequest, onActionHandled]);

  const handleClose = (documentId: string) => {
    if (editorBusy) return;
    const closingIndex = openDocumentIds.indexOf(documentId);
    const remaining = openDocumentIds.filter((id) => id !== documentId);
    setOpenDocumentIds(remaining);
    if (selected?.id !== documentId) return;
    const nextId = remaining[Math.min(Math.max(closingIndex, 0), remaining.length - 1)];
    setSelected(nextId ? (documents.find((item) => item.id === nextId) ?? null) : null);
  };

  const handleSaved = (saved: DocumentEnvelope) => {
    setDocuments((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    setSelected(saved);
  };

  const handleReload = async (documentId: string) => {
    const reloaded = await loadDocument(projectId, documentId);
    handleSaved(reloaded);
    return reloaded;
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const deleting = deleteTarget;
    await notices.promise(() => deleteDocument(projectId, deleting.id), {
      loading: {
        title: "Deleting document",
        description: "Removing it from the encrypted project.",
        type: "info",
      },
      success: {
        title: "Document deleted",
        description: `${documentTitle(deleting)} was moved out of the workspace.`,
        type: "success",
        timeout: 10_000,
        action: {
          label: "Undo",
          onClick: async () => {
            let restored: DocumentEnvelope;
            try {
              restored = await restoreDocument(projectId, deleting.id);
            } catch (cause) {
              notices.add({
                title: "Document not restored",
                description: documentErrorMessage(cause),
                type: "info",
              });
              return;
            }
            setDocuments((current) => [
              ...current.filter((item) => item.id !== restored.id),
              restored,
            ]);
            handleOpen(restored);
            notices.add({
              title: "Document restored",
              description: `${documentTitle(restored)} is open again.`,
              type: "success",
            });
          },
        },
      },
      error: (cause) => ({
        title: "Document not deleted",
        description: documentErrorMessage(cause),
        type: "info",
      }),
    });
    const remainingDocuments = documents.filter((item) => item.id !== deleting.id);
    const remainingOpenIds = openDocumentIds.filter((id) => id !== deleting.id);
    setDocuments(remainingDocuments);
    setOpenDocumentIds(remainingOpenIds);
    if (selected?.id === deleting.id) {
      const nextId = remainingOpenIds.at(-1);
      setSelected(nextId ? (remainingDocuments.find((item) => item.id === nextId) ?? null) : null);
    }
  };

  const handleExport = async (documentId: string, options: DocumentPublicationOptions) => {
    try {
      const outcome = await exportSavedDocument(projectId, documentId, options);
      if (outcome.saved) {
        notices.add({
          title: `${options.format.toUpperCase()} exported`,
          description: "The document was saved to the selected location.",
          type: "success",
        });
      }
    } catch (cause) {
      notices.add({
        title: "Document not exported",
        description: documentErrorMessage(cause),
        type: "info",
      });
      throw cause;
    }
  };

  const workspaceTabHost = window.document.getElementById("workspace-tabs");
  const workspaceTabs = (
    <>
      <div className="document-tab-bar" role="tablist" aria-label="Open documents">
        {openDocumentIds.map((documentId) => {
          const document = documents.find((item) => item.id === documentId);
          if (!document) return null;
          const title = documentTitle(document);
          return (
            <WorkspaceContextMenu
              key={documentId}
              trigger={
                <div className="document-tab" data-active={selected?.id === documentId}>
                  <Button
                    className="document-tab-select"
                    type="button"
                    role="tab"
                    aria-selected={selected?.id === documentId}
                    disabled={editorBusy && selected?.id !== documentId}
                    onClick={() => handleOpen(document)}
                  >
                    <span className="truncate">{title}</span>
                  </Button>
                  <Button
                    className="document-tab-close"
                    type="button"
                    disabled={editorBusy}
                    onClick={() => handleClose(documentId)}
                    aria-label={`Close ${title}`}
                    title={`Close ${title}`}
                  >
                    <IconX size={12} stroke={1.8} aria-hidden="true" />
                  </Button>
                </div>
              }
              items={[
                { label: "Open document", shortcut: "Enter", onSelect: () => handleOpen(document) },
                { label: "Close tab", onSelect: () => handleClose(documentId) },
                {
                  label: "Delete document",
                  danger: true,
                  separatorBefore: true,
                  disabled: editorBusy,
                  onSelect: () => setDeleteTarget(document),
                },
              ]}
            />
          );
        })}
      </div>
      <fieldset className="workspace-tab-actions">
        <legend className="sr-only">Create document</legend>
        <CreateAction
          label="Quick Note"
          disabled={creating || editorBusy}
          onClick={() => void handleCreate("analyst_note")}
        />
        <CreateAction
          label="New Investigation"
          disabled={creating || editorBusy}
          onClick={() => void handleCreate("investigation")}
        />
        <CreateAction
          label="New Analyst Note"
          disabled={creating || editorBusy}
          onClick={() => void handleCreate("analyst_note")}
        />
        <CreateAction
          label="New Report"
          disabled={creating || editorBusy}
          onClick={() => void handleCreate("report")}
        />
      </fieldset>
    </>
  );

  return (
    <>
      {workspaceTabHost ? createPortal(workspaceTabs, workspaceTabHost) : null}
      <section
        className="document-workspace-grid grid h-full min-h-full"
        aria-labelledby="documents-title"
        data-document-explorer-collapsed={documentExplorerCollapsed}
      >
        {loading && documents.length === 0 && !selected ? (
          <div className="col-span-2 h-full min-h-0">
            <WorkspaceLoadingState
              icon={<IconNotes size={26} aria-hidden="true" />}
              title="Loading documents"
              description="Reading the encrypted document index."
            />
          </div>
        ) : (
          <>
            <aside
              className="investigation-list min-h-0 overflow-auto border-panel-border border-r bg-panel-base"
              aria-label="Document explorer"
              data-collapsed={documentExplorerCollapsed}
            >
              <header className="document-list-header border-panel-border border-b px-2">
                <div className="document-list-heading">
                  {documentExplorerCollapsed ? (
                    <span className="sr-only" id="documents-title">
                      Documents
                    </span>
                  ) : (
                    <h1
                      className="m-0 font-semibold text-copy-secondary text-xs"
                      id="documents-title"
                    >
                      Documents
                    </h1>
                  )}
                  <Button
                    className="icon-control document-list-collapse"
                    type="button"
                    onClick={() => setDocumentExplorerCollapsed((value) => !value)}
                    aria-label={
                      documentExplorerCollapsed
                        ? "Expand document explorer"
                        : "Collapse document explorer"
                    }
                    title={
                      documentExplorerCollapsed
                        ? "Expand document explorer"
                        : "Collapse document explorer"
                    }
                  >
                    <IconLayoutSidebarLeftCollapse
                      className={documentExplorerCollapsed ? "rotate-180" : undefined}
                      size={15}
                      stroke={1.7}
                      aria-hidden="true"
                    />
                  </Button>
                </div>
              </header>
              {!loading && documents.length === 0 ? (
                <p className="list-message">No documents yet.</p>
              ) : null}
              <nav
                className={documentExplorerCollapsed ? "collapsed-document-list" : "py-1"}
                aria-label="Documents"
              >
                {documents.map((document) => (
                  <DocumentRow
                    key={document.id}
                    collapsed={documentExplorerCollapsed}
                    document={document}
                    active={selected?.id === document.id}
                    disabled={editorBusy && selected?.id !== document.id}
                    onDelete={() => setDeleteTarget(document)}
                    onOpen={() => handleOpen(document)}
                  />
                ))}
              </nav>
            </aside>
            <div className="h-full min-h-0 min-w-0 overflow-auto">
              {selected ? (
                <Suspense
                  fallback={
                    <WorkspaceLoadingState
                      icon={<IconNotes size={24} aria-hidden="true" />}
                      title="Opening document editor"
                    />
                  }
                >
                  <DocumentEditor
                    key={selected.id}
                    projectId={projectId}
                    document={selected}
                    onSaved={handleSaved}
                    onReload={handleReload}
                    onBusyChange={setBusy}
                    onExport={(options) => handleExport(selected.id, options)}
                    defaultTlpMarking={defaultTlpMarking}
                  />
                </Suspense>
              ) : (
                <div className="grid min-h-full place-items-center px-8 text-center">
                  <div>
                    <p className="m-0 font-medium text-copy-secondary text-sm">No document open</p>
                    <p className="mt-1 mb-0 text-copy-faint text-xs">
                      Create one or select an existing document.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <DeleteDocumentDialog
              document={deleteTarget}
              open={deleteTarget !== null}
              onOpenChange={(open) => {
                if (!open) setDeleteTarget(null);
              }}
              onDelete={handleDelete}
            />
          </>
        )}
      </section>
    </>
  );
}

function CreateAction({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="workspace-tab-action"
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      + {label.replace(/^New /, "")}
    </Button>
  );
}

function DocumentRow({
  collapsed,
  document,
  active,
  disabled,
  onOpen,
  onDelete,
}: {
  collapsed: boolean;
  document: DocumentEnvelope;
  active: boolean;
  disabled: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const title = documentTitle(document);
  if (collapsed) {
    return (
      <Button
        className="collapsed-document-button"
        type="button"
        disabled={disabled}
        aria-current={active ? "page" : undefined}
        aria-label={`Open ${title}`}
        title={title}
        onClick={onOpen}
      >
        <IconNotes size={15} stroke={1.7} aria-hidden="true" />
      </Button>
    );
  }
  return (
    <div className="document-row" data-active={active}>
      <WorkspaceContextMenu
        trigger={
          <Button
            className="investigation-row"
            type="button"
            aria-label={`Open ${title}`}
            aria-current={active ? "page" : undefined}
            disabled={disabled}
            onClick={onOpen}
            onContextMenu={onOpen}
          >
            <span className="document-row-copy">
              <span className="document-row-title" title={title}>
                {title}
              </span>
              <span className="document-row-meta">
                {documentKindLabel(document.kind)} · r{document.revision}
              </span>
            </span>
          </Button>
        }
        items={[
          { label: "Open", shortcut: "Enter", disabled, onSelect: onOpen },
          { label: "Delete document", danger: true, separatorBefore: true, onSelect: onDelete },
        ]}
      />
      <Button
        className="document-row-delete"
        type="button"
        disabled={disabled}
        onClick={onDelete}
        aria-label={`Delete ${title}`}
        title={`Delete ${title}`}
      >
        <IconTrash size={13} stroke={1.7} aria-hidden="true" />
      </Button>
    </div>
  );
}
