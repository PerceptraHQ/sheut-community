import { Node } from "@tiptap/core";

export type CalloutTone = "info" | "warning" | "critical";

const validTones: readonly CalloutTone[] = ["info", "warning", "critical"];

function calloutTone(value: unknown): CalloutTone {
  return typeof value === "string" && validTones.includes(value as CalloutTone)
    ? (value as CalloutTone)
    : "info";
}

export const CalloutExtension = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: "info",
        parseHTML: (element) => calloutTone(element.getAttribute("data-sheut-callout")),
        renderHTML: (attributes) => ({
          "data-sheut-callout": calloutTone(attributes.tone),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "aside[data-sheut-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["aside", HTMLAttributes, 0];
  },
});
