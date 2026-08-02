import { Button } from "@base-ui/react/button";
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
  pickDocumentImage,
  publicationSelectionsFromRoots,
  saveDocument,
} from "../lib/documents";
import { normalizeEditorLink } from "../lib/editor-content";
import { createImageAttachmentExtension } from "../lib/image-attachment-extension";
import type { TlpMarking } from "../lib/projects";
import { DocumentToolbar } from "./DocumentToolbar";
import { PublicationDialog } from "./PublicationDialog";
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
  const pendingRoot = useRef<DocumentRoot | null>(null);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const publicationSelections = useMemo(
    () => publicationSelectionsFromRoots([document.root]),
    [document.root],
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
      TableKit,
      CalloutExtension,
      createImageAttachmentExtension(projectId, document.id),
    ],
    content: document.root,
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => {
      pendingRoot.current = currentEditor.getJSON() as DocumentRoot;
      setError(null);
      setConflicted(false);
      setSaveState("pending");
      onBusyChange(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persistPendingRef.current(), AUTOSAVE_INTERVAL_MS);
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
        const saved = await saveDocument(projectId, document.id, revision.current, root);
        revision.current = saved.revision;
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
    [document.id, onBusyChange, onSaved, projectId],
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
      if (event.detail === "file.new-report") {
        notices.add({
          title: "New report",
          description: "Choose a report template from the Documents workspace.",
          type: "info",
        });
      }
    };
    window.addEventListener(WORKSPACE_ACTION_EVENT, handleWorkspaceAction);
    return () => window.removeEventListener(WORKSPACE_ACTION_EVENT, handleWorkspaceAction);
  }, [conflicted, notices, onExport]);

  useEffect(() => {
    if (!editor || document.revision === revision.current) return;
    revision.current = document.revision;
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

  return (
    <article className="document-editor min-h-full w-full px-4 py-4">
      <DocumentToolbar
        editor={editor}
        saveState={saveState}
        savedRevision={savedRevision}
        onSave={() => void persistPendingRef.current()}
        onOpenLinkEditor={handleOpenLinkEditor}
        onInsertImage={() => void handleInsertImage()}
        onOpenExport={handleOpenExport}
        exportDisabled={!onExport || exporting || saveState !== "saved"}
        imageDisabled={attachingImage}
      />

      {onExport && exportDialogOpen ? (
        <PublicationDialog
          busy={exporting}
          defaultTlpMarking={defaultTlpMarking}
          initialFileName={documentTitle(document)}
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
          title="Publish document"
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
        className="editor-surface prose prose-invert prose-sheut mx-auto w-[min(100%,56rem)] max-w-none"
      />
    </article>
  );
}
