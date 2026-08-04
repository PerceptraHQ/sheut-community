import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_ACTION_EVENT } from "../lib/desktopActions";
import type { DocumentEnvelope } from "../lib/documents";
import * as documentsApi from "../lib/documents";
import * as graphApi from "../lib/graph";
import DocumentEditor, { AUTOSAVE_INTERVAL_MS } from "./DocumentEditor";
import type { VaultPromiseNoticeOptions } from "./VaultNotices";

const editorState = vi.hoisted(() => ({
  activeTable: false,
  alignment: "left",
  selectedText: "",
  selection: { from: 1, to: 1, empty: true },
}));
const editorCommandSpies = vi.hoisted(() => ({
  addColumnBefore: vi.fn(),
  addColumnAfter: vi.fn(),
  addRowBefore: vi.fn(),
  addRowAfter: vi.fn(),
  deleteColumn: vi.fn(),
  deleteRow: vi.fn(),
  deleteTable: vi.fn(),
  focus: vi.fn(),
  insertContent: vi.fn(),
  insertTable: vi.fn(),
  setTextSelection: vi.fn(),
  setTextAlign: vi.fn(),
  unsetLink: vi.fn(),
}));
const noticeSpies = vi.hoisted(() => ({
  add: vi.fn(),
  promise: vi.fn(
    (
      operation: () => Promise<unknown>,
      options: VaultPromiseNoticeOptions<unknown>,
    ): Promise<unknown> => {
      void options;
      return operation();
    },
  ),
}));

vi.mock("@tiptap/starter-kit", () => ({
  default: { configure: vi.fn(() => ({})) },
}));

vi.mock("@tiptap/react", async () => {
  const React = await import("react");
  let onUpdate: ((event: { editor: typeof editor }) => void) | undefined;
  const selectionListeners = new Set<() => void>();
  const chain = {
    focus: () => {
      editorCommandSpies.focus();
      return chain;
    },
    toggleHeading: () => chain,
    toggleBold: () => chain,
    toggleItalic: () => chain,
    toggleStrike: () => chain,
    toggleCode: () => chain,
    toggleBulletList: () => chain,
    toggleOrderedList: () => chain,
    toggleBlockquote: () => chain,
    setTextAlign: (alignment: string) => {
      editorCommandSpies.setTextAlign(alignment);
      return chain;
    },
    insertTable: (options: unknown) => {
      editorCommandSpies.insertTable(options);
      editorState.activeTable = true;
      for (const listener of selectionListeners) listener();
      return chain;
    },
    addRowBefore: () => {
      editorCommandSpies.addRowBefore();
      return chain;
    },
    addRowAfter: () => {
      editorCommandSpies.addRowAfter();
      return chain;
    },
    deleteRow: () => {
      editorCommandSpies.deleteRow();
      return chain;
    },
    addColumnBefore: () => {
      editorCommandSpies.addColumnBefore();
      return chain;
    },
    addColumnAfter: () => {
      editorCommandSpies.addColumnAfter();
      return chain;
    },
    deleteColumn: () => {
      editorCommandSpies.deleteColumn();
      return chain;
    },
    deleteTable: () => {
      editorCommandSpies.deleteTable();
      return chain;
    },
    insertContent: (content: unknown) => {
      editorCommandSpies.insertContent(content);
      return chain;
    },
    setTextSelection: (position: number) => {
      editorCommandSpies.setTextSelection(position);
      return chain;
    },
    extendMarkRange: () => chain,
    setLink: () => chain,
    unsetLink: () => {
      editorCommandSpies.unsetLink();
      return chain;
    },
    run: () => true,
  };
  const editor = {
    getJSON: () => ({
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Original finding" }],
        },
      ],
    }),
    isActive: (name: string, attrs?: Record<string, unknown>) => {
      if (name === "table") return editorState.activeTable;
      if ((name === "paragraph" || name === "heading") && attrs?.textAlign) {
        return attrs.textAlign === editorState.alignment;
      }
      return false;
    },
    getAttributes: () => ({}),
    state: {
      get selection() {
        return editorState.selection;
      },
      doc: { textBetween: () => editorState.selectedText },
    },
    chain: () => chain,
    commands: { setContent: vi.fn() },
  };
  return {
    useEditor: (options: { onUpdate: typeof onUpdate }) => {
      onUpdate = options.onUpdate;
      return editor;
    },
    useEditorState: ({
      selector,
    }: {
      selector: (context: { editor: typeof editor }) => unknown;
    }) => {
      const [, setVersion] = React.useState(0);
      React.useEffect(() => {
        const listener = () => setVersion((version) => version + 1);
        selectionListeners.add(listener);
        return () => {
          selectionListeners.delete(listener);
        };
      }, []);
      return selector({ editor });
    },
    EditorContent: () =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "button",
          { type: "button", onClick: () => onUpdate?.({ editor }) },
          "Simulate edit",
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              editorState.selection = { from: 1, to: 15, empty: false };
              editorState.selectedText = "evil.example";
              for (const listener of selectionListeners) listener();
            },
          },
          "Select indicator",
        ),
      ),
  };
});

vi.mock("../lib/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/documents")>();
  return {
    ...actual,
    pickDocumentImage: vi.fn(),
    renderSavedDocument: vi.fn(),
    saveDocument: vi.fn(),
  };
});

vi.mock("../lib/brand-profiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/brand-profiles")>()),
  listBrandProfiles: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/graph")>()),
  createGraphSnapshotAttachment: vi.fn(),
  listGraphWorkspaces: vi.fn(),
}));

vi.mock("./VaultNotices", () => ({
  useVaultNotices: () => noticeSpies,
}));

const document: DocumentEnvelope = {
  schema_version: 1,
  id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
  kind: "investigation",
  revision: 1,
  root: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Original" }],
      },
    ],
  },
};

const reportDocument: DocumentEnvelope = {
  ...document,
  kind: "report",
  reportProperties: {
    reportId: "RPT-0001",
    title: "Untitled report",
    authors: [],
    producingOrganisation: null,
    issueDate: "2026-08-04",
  },
};

describe("DocumentEditor", () => {
  beforeEach(() => {
    editorState.activeTable = false;
    editorState.alignment = "left";
    editorState.selectedText = "";
    editorState.selection = { from: 1, to: 1, empty: true };
    for (const command of Object.values(editorCommandSpies)) command.mockReset();
    vi.mocked(documentsApi.saveDocument).mockReset();
    vi.mocked(documentsApi.pickDocumentImage).mockReset();
    vi.mocked(documentsApi.renderSavedDocument).mockReset();
    vi.mocked(graphApi.createGraphSnapshotAttachment).mockReset();
    vi.mocked(graphApi.listGraphWorkspaces).mockReset().mockResolvedValue([]);
    noticeSpies.add.mockReset();
    noticeSpies.promise.mockClear();
  });

  it("uses direct toggle groups for block style and bounded text alignment", async () => {
    const user = userEvent.setup();
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("toolbar", { name: "Document toolbar" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Heading 3" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "More formatting" }));
    await user.click(screen.getByRole("button", { name: "Align center" }));
    await user.click(screen.getByRole("button", { name: "Justify" }));

    expect(editorCommandSpies.setTextAlign).toHaveBeenNthCalledWith(1, "center");
    expect(editorCommandSpies.setTextAlign).toHaveBeenNthCalledWith(2, "justify");
  });

  it("uses recognizable toolbar icons instead of letter abbreviations", () => {
    const { container } = render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );
    for (const label of [
      "Add or edit link",
      "Strikethrough",
      "Justify",
      "Undo",
      "Redo",
      "Export document",
    ]) {
      const button = container.querySelector(`[aria-label="${label}"]`);
      expect(button, label).not.toBeNull();
      expect(button?.querySelector("svg"), label).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "Add or edit link" })).not.toHaveTextContent("Ln");
  });

  it("keeps one responsive toolbar and expands secondary formatting without wrapping", async () => {
    const user = userEvent.setup();
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "Document toolbar" });
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(within(toolbar).getByRole("button", { name: "Save document" })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: "Undo" })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: "Redo" })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: "Export document" })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: "Bold" })).toBeVisible();
    const more = within(toolbar).getByRole("button", { name: "More formatting" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(within(toolbar).getByRole("button", { name: "Strikethrough" })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: "Align center" })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: "Insert table" })).toBeVisible();
  });

  it("keeps report insertion actions in one menu without duplicate toolbar buttons", async () => {
    const user = userEvent.setup();
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={reportDocument}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "Document toolbar" });
    const formatting = within(toolbar).getByRole("group", { name: "Document formatting" });
    const documentActions = within(toolbar).getByRole("group", { name: "Document actions" });
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(within(formatting).getByRole("button", { name: "Undo" })).toBeVisible();
    expect(within(formatting).getByRole("button", { name: "Redo" })).toBeVisible();
    expect(within(formatting).getByRole("button", { name: "Insert report content" })).toBeVisible();
    expect(
      within(documentActions).getByRole("button", { name: "More document actions" }),
    ).toBeVisible();
    expect(within(documentActions).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(within(documentActions).queryByRole("button", { name: "Redo" })).toBeNull();
    expect(
      within(documentActions).queryByRole("button", { name: "Insert report content" }),
    ).toBeNull();
    expect(within(formatting).getByRole("group", { name: "Detailed typography" })).toHaveClass(
      "editor-toolbar-responsive-priority-1",
    );
    expect(
      within(formatting).getByRole("group", { name: "Additional inline formatting" }),
    ).toHaveClass("editor-toolbar-responsive-priority-2");
    expect(within(formatting).getByRole("group", { name: "Text alignment" })).toHaveClass(
      "editor-toolbar-responsive-priority-3",
    );
    expect(screen.queryByRole("button", { name: "Attach image" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Insert table" })).toBeNull();
    await user.click(
      within(documentActions).getByRole("button", { name: "More document actions" }),
    );
    const actionsMenu = await screen.findByRole("dialog", { name: "Report" });
    expect(
      within(actionsMenu).getByRole("button", { name: "Report administration" }),
    ).toBeVisible();
    expect(within(actionsMenu).getByRole("button", { name: "Preview A4 page" })).toBeVisible();
    expect(within(actionsMenu).getByText(/Add H1–H3 headings/)).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Insert report content" }));
    const menu = await screen.findByRole("dialog", { name: "Insert report content" });
    for (const label of ["Evidence", "Image", "Table", /Page break/]) {
      expect(within(menu).getByText(label)).toBeVisible();
    }
    await user.click(within(menu).getByText("Table"));
    expect(
      screen.getByRole("button", { name: "Landscape page is available for very wide tables" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("cancels an insertion without changing the document and restores the caret", async () => {
    const user = userEvent.setup();
    editorState.selection = { from: 7, to: 7, empty: true };
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={reportDocument}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Insert report content" }));
    const insertMenu = await screen.findByRole("dialog", { name: "Insert report content" });
    await user.click(within(insertMenu).getByText("Evidence"));
    expect(await screen.findByRole("dialog", { name: "Insert Evidence" })).toBeVisible();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Insert Evidence" })).not.toBeInTheDocument(),
    );
    expect(editorCommandSpies.insertContent).not.toHaveBeenCalled();
    expect(editorCommandSpies.setTextSelection).toHaveBeenLastCalledWith(7);
    expect(editorCommandSpies.focus).toHaveBeenCalled();
  });

  it("does not insert a graph if the dialog is cancelled while rendering", async () => {
    const user = userEvent.setup();
    let resolveSnapshot: ((snapshot: graphApi.GraphSnapshotAttachment) => void) | undefined;
    vi.mocked(graphApi.listGraphWorkspaces).mockResolvedValue([
      {
        schema_version: 1,
        id: "4f3d8e34-7c64-4d41-8b68-d7a334e1a884",
        name: "Infrastructure map",
        revision: 7,
        mode: "view",
        viewport: { x: 0, y: 0, zoom: 1 },
        created_at_unix_ms: 1,
        updated_at_unix_ms: 2,
        deleted_at_unix_ms: null,
      },
    ]);
    vi.mocked(graphApi.createGraphSnapshotAttachment).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={reportDocument}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Insert report content" }));
    const insertMenu = await screen.findByRole("dialog", { name: "Insert report content" });
    await user.click(within(insertMenu).getByText("Graph snapshot"));
    await user.click(await screen.findByRole("option", { name: /Infrastructure map/ }));
    await user.click(screen.getByRole("button", { name: "Insert inline" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Insert graph snapshot" }),
      ).not.toBeInTheDocument(),
    );

    await act(async () => {
      resolveSnapshot?.({
        attachment: {
          id: "22a415a0-61b2-4b50-904d-d5f180bfc505",
          documentId: reportDocument.id,
          mediaType: "image/png",
          fileName: "graph.png",
          byteLen: 64,
        },
        workspaceId: "4f3d8e34-7c64-4d41-8b68-d7a334e1a884",
        workspaceRevision: 7,
        workspaceName: "Infrastructure map",
      });
      await Promise.resolve();
    });

    expect(editorCommandSpies.insertContent).not.toHaveBeenCalled();
  });

  it("uses the available workspace width instead of constraining the editor chrome", () => {
    const { container } = render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    const editor = container.querySelector(".document-editor");
    expect(editor).toHaveClass("w-full");
    expect(editor).not.toHaveClass("max-w-4xl");
  });

  it("collects publication overrides before opening the native save picker", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn().mockResolvedValue(undefined);
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
        onExport={onExport}
        defaultTlpMarking="green"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export document" }));
    expect(screen.getByRole("dialog", { name: "Publish document" })).toHaveClass("max-w-[48rem]");
    const fileName = screen.getByRole("textbox", { name: "File name" });
    expect(fileName).toHaveValue("Original");
    expect(screen.getByText("PDF")).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Paper size" }));
    await user.click(await screen.findByRole("option", { name: "Letter US Letter" }));
    await user.click(screen.getByRole("combobox", { name: "Orientation" }));
    await user.click(await screen.findByRole("option", { name: "Landscape Wide pages" }));
    await user.click(screen.getByRole("combobox", { name: "TLP marking" }));
    await user.click(
      await screen.findByRole("option", { name: "TLP:AMBER+STRICT — Organization only" }),
    );
    expect(screen.queryByText("Included sections")).toBeNull();
    expect(screen.queryByText("Included appendices")).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Include footer" }));
    await user.clear(fileName);
    await user.type(fileName, "incident-summary");
    await user.click(screen.getByRole("button", { name: "Choose save location" }));

    expect(onExport).toHaveBeenCalledWith({
      format: "pdf",
      paperSize: "letter",
      orientation: "landscape",
      tlpMarking: "amber_strict",
      brandProfileId: null,
      brandProfileRevision: null,
      releaseVersion: "1.0",
      publicationStatus: "draft",
      includeReleaseHistory: false,
      changeNote: null,
      pageFurniture: { header: true, footer: false, marking: true, page_numbers: true },
      includedSections: [],
      appendices: [],
      fileName: "incident-summary",
    });
  });

  it("defangs only when the user explicitly applies it to a selection", async () => {
    const user = userEvent.setup();
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Defang selection" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Select indicator" }));
    expect(editorCommandSpies.insertContent).not.toHaveBeenCalled();
    const defang = screen.getByRole("button", { name: "Defang selection" });
    expect(defang).toBeEnabled();
    expect(defang).not.toHaveTextContent("Defang");
    expect(defang).toHaveAttribute("data-base-ui-tooltip-trigger");
    await user.click(defang);

    expect(editorCommandSpies.unsetLink).toHaveBeenCalledOnce();
    expect(editorCommandSpies.insertContent).toHaveBeenCalledWith("evil[.]example");
  });

  it("inserts a bounded table and a canonical information callout", async () => {
    const user = userEvent.setup();
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Insert table" }));
    await user.click(screen.getByRole("button", { name: "Insert callout" }));

    expect(editorCommandSpies.insertTable).toHaveBeenCalledWith({
      rows: 3,
      cols: 3,
      withHeaderRow: true,
    });
    expect(editorCommandSpies.insertContent).toHaveBeenCalledWith({
      type: "callout",
      attrs: { tone: "info" },
      content: [{ type: "paragraph" }],
    });
  });

  it("attaches an image by opaque identifier without exposing a file path", async () => {
    const user = userEvent.setup();
    vi.mocked(documentsApi.pickDocumentImage).mockResolvedValue({
      id: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
      documentId: document.id,
      mediaType: "image/webp",
      fileName: "evidence.webp",
      byteLen: 128,
    });
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    const attachImage = screen.getByRole("button", { name: "Attach image" });
    expect(attachImage.querySelector("svg")).not.toBeNull();
    expect(attachImage).not.toHaveTextContent("Im");
    await user.click(attachImage);

    await waitFor(() =>
      expect(editorCommandSpies.insertContent).toHaveBeenCalledWith({
        type: "imageAttachment",
        attrs: {
          attachmentId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
          alt: "evidence.webp",
          title: null,
        },
      }),
    );
    expect(documentsApi.pickDocumentImage).toHaveBeenCalledWith(
      "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
      document.id,
    );
  });

  it("reveals complete row and column controls after inserting a table", async () => {
    const user = userEvent.setup();
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Table editing")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Insert table" }));
    expect(screen.getByLabelText("Table editing")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Add row above" }));
    await user.click(screen.getByRole("button", { name: "Add row below" }));
    await user.click(screen.getByRole("button", { name: "Delete row" }));
    await user.click(screen.getByRole("button", { name: "Add column before" }));
    await user.click(screen.getByRole("button", { name: "Add column after" }));
    await user.click(screen.getByRole("button", { name: "Delete column" }));
    await user.click(screen.getByRole("button", { name: "Delete table" }));

    expect(editorCommandSpies.addRowBefore).toHaveBeenCalledOnce();
    expect(editorCommandSpies.addRowAfter).toHaveBeenCalledOnce();
    expect(editorCommandSpies.deleteRow).toHaveBeenCalledOnce();
    expect(editorCommandSpies.addColumnBefore).toHaveBeenCalledOnce();
    expect(editorCommandSpies.addColumnAfter).toHaveBeenCalledOnce();
    expect(editorCommandSpies.deleteColumn).toHaveBeenCalledOnce();
    expect(editorCommandSpies.deleteTable).toHaveBeenCalledOnce();
  });

  it("autosaves structured JSON against the current revision", async () => {
    vi.useFakeTimers();
    const onSaved = vi.fn();
    const onBusyChange = vi.fn();
    vi.mocked(documentsApi.saveDocument).mockImplementation(
      (_projectId, _documentId, _revision, root) =>
        Promise.resolve({
          ...document,
          revision: 2,
          root,
        }),
    );
    try {
      render(
        <DocumentEditor
          projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
          document={document}
          onSaved={onSaved}
          onReload={vi.fn()}
          onBusyChange={onBusyChange}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Simulate edit" }));
      await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS - 1));
      expect(documentsApi.saveDocument).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(1));

      expect(documentsApi.saveDocument).toHaveBeenCalledWith(
        "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
        document.id,
        1,
        expect.objectContaining({ type: "doc" }),
      );
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
      expect(screen.getByText("Saved · r2")).toBeVisible();
      expect(screen.queryByRole("button", { name: "Derived output" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add or edit link" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.getByRole("button", { name: "Defang selection" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(onBusyChange).toHaveBeenCalledWith(true);
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("debounces autosave until editing has been idle", async () => {
    vi.useFakeTimers();
    vi.mocked(documentsApi.saveDocument).mockResolvedValue({ ...document, revision: 2 });
    try {
      render(
        <DocumentEditor
          projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
          document={document}
          onSaved={vi.fn()}
          onReload={vi.fn()}
          onBusyChange={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Simulate edit" }));
      await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS - 500));
      fireEvent.click(screen.getByRole("button", { name: "Simulate edit" }));
      await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS - 1));
      expect(documentsApi.saveDocument).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(1));

      expect(documentsApi.saveDocument).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves pending edits immediately from the toolbar and the shared desktop action", async () => {
    vi.mocked(documentsApi.saveDocument)
      .mockResolvedValueOnce({ ...document, revision: 2 })
      .mockResolvedValueOnce({ ...document, revision: 3 });
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    const save = screen.getByRole("button", { name: "Save document" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Simulate edit" }));
    expect(save).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(save);
    await waitFor(() => expect(documentsApi.saveDocument).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Simulate edit" }));
    window.dispatchEvent(new CustomEvent(WORKSPACE_ACTION_EVENT, { detail: "file.save" }));
    await waitFor(() => expect(documentsApi.saveDocument).toHaveBeenCalledTimes(2));
    const noticeCall = noticeSpies.promise.mock.calls[0];
    expect(noticeCall).toBeDefined();
    if (!noticeCall) throw new Error("Shortcut save notice was not recorded");
    const [, noticeOptions] = noticeCall;
    expect(noticeOptions.loading.title).toBe("Saving document");
    expect(typeof noticeOptions.success).toBe("object");
    if (typeof noticeOptions.success !== "function") {
      expect(noticeOptions.success.title).toBe("Document saved");
    }
    expect(typeof noticeOptions.error).toBe("function");
    expect(documentsApi.saveDocument).toHaveBeenLastCalledWith(
      "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
      document.id,
      2,
      expect.objectContaining({ type: "doc" }),
    );
  });

  it("leaves native undo and redo shortcuts to the focused editor", () => {
    render(
      <DocumentEditor
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        document={document}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });

    expect(noticeSpies.add).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Undo" }));
    expect(noticeSpies.add).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Redo" }));
  });

  it("blocks navigation after a conflict until the committed copy is reloaded", async () => {
    vi.useFakeTimers();
    const onBusyChange = vi.fn();
    const reloaded = { ...document, revision: 2 };
    const onReload = vi.fn().mockResolvedValue(reloaded);
    vi.mocked(documentsApi.saveDocument).mockRejectedValue({ code: "revision_conflict" });
    try {
      render(
        <DocumentEditor
          projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
          document={document}
          onSaved={vi.fn()}
          onReload={onReload}
          onBusyChange={onBusyChange}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Simulate edit" }));
      await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS));
      expect(screen.getByRole("alert")).toHaveTextContent("This document changed elsewhere");
      expect(onBusyChange).toHaveBeenLastCalledWith(true);

      fireEvent.click(screen.getByRole("button", { name: "Reload committed copy" }));
      await act(async () => Promise.resolve());
      expect(onReload).toHaveBeenCalledWith(document.id);
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
