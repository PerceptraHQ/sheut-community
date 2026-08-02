import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compileStixCatalog, verifySource } from "./compile-mitre-catalog.mjs";

const fixture = {
  type: "bundle",
  objects: [
    {
      type: "x-mitre-matrix",
      id: "x-mitre-matrix--1",
      name: "Enterprise ATT&CK",
      tactic_refs: ["x-mitre-tactic--2", "x-mitre-tactic--1"],
    },
    {
      type: "x-mitre-tactic",
      id: "x-mitre-tactic--1",
      name: "Execution",
      description: "Run adversary-controlled code.",
      x_mitre_shortname: "execution",
      external_references: [{ source_name: "mitre-attack", external_id: "TA0002" }],
    },
    {
      type: "x-mitre-tactic",
      id: "x-mitre-tactic--2",
      name: "Reconnaissance",
      description: "Gather information for targeting.",
      x_mitre_shortname: "reconnaissance",
      external_references: [{ source_name: "mitre-attack", external_id: "TA0043" }],
    },
    {
      type: "attack-pattern",
      id: "attack-pattern--1",
      name: "PowerShell",
      description: "Use PowerShell.",
      kill_chain_phases: [{ kill_chain_name: "mitre-attack", phase_name: "execution" }],
      x_mitre_platforms: ["Windows"],
      external_references: [{ source_name: "mitre-attack", external_id: "T1059.001" }],
    },
    {
      type: "attack-pattern",
      id: "attack-pattern--2",
      name: "Command and Scripting Interpreter",
      description: "Use command interpreters.",
      kill_chain_phases: [{ kill_chain_name: "mitre-attack", phase_name: "execution" }],
      x_mitre_platforms: ["Linux", "Windows"],
      external_references: [{ source_name: "mitre-attack", external_id: "T1059" }],
    },
  ],
};

describe("MITRE catalog compiler", () => {
  it("compiles deterministic tactic and technique records", () => {
    const catalog = compileStixCatalog(fixture, {
      catalog: "attack_enterprise",
      version: "19.1",
      sourceUrl: "https://example.invalid/enterprise.json",
      sha256: "a".repeat(64),
    });

    expect(catalog.schemaVersion).toBe(2);
    expect(catalog.tactics).toEqual([
      {
        id: "TA0043",
        name: "Reconnaissance",
        shortName: "reconnaissance",
        description: "Gather information for targeting.",
      },
      {
        id: "TA0002",
        name: "Execution",
        shortName: "execution",
        description: "Run adversary-controlled code.",
      },
    ]);
    expect(catalog.techniques).toEqual([
      {
        id: "T1059",
        name: "Command and Scripting Interpreter",
        description: "Use command interpreters.",
        tacticIds: ["TA0002"],
        platforms: ["Linux", "Windows"],
        parentId: null,
      },
      {
        id: "T1059.001",
        name: "PowerShell",
        description: "Use PowerShell.",
        tacticIds: ["TA0002"],
        platforms: ["Windows"],
        parentId: "T1059",
      },
    ]);
  });

  it("rejects source bytes whose digest does not match the pinned manifest", () => {
    const source = Buffer.from(JSON.stringify(fixture));
    const actual = createHash("sha256").update(source).digest("hex");

    expect(() => verifySource(source, "0".repeat(64))).toThrow(/digest/u);
    expect(verifySource(source, actual)).toBe(actual);
  });

  it("rejects duplicate catalog identifiers", () => {
    expect(() =>
      compileStixCatalog(
        { ...fixture, objects: [...fixture.objects, fixture.objects[3]] },
        {
          catalog: "attack_enterprise",
          version: "19.1",
          sourceUrl: "https://example.invalid/enterprise.json",
          sha256: "a".repeat(64),
        },
      ),
    ).toThrow(/duplicate technique/iu);
  });
});
