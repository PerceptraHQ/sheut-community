import { describe, expect, it } from "vitest";
import { stixObjectTypes } from "./stix";
import {
  initialStixFieldValues,
  relationshipTypeSuggestions,
  stixObjectSchemas,
} from "./stixSchemas";

describe("STIX 2.1 authoring metadata", () => {
  it("covers every built-in STIX 2.1 object type exposed by Sheut", () => {
    expect(Object.keys(stixObjectSchemas).sort()).toEqual([...stixObjectTypes].sort());
  });

  it("includes required fields and Errata 01 corrections", () => {
    expect(stixObjectSchemas["autonomous-system"].fields.number?.required).toBe(true);
    expect(stixObjectSchemas.malware.fields.is_family?.required).toBe(true);
    expect(stixObjectSchemas.malware.fields.operating_system_refs).toBeDefined();
    expect(stixObjectSchemas["email-message"].fields.from_ref?.referenceTypes).toContain(
      "email-addr",
    );
    expect(stixObjectSchemas["email-message"].fields.sender_ref?.referenceTypes).toContain(
      "email-addr",
    );
    expect(stixObjectSchemas["email-message"].fields.is_multipart?.required).toBe(true);
  });

  it("matches the unconditional analyst-entered requirements for every built-in type", () => {
    const expectedRequiredFields = {
      "attack-pattern": ["name"],
      campaign: ["name"],
      "course-of-action": ["name"],
      grouping: ["context", "object_refs"],
      identity: ["name"],
      incident: ["name"],
      indicator: ["pattern", "pattern_type", "valid_from"],
      infrastructure: ["name"],
      "intrusion-set": ["name"],
      location: [],
      malware: ["is_family"],
      "malware-analysis": ["product"],
      note: ["content", "object_refs"],
      "observed-data": ["first_observed", "last_observed", "number_observed"],
      opinion: ["object_refs", "opinion"],
      report: ["name", "object_refs", "published"],
      "threat-actor": ["name"],
      tool: ["name"],
      vulnerability: ["name"],
      artifact: [],
      "autonomous-system": ["number"],
      directory: ["path"],
      "domain-name": ["value"],
      "email-addr": ["value"],
      "email-message": ["is_multipart"],
      file: [],
      "ipv4-addr": ["value"],
      "ipv6-addr": ["value"],
      "mac-addr": ["value"],
      mutex: ["name"],
      "network-traffic": ["protocols"],
      process: [],
      software: ["name"],
      url: ["value"],
      "user-account": [],
      "windows-registry-key": [],
      "x509-certificate": [],
      relationship: [],
      sighting: ["sighting_of_ref"],
      "marking-definition": [],
      "language-content": ["contents", "object_ref"],
      "extension-definition": ["extension_types", "name", "schema", "version"],
    } satisfies Record<(typeof stixObjectTypes)[number], readonly string[]>;

    const actual = Object.fromEntries(
      stixObjectTypes.map((objectType) => [
        objectType,
        Object.entries(stixObjectSchemas[objectType].fields)
          .filter(([, definition]) => definition.required && !definition.managed)
          .map(([name]) => name)
          .sort(),
      ]),
    );
    const expected = Object.fromEntries(
      Object.entries(expectedRequiredFields).map(([objectType, fields]) => [
        objectType,
        [...fields].sort(),
      ]),
    );

    expect(actual).toEqual(expected);
  });

  it("exposes the complete STIX 2.1 meta-object and legacy observable fields", () => {
    expect(stixObjectSchemas["observed-data"].fields.objects?.kind).toBe("json");
    expect(stixObjectSchemas["language-content"].fields.created?.managed).toBe(true);
    expect(stixObjectSchemas["language-content"].fields.modified?.managed).toBe(true);
    expect(stixObjectSchemas["language-content"].fields.created_by_ref).toBeDefined();
    expect(stixObjectSchemas["marking-definition"].fields.name).toBeDefined();
    expect(stixObjectSchemas["marking-definition"].fields.created_by_ref).toBeDefined();
    expect(stixObjectSchemas["marking-definition"].fields.definition_type?.required).not.toBe(true);
    expect(stixObjectSchemas["marking-definition"].fields.definition?.required).not.toBe(true);
  });

  it("carries the Errata 01 vocabulary additions used by guided fields", () => {
    expect(stixObjectSchemas.malware.fields.implementation_languages?.options).toContain("rust");
    expect(stixObjectSchemas.identity.fields.sectors?.options).toContain("legal");
    expect(stixObjectSchemas.infrastructure.fields.infrastructure_types?.options).toEqual(
      expect.arrayContaining(["control-system", "firewall", "routers-switches", "workstation"]),
    );
    expect(stixObjectSchemas.report.fields.report_types?.options).toContain("incident");
    expect(stixObjectSchemas["threat-actor"].fields.threat_actor_types?.options).toContain(
      "private-sector",
    );
  });

  it("suggests the STIX 2.1 relationships defined for each endpoint pair", () => {
    expect(relationshipTypeSuggestions("malware-analysis", "malware")).toEqual(
      expect.arrayContaining([
        "analysis-of",
        "characterizes",
        "dynamic-analysis-of",
        "static-analysis-of",
      ]),
    );
    expect(relationshipTypeSuggestions("course-of-action", "malware")).toContain("mitigates");
    expect(relationshipTypeSuggestions("course-of-action", "malware")).not.toContain("remediates");
    expect(relationshipTypeSuggestions("tool", "infrastructure")).toContain("targets");
    expect(relationshipTypeSuggestions("tool", "infrastructure")).not.toContain("uses");
    expect(relationshipTypeSuggestions("domain-name", "ipv4-addr")).toContain("resolves-to");
    expect(relationshipTypeSuggestions("ipv4-addr", "autonomous-system")).toContain("belongs-to");
    expect(relationshipTypeSuggestions("indicator", "threat-actor")).toContain("indicates");
    expect(relationshipTypeSuggestions("infrastructure", "file")).toContain("consists-of");
  });

  it("only suggests same-type STIX relationship names for matching endpoint types", () => {
    expect(relationshipTypeSuggestions("malware", "malware")).toEqual(
      expect.arrayContaining(["derived-from", "duplicate-of", "related-to", "variant-of"]),
    );
    expect(relationshipTypeSuggestions("indicator", "threat-actor")).not.toEqual(
      expect.arrayContaining(["derived-from", "duplicate-of"]),
    );
    expect(relationshipTypeSuggestions("identity", "malware")).toEqual(["related-to"]);
  });

  it("generates required STIX timestamps as draft metadata instead of asking for IDs", () => {
    const now = "2026-07-30T10:00:00.000Z";
    expect(initialStixFieldValues("indicator", now)).toEqual(
      expect.objectContaining({
        created: now,
        modified: now,
        pattern_type: "stix",
        valid_from: now,
      }),
    );
    expect(initialStixFieldValues("domain-name", now)).not.toHaveProperty("created");
    expect(initialStixFieldValues("email-message", now)).toEqual({ is_multipart: false });
    expect(initialStixFieldValues("relationship", now)).not.toHaveProperty("source_ref");
    expect(initialStixFieldValues("relationship", now)).not.toHaveProperty("target_ref");
  });
});
