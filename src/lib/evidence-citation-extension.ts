import { Node } from "@tiptap/core";

export const EvidenceCitationExtension = Node.create({
  name: "evidenceCitation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      evidenceId: { default: null },
      revision: { default: null },
      label: { default: "Evidence" },
      fileName: { default: "" },
      mediaType: { default: "application/octet-stream" },
      sha256: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-sheut-evidence-citation]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const label = stringAttribute(HTMLAttributes, "label", "Evidence");
    const evidenceId = stringAttribute(HTMLAttributes, "evidenceId", "");
    return [
      "span",
      {
        "data-sheut-evidence-citation": evidenceId,
        class: "editor-evidence-citation",
      },
      `[${label}]`,
    ];
  },
});

function stringAttribute(attributes: unknown, name: string, fallback: string): string {
  if (typeof attributes !== "object" || attributes === null) return fallback;
  const value: unknown = Reflect.get(attributes, name);
  return typeof value === "string" ? value : fallback;
}
