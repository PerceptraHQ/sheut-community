import { describe, expect, it } from "vitest";

import { validateWindowsBundleVersion } from "./check-tauri-bundle-config.mjs";

describe("Windows Tauri bundle version", () => {
  it("accepts a numeric prerelease identifier for MSI", () => {
    expect(() => validateWindowsBundleVersion("0.1.0-alpha", "0.1.0-0")).not.toThrow();
  });

  it.each(["0.1.0-alpha", "0.1.0-1.2", "0.1.0-65536"])(
    "rejects an MSI-incompatible prerelease version: %s",
    (windowsVersion) => {
      expect(() => validateWindowsBundleVersion("0.1.0-alpha", windowsVersion)).toThrow(
        /numeric prerelease identifier from 0 through 65535/u,
      );
    },
  );

  it("keeps the Windows override on the same release core", () => {
    expect(() => validateWindowsBundleVersion("0.1.0-alpha", "0.2.0-0")).toThrow(
      /same release core/u,
    );
  });
});
