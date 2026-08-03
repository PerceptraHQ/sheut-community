import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import {
  IconBold,
  IconItalic,
  IconLink,
  IconLinkOff,
  IconList,
  IconListNumbers,
  IconPhotoPlus,
  IconPlus,
  IconQuote,
  IconX,
} from "@tabler/icons-react";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type SyntheticEvent, useState } from "react";
import { defangUrls } from "../lib/defang";
import type { DocumentRoot } from "../lib/documents";
import { normalizeEditorLink } from "../lib/editor-content";
import {
  type EvidenceFileMetadata,
  guidedReportErrorMessage,
  importEvidenceImage,
  listEvidenceFiles,
} from "../lib/guided-reports";
import { createEvidenceImageExtension } from "../lib/image-attachment-extension";
import { DialogFrame } from "./DialogFrame";
import { SelectField, type SelectFieldOption } from "./SelectField";
import { useVaultNotices } from "./VaultNotices";

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

export function GuidedReportNarrativeInput({
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
                autoComplete="off"
                className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 font-normal text-copy-primary text-sm outline-none focus:border-accent"
                value={linkLabel}
                onChange={(event) => setLinkLabel(event.currentTarget.value)}
                maxLength={500}
              />
            </label>
            <label className="grid gap-1.5 font-medium text-copy-secondary text-xs">
              Evidence URL
              <input
                autoComplete="off"
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
                  autoComplete="off"
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
