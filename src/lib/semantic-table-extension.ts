import { Table } from "@tiptap/extension-table";

export const SemanticTable = Table.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      layout: {
        default: "fit-page",
        parseHTML: (element) =>
          element.getAttribute("data-layout") === "landscape-page" ? "landscape-page" : "fit-page",
        renderHTML: (attributes) => ({
          "data-layout": attributes.layout === "landscape-page" ? "landscape-page" : "fit-page",
        }),
      },
    };
  },
}).configure({
  resizable: true,
  lastColumnResizable: true,
  allowTableNodeSelection: true,
});
