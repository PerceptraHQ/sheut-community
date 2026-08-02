import { describe, expect, it } from "vitest";

import { propertyEntries } from "./GraphItemInspector";

describe("propertyEntries", () => {
  it("renders nested kill-chain phases as readable text", () => {
    expect(
      propertyEntries({
        kill_chain_phases: [
          {
            kill_chain_name: "mandiant-attack-lifecycle-model",
            phase_name: "initial-compromise",
          },
          {
            kill_chain_name: "mitre-attack",
            phase_name: "command-and-control",
          },
        ],
      }),
    ).toEqual([
      [
        "kill_chain_phases",
        "mandiant attack lifecycle model — initial compromise · mitre attack — command and control",
      ],
    ]);
  });

  it("never falls back to object coercion for nested STIX properties", () => {
    const entries = propertyEntries({ external_references: [{ source_name: "example" }] });

    expect(entries[0]?.[1]).toBe("source name: example");
    expect(entries[0]?.[1]).not.toContain("[object Object]");
  });
});
