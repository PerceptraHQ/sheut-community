import { describe, expect, it } from "vitest";
import { stixObjectTypes } from "../../lib/stix";
import { iconUrlFor } from "./stix-icon-urls";

describe("STIX icon registry", () => {
  it("resolves every supported STIX type to official artwork or the bounded custom fallback", () => {
    const fallback = iconUrlFor("unsupported-custom-object");

    for (const objectType of stixObjectTypes) {
      const url = iconUrlFor(objectType);
      expect(url).toBeTruthy();
      if (objectType !== "extension-definition") {
        expect(url, objectType).not.toBe(fallback);
      }
    }
  });

  it("uses the domain-name artwork instead of the generic object icon", () => {
    expect(iconUrlFor("domain-name")).toContain("stix2_domain_name_icon_tiny_round_v1.png");
  });
});
