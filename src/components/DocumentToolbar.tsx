import { Button } from "@base-ui/react/button";
import { Popover } from "@base-ui/react/popover";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toolbar } from "@base-ui/react/toolbar";
import { Tooltip } from "@base-ui/react/tooltip";
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBlockquote,
  IconBold,
  IconCode,
  IconCodeDots,
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconColumnRemove,
  IconDeviceFloppy,
  IconDots,
  IconFileExport,
  IconFileText,
  IconH1,
  IconH2,
  IconH3,
  IconHighlight,
  IconInfoSquareRounded,
  IconItalic,
  IconLink,
  IconList,
  IconListCheck,
  IconListNumbers,
  IconListTree,
  IconPhotoPlus,
  IconPilcrow,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconRowRemove,
  IconSeparatorHorizontal,
  IconSettings,
  IconShieldCheck,
  IconStrikethrough,
  IconSubscript,
  IconSuperscript,
  IconTable,
  IconTableOff,
  IconUnderline,
} from "@tabler/icons-react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { defangIndicatorText } from "../lib/editor-content";
import {
  REPORT_FONT_FAMILIES,
  REPORT_FONT_SIZES,
  REPORT_LINE_SPACING,
  REPORT_PARAGRAPH_SPACING,
  REPORT_TEXT_COLORS,
} from "../lib/semantic-formatting-extension";

interface DocumentToolbarProps {
  editor: Editor;
  saveState: "saved" | "pending" | "saving" | "error";
  savedRevision: number;
  onSave: () => void;
  onOpenLinkEditor: () => void;
  onInsertImage: () => void;
  onInsertEvidence?: () => void;
  onInsertProjectData?: () => void;
  onInsertMitre?: () => void;
  onInsertGraph?: () => void;
  onOpenExport: () => void;
  exportDisabled: boolean;
  imageDisabled: boolean;
  reportTitle?: string;
  outline?: readonly ReportOutlineEntry[];
  onOpenReportProperties?: () => void;
  onInsertPageBreak?: () => void;
  onSelectOutline?: (position: number) => void;
  previewPaperSize?: "a4" | "letter";
  onPreviewPaperSizeChange?: (size: "a4" | "letter") => void;
}

export interface ReportOutlineEntry {
  level: 1 | 2 | 3;
  position: number;
  title: string;
}

export function DocumentToolbar({
  editor,
  saveState,
  savedRevision,
  onSave,
  onOpenLinkEditor,
  onInsertImage,
  onInsertEvidence,
  onInsertProjectData,
  onInsertMitre,
  onInsertGraph,
  onOpenExport,
  exportDisabled,
  imageDisabled,
  reportTitle,
  outline = [],
  onOpenReportProperties,
  onInsertPageBreak,
  onSelectOutline,
  previewPaperSize = "a4",
  onPreviewPaperSizeChange,
}: DocumentToolbarProps) {
  const [moreFormattingOpen, setMoreFormattingOpen] = useState(false);
  useEffect(() => {
    if (!moreFormattingOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreFormattingOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [moreFormattingOpen]);
  const state = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      selectionEmpty: currentEditor.state.selection.empty,
      paragraph: currentEditor.isActive("paragraph"),
      heading1: currentEditor.isActive("heading", { level: 1 }),
      heading2: currentEditor.isActive("heading", { level: 2 }),
      heading3: currentEditor.isActive("heading", { level: 3 }),
      bold: currentEditor.isActive("bold"),
      italic: currentEditor.isActive("italic"),
      underline: currentEditor.isActive("underline"),
      strike: currentEditor.isActive("strike"),
      highlight: currentEditor.isActive("highlight"),
      code: currentEditor.isActive("code"),
      subscript: currentEditor.isActive("subscript"),
      superscript: currentEditor.isActive("superscript"),
      alignLeft:
        currentEditor.isActive("paragraph", { textAlign: "left" }) ||
        currentEditor.isActive("heading", { textAlign: "left" }),
      alignCenter:
        currentEditor.isActive("paragraph", { textAlign: "center" }) ||
        currentEditor.isActive("heading", { textAlign: "center" }),
      alignRight:
        currentEditor.isActive("paragraph", { textAlign: "right" }) ||
        currentEditor.isActive("heading", { textAlign: "right" }),
      alignJustify:
        currentEditor.isActive("paragraph", { textAlign: "justify" }) ||
        currentEditor.isActive("heading", { textAlign: "justify" }),
      bulletList: currentEditor.isActive("bulletList"),
      orderedList: currentEditor.isActive("orderedList"),
      taskList: currentEditor.isActive("taskList"),
      blockquote: currentEditor.isActive("blockquote"),
      codeBlock: currentEditor.isActive("codeBlock"),
      table: currentEditor.isActive("table"),
      link: currentEditor.isActive("link"),
    }),
  });

  const handleDefang = () => {
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    const selected = editor.state.doc.textBetween(from, to, "\n");
    editor.chain().focus().unsetLink().insertContent(defangIndicatorText(selected)).run();
  };

  const blockStyleValue = state.heading1
    ? ["heading-1"]
    : state.heading2
      ? ["heading-2"]
      : state.heading3
        ? ["heading-3"]
        : state.paragraph
          ? ["paragraph"]
          : [];
  const alignmentValue = state.alignCenter
    ? ["center"]
    : state.alignRight
      ? ["right"]
      : state.alignJustify
        ? ["justify"]
        : state.alignLeft
          ? ["left"]
          : [];

  return (
    <Tooltip.Provider delay={350}>
      <div className="editor-toolbar-stack">
        <Toolbar.Root
          className="editor-toolbar-unified"
          aria-label="Document toolbar"
          data-more-formatting-open={moreFormattingOpen || undefined}
        >
          <Toolbar.Group className="editor-toolbar-actions" aria-label="Document actions">
            <ToolbarButton
              label="Save document"
              wide
              disabled={saveState !== "pending"}
              onClick={onSave}
            >
              <IconDeviceFloppy size={15} stroke={1.7} aria-hidden="true" />
              <span>Save</span>
            </ToolbarButton>
            <ToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()}>
              <IconArrowBackUp size={15} stroke={1.7} aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()}>
              <IconArrowForwardUp size={15} stroke={1.7} aria-hidden="true" />
            </ToolbarButton>
            {reportTitle && onOpenReportProperties ? (
              <ToolbarButton label="Report properties" wide onClick={onOpenReportProperties}>
                <IconSettings size={15} stroke={1.7} aria-hidden="true" />
                <span>Properties</span>
              </ToolbarButton>
            ) : null}
            {reportTitle && onInsertPageBreak ? (
              <Popover.Root>
                <Popover.Trigger
                  render={
                    <Toolbar.Button
                      className="editor-toolbar-button editor-toolbar-button-wide"
                      type="button"
                    />
                  }
                  aria-label="Insert report content"
                >
                  <IconFileText size={15} stroke={1.7} aria-hidden="true" />
                  <span>Insert</span>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner align="start" className="z-50" sideOffset={5}>
                    <Popover.Popup
                      className="report-outline-popup"
                      aria-label="Insert report content"
                    >
                      {onInsertEvidence ? (
                        <Popover.Close
                          render={<Button className="report-outline-entry" type="button" />}
                          onClick={onInsertEvidence}
                        >
                          Evidence
                        </Popover.Close>
                      ) : null}
                      {onInsertProjectData ? (
                        <Popover.Close
                          render={<Button className="report-outline-entry" type="button" />}
                          onClick={onInsertProjectData}
                        >
                          Project data
                        </Popover.Close>
                      ) : null}
                      {onInsertMitre ? (
                        <Popover.Close
                          render={<Button className="report-outline-entry" type="button" />}
                          onClick={onInsertMitre}
                        >
                          MITRE observations
                        </Popover.Close>
                      ) : null}
                      {onInsertGraph ? (
                        <Popover.Close
                          render={<Button className="report-outline-entry" type="button" />}
                          onClick={onInsertGraph}
                        >
                          Graph snapshot
                        </Popover.Close>
                      ) : null}
                      <Popover.Close
                        render={<Button className="report-outline-entry" type="button" />}
                        onClick={onInsertImage}
                      >
                        Image
                      </Popover.Close>
                      <Popover.Close
                        render={<Button className="report-outline-entry" type="button" />}
                        onClick={() =>
                          editor
                            .chain()
                            .focus()
                            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                            .run()
                        }
                      >
                        Table
                      </Popover.Close>
                      <Popover.Close
                        render={<Button className="report-outline-entry" type="button" />}
                        onClick={onInsertPageBreak}
                      >
                        Page break <span className="ml-auto text-copy-faint">⌘↵</span>
                      </Popover.Close>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            ) : null}
            {reportTitle ? (
              <Popover.Root>
                <Popover.Trigger
                  render={
                    <Toolbar.Button
                      className="editor-toolbar-button editor-toolbar-button-wide"
                      type="button"
                    />
                  }
                  aria-label="Report outline"
                >
                  <IconListTree size={15} stroke={1.7} aria-hidden="true" />
                  <span>Outline</span>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner align="end" className="z-50" sideOffset={5}>
                    <Popover.Popup className="report-outline-popup" aria-label="Report outline">
                      <Popover.Title className="report-outline-title">
                        Document outline
                      </Popover.Title>
                      {outline.length === 0 ? (
                        <p className="report-outline-empty">
                          Add H1–H3 headings to build the outline and PDF contents.
                        </p>
                      ) : (
                        outline.map((entry) => (
                          <Popover.Close
                            key={`${entry.position}:${entry.title}`}
                            render={<Button className="report-outline-entry" type="button" />}
                            data-level={entry.level}
                            onClick={() => onSelectOutline?.(entry.position)}
                          >
                            {entry.title}
                          </Popover.Close>
                        ))
                      )}
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            ) : null}
            {reportTitle && onPreviewPaperSizeChange ? (
              <Popover.Root>
                <Popover.Trigger
                  render={
                    <Toolbar.Button
                      className="editor-toolbar-button editor-toolbar-button-wide"
                      type="button"
                    />
                  }
                  aria-label="Page preview size"
                >
                  <span>Page · {previewPaperSize.toUpperCase()}</span>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner align="end" className="z-50" sideOffset={5}>
                    <Popover.Popup className="report-outline-popup" aria-label="Page preview size">
                      {(["a4", "letter"] as const).map((size) => (
                        <Popover.Close
                          key={size}
                          render={<Button className="report-outline-entry" type="button" />}
                          aria-current={previewPaperSize === size ? "true" : undefined}
                          onClick={() => onPreviewPaperSizeChange(size)}
                        >
                          {size === "a4" ? "A4 · 210 × 297 mm" : "Letter · 8.5 × 11 in"}
                        </Popover.Close>
                      ))}
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            ) : null}
            <ToolbarButton
              label={reportTitle ? "Publish report" : "Export document"}
              wide={Boolean(reportTitle)}
              disabled={exportDisabled}
              onClick={onOpenExport}
            >
              <IconFileExport size={15} stroke={1.7} aria-hidden="true" />
              {reportTitle ? <span>Publish</span> : null}
            </ToolbarButton>
          </Toolbar.Group>
          <span className="editor-save-state" aria-live="polite">
            {saveState === "saved" ? `Saved · r${savedRevision}` : null}
            {saveState === "pending" ? "Unsaved" : null}
            {saveState === "saving" ? "Saving…" : null}
            {saveState === "error" ? "Not saved" : null}
          </span>
          <Toolbar.Group className="editor-toolbar-formatting" aria-label="Document formatting">
            {reportTitle ? (
              <Toolbar.Group className="editor-toolbar-group" aria-label="Typography formatting">
                <FormattingPopover
                  label="Font family"
                  value="Font"
                  options={REPORT_FONT_FAMILIES.map((font) => ({
                    value: font,
                    label:
                      font === "geist"
                        ? "Geist"
                        : font === "source_serif_4"
                          ? "Source Serif 4"
                          : "Geist Mono",
                  }))}
                  onSelect={(fontFamily) =>
                    editor.chain().focus().setMark("textStyle", { fontFamily }).run()
                  }
                />
                <FormattingPopover
                  label="Font size"
                  value="Size"
                  options={REPORT_FONT_SIZES.map((size) => ({ value: size, label: `${size} pt` }))}
                  onSelect={(fontSize) =>
                    editor.chain().focus().setMark("textStyle", { fontSize }).run()
                  }
                />
              </Toolbar.Group>
            ) : null}
            {reportTitle ? <ToolbarSeparator /> : null}
            <ToggleGroup
              className="editor-toolbar-group"
              aria-label="Text style"
              value={blockStyleValue}
              onValueChange={(value) => {
                switch (value[0]) {
                  case "paragraph":
                    editor.chain().focus().setParagraph().run();
                    break;
                  case "heading-1":
                    editor.chain().focus().toggleHeading({ level: 1 }).run();
                    break;
                  case "heading-2":
                    editor.chain().focus().toggleHeading({ level: 2 }).run();
                    break;
                  case "heading-3":
                    editor.chain().focus().toggleHeading({ level: 3 }).run();
                    break;
                }
              }}
            >
              <ToolbarButton label="Paragraph" value="paragraph">
                <IconPilcrow size={15} stroke={1.7} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton label="Heading 1" value="heading-1">
                <IconH1 size={15} stroke={1.7} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton label="Heading 2" value="heading-2">
                <IconH2 size={15} stroke={1.7} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton label="Heading 3" value="heading-3">
                <IconH3 size={15} stroke={1.7} aria-hidden="true" />
              </ToolbarButton>
            </ToggleGroup>
            <ToolbarSeparator />
            <Toolbar.Group className="editor-toolbar-group" aria-label="Common inline formatting">
              <ToolbarButton
                label="Bold"
                active={state.bold}
                onClick={() => editor.chain().focus().toggleBold().run()}
              >
                <IconBold size={15} stroke={1.7} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                label="Italic"
                active={state.italic}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              >
                <IconItalic size={15} stroke={1.7} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                label="Underline"
                active={state.underline}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              >
                <IconUnderline size={15} stroke={1.7} aria-hidden="true" />
              </ToolbarButton>
            </Toolbar.Group>
            <ToolbarSeparator />
            <span className="editor-toolbar-more-trigger">
              <ToolbarButton
                label="More formatting"
                active={moreFormattingOpen}
                expanded={moreFormattingOpen}
                controls="editor-additional-formatting"
                onClick={() => setMoreFormattingOpen((open) => !open)}
              >
                <IconDots size={16} stroke={1.8} aria-hidden="true" />
              </ToolbarButton>
            </span>
            <Toolbar.Group
              id="editor-additional-formatting"
              className="editor-toolbar-overflow-priority"
              aria-label="Additional formatting controls"
            >
              {reportTitle ? (
                <Toolbar.Group className="editor-toolbar-group" aria-label="Detailed typography">
                  <FormattingPopover
                    label="Text color"
                    value="Color"
                    options={REPORT_TEXT_COLORS.map((color, index) => ({
                      value: color,
                      label: ["Charcoal", "Black", "Blue", "Red", "Green"][index] ?? "Color",
                      swatch: color,
                    }))}
                    onSelect={(color) =>
                      editor.chain().focus().setMark("textStyle", { color }).run()
                    }
                  />
                  <FormattingPopover
                    label="Line spacing"
                    value="Line"
                    options={REPORT_LINE_SPACING.map((spacing) => ({
                      value: spacing,
                      label: `${spacing}×`,
                    }))}
                    onSelect={(lineSpacing) => updateActiveTextBlock(editor, { lineSpacing })}
                  />
                  <FormattingPopover
                    label="Paragraph spacing"
                    value="After"
                    options={REPORT_PARAGRAPH_SPACING.map((spacing) => ({
                      value: spacing,
                      label: `${spacing} pt after`,
                    }))}
                    onSelect={(paragraphSpacing) =>
                      updateActiveTextBlock(editor, { paragraphSpacing })
                    }
                  />
                </Toolbar.Group>
              ) : null}
              <ToolbarSeparator />
              <Toolbar.Group className="editor-toolbar-group" aria-label="Document content">
                <ToolbarButton
                  label="Add or edit link"
                  active={state.link}
                  disabled={state.selectionEmpty && !state.link}
                  onClick={onOpenLinkEditor}
                >
                  <IconLink size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                {!reportTitle ? (
                  <ToolbarButton
                    label="Attach image"
                    disabled={imageDisabled}
                    onClick={onInsertImage}
                  >
                    <IconPhotoPlus size={15} stroke={1.7} aria-hidden="true" />
                  </ToolbarButton>
                ) : null}
              </Toolbar.Group>
              <ToolbarSeparator />
              <ToolbarButton
                label="Defang selection"
                disabled={state.selectionEmpty}
                onClick={handleDefang}
              >
                <IconShieldCheck size={15} stroke={1.7} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarSeparator />
              <Toolbar.Group
                className="editor-toolbar-group"
                aria-label="Additional inline formatting"
              >
                <ToolbarButton
                  label="Strikethrough"
                  active={state.strike}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                >
                  <IconStrikethrough size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Highlight"
                  active={state.highlight}
                  onClick={() => editor.chain().focus().toggleHighlight().run()}
                >
                  <IconHighlight size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Inline code"
                  active={state.code}
                  onClick={() => editor.chain().focus().toggleCode().run()}
                >
                  <IconCode size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Subscript"
                  active={state.subscript}
                  onClick={() => editor.chain().focus().toggleSubscript().run()}
                >
                  <IconSubscript size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Superscript"
                  active={state.superscript}
                  onClick={() => editor.chain().focus().toggleSuperscript().run()}
                >
                  <IconSuperscript size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
              </Toolbar.Group>
              <ToolbarSeparator />
              <ToggleGroup
                className="editor-toolbar-group"
                aria-label="Text alignment"
                value={alignmentValue}
                onValueChange={(value) => {
                  const alignment = value[0];
                  if (alignment) editor.chain().focus().setTextAlign(alignment).run();
                }}
              >
                <ToolbarButton label="Align left" value="left">
                  <IconAlignLeft size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton label="Align center" value="center">
                  <IconAlignCenter size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton label="Align right" value="right">
                  <IconAlignRight size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton label="Justify" value="justify">
                  <IconAlignJustified size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
              </ToggleGroup>
              <ToolbarSeparator />
              <Toolbar.Group className="editor-toolbar-group" aria-label="Block formatting">
                <ToolbarButton
                  label="Bullet list"
                  active={state.bulletList}
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                >
                  <IconList size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Numbered list"
                  active={state.orderedList}
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                >
                  <IconListNumbers size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Task list"
                  active={state.taskList}
                  onClick={() => editor.chain().focus().toggleTaskList().run()}
                >
                  <IconListCheck size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Block quote"
                  active={state.blockquote}
                  onClick={() => editor.chain().focus().toggleBlockquote().run()}
                >
                  <IconBlockquote size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Code block"
                  active={state.codeBlock}
                  onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                >
                  <IconCodeDots size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Horizontal rule"
                  onClick={() => editor.chain().focus().setHorizontalRule().run()}
                >
                  <IconSeparatorHorizontal size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
              </Toolbar.Group>
              <ToolbarSeparator />
              <Toolbar.Group
                className="editor-toolbar-group"
                aria-label="Additional document content"
              >
                <ToolbarButton
                  label="Insert callout"
                  onClick={() =>
                    editor
                      .chain()
                      .focus()
                      .insertContent({
                        type: "callout",
                        attrs: { tone: "info" },
                        content: [{ type: "paragraph" }],
                      })
                      .run()
                  }
                >
                  <IconInfoSquareRounded size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                {!reportTitle ? (
                  <ToolbarButton
                    label="Insert table"
                    disabled={state.table}
                    onClick={() =>
                      editor
                        .chain()
                        .focus()
                        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                        .run()
                    }
                  >
                    <IconTable size={15} stroke={1.7} aria-hidden="true" />
                  </ToolbarButton>
                ) : null}
              </Toolbar.Group>
            </Toolbar.Group>
          </Toolbar.Group>
          {state.table ? (
            <Toolbar.Group className="editor-table-toolbar" aria-label="Table editing">
              <span className="editor-table-toolbar-label">Table</span>
              <Toolbar.Group className="editor-toolbar-group" aria-label="Table rows">
                <ToolbarButton
                  label="Add row above"
                  onClick={() => editor.chain().focus().addRowBefore().run()}
                >
                  <IconRowInsertTop size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Add row below"
                  onClick={() => editor.chain().focus().addRowAfter().run()}
                >
                  <IconRowInsertBottom size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Delete row"
                  danger
                  onClick={() => editor.chain().focus().deleteRow().run()}
                >
                  <IconRowRemove size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
              </Toolbar.Group>
              <ToolbarSeparator />
              <Toolbar.Group className="editor-toolbar-group" aria-label="Table columns">
                <ToolbarButton
                  label="Add column before"
                  onClick={() => editor.chain().focus().addColumnBefore().run()}
                >
                  <IconColumnInsertLeft size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Add column after"
                  onClick={() => editor.chain().focus().addColumnAfter().run()}
                >
                  <IconColumnInsertRight size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  label="Delete column"
                  danger
                  onClick={() => editor.chain().focus().deleteColumn().run()}
                >
                  <IconColumnRemove size={15} stroke={1.7} aria-hidden="true" />
                </ToolbarButton>
              </Toolbar.Group>
              <ToolbarSeparator />
              <ToolbarButton
                label="Delete table"
                danger
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                <IconTableOff size={15} stroke={1.7} aria-hidden="true" />
              </ToolbarButton>
              {reportTitle ? (
                <>
                  <ToolbarSeparator />
                  <ToolbarButton
                    label="Fit table to page"
                    wide
                    onClick={() =>
                      editor.chain().focus().updateAttributes("table", { layout: "fit-page" }).run()
                    }
                  >
                    <span>Fit page</span>
                  </ToolbarButton>
                  <ToolbarButton
                    label="Place table on a landscape page"
                    wide
                    onClick={() =>
                      editor
                        .chain()
                        .focus()
                        .updateAttributes("table", { layout: "landscape-page" })
                        .run()
                    }
                  >
                    <span>Landscape page</span>
                  </ToolbarButton>
                </>
              ) : null}
            </Toolbar.Group>
          ) : null}
        </Toolbar.Root>
      </div>
    </Tooltip.Provider>
  );
}

interface ToolbarButtonProps {
  label: string;
  value?: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  wide?: boolean;
  expanded?: boolean;
  controls?: string;
  onClick?: () => void;
  children: ReactNode;
}

function ToolbarButton({
  label,
  value,
  active,
  disabled = false,
  danger = false,
  wide = false,
  expanded,
  controls,
  onClick,
  children,
}: ToolbarButtonProps) {
  const commonProps = {
    className: wide ? "editor-toolbar-button editor-toolbar-button-wide" : "editor-toolbar-button",
    type: "button" as const,
    "aria-label": label,
    "data-danger": danger || undefined,
    "aria-expanded": expanded,
    "aria-controls": controls,
    disabled,
  };

  let trigger: ReactElement;
  if (value) {
    trigger = (
      <Toolbar.Button render={<Toggle />} value={value} {...commonProps}>
        {children}
      </Toolbar.Button>
    );
  } else if (active !== undefined) {
    trigger = (
      <Toolbar.Button
        render={
          <Toggle
            pressed={active}
            onPressedChange={() => {
              onClick?.();
            }}
          />
        }
        {...commonProps}
      >
        {children}
      </Toolbar.Button>
    );
  } else {
    trigger = (
      <Toolbar.Button
        {...commonProps}
        onClick={() => {
          onClick?.();
        }}
      >
        {children}
      </Toolbar.Button>
    );
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={trigger} />
      <ToolbarTooltipPopup label={label} />
    </Tooltip.Root>
  );
}

function ToolbarTooltipPopup({ label }: { label: string }) {
  return (
    <Tooltip.Portal>
      <Tooltip.Positioner className="editor-toolbar-tooltip-positioner" sideOffset={6}>
        <Tooltip.Popup className="editor-toolbar-tooltip">
          <Tooltip.Viewport>{label}</Tooltip.Viewport>
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  );
}

function ToolbarSeparator() {
  return <Toolbar.Separator className="editor-toolbar-separator" />;
}

interface FormattingOption<T extends string | number> {
  value: T;
  label: string;
  swatch?: string;
}

function FormattingPopover<T extends string | number>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  options: readonly FormattingOption<T>[];
  onSelect: (value: T) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Toolbar.Button
            className="editor-toolbar-button editor-toolbar-button-wide"
            type="button"
          />
        }
        aria-label={label}
      >
        {value}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="z-50" align="start" sideOffset={5}>
          <Popover.Popup className="report-outline-popup" aria-label={label}>
            {options.map((option) => (
              <Popover.Close
                key={String(option.value)}
                render={<Button className="report-outline-entry" type="button" />}
                onClick={() => onSelect(option.value)}
              >
                {option.swatch ? (
                  <span
                    className="editor-color-swatch"
                    style={{ backgroundColor: option.swatch }}
                    aria-hidden="true"
                  />
                ) : null}
                {option.label}
              </Popover.Close>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function updateActiveTextBlock(editor: Editor, attributes: Record<string, number>) {
  const node = editor.isActive("heading") ? "heading" : "paragraph";
  editor.chain().focus().updateAttributes(node, attributes).run();
}
