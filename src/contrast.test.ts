import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");

function colorToken(name: string): string {
  const match = appCss.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`, "iu"));
  if (!match?.[1]) throw new Error(`Missing color token: ${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../gu)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  if (channels?.length !== 3) throw new Error(`Invalid color: ${hex}`);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

describe("application text contrast", () => {
  it("keeps semantic text tokens at WCAG AAA contrast on every dark surface", () => {
    const surfaces = ["workbench", "panel-deep", "panel-base", "panel-raised", "panel-hover"];
    const textTokens = [
      "copy-primary",
      "copy-secondary",
      "copy-muted",
      "copy-faint",
      "accent-hover",
      "accent-bright",
      "danger",
    ];

    for (const textToken of textTokens) {
      for (const surface of surfaces) {
        expect(contrast(colorToken(textToken), colorToken(surface))).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it("keeps primary button text at WCAG AAA contrast", () => {
    for (const background of ["accent", "accent-strong"]) {
      expect(contrast("#ffffff", colorToken(background))).toBeGreaterThanOrEqual(7);
    }
  });
});
