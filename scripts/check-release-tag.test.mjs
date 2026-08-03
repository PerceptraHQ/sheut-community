import { describe, expect, it } from "vitest";

import { validateReleaseTag } from "./check-release-tag.mjs";

describe("release tag", () => {
  it("matches the application version exactly", () => {
    expect(() => validateReleaseTag("v0.1.1", "0.1.1")).not.toThrow();
  });

  it.each(["0.1.1", "v0.1.2", "release-0.1.1", "v0.1.1 "])(
    "rejects a mismatched tag: %s",
    (tag) => {
      expect(() => validateReleaseTag(tag, "0.1.1")).toThrow(/must match app version/u);
    },
  );
});
