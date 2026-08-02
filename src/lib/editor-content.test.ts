import { describe, expect, it } from "vitest";
import { defangIndicatorText, normalizeEditorLink, refangIndicatorText } from "./editor-content";

describe("editor content helpers", () => {
  it("defangs and refangs common indicator text without double-defanging", () => {
    const active = "https://user@example.com/1.2.3.4";
    const defanged = "hxxps://user[@]example[.]com/1[.]2[.]3[.]4";

    expect(defangIndicatorText(active)).toBe(defanged);
    expect(defangIndicatorText(defanged)).toBe(defanged);
    expect(refangIndicatorText(defanged)).toBe(active);
  });

  it("normalizes ordinary domains and rejects executable protocols", () => {
    expect(normalizeEditorLink("example.com/report")).toBe("https://example.com/report");
    expect(normalizeEditorLink("https://example.com/report")).toBe("https://example.com/report");
    expect(normalizeEditorLink("javascript:alert(1)")).toBeNull();
    expect(normalizeEditorLink("data:text/html,unsafe")).toBeNull();
    expect(normalizeEditorLink("https://safe.example\njavascript:alert(1)")).toBeNull();
  });
});
