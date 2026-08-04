import { Button } from "@base-ui/react/button";
import type { Editor } from "@tiptap/core";
import { Highlight } from "@tiptap/extension-highlight";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import { TextAlign } from "@tiptap/extension-text-align";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalloutExtension } from "../lib/callout-extension";
import { isWorkspaceActionEvent, WORKSPACE_ACTION_EVENT } from "../lib/desktopActions";
import {
  type DocumentEnvelope,
  type DocumentPublicationOptions,
  type DocumentRoot,
  documentErrorMessage,
  documentTitle,
  loadDocumentImage,
  pickDocumentImage,
  publicationSelectionsFromRoots,
  type ReportProperties,
  saveDocument,
} from "../lib/documents";
import { normalizeEditorLink } from "../lib/editor-content";
import { EvidenceCitationExtension } from "../lib/evidence-citation-extension";
import {
  createGraphSnapshotAttachment,
  type GraphWorkspace,
  listGraphWorkspaces,
} from "../lib/graph";
import {
  createEvidenceImageExtension,
  createImageAttachmentExtension,
} from "../lib/image-attachment-extension";
import {
  createIntelligenceReferenceExtensions,
  type GraphSnapshotAttributes,
  type MitreSnapshotAttributes,
  type ProjectReferenceAttributes,
} from "../lib/intelligence-reference-extension";
import { PageBreakExtension } from "../lib/page-break-extension";
import type { TlpMarking } from "../lib/projects";
import { listReportProjectData, type ReportProjectDataItem } from "../lib/report-data";
import {
  SemanticParagraphFormatting,
  SemanticTextStyle,
} from "../lib/semantic-formatting-extension";
import { SemanticTable } from "../lib/semantic-table-extension";
import { DocumentToolbar, type ReportOutlineEntry } from "./DocumentToolbar";
import { type EvidenceInsertion, EvidencePickerDialog } from "./EvidencePickerDialog";
import { GraphSnapshotDialog } from "./GraphSnapshotDialog";
import { PublicationDialog } from "./PublicationDialog";
import { ReportDataPickerDialog, type ReportDataPickerMode } from "./ReportDataPickerDialog";
import { ReportPropertiesDialog } from "./ReportPropertiesDialog";
import { useVaultNotices } from "./VaultNotices";

interface DocumentEditorProps {
  projectId: string;
  document: DocumentEnvelope;
  onSaved: (document: DocumentEnvelope) => void;
  onReload: (documentId: string) => Promise<DocumentEnvelope>;
  onBusyChange: (busy: boolean) => void;
  onExport?: (options: DocumentPublicationOptions) => Promise<void>;
  defaultTlpMarking?: TlpMarking;
}

export const AUTOSAVE_INTERVAL_MS = 2_500;

export default function DocumentEditor({
  projectId,
  document,
  onSaved,
  onReload,
  onBusyChange,
  onExport,
  defaultTlpMarking = "amber",
}: DocumentEditorProps) {
  const notices = useVaultNotices();
  const revision = useRef(document.revision);
  const reportPropertiesRef = useRef<ReportProperties | undefined>(document.reportProperties);
  const pendingRoot = useRef<DocumentRoot | null>(null);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insertionPosition = useRef(1);
  const insertionCommitted = useRef(false);
  const persistPendingRef = useRef<(reportFailure?: boolean) => Promise<void>>(async () => {});
  const [saveState, setSaveState] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [savedRevision, setSavedRevision] = useState(document.revision);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [attachingImage, setAttachingImage] = useState(false);
  const [reportProperties, setReportProperties] = useState(document.reportProperties);
  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);
  const [evidencePickerOpen, setEvidencePickerOpen] = useState(false);
  const [reportDataPickerMode, setReportDataPickerMode] = useState<ReportDataPickerMode | null>(
    null,
  );
  const [graphPickerOpen, setGraphPickerOpen] = useState(false);
  const [outline, setOutline] = useState<ReportOutlineEntry[]>([]);
  const [previewPaperSize, setPreviewPaperSize] = useState<"a4" | "letter">("a4");
  const isReport = document.kind === "report";
  const publicationSelections = useMemo(
    () => publicationSelectionsFromRoots([document.root]),
    [document.root],
  );

  const intelligenceExtensions = useMemo(
    () =>
      createIntelligenceReferenceExtensions({
        onRefreshProject: async (attributes) => {
          const items = await listReportProjectData(projectId);
          const current = items.find(
            (item) => item.id === attributes.sourceId && item.kind === attributes.sourceKind,
          );
          if (!current) throw new Error("project_reference_missing");
          return projectReferenceAttributes(current, attributes.display);
        },
        onRefreshMitre: async (attributes) => {
          const items = await listReportProjectData(projectId);
          const refreshed = attributes.observations.map((observation) =>
            items.find(
              (item) => item.kind === "catalog_reference" && item.id === observation.observationId,
            ),
          );
          if (refreshed.some((item) => !item)) throw new Error("mitre_observation_missing");
          return mitreSnapshotAttributes(refreshed as ReportProjectDataItem[]);
        },
        onRefreshGraph: async (attributes) => {
          const workspaces = await listGraphWorkspaces(projectId);
          const workspace = workspaces.find((item) => item.id === attributes.workspaceId);
          if (!workspace) throw new Error("graph_workspace_missing");
          const frozen = await createGraphSnapshotAttachment(
            projectId,
            document.id,
            workspace.id,
            workspace.revision,
          );
          return graphSnapshotAttributes(frozen, attributes.placement);
        },
        loadGraphImage: (attachmentId) => loadDocumentImage(projectId, document.id, attachmentId),
      }),
    [document.id, projectId],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: false },
      }),
      Highlight,
      Subscript,
      Superscript,
      TaskList,
      TaskItem.configure({ nested: true }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
        alignments: ["left", "center", "right", "justify"],
      }),
      SemanticTextStyle,
      SemanticParagraphFormatting,
      TableKit.configure({ table: false }),
      SemanticTable,
      CalloutExtension,
      PageBreakExtension,
      EvidenceCitationExtension,
      ...intelligenceExtensions,
      createImageAttachmentExtension(projectId, document.id),
      createEvidenceImageExtension(projectId),
    ],
    content: document.root,
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => {
      pendingRoot.current = currentEditor.getJSON() as DocumentRoot;
      if (isReport) setOutline(extractReportOutline(currentEditor));
      setError(null);
      setConflicted(false);
      setSaveState("pending");
      onBusyChange(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persistPendingRef.current(), AUTOSAVE_INTERVAL_MS);
    },
    onCreate: ({ editor: currentEditor }) => {
      if (isReport) setOutline(extractReportOutline(currentEditor));
    },
  });

  const persistPending = useCallback(
    async (reportFailure = false) => {
      if (saving.current || !pendingRoot.current) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const root = pendingRoot.current;
      let failed = false;
      pendingRoot.current = null;
      saving.current = true;
      setSaveState("saving");
      try {
        const saved = isReport
          ? await saveDocument(
              projectId,
              document.id,
              revision.current,
              root,
              reportPropertiesRef.current,
            )
          : await saveDocument(projectId, document.id, revision.current, root);
        revision.current = saved.revision;
        reportPropertiesRef.current = saved.reportProperties;
        setReportProperties(saved.reportProperties);
        setSavedRevision(saved.revision);
        setSaveState("saved");
        setError(null);
        onSaved(saved);
      } catch (cause) {
        failed = true;
        const conflict =
          typeof cause === "object" &&
          cause !== null &&
          Reflect.get(cause, "code") === "revision_conflict";
        setConflicted(conflict);
        setError(documentErrorMessage(cause));
        setSaveState("error");
        if (reportFailure) throw cause;
      } finally {
        saving.current = false;
        if (pendingRoot.current) {
          timer.current = setTimeout(() => void persistPendingRef.current(), AUTOSAVE_INTERVAL_MS);
        } else {
          onBusyChange(failed);
        }
      }
    },
    [document.id, isReport, onBusyChange, onSaved, projectId],
  );

  useEffect(() => {
    persistPendingRef.current = persistPending;
  }, [persistPending]);

  useEffect(() => {
    const handleWorkspaceAction = (event: Event) => {
      if (!isWorkspaceActionEvent(event)) return;
      if (event.detail === "file.save") {
        if (conflicted) {
          notices.add({
            title: "Document not saved",
            description: "Reload the committed copy before saving again.",
            type: "info",
          });
        } else if (!pendingRoot.current) {
          notices.add({
            title: "Already saved",
            description: `Revision ${revision.current} is current.`,
            type: "info",
          });
        } else {
          void notices
            .promise(() => persistPendingRef.current(true), {
              loading: { title: "Saving document", description: "Writing the encrypted revision…" },
              success: {
                title: "Document saved",
                description: "The keyboard shortcut committed the latest changes.",
                type: "success",
              },
              error: (cause) => ({
                title: "Document not saved",
                description: documentErrorMessage(cause),
                type: "info",
              }),
            })
            .catch(() => {});
        }
        return;
      }
      if (event.detail === "file.publish") {
        if (!onExport) return;
        if (pendingRoot.current || saving.current) {
          notices.add({
            title: "Report not ready to publish",
            description: "Save the current document revision before opening Publish.",
            type: "info",
          });
          return;
        }
        setExportDialogOpen(true);
      }
    };
    window.addEventListener(WORKSPACE_ACTION_EVENT, handleWorkspaceAction);
    return () => window.removeEventListener(WORKSPACE_ACTION_EVENT, handleWorkspaceAction);
  }, [conflicted, notices, onExport]);

  useEffect(() => {
    if (!editor || document.revision === revision.current) return;
    revision.current = document.revision;
    reportPropertiesRef.current = document.reportProperties;
    setReportProperties(document.reportProperties);
    setSavedRevision(document.revision);
    editor.commands.setContent(document.root, { emitUpdate: false });
    pendingRoot.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setSaveState("saved");
    setError(null);
    setConflicted(false);
  }, [document, editor]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      onBusyChange(false);
    },
    [onBusyChange],
  );

  if (!editor) return <p className="list-message">Preparing editor…</p>;

  const handleReload = async () => {
    try {
      const reloaded = await onReload(document.id);
      revision.current = reloaded.revision;
      setSavedRevision(reloaded.revision);
      editor.commands.setContent(reloaded.root, { emitUpdate: false });
      reportPropertiesRef.current = reloaded.reportProperties;
      setReportProperties(reloaded.reportProperties);
      if (isReport) setOutline(extractReportOutline(editor));
      pendingRoot.current = null;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setError(null);
      setConflicted(false);
      setSaveState("saved");
      onBusyChange(false);
    } catch (cause) {
      setError(documentErrorMessage(cause));
    }
  };

  const handleRetry = () => {
    pendingRoot.current = editor.getJSON() as DocumentRoot;
    setError(null);
    setSaveState("pending");
    onBusyChange(true);
    void persistPendingRef.current();
  };

  const handleOpenLinkEditor = () => {
    const attributes: unknown = editor.getAttributes("link");
    const existing: unknown =
      typeof attributes === "object" && attributes !== null
        ? Reflect.get(attributes, "href")
        : null;
    setLinkValue(typeof existing === "string" ? existing : "");
    setLinkError(null);
    setLinkEditorOpen(true);
  };

  const handleApplyLink = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    const href = normalizeEditorLink(linkValue);
    if (!href) {
      setLinkError("Use an HTTP, HTTPS, email, anchor, or local link.");
      return;
    }
    const chain = editor.chain().focus();
    if (editor.isActive("link")) chain.extendMarkRange("link");
    chain.setLink({ href }).run();
    setLinkEditorOpen(false);
    setLinkError(null);
  };

  const handleRemoveLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkEditorOpen(false);
    setLinkError(null);
  };

  const handleOpenExport = () => {
    setExportDialogOpen(true);
  };

  const handleInsertImage = async () => {
    setAttachingImage(true);
    try {
      const attachment = await pickDocumentImage(projectId, document.id);
      if (!attachment) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "imageAttachment",
          attrs: {
            attachmentId: attachment.id,
            alt: attachment.fileName,
            title: null,
          },
        })
        .run();
      notices.add({
        title: "Image attached",
        description: "The image is stored inside the encrypted project.",
        type: "success",
      });
    } catch (cause) {
      const message = documentErrorMessage(cause);
      setError(message);
      notices.add({
        title: "Image not attached",
        description: message,
        type: "info",
      });
    } finally {
      setAttachingImage(false);
    }
  };

  const handleReportProperties = (properties: ReportProperties) => {
    reportPropertiesRef.current = properties;
    setReportProperties(properties);
    pendingRoot.current = editor.getJSON() as DocumentRoot;
    setError(null);
    setConflicted(false);
    setSaveState("pending");
    onBusyChange(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persistPendingRef.current(), AUTOSAVE_INTERVAL_MS);
  };

  const handleInsertEvidence = (insertion: EvidenceInsertion) => {
    insertionCommitted.current = true;
    const { evidence } = insertion;
    const label = evidence.title.trim() || evidence.fileName;
    if (insertion.kind === "citation") {
      editor
        .chain()
        .focus()
        .setTextSelection(insertionPosition.current)
        .insertContent({
          type: "evidenceCitation",
          attrs: {
            evidenceId: evidence.id,
            revision: evidence.revision,
            label,
            fileName: evidence.fileName,
            mediaType: evidence.mediaType,
            sha256: evidence.sha256,
          },
        })
        .run();
    } else {
      editor
        .chain()
        .focus()
        .setTextSelection(insertionPosition.current)
        .insertContent({
          type: "evidenceImage",
          attrs: {
            evidenceId: evidence.id,
            alt: label,
            title: evidence.description.trim() || null,
            placement: "inline",
            appendixKey: null,
            appendixTitle: null,
          },
        })
        .run();
    }
    setEvidencePickerOpen(false);
  };

  const openInsertionDialog = (mode: "evidence" | ReportDataPickerMode) => {
    insertionPosition.current = editor.state.selection.from;
    insertionCommitted.current = false;
    if (mode === "evidence") setEvidencePickerOpen(true);
    else setReportDataPickerMode(mode);
  };

  const restoreInsertionFocus = () => {
    if (!insertionCommitted.current) {
      editor.chain().focus().setTextSelection(insertionPosition.current).run();
    }
  };

  const handleInsertProjectData = (item: ReportProjectDataItem, display: "inline" | "block") => {
    insertionCommitted.current = true;
    const chain = editor
      .chain()
      .focus()
      .setTextSelection(insertionPosition.current)
      .insertContent({
        type: "projectReference",
        attrs: projectReferenceAttributes(item, display),
      });
    if (display === "block") chain.insertContent({ type: "paragraph" });
    chain.run();
    setReportDataPickerMode(null);
  };

  const handleInsertMitre = (items: ReportProjectDataItem[]) => {
    insertionCommitted.current = true;
    editor
      .chain()
      .focus()
      .setTextSelection(insertionPosition.current)
      .insertContent({ type: "mitreSnapshot", attrs: mitreSnapshotAttributes(items) })
      .run();
    setReportDataPickerMode(null);
  };

  const handleInsertGraph = async (workspace: GraphWorkspace, placement: "inline" | "appendix") => {
    const frozen = await createGraphSnapshotAttachment(
      projectId,
      document.id,
      workspace.id,
      workspace.revision,
    );
    insertionCommitted.current = true;
    editor
      .chain()
      .focus()
      .setTextSelection(insertionPosition.current)
      .insertContent({ type: "graphSnapshot", attrs: graphSnapshotAttributes(frozen, placement) })
      .run();
    setGraphPickerOpen(false);
  };

  return (
    <article
      className={`document-editor min-h-full w-full ${isReport ? "report-document-editor" : "px-4 py-4"}`}
    >
      <DocumentToolbar
        editor={editor}
        saveState={saveState}
        savedRevision={savedRevision}
        onSave={() => void persistPendingRef.current()}
        onOpenLinkEditor={handleOpenLinkEditor}
        onInsertImage={() => void handleInsertImage()}
        onInsertEvidence={isReport ? () => openInsertionDialog("evidence") : undefined}
        onInsertProjectData={isReport ? () => openInsertionDialog("project") : undefined}
        onInsertMitre={isReport ? () => openInsertionDialog("mitre") : undefined}
        onInsertGraph={
          isReport
            ? () => {
                insertionPosition.current = editor.state.selection.from;
                insertionCommitted.current = false;
                setGraphPickerOpen(true);
              }
            : undefined
        }
        onOpenExport={handleOpenExport}
        exportDisabled={!onExport || exporting || saveState !== "saved"}
        imageDisabled={attachingImage}
        reportTitle={reportProperties?.title}
        outline={outline}
        onOpenReportProperties={isReport ? () => setPropertiesDialogOpen(true) : undefined}
        onInsertPageBreak={
          isReport ? () => editor.chain().focus().insertPageBreak().run() : undefined
        }
        onSelectOutline={(position) =>
          editor
            .chain()
            .focus()
            .setTextSelection(position + 1)
            .scrollIntoView()
            .run()
        }
        previewPaperSize={previewPaperSize}
        onPreviewPaperSizeChange={isReport ? setPreviewPaperSize : undefined}
      />

      {isReport && reportProperties && propertiesDialogOpen ? (
        <ReportPropertiesDialog
          open={propertiesDialogOpen}
          properties={reportProperties}
          onOpenChange={setPropertiesDialogOpen}
          onSave={handleReportProperties}
        />
      ) : null}

      {isReport && evidencePickerOpen ? (
        <EvidencePickerDialog
          open={evidencePickerOpen}
          projectId={projectId}
          onOpenChange={(open) => {
            setEvidencePickerOpen(open);
            if (!open) restoreInsertionFocus();
          }}
          onInsert={handleInsertEvidence}
        />
      ) : null}

      {isReport && reportDataPickerMode ? (
        <ReportDataPickerDialog
          mode={reportDataPickerMode}
          open
          projectId={projectId}
          onOpenChange={(open) => {
            if (!open) {
              setReportDataPickerMode(null);
              restoreInsertionFocus();
            }
          }}
          onInsertProject={handleInsertProjectData}
          onInsertMitre={handleInsertMitre}
        />
      ) : null}

      {isReport && graphPickerOpen ? (
        <GraphSnapshotDialog
          open
          projectId={projectId}
          onOpenChange={(open) => {
            setGraphPickerOpen(open);
            if (!open) restoreInsertionFocus();
          }}
          onInsert={handleInsertGraph}
        />
      ) : null}

      {onExport && exportDialogOpen ? (
        <PublicationDialog
          busy={exporting}
          defaultTlpMarking={defaultTlpMarking}
          initialFileName={documentTitle(document)}
          initialPaperSize={previewPaperSize}
          onOpenChange={setExportDialogOpen}
          onPublish={async (options) => {
            setExporting(true);
            try {
              await onExport(options);
            } finally {
              setExporting(false);
            }
          }}
          open={exportDialogOpen}
          projectId={projectId}
          sourceId={document.id}
          sections={publicationSelections.sections}
          appendices={publicationSelections.appendices}
          title={isReport ? "Publish report" : "Publish document"}
        />
      ) : null}

      {linkEditorOpen ? (
        <form className="editor-link-form" onSubmit={handleApplyLink}>
          <label htmlFor="editor-link-href">Link target</label>
          <input
            id="editor-link-href"
            type="text"
            value={linkValue}
            onChange={(event) => setLinkValue(event.currentTarget.value)}
            placeholder="https://example.com"
            autoComplete="off"
            spellCheck={false}
          />
          <Button className="control-button" type="submit">
            Apply
          </Button>
          {editor.isActive("link") ? (
            <Button className="control-button" type="button" onClick={handleRemoveLink}>
              Remove
            </Button>
          ) : null}
          <Button className="control-button" type="button" onClick={() => setLinkEditorOpen(false)}>
            Cancel
          </Button>
          {linkError ? (
            <span className="text-danger text-xs" role="alert">
              {linkError}
            </span>
          ) : null}
        </form>
      ) : null}

      {error ? (
        <div className="error-message mt-3 flex items-center gap-2" role="alert">
          <span>{error}</span>
          <div className="ml-auto flex gap-3">
            {!conflicted ? (
              <Button className="text-danger underline" type="button" onClick={handleRetry}>
                Retry save
              </Button>
            ) : null}
            <Button
              className="text-danger underline"
              type="button"
              onClick={() => void handleReload()}
            >
              Reload committed copy
            </Button>
          </div>
        </div>
      ) : null}

      <EditorContent
        editor={editor}
        data-paper-size={isReport ? previewPaperSize : undefined}
        className={`editor-surface prose prose-invert prose-sheut mx-auto max-w-none ${isReport ? "report-page-surface" : "w-[min(100%,56rem)]"}`}
      />
    </article>
  );
}

function projectReferenceAttributes(
  item: ReportProjectDataItem,
  display: "inline" | "block",
): ProjectReferenceAttributes {
  if (item.kind === "catalog_reference") throw new Error("invalid_project_reference_kind");
  return {
    sourceKind: item.kind,
    sourceId: item.id,
    sourceVersion: item.revision ? `r${item.revision}` : (item.sourceVersion ?? null),
    display,
    label: item.label,
    snapshot: item.values,
  };
}

function mitreSnapshotAttributes(items: ReportProjectDataItem[]): MitreSnapshotAttributes {
  return {
    observations: items.map((item) => ({
      observationId: item.id,
      revision: item.revision ?? 1,
      catalog: item.values.catalog ?? "attack_enterprise",
      catalogVersion: item.values.catalog_version ?? item.sourceVersion ?? "unknown",
      techniqueId: item.values.technique_id ?? item.label,
      techniqueName: item.values.technique_name ?? item.label,
      explanation: item.values.explanation ?? "",
    })),
  };
}

function graphSnapshotAttributes(
  frozen: Awaited<ReturnType<typeof createGraphSnapshotAttachment>>,
  placement: "inline" | "appendix",
): GraphSnapshotAttributes {
  const title = `${frozen.workspaceName} · revision ${frozen.workspaceRevision}`;
  return {
    attachmentId: frozen.attachment.id,
    workspaceId: frozen.workspaceId,
    workspaceRevision: frozen.workspaceRevision,
    workspaceName: frozen.workspaceName,
    placement,
    alt: `Analytical graph snapshot: ${frozen.workspaceName}`,
    title,
  };
}

function extractReportOutline(editor: Editor): ReportOutlineEntry[] {
  const entries: ReportOutlineEntry[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== "heading") return;
    const title = node.textContent.trim();
    const level = Number(node.attrs.level);
    if (!title || ![1, 2, 3].includes(level)) return;
    entries.push({ level: level as 1 | 2 | 3, position, title });
  });
  return entries;
}
