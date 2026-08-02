import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("D3 under Tauri prototype hardening", () => {
  it("loads the graph interaction bundle after Object.prototype is frozen", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          'Object.freeze(Object.prototype); await import("d3-zoom");',
        ],
        { stdio: "pipe" },
      ),
    ).not.toThrow();
  });
});
