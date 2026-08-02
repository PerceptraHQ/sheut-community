import { Button } from "@base-ui/react/button";
import { IconLayoutSidebarLeftCollapse, IconNotes, IconTrash, IconX } from "@tabler/icons-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
  type DocumentKind,
  type DocumentPublicationOptions,
  deleteDocument,
  documentErrorMessage,
  documentTitle,
  exportSavedDocument,
  listDocuments,
  loadDocument,
  type NewDocumentKind,
  restoreDocument,
} from "../lib/documents";
import {
  createCustomReportTemplate,
  createGuidedReport,
  deleteGuidedReport,
  exportGuidedReport,
  type GuidedReport,
  guidedReportErrorMessage,
  listGuidedReports,
  listReportTemplates,
  type ReportTemplateDefinition,
  restoreGuidedReport,
  upgradeIllicitEcosystemReport,
} from "../lib/guided-reports";
import type { TlpMarking } from "../lib/projects";
import { DeleteDocumentDialog } from "./DeleteDocumentDialog";
import { DeleteGuidedReportDialog } from "./DeleteGuidedReportDialog";
import { GuidedReportCreateDialog } from "./GuidedReportCreateDialog";
import { GuidedReportEditor } from "./GuidedReportEditor";
import { useVaultNotices } from "./VaultNotices";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";
import { WorkspaceLoadingState } from "./WorkspaceState";

const loadDocumentEditor = () => import("./DocumentEditor");
const ILLICIT_ECOSYSTEM_TEMPLATE_ID = "6fba43e4-fcac-5b12-b37a-17aa0d4e99ca";
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
  const [guidedReports, setGuidedReports] = useState<GuidedReport[]>([]);
  const [selectedGuidedReport, setSelectedGuidedReport] = useState<GuidedReport | null>(null);
  const [reportTemplates, setReportTemplates] = useState<ReportTemplateDefinition[]>([]);
  const [reportTemplateDialogOpen, setReportTemplateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocumentEnvelope | null>(null);
  const [deleteReportTarget, setDeleteReportTarget] = useState<GuidedReport | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [documentExplorerCollapsed, setDocumentExplorerCollapsed] = useState(false);
  const [openDocumentIds, setOpenDocumentIds] = useState<string[]>(() =>
    externalDocument ? [externalDocument.id] : [],
  );

  useEffect(() => {
    const handleWorkspaceAction = (event: Event) => {
      if (!isWorkspaceActionEvent(event) || event.detail !== "file.new-report") return;
      setReportTemplateDialogOpen(true);
    };
    window.addEventListener(WORKSPACE_ACTION_EVENT, handleWorkspaceAction);
    return () => window.removeEventListener(WORKSPACE_ACTION_EVENT, handleWorkspaceAction);
  }, []);

  useEffect(() => {
    if (!actionRequest) return;
    dispatchWorkspaceAction(actionRequest.action);
    onActionHandled?.(actionRequest.requestKey);
  }, [actionRequest, onActionHandled]);

  useEffect(() => {
    let active = true;
    Promise.all([
      listDocuments(projectId),
      listGuidedReports(projectId),
      listReportTemplates(projectId),
    ])
      .then(([documentItems, reportItems, templateItems]) => {
        if (!active) return;
        setDocuments(documentItems);
        setGuidedReports(reportItems);
        setReportTemplates(templateItems);
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
  }, [notices, projectId, onBusyChange]);

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

  const handleCreate = async (kind: NewDocumentKind) => {
    setCreating(true);
    try {
      const kindLabel = documentKindLabel(kind);
      const created = await notices.promise(() => createDocument(projectId, kind), {
        loading: {
          title: `Creating ${kindLabel}`,
          description: "Preparing the encrypted document.",
          type: "info",
        },
        success: {
          title: `${capitalize(kindLabel)} created`,
          description: "The document is ready to edit.",
          type: "success",
        },
        error: (cause) => ({
          title: `${capitalize(kindLabel)} not created`,
          description: documentErrorMessage(cause),
          type: "info",
        }),
      });
      setDocuments((current) => [...current, created]);
      setOpenDocumentIds((current) =>
        current.includes(created.id) ? current : [...current, created.id],
      );
      setSelected(created);
      setSelectedGuidedReport(null);
    } catch {
      // The bounded notice promise already reports the exact failure.
    } finally {
      setCreating(false);
    }
  };

  const handleCreateGuidedReport = async (template: ReportTemplateDefinition) => {
    setCreating(true);
    try {
      const created = await notices.promise(() => createGuidedReport(projectId, template.id), {
        loading: {
          title: `Creating ${template.name}`,
          description: "Preparing the encrypted guided report.",
          type: "info",
        },
        success: {
          title: `${template.name} created`,
          description: "The guided report is ready to edit.",
          type: "success",
        },
        error: (cause) => ({
          title: `${template.name} not created`,
          description: guidedReportErrorMessage(cause),
          type: "info",
        }),
      });
      setGuidedReports((current) => [...current, created]);
      setOpenDocumentIds((current) =>
        current.includes(created.id) ? current : [...current, created.id],
      );
      setSelected(null);
      setSelectedGuidedReport(created);
      setReportTemplateDialogOpen(false);
    } catch {
      // The bounded notice promise already reports the exact failure.
    } finally {
      setCreating(false);
    }
  };

  const handleCreateCustomTemplate = async (
    baseTemplateId: string,
    name: string,
    description: string,
    additionalSections: ReportTemplateDefinition["sections"],
  ) => {
    const template = await notices.promise(
      () =>
        createCustomReportTemplate(
          projectId,
          baseTemplateId,
          name,
          description,
          additionalSections,
        ),
      {
        loading: {
          title: "Creating custom template",
          description: "Saving the project-local guided structure.",
          type: "info",
        },
        success: {
          title: "Custom template created",
          description: `${name} is ready for new reports.`,
          type: "success",
        },
        error: (cause) => ({
          title: "Custom template not created",
          description: guidedReportErrorMessage(cause),
          type: "info",
        }),
      },
    );
    setReportTemplates((current) => [
      ...current.filter((existing) => existing.id !== template.id),
      template,
    ]);
    return template;
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
            try {
              const restored = await restoreDocument(projectId, deleting.id);
              setDocuments((current) => [
                ...current.filter((item) => item.id !== restored.id),
                restored,
              ]);
              setOpenDocumentIds((current) =>
                current.includes(restored.id) ? current : [...current, restored.id],
              );
              setSelected(restored);
              setSelectedGuidedReport(null);
              notices.add({
                title: "Document restored",
                description: `${documentTitle(restored)} is open again.`,
                type: "success",
              });
            } catch (cause) {
              notices.add({
                title: "Document not restored",
                description: documentErrorMessage(cause),
                type: "info",
              });
            }
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
    const closingIndex = openDocumentIds.indexOf(deleting.id);
    const remainingOpenIds = openDocumentIds.filter((id) => id !== deleting.id);
    const nextId =
      remainingOpenIds[Math.min(Math.max(closingIndex, 0), remainingOpenIds.length - 1)];
    setDocuments(remainingDocuments);
    setOpenDocumentIds(remainingOpenIds);
    if (selected?.id === deleting.id) {
      const nextDocument = nextId
        ? remainingDocuments.find((item) => item.id === nextId)
        : undefined;
      const nextReport = nextId ? guidedReports.find((item) => item.id === nextId) : undefined;
      setSelected(nextDocument ?? null);
      setSelectedGuidedReport(nextReport ?? null);
    }
  };

  const handleDeleteGuidedReport = async () => {
    if (!deleteReportTarget) return;
    const deleting = deleteReportTarget;
    await notices.promise(() => deleteGuidedReport(projectId, deleting.id), {
      loading: {
        title: "Deleting report",
        description: "Removing it from the encrypted project.",
        type: "info",
      },
      success: {
        title: "Report deleted",
        description: `${deleting.title} was moved out of the workspace.`,
        type: "success",
        timeout: 10_000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              const restored = await restoreGuidedReport(projectId, deleting.id);
              setGuidedReports((current) => [
                ...current.filter((item) => item.id !== restored.id),
                restored,
              ]);
              setOpenDocumentIds((current) =>
                current.includes(restored.id) ? current : [...current, restored.id],
              );
              setSelected(null);
              setSelectedGuidedReport(restored);
              notices.add({
                title: "Report restored",
                description: `${restored.title} is open again.`,
                type: "success",
              });
            } catch (cause) {
              notices.add({
                title: "Report not restored",
                description: guidedReportErrorMessage(cause),
                type: "info",
              });
            }
          },
        },
      },
      error: (cause) => ({
        title: "Report not deleted",
        description: guidedReportErrorMessage(cause),
        type: "info",
      }),
    });
    const remainingReports = guidedReports.filter((item) => item.id !== deleting.id);
    const closingIndex = openDocumentIds.indexOf(deleting.id);
    const remainingOpenIds = openDocumentIds.filter((id) => id !== deleting.id);
    const nextId =
      remainingOpenIds[Math.min(Math.max(closingIndex, 0), remainingOpenIds.length - 1)];
    setGuidedReports(remainingReports);
    setOpenDocumentIds(remainingOpenIds);
    if (selectedGuidedReport?.id === deleting.id) {
      const nextDocument = nextId ? documents.find((item) => item.id === nextId) : undefined;
      const nextReport = nextId ? remainingReports.find((item) => item.id === nextId) : undefined;
      setSelected(nextDocument ?? null);
      setSelectedGuidedReport(nextReport ?? null);
    }
  };

  const handleOpen = (document: DocumentEnvelope) => {
    setOpenDocumentIds((current) =>
      current.includes(document.id) ? current : [...current, document.id],
    );
    setSelected(document);
    setSelectedGuidedReport(null);
  };

  const handleOpenGuidedReport = (report: GuidedReport) => {
    setOpenDocumentIds((current) =>
      current.includes(report.id) ? current : [...current, report.id],
    );
    setSelected(null);
    setSelectedGuidedReport(report);
  };

  const handleClose = (documentId: string) => {
    if (editorBusy) return;
    const closingIndex = openDocumentIds.indexOf(documentId);
    const remainingOpenIds = openDocumentIds.filter((id) => id !== documentId);
    setOpenDocumentIds(remainingOpenIds);
    if ((selectedGuidedReport?.id ?? selected?.id) !== documentId) return;
    const nextId =
      remainingOpenIds[Math.min(Math.max(closingIndex, 0), remainingOpenIds.length - 1)];
    const nextDocument = nextId ? documents.find((item) => item.id === nextId) : undefined;
    const nextReport = nextId ? guidedReports.find((item) => item.id === nextId) : undefined;
    setSelected(nextDocument ?? null);
    setSelectedGuidedReport(nextReport ?? null);
  };

  const handleSaved = (saved: DocumentEnvelope) => {
    setDocuments((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    setSelected(saved);
  };

  const handleGuidedReportSaved = (saved: GuidedReport) => {
    setGuidedReports((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    setSelectedGuidedReport(saved);
  };

  const handleGuidedReportUpgrade = async () => {
    if (!selectedGuidedReport) return;
    const upgraded = await notices.promise(
      () =>
        upgradeIllicitEcosystemReport(
          projectId,
          selectedGuidedReport.id,
          selectedGuidedReport.revision,
        ),
      {
        loading: {
          title: "Upgrading report structure",
          description: "Creating a backward-compatible encrypted report revision.",
          type: "info",
        },
        success: {
          title: "Report structure upgraded",
          description: "Historical revisions remain available for deterministic publication.",
          type: "success",
        },
        error: (cause) => ({
          title: "Report structure not upgraded",
          description: guidedReportErrorMessage(cause),
          type: "info",
        }),
      },
    );
    handleGuidedReportSaved(upgraded);
  };

  const handleReload = async (documentId: string) => {
    const reloaded = await loadDocument(projectId, documentId);
    handleSaved(reloaded);
    return reloaded;
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

  const handleGuidedReportExport = async (
    reportId: string,
    options: DocumentPublicationOptions,
  ) => {
    try {
      const outcome = await exportGuidedReport(projectId, reportId, options);
      if (outcome.saved) {
        notices.add({
          title: `${options.format.toUpperCase()} published`,
          description: "The guided report was saved to the selected location.",
          type: "success",
        });
      }
    } catch (cause) {
      notices.add({
        title: "Report not published",
        description: guidedReportErrorMessage(cause),
        type: "info",
      });
      throw cause;
    }
  };

  const workspaceTabHost = window.document.getElementById("workspace-tabs");
  const activeItemId = selectedGuidedReport?.id ?? selected?.id;
  const latestReportTemplates = useMemo(
    () =>
      reportTemplates.filter(
        (template) =>
          !reportTemplates.some(
            (candidate) => candidate.id === template.id && candidate.revision > template.revision,
          ),
      ),
    [reportTemplates],
  );
  const selectedGuidedTemplate = selectedGuidedReport
    ? reportTemplates.find(
        (template) =>
          template.id === selectedGuidedReport.template_id &&
          template.revision === selectedGuidedReport.template_revision,
      )
    : undefined;
  const selectedGuidedLatestTemplate = selectedGuidedReport
    ? reportTemplates
        .filter((template) => template.id === selectedGuidedReport.template_id)
        .sort((left, right) => right.revision - left.revision)[0]
    : undefined;
  const workspaceTabs = (
    <>
      <div className="document-tab-bar" role="tablist" aria-label="Open documents">
        {openDocumentIds.map((documentId) => {
          const document = documents.find((item) => item.id === documentId);
          const guidedReport = guidedReports.find((item) => item.id === documentId);
          if (!document && !guidedReport) return null;
          const title = document
            ? documentTitle(document)
            : (guidedReport?.title ?? "Guided report");
          const openItem = () => {
            if (document) {
              handleOpen(document);
            } else if (guidedReport) {
              handleOpenGuidedReport(guidedReport);
            }
          };
          return (
            <WorkspaceContextMenu
              key={documentId}
              trigger={
                <div className="document-tab" data-active={activeItemId === documentId}>
                  <Button
                    className="document-tab-select"
                    type="button"
                    role="tab"
                    aria-selected={activeItemId === documentId}
                    disabled={editorBusy && activeItemId !== documentId}
                    onClick={openItem}
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
                {
                  label: "Open document",
                  shortcut: "Enter",
                  disabled: editorBusy && activeItemId !== documentId,
                  onSelect: openItem,
                },
                {
                  label: "Close tab",
                  disabled: editorBusy,
                  onSelect: () => handleClose(documentId),
                },
                ...(document
                  ? [
                      {
                        label: "Delete document",
                        danger: true,
                        separatorBefore: true,
                        disabled: editorBusy,
                        onSelect: () => setDeleteTarget(document),
                      },
                    ]
                  : guidedReport
                    ? [
                        {
                          label: "Delete report",
                          danger: true,
                          separatorBefore: true,
                          disabled: editorBusy,
                          onSelect: () => setDeleteReportTarget(guidedReport),
                        },
                      ]
                    : []),
              ]}
            />
          );
        })}
      </div>
      <fieldset className="workspace-tab-actions">
        <legend className="sr-only">Create document</legend>
        <Button
          className="workspace-tab-action"
          type="button"
          disabled={creating || editorBusy}
          onClick={() => void handleCreate("analyst_note")}
          aria-label="Quick note"
          title="Quick note — creates an analyst note"
        >
          + Quick note
        </Button>
        <Button
          className="workspace-tab-action"
          type="button"
          disabled={creating || editorBusy}
          onClick={() => void handleCreate("investigation")}
          aria-label="New investigation"
          title="New investigation"
        >
          + Investigation
        </Button>
        <Button
          className="workspace-tab-action"
          type="button"
          disabled={creating || editorBusy}
          onClick={() => void handleCreate("analyst_note")}
          aria-label="New analyst note"
          title="New analyst note"
        >
          + Analyst note
        </Button>
        <Button
          className="workspace-tab-action"
          type="button"
          disabled={creating || editorBusy}
          onClick={() => setReportTemplateDialogOpen(true)}
          aria-label="New report"
          title="New guided report"
        >
          + Report
        </Button>
      </fieldset>
    </>
  );

  return (
    <>
      {workspaceTabHost ? createPortal(workspaceTabs, workspaceTabHost) : null}
      <section
        className={`grid h-full min-h-full ${
          documentExplorerCollapsed
            ? "grid-cols-[44px_minmax(0,1fr)]"
            : "grid-cols-[240px_minmax(0,1fr)]"
        }`}
        aria-labelledby="documents-title"
        data-document-explorer-collapsed={documentExplorerCollapsed}
      >
        {loading && documents.length === 0 && guidedReports.length === 0 && !activeItemId ? (
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
                  {!documentExplorerCollapsed ? (
                    <h1
                      className="m-0 font-semibold text-copy-secondary text-xs"
                      id="documents-title"
                    >
                      Documents
                    </h1>
                  ) : (
                    <span className="sr-only" id="documents-title">
                      Documents
                    </span>
                  )}
                  <Button
                    className="icon-control document-list-collapse"
                    type="button"
                    onClick={() => setDocumentExplorerCollapsed((collapsed) => !collapsed)}
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

              {!documentExplorerCollapsed &&
              !loading &&
              documents.length === 0 &&
              guidedReports.length === 0 ? (
                <p className="list-message">No documents yet.</p>
              ) : null}
              {documentExplorerCollapsed ? (
                <nav className="collapsed-document-list" aria-label="Collapsed documents">
                  {guidedReports.map((report) => {
                    const unavailable = editorBusy && activeItemId !== report.id;
                    return (
                      <Button
                        className="collapsed-document-button"
                        type="button"
                        key={report.id}
                        disabled={unavailable}
                        aria-current={selectedGuidedReport?.id === report.id ? "page" : undefined}
                        aria-label={`Open ${report.title}`}
                        title={report.title}
                        onClick={() => handleOpenGuidedReport(report)}
                      >
                        <IconNotes size={15} stroke={1.7} aria-hidden="true" />
                      </Button>
                    );
                  })}
                  {documents.map((document) => {
                    const title = documentTitle(document);
                    const unavailable = editorBusy && selected?.id !== document.id;
                    return (
                      <Button
                        className="collapsed-document-button"
                        type="button"
                        key={document.id}
                        disabled={unavailable}
                        aria-current={selected?.id === document.id ? "page" : undefined}
                        aria-label={`Open ${title}`}
                        title={title}
                        onClick={() => handleOpen(document)}
                      >
                        <IconNotes size={15} stroke={1.7} aria-hidden="true" />
                      </Button>
                    );
                  })}
                </nav>
              ) : (
                <div className="py-1">
                  {guidedReports.length > 0 ? (
                    <p className="m-0 px-2 pt-2 pb-1 text-[10px] text-copy-faint uppercase tracking-[0.12em]">
                      Guided reports
                    </p>
                  ) : null}
                  {guidedReports.map((report) => {
                    const unavailable = editorBusy && activeItemId !== report.id;
                    const template = reportTemplates.find(
                      (item) =>
                        item.id === report.template_id &&
                        item.revision === report.template_revision,
                    );
                    return (
                      <div
                        className="document-row"
                        data-active={selectedGuidedReport?.id === report.id}
                        key={report.id}
                      >
                        <WorkspaceContextMenu
                          trigger={
                            <Button
                              className="investigation-row"
                              type="button"
                              aria-label={`Open ${report.title}`}
                              aria-current={
                                selectedGuidedReport?.id === report.id ? "page" : undefined
                              }
                              disabled={unavailable}
                              onClick={() => handleOpenGuidedReport(report)}
                              onContextMenu={() => handleOpenGuidedReport(report)}
                            >
                              <span className="document-row-copy">
                                <span className="document-row-title" title={report.title}>
                                  {report.title}
                                </span>
                                <span
                                  className="document-row-meta"
                                  title={`${template?.name ?? "Guided report"} · r${report.revision}`}
                                >
                                  {template?.name ?? "Guided report"} · r{report.revision}
                                </span>
                              </span>
                            </Button>
                          }
                          items={[
                            {
                              label: "Open",
                              shortcut: "Enter",
                              disabled: unavailable,
                              onSelect: () => handleOpenGuidedReport(report),
                            },
                            {
                              label: "Delete report",
                              danger: true,
                              separatorBefore: true,
                              disabled: editorBusy,
                              onSelect: () => setDeleteReportTarget(report),
                            },
                          ]}
                        />
                        <Button
                          className="document-row-delete"
                          type="button"
                          disabled={editorBusy}
                          onClick={() => setDeleteReportTarget(report)}
                          aria-label={`Delete ${report.title}`}
                          title={`Delete ${report.title}`}
                        >
                          <IconTrash size={13} stroke={1.7} aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                  {documents.length > 0 ? (
                    <p className="m-0 px-2 pt-2 pb-1 text-[10px] text-copy-faint uppercase tracking-[0.12em]">
                      Freeform documents
                    </p>
                  ) : null}
                  {documents.map((document) => {
                    const unavailable = editorBusy && selected?.id !== document.id;
                    const title = documentTitle(document);
                    return (
                      <div
                        className="document-row"
                        data-active={selected?.id === document.id}
                        key={document.id}
                      >
                        <WorkspaceContextMenu
                          trigger={
                            <Button
                              className="investigation-row"
                              type="button"
                              aria-label={`Open ${title}`}
                              aria-current={selected?.id === document.id ? "page" : undefined}
                              disabled={unavailable}
                              onClick={() => handleOpen(document)}
                              onContextMenu={() => handleOpen(document)}
                            >
                              <span className="document-row-copy">
                                <span className="document-row-title" title={title}>
                                  {title}
                                </span>
                                <span
                                  className="document-row-meta"
                                  title={`${documentKindShortLabel(document.kind)} · r${document.revision}`}
                                >
                                  {documentKindShortLabel(document.kind)} · r{document.revision}
                                </span>
                              </span>
                            </Button>
                          }
                          items={[
                            {
                              label: "Open",
                              shortcut: "Enter",
                              disabled: unavailable,
                              onSelect: () => handleOpen(document),
                            },
                            {
                              label: "Delete document",
                              danger: true,
                              separatorBefore: true,
                              disabled: editorBusy,
                              onSelect: () => setDeleteTarget(document),
                            },
                          ]}
                        />
                        <Button
                          className="document-row-delete"
                          type="button"
                          disabled={editorBusy}
                          onClick={() => setDeleteTarget(document)}
                          aria-label={`Delete ${title}`}
                          title={`Delete ${title}`}
                        >
                          <IconTrash size={13} stroke={1.7} aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </aside>

            <div className="h-full min-h-0 min-w-0">
              <div className="h-full min-h-0 min-w-0 overflow-auto">
                {selectedGuidedReport && selectedGuidedTemplate ? (
                  <GuidedReportEditor
                    key={`${selectedGuidedReport.id}:${selectedGuidedReport.template_revision}`}
                    projectId={projectId}
                    report={selectedGuidedReport}
                    template={selectedGuidedTemplate}
                    defaultTlpMarking={defaultTlpMarking}
                    onBusyChange={setBusy}
                    onPublish={(options) =>
                      handleGuidedReportExport(selectedGuidedReport.id, options)
                    }
                    onSaved={handleGuidedReportSaved}
                    latestTemplateRevision={selectedGuidedLatestTemplate?.revision}
                    onUpgrade={
                      selectedGuidedReport.template_id === ILLICIT_ECOSYSTEM_TEMPLATE_ID &&
                      selectedGuidedLatestTemplate &&
                      selectedGuidedLatestTemplate.revision > selectedGuidedReport.template_revision
                        ? handleGuidedReportUpgrade
                        : undefined
                    }
                  />
                ) : selectedGuidedReport ? (
                  <div className="grid min-h-full place-items-center px-8 text-center">
                    <p className="error-message" role="alert">
                      This report's template revision is unavailable.
                    </p>
                  </div>
                ) : selected ? (
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
                      <p className="m-0 font-medium text-copy-secondary text-sm">
                        No document open
                      </p>
                      <p className="mt-1 mb-0 text-copy-faint text-xs">
                        Create one or select an existing document.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <DeleteDocumentDialog
              document={deleteTarget}
              open={deleteTarget !== null}
              onOpenChange={(open) => {
                if (!open) setDeleteTarget(null);
              }}
              onDelete={handleDelete}
            />
            <DeleteGuidedReportDialog
              report={deleteReportTarget}
              open={deleteReportTarget !== null}
              onOpenChange={(open) => {
                if (!open) setDeleteReportTarget(null);
              }}
              onDelete={handleDeleteGuidedReport}
            />
            <GuidedReportCreateDialog
              creating={creating}
              onCreate={handleCreateGuidedReport}
              onCreateCustom={handleCreateCustomTemplate}
              onOpenChange={setReportTemplateDialogOpen}
              open={reportTemplateDialogOpen}
              templates={latestReportTemplates}
            />
          </>
        )}
      </section>
    </>
  );
}

function documentKindLabel(kind: DocumentKind): string {
  if (kind === "analyst_note") return "analyst note";
  return kind;
}

function documentKindShortLabel(kind: DocumentKind): string {
  if (kind === "analyst_note") return "NOTE";
  return "INV";
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
