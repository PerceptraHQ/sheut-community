import { describe, expect, it } from "vitest";
import { collectStartupChunks, verifyBundleBudgets } from "./check-bundle-size.mjs";

const manifest = {
  "src/main.tsx": {
    file: "assets/index.js",
    isEntry: true,
    imports: ["_react.js", "_icons.js"],
    dynamicImports: ["src/features/editor.tsx", "src/features/graph.tsx"],
  },
  "_react.js": {
    file: "assets/react.js",
  },
  "_icons.js": {
    file: "assets/icons.js",
    name: "icons",
    imports: ["_react.js"],
  },
  "src/features/editor.tsx": {
    file: "assets/editor.js",
    isDynamicEntry: true,
    imports: ["_editor-icons.js"],
  },
  "_editor-icons.js": {
    file: "assets/editor-icons.js",
    name: "editor-icons",
    imports: ["_icons.js"],
  },
  "src/features/graph.tsx": {
    file: "assets/graph.js",
    name: "GraphWorkspace",
    isDynamicEntry: true,
    imports: ["_react.js", "_graph-icons.js", "_stix-icon-urls.js"],
  },
  "_graph-icons.js": {
    file: "assets/graph-icons.js",
    name: "graph-icons",
    imports: ["_react.js"],
  },
  "_stix-icon-urls.js": {
    file: "assets/stix-icon-urls.js",
    name: "stix-icon-urls",
  },
};

const graphMeasurements = [
  ["assets/graph.js", 60_000],
  ["assets/graph-icons.js", 3_000],
  ["assets/graph-layout.worker-test.js", 12_000],
  ["assets/stix-icon-urls.js", 5_000],
];

describe("bundle budgets", () => {
  it("counts the complete static startup graph but excludes lazy chunks", () => {
    expect(collectStartupChunks(manifest)).toEqual(
      new Set(["assets/index.js", "assets/react.js", "assets/icons.js"]),
    );
  });

  it("accepts startup and named icon chunks within their gzip ceilings", () => {
    const result = verifyBundleBudgets(
      manifest,
      new Map([
        ["assets/index.js", 20_000],
        ["assets/react.js", 50_000],
        ["assets/icons.js", 4_000],
        ["assets/editor.js", 200_000],
        ["assets/editor-icons.js", 2_500],
        ...graphMeasurements,
      ]),
    );

    expect(result).toEqual({
      startupGzipBytes: 74_000,
      iconGzipBytes: 4_000,
      editorIconGzipBytes: 2_500,
      graphGzipBytes: 63_000,
      graphWorkerGzipBytes: 12_000,
      stixIconRegistryGzipBytes: 5_000,
    });
  });

  it("rejects an oversized startup graph or icon chunk", () => {
    expect(() =>
      verifyBundleBudgets(
        manifest,
        new Map([
          ["assets/index.js", 30_000],
          ["assets/react.js", 50_000],
          ["assets/icons.js", 5_121],
          ["assets/editor-icons.js", 4_097],
          ...graphMeasurements,
        ]),
      ),
    ).toThrow(/startup.*81920.*icon.*5120.*editor icon.*4096/i);
  });

  it("rejects editor-only icons that leak into the startup graph", () => {
    const leakedManifest = structuredClone(manifest);
    leakedManifest["src/main.tsx"].imports.push("_editor-icons.js");

    expect(() =>
      verifyBundleBudgets(
        leakedManifest,
        new Map([
          ["assets/index.js", 20_000],
          ["assets/react.js", 50_000],
          ["assets/icons.js", 4_000],
          ["assets/editor-icons.js", 2_500],
          ...graphMeasurements,
        ]),
      ),
    ).toThrow(/editor icon chunk must stay out of the startup graph/i);
  });

  it("rejects an oversized graph entry or layout worker", () => {
    expect(() =>
      verifyBundleBudgets(
        manifest,
        new Map([
          ["assets/index.js", 20_000],
          ["assets/react.js", 50_000],
          ["assets/icons.js", 4_000],
          ["assets/editor-icons.js", 2_500],
          ["assets/graph.js", 74_000],
          ["assets/graph-icons.js", 3_000],
          ["assets/graph-layout.worker-test.js", 20_481],
          ["assets/stix-icon-urls.js", 5_000],
        ]),
      ),
    ).toThrow(/graph.*76800.*graph worker.*20480/i);
  });

  it("rejects graph code or graph-only icons that leak into startup", () => {
    for (const leakedImport of ["src/features/graph.tsx", "_graph-icons.js"]) {
      const leakedManifest = structuredClone(manifest);
      leakedManifest["src/main.tsx"].imports.push(leakedImport);
      expect(() =>
        verifyBundleBudgets(
          leakedManifest,
          new Map([
            ["assets/index.js", 20_000],
            ["assets/react.js", 50_000],
            ["assets/icons.js", 4_000],
            ["assets/editor-icons.js", 2_500],
            ...graphMeasurements,
          ]),
        ),
      ).toThrow(/graph.*startup/i);
    }
  });

  it("rejects an oversized STIX icon registry or a registry leaked into startup", () => {
    const measurements = new Map([
      ["assets/index.js", 20_000],
      ["assets/react.js", 50_000],
      ["assets/icons.js", 4_000],
      ["assets/editor-icons.js", 2_500],
      ...graphMeasurements.filter(([file]) => file !== "assets/stix-icon-urls.js"),
      ["assets/stix-icon-urls.js", 8_193],
    ]);
    expect(() => verifyBundleBudgets(manifest, measurements)).toThrow(/STIX icon registry.*8192/i);

    const leakedManifest = structuredClone(manifest);
    leakedManifest["src/main.tsx"].imports.push("_stix-icon-urls.js");
    measurements.set("assets/stix-icon-urls.js", 5_000);
    expect(() => verifyBundleBudgets(leakedManifest, measurements)).toThrow(
      /STIX icon registry must stay out of the startup graph/i,
    );
  });

  it("fails closed when the build has no isolated icon chunk", () => {
    const manifestWithoutIcons = {
      "src/main.tsx": { file: "assets/index.js", isEntry: true },
    };

    expect(() =>
      verifyBundleBudgets(manifestWithoutIcons, new Map([["assets/index.js", 10_000]])),
    ).toThrow(/icon chunk/i);
  });
});
