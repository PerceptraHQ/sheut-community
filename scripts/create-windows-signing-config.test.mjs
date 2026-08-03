import { describe, expect, it } from "vitest";

import { buildWindowsSigningConfig } from "./create-windows-signing-config.mjs";

describe("Windows release signing config", () => {
  it("builds Tauri's custom signing command from reviewed Azure identifiers", () => {
    expect(
      buildWindowsSigningConfig({
        endpoint: "https://wus2.codesigning.azure.net",
        account: "perceptra-signing",
        profile: "sheut-public-trust",
      }),
    ).toEqual({
      bundle: {
        windows: {
          signCommand:
            "artifact-signing-cli -e https://wus2.codesigning.azure.net -a perceptra-signing -c sheut-public-trust -d Sheut %1",
        },
      },
    });
  });

  it.each([
    {
      endpoint: "https://attacker.invalid",
      account: "perceptra-signing",
      profile: "sheut-public-trust",
    },
    {
      endpoint: "https://wus2.codesigning.azure.net",
      account: "perceptra-signing & whoami",
      profile: "sheut-public-trust",
    },
    {
      endpoint: "https://wus2.codesigning.azure.net",
      account: "perceptra-signing",
      profile: "",
    },
  ])("rejects values that could alter the signing command", (input) => {
    expect(() => buildWindowsSigningConfig(input)).toThrow(/Azure Artifact Signing/u);
  });
});
