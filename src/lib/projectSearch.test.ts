import { describe, expect, it } from "vitest";
import type { DocumentEnvelope } from "./documents";
import type { GraphWorkspace } from "./graph";
import { buildProjectSearchResults } from "./projectSearch";
import type { StixDraftSummary, StixObjectSummary } from "./stix";

const document: DocumentEnvelope = {
  schema_version: 1,
  id: "document-1",
  kind: "investigation",
  revision: 3,
  root: {
    type: "doc",
    content: [
      {
        type: "heading",
        content: [{ type: "text", text: "Operation Lantern" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Persistence clue in scheduled tasks" }],
      },
    ],
  },
};

describe("buildProjectSearchResults", () => {
  it("indexes document content, intelligence names, drafts, and graph workspaces", () => {
    const objects: StixObjectSummary[] = [
      {
        localId: "object-1",
        stixId: "malware--one",
        objectType: "malware",
        displayName: "Night Jackal",
        modified: null,
      },
    ];
    const drafts: StixDraftSummary[] = [
      {
        localId: "draft-1",
        objectType: "indicator",
        properties: { name: "Beacon domain", pattern: "[domain-name:value = 'example.test']" },
      },
    ];
    const workspaces: GraphWorkspace[] = [
      {
        schema_version: 1,
        id: "workspace-1",
        name: "APT1 overview",
        revision: 1,
        mode: "view",
        viewport: { x: 0, y: 0, zoom: 1 },
        created_at_unix_ms: 1,
        updated_at_unix_ms: 1,
        deleted_at_unix_ms: null,
      },
    ];

    const results = buildProjectSearchResults({
      documents: [document],
      objects,
      drafts,
      workspaces,
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "document:document-1", label: "Operation Lantern" }),
        expect.objectContaining({ id: "intelligence:object-1", label: "Night Jackal" }),
        expect.objectContaining({ id: "draft:draft-1", label: "Beacon domain" }),
        expect.objectContaining({ id: "graph:workspace-1", label: "APT1 overview" }),
      ]),
    );
    expect(
      results.find((result) => result.id === "document:document-1")?.keywords.join(" "),
    ).toContain("Persistence clue in scheduled tasks");
  });

  it("bounds indexed free text", () => {
    const longDocument: DocumentEnvelope = {
      ...document,
      id: "document-long",
      root: { type: "doc", content: [{ type: "text", text: "x".repeat(20_000) }] },
    };

    const [result] = buildProjectSearchResults({
      documents: [longDocument],
      objects: [],
      drafts: [],
      workspaces: [],
    });

    expect(result?.keywords.join(" ").length).toBeLessThanOrEqual(12_500);
  });

  it("uses canonical product labels for every document kind", () => {
    const results = buildProjectSearchResults({
      documents: [
        { ...document, id: "note", kind: "analyst_note" },
        {
          ...document,
          id: "report",
          kind: "report",
          reportProperties: {
            reportId: "RPT-0001",
            title: "Assessment",
            authors: [],
            issueDate: "2026-08-03",
          },
        },
      ],
      objects: [],
      drafts: [],
      workspaces: [],
    });

    expect(results.map((result) => result.description)).toEqual([
      "Analyst Note · revision 3",
      "Report · revision 3",
    ]);
  });
});
