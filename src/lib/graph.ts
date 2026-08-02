/** Graph workspace facade; visual links do not silently become STIX relationships. */
import { invoke } from "@tauri-apps/api/core";
import type { StixDraftSummary } from "./stix";

export type GraphWorkspaceMode = "view" | "build";
export type GraphItemKind = "intelligence" | "document" | "catalog_reference" | "evidence";
export type GraphEdgeKind = "semantic" | "reference" | "visual" | "draft";

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphWorkspace {
  schema_version: 1;
  id: string;
  name: string;
  revision: number;
  mode: GraphWorkspaceMode;
  viewport: GraphViewport;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  deleted_at_unix_ms: number | null;
}

export interface GraphWorkspaceItem {
  workspace_id: string;
  item_id: string;
  item_kind: GraphItemKind;
  position: { x: number; y: number };
  pinned: boolean;
}

export interface GraphWorkspaceSeed {
  itemId: string;
  itemKind: GraphItemKind;
  x: number;
  y: number;
  pinned: boolean;
}

export interface GraphNodeSummary {
  id: string;
  itemKind: GraphItemKind;
  objectType: string;
  displayName: string;
  available: boolean;
  sourceView: string;
  stixId: string | null;
  timelineDates?: string[];
}

export interface GraphEdgeSummary {
  id: string;
  kind: GraphEdgeKind;
  sourceId: string;
  targetId: string;
  label: string;
  canonicalLabel: string;
  directed: boolean;
}

export interface GraphWorkspaceView {
  workspace: GraphWorkspace;
  items: GraphWorkspaceItem[];
  nodes: GraphNodeSummary[];
  edges: GraphEdgeSummary[];
}

export interface GraphItemProperties {
  node: GraphNodeSummary;
  properties: unknown;
  inbound: GraphEdgeSummary[];
  outbound: GraphEdgeSummary[];
}

export interface GraphRelationshipDraftPreview {
  visualLinkId: string;
  sourceId: string;
  targetId: string;
  sourceObjectType: string;
  targetObjectType: string;
  visualLabel: string | null;
}

export function listGraphWorkspaces(projectId: string, includeDeleted = false) {
  return invoke<GraphWorkspace[]>("list_graph_workspaces", { projectId, includeDeleted });
}

export function listGraphSourceItems(projectId: string) {
  return invoke<GraphNodeSummary[]>("list_graph_source_items", { projectId });
}

export function createGraphWorkspace(
  projectId: string,
  name: string,
  mode: GraphWorkspaceMode,
  items: GraphWorkspaceSeed[],
) {
  return invoke<GraphWorkspaceView>("create_graph_workspace", { projectId, name, mode, items });
}

export function loadGraphWorkspace(projectId: string, workspaceId: string) {
  return invoke<GraphWorkspaceView>("load_graph_workspace", { projectId, workspaceId });
}

export function renameGraphWorkspace(
  projectId: string,
  workspaceId: string,
  expectedRevision: number,
  name: string,
) {
  return invoke<GraphWorkspace>("rename_graph_workspace", {
    projectId,
    workspaceId,
    expectedRevision,
    name,
  });
}

export function deleteGraphWorkspace(
  projectId: string,
  workspaceId: string,
  expectedRevision: number,
) {
  return invoke<GraphWorkspace>("delete_graph_workspace", {
    projectId,
    workspaceId,
    expectedRevision,
  });
}

export function restoreGraphWorkspace(
  projectId: string,
  workspaceId: string,
  expectedRevision: number,
) {
  return invoke<GraphWorkspace>("restore_graph_workspace", {
    projectId,
    workspaceId,
    expectedRevision,
  });
}

export function addGraphWorkspaceItems(
  projectId: string,
  workspaceId: string,
  expectedRevision: number,
  items: GraphWorkspaceSeed[],
) {
  return invoke<GraphWorkspace>("add_graph_workspace_items", {
    projectId,
    workspaceId,
    expectedRevision,
    items,
  });
}

export function removeGraphWorkspaceItems(
  projectId: string,
  workspaceId: string,
  expectedRevision: number,
  itemIds: string[],
) {
  return invoke<GraphWorkspace>("remove_graph_workspace_items", {
    projectId,
    workspaceId,
    expectedRevision,
    itemIds,
  });
}

export function saveGraphWorkspaceState(
  projectId: string,
  workspaceId: string,
  expectedRevision: number,
  mode: GraphWorkspaceMode,
  state: { viewport: GraphViewport; positions: GraphWorkspaceSeed[] },
) {
  return invoke<GraphWorkspace>("save_graph_workspace_state", {
    projectId,
    workspaceId,
    update: {
      expectedRevision,
      mode,
      viewport: state.viewport,
      positions: state.positions,
    },
  });
}

export function createGraphVisualLink(
  projectId: string,
  workspaceId: string,
  expectedRevision: number,
  sourceId: string,
  targetId: string,
  label: string | null,
) {
  return invoke<GraphWorkspace>("create_graph_visual_link", {
    projectId,
    workspaceId,
    expectedRevision,
    sourceId,
    targetId,
    label,
  });
}

export function updateGraphVisualLink(
  projectId: string,
  workspaceId: string,
  expectedRevision: number,
  link: { id: string; sourceId: string; targetId: string; label: string | null },
) {
  return invoke<GraphWorkspace>("update_graph_visual_link", {
    projectId,
    workspaceId,
    expectedRevision,
    linkId: link.id,
    sourceId: link.sourceId,
    targetId: link.targetId,
    label: link.label,
  });
}

export function deleteGraphVisualLink(
  projectId: string,
  workspaceId: string,
  expectedRevision: number,
  linkId: string,
) {
  return invoke<GraphWorkspace>("delete_graph_visual_link", {
    projectId,
    workspaceId,
    expectedRevision,
    linkId,
  });
}

export function loadGraphItemProperties(projectId: string, workspaceId: string, itemId: string) {
  return invoke<GraphItemProperties>("load_graph_item_properties", {
    projectId,
    workspaceId,
    itemId,
  });
}

export function previewGraphRelationshipDraft(
  projectId: string,
  workspaceId: string,
  linkId: string,
) {
  return invoke<GraphRelationshipDraftPreview>("preview_graph_relationship_draft", {
    projectId,
    workspaceId,
    linkId,
  });
}

export function commitGraphRelationshipDraft(
  projectId: string,
  workspaceId: string,
  linkId: string,
  relationshipType: string,
  properties: Record<string, unknown>,
) {
  return invoke<StixDraftSummary>("commit_graph_relationship_draft", {
    projectId,
    workspaceId,
    linkId,
    relationshipType,
    properties,
  });
}

export function graphErrorMessage(cause: unknown): string {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
  if (code === "revision_conflict")
    return "This graph changed elsewhere. Reloading the latest revision.";
  if (code === "graph_workspace_not_found") return "This graph workspace is no longer available.";
  if (code === "graph_item_unavailable") return "That project item is no longer available.";
  if (code === "project_locked") return "Unlock the project to use its graph workspaces.";
  return "Sheut could not complete that graph operation. Try again.";
}
