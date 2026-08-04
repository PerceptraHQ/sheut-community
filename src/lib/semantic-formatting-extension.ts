import { Extension, Mark, mergeAttributes } from "@tiptap/core";

export const REPORT_FONT_FAMILIES = ["geist", "source_serif_4", "geist_mono"] as const;
export const REPORT_FONT_SIZES = [9, 10, 11, 12, 14, 18, 24, 32] as const;
export const REPORT_TEXT_COLORS = ["#17202b", "#0b1320", "#004b76", "#7a1f1f", "#315a3c"] as const;
export const REPORT_LINE_SPACING = [1, 1.15, 1.5, 2] as const;
export const REPORT_PARAGRAPH_SPACING = [0, 6, 12, 18] as const;

const fontStack: Readonly<Record<string, string>> = {
  geist: '"Geist Variable", sans-serif',
  source_serif_4: '"Source Serif 4", serif',
  geist_mono: '"Geist Mono Variable", monospace',
};

export const SemanticTextStyle = Mark.create({
  name: "textStyle",
  addAttributes() {
    return {
      fontFamily: { default: null },
      fontSize: { default: null },
      color: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-sheut-text-style]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const fontFamily = stringAttribute(HTMLAttributes, "fontFamily");
    const fontSize = numberAttribute(HTMLAttributes, "fontSize");
    const color = stringAttribute(HTMLAttributes, "color");
    const style = [
      fontFamily && fontStack[fontFamily] ? `font-family:${fontStack[fontFamily]}` : null,
      fontSize ? `font-size:${fontSize}pt` : null,
      color ? `color:${color}` : null,
    ]
      .filter(Boolean)
      .join(";");
    return [
      "span",
      mergeAttributes({
        "data-sheut-text-style": "true",
        ...(style ? { style } : {}),
      }),
      0,
    ];
  },
});

export const SemanticParagraphFormatting = Extension.create({
  name: "semanticParagraphFormatting",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          lineSpacing: {
            default: null,
            parseHTML: (element) => numericDataAttribute(element, "lineSpacing"),
            renderHTML: (attributes) =>
              attributes.lineSpacing
                ? {
                    "data-line-spacing": String(attributes.lineSpacing),
                    style: `line-height:${String(attributes.lineSpacing)}`,
                  }
                : {},
          },
          paragraphSpacing: {
            default: null,
            parseHTML: (element) => numericDataAttribute(element, "paragraphSpacing"),
            renderHTML: (attributes) =>
              attributes.paragraphSpacing !== null
                ? {
                    "data-paragraph-spacing": String(attributes.paragraphSpacing),
                    style: `margin-bottom:${String(attributes.paragraphSpacing)}pt`,
                  }
                : {},
          },
        },
      },
    ];
  },
});

function stringAttribute(attributes: unknown, name: string): string | null {
  if (typeof attributes !== "object" || attributes === null) return null;
  const value: unknown = Reflect.get(attributes, name);
  return typeof value === "string" ? value : null;
}

function numberAttribute(attributes: unknown, name: string): number | null {
  if (typeof attributes !== "object" || attributes === null) return null;
  const value: unknown = Reflect.get(attributes, name);
  return typeof value === "number" ? value : null;
}

function numericDataAttribute(element: HTMLElement, name: string): number | null {
  const raw = element.dataset[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
