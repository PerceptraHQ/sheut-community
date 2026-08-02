import { describe, expect, it } from "vitest";
import { assertCatalogFreshness } from "./check-mitre-freshness.mjs";

const manifest = {
  sources: [
    { catalog: "attack_enterprise", version: "19.1" },
    { catalog: "attack_mobile", version: "19.1" },
    { catalog: "attack_ics", version: "19.1" },
    { catalog: "atlas", version: "2026.06" },
  ],
};

describe("MITRE release freshness gate", () => {
  it("accepts catalog pins that match both official latest releases", () => {
    expect(assertCatalogFreshness(manifest, { attack: "v19.1", atlas: "v2026.06" })).toEqual({
      attack: "19.1",
      atlas: "2026.06",
    });
  });

  it("rejects a production pin when ATT&CK has a newer official release", () => {
    expect(() => assertCatalogFreshness(manifest, { attack: "v20.0", atlas: "v2026.06" })).toThrow(
      /ATT&CK catalogs are pinned to 19\.1 but the official latest release is 20\.0/u,
    );
  });

  it("rejects inconsistent ATT&CK domain versions", () => {
    expect(() =>
      assertCatalogFreshness(
        {
          sources: manifest.sources.map((source) =>
            source.catalog === "attack_ics" ? { ...source, version: "18.1" } : source,
          ),
        },
        { attack: "v19.1", atlas: "v2026.06" },
      ),
    ).toThrow(/same release/u);
  });
});
