import {
  type DocumentEnvelope,
  type DocumentJsonNode,
  documentKindLabel,
  documentTitle,
} from "./documents";
import type { GraphWorkspace } from "./graph";
import type { StixDraftSummary, StixObjectSummary } from "./stix";

const MAX_DOCUMENT_SEARCH_CHARACTERS = 12_000;
const MAX_PROPERTY_SEARCH_CHARACTERS = 2_000;

export type SearchDestination =
  | "overview"
  | "investigations"
  | "intelligence"
  | "evidence"
  | "mitre"
  | "graph"
  | "settings";

export interface ProjectSearchResult {
  id: string;
  kind: "document" | "intelligence" | "draft" | "graph";
  label: string;
  description: string;
  keywords: string[];
  destination: SearchDestination;
  document?: DocumentEnvelope;
}

interface ProjectSearchSources {
  documents: DocumentEnvelope[];
  objects: StixObjectSummary[];
  drafts: StixDraftSummary[];
  workspaces: GraphWorkspace[];
}

export function buildProjectSearchResults({
  documents,
  objects,
  drafts,
  workspaces,
}: ProjectSearchSources): ProjectSearchResult[] {
  return [
    ...documents.map((document) => ({
      id: `document:${document.id}`,
      kind: "document" as const,
      label: documentTitle(document),
      description: `${documentKindLabel(document.kind)} · revision ${document.revision}`,
      keywords: [
        document.kind.replaceAll("_", " "),
        document.id,
        collectDocumentText(document.root),
      ],
      destination: "investigations" as const,
      document,
    })),
    ...objects.map((object) => ({
      id: `intelligence:${object.localId}`,
      kind: "intelligence" as const,
      label: object.displayName,
      description: `${readableType(object.objectType)} · validated STIX object`,
      keywords: [object.objectType, object.localId, object.stixId],
      destination: "intelligence" as const,
    })),
    ...drafts.map((draft) => ({
      id: `draft:${draft.localId}`,
      kind: "draft" as const,
      label: draftDisplayName(draft),
      description: `${readableType(draft.objectType)} · local draft`,
      keywords: [draft.objectType, draft.localId, ...collectPropertyStrings(draft.properties)],
      destination: "intelligence" as const,
    })),
    ...workspaces.map((workspace) => ({
      id: `graph:${workspace.id}`,
      kind: "graph" as const,
      label: workspace.name,
      description: `Graph workspace · ${workspace.mode} mode`,
      keywords: [workspace.id, workspace.mode, "visual investigation"],
      destination: "graph" as const,
    })),
  ];
}

function collectDocumentText(root: DocumentJsonNode): string {
  const chunks: string[] = [];
  let remaining = MAX_DOCUMENT_SEARCH_CHARACTERS;

  const visit = (node: DocumentJsonNode) => {
    if (remaining <= 0) return;
    if (typeof node.text === "string") {
      const text = node.text.trim();
      if (text) {
        const bounded = Array.from(text).slice(0, remaining).join("");
        chunks.push(bounded);
        remaining -= bounded.length;
      }
    }
    for (const child of node.content ?? []) visit(child);
  };

  visit(root);
  return chunks.join(" ").slice(0, MAX_DOCUMENT_SEARCH_CHARACTERS);
}

function collectPropertyStrings(properties: Record<string, unknown>): string[] {
  const strings: string[] = [];
  let remaining = MAX_PROPERTY_SEARCH_CHARACTERS;

  const visit = (value: unknown, depth: number) => {
    if (remaining <= 0 || depth > 4 || strings.length >= 32) return;
    if (typeof value === "string") {
      const bounded = value.slice(0, remaining).trim();
      if (bounded) {
        strings.push(bounded);
        remaining -= bounded.length;
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        visit(key, depth + 1);
        visit(child, depth + 1);
      }
    }
  };

  visit(properties, 0);
  return strings;
}

function draftDisplayName(draft: StixDraftSummary): string {
  for (const key of ["name", "title", "value"]) {
    const value = draft.properties[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
  }
  return `Untitled ${readableType(draft.objectType)} draft`;
}

function readableType(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ");
}
