import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitGraphRelationshipDraft,
  createGraphVisualLink,
  createGraphWorkspace,
  type GraphWorkspaceSeed,
  listGraphSourceItems,
  listGraphWorkspaces,
  loadGraphItemProperties,
  loadGraphWorkspace,
  previewGraphRelationshipDraft,
  removeGraphWorkspaceItems,
  saveGraphWorkspaceState,
} from "./graph";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const PROJECT_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const WORKSPACE_ID = "4f3d8e34-7c64-4d41-8b68-d7a334e1a884";
const SOURCE_ID = "e7c44850-9f67-4d26-b7e3-0d4ee82339ef";
const TARGET_ID = "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb";

describe("graph command boundary", () => {
  beforeEach(() => vi.mocked(invoke).mockReset().mockResolvedValue({}));

  it("keeps graph persistence behind bounded revision-checked commands", async () => {
    const item: GraphWorkspaceSeed = {
      itemId: SOURCE_ID,
      itemKind: "intelligence",
      x: 20,
      y: 40,
      pinned: false,
    };

    await listGraphWorkspaces(PROJECT_ID);
    await listGraphSourceItems(PROJECT_ID);
    await createGraphWorkspace(PROJECT_ID, "All intelligence", "view", [item]);
    await loadGraphWorkspace(PROJECT_ID, WORKSPACE_ID);
    await saveGraphWorkspaceState(PROJECT_ID, WORKSPACE_ID, 2, "build", {
      viewport: { x: 4, y: 8, zoom: 1.25 },
      positions: [{ ...item, pinned: true }],
    });
    await createGraphVisualLink(PROJECT_ID, WORKSPACE_ID, 3, SOURCE_ID, TARGET_ID, "supports");
    await removeGraphWorkspaceItems(PROJECT_ID, WORKSPACE_ID, 4, [SOURCE_ID]);
    await loadGraphItemProperties(PROJECT_ID, WORKSPACE_ID, TARGET_ID);
    await previewGraphRelationshipDraft(PROJECT_ID, WORKSPACE_ID, TARGET_ID);
    await commitGraphRelationshipDraft(PROJECT_ID, WORKSPACE_ID, TARGET_ID, "indicates", {
      description: "Validated analyst assertion",
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "list_graph_workspaces", {
      projectId: PROJECT_ID,
      includeDeleted: false,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "list_graph_source_items", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "create_graph_workspace", {
      projectId: PROJECT_ID,
      name: "All intelligence",
      mode: "view",
      items: [item],
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "save_graph_workspace_state", {
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      update: {
        expectedRevision: 2,
        mode: "build",
        viewport: { x: 4, y: 8, zoom: 1.25 },
        positions: [{ ...item, pinned: true }],
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "create_graph_visual_link", {
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      expectedRevision: 3,
      sourceId: SOURCE_ID,
      targetId: TARGET_ID,
      label: "supports",
    });
    expect(invoke).toHaveBeenNthCalledWith(9, "preview_graph_relationship_draft", {
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      linkId: TARGET_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(10, "commit_graph_relationship_draft", {
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      linkId: TARGET_ID,
      relationshipType: "indicates",
      properties: { description: "Validated analyst assertion" },
    });
  });
});
