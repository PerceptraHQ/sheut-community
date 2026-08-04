import { describe, expect, it } from "vitest";
import {
  desktopActionFromKeyboardEvent,
  helpTopicFromDesktopAction,
  isDesktopActionId,
} from "./desktopActions";

describe("desktop actions", () => {
  it("accepts only the bounded action identifiers shared with the native menu", () => {
    expect(isDesktopActionId("file.save")).toBe(true);
    expect(isDesktopActionId("help.guide.document-native-reports")).toBe(true);
    expect(isDesktopActionId("help.guide../../untrusted")).toBe(false);
    expect(isDesktopActionId("file.delete-project")).toBe(false);
    expect(isDesktopActionId({ id: "file.save" })).toBe(false);
  });

  it("maps browser shortcuts to the same actions as native accelerators", () => {
    expect(
      desktopActionFromKeyboardEvent({ key: "s", metaKey: true, ctrlKey: false, shiftKey: false }),
    ).toBe("file.save");
    expect(
      desktopActionFromKeyboardEvent({ key: "p", metaKey: false, ctrlKey: true, shiftKey: true }),
    ).toBe("file.publish");
    expect(
      desktopActionFromKeyboardEvent({ key: "k", metaKey: false, ctrlKey: true, shiftKey: false }),
    ).toBe("view.command-palette");
    expect(
      desktopActionFromKeyboardEvent({ key: "s", metaKey: false, ctrlKey: false, shiftKey: false }),
    ).toBeNull();
  });

  it("resolves only bounded report-guide actions to help topics", () => {
    expect(helpTopicFromDesktopAction("help.guide.document-native-reports")).toBe(
      "document-native-reports",
    );
    expect(helpTopicFromDesktopAction("help.guides")).toBeNull();
  });
});
