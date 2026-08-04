import { mergeAttributes, Node } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      insertPageBreak: () => ReturnType;
    };
  }
}

export const PageBreakExtension = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-sheut-page-break]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-sheut-page-break": "",
        role: "separator",
        "aria-label": "Page break",
      }),
    ];
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name }, { type: "paragraph" }]),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.insertPageBreak() };
  },
});
