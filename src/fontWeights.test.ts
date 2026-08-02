import { describe, expect, it } from "vitest";
import appCss from "./App.css?raw";

describe("Geist font weights", () => {
  it("lets semantic font-weight values drive the variable font axis", () => {
    expect(appCss).not.toMatch(/:root\s*\{[^}]*font-variation-settings:\s*["']wght["']\s+400/s);
  });
});
