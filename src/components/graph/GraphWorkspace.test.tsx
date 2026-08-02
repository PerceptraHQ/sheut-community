import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphWorkspaceView } from "../../lib/graph";
import { VaultNoticeProvider } from "../VaultNotices";
import { GraphWorkspace } from "./GraphWorkspace";

const graphApi = vi.hoisted(() => ({
  addGraphWorkspaceItems: vi.fn(),
  createGraphWorkspace: vi.fn(),
  listGraphSourceItems: vi.fn(),
  listGraphWorkspaces: vi.fn(),
  loadGraphItemProperties: vi.fn(),
  loadGraphWorkspace: vi.fn(),
  removeGraphWorkspaceItems: vi.fn(),
  saveGraphWorkspaceState: vi.fn(),
}));

vi.mock("../../lib/graph", async () => {
  const actual = await vi.importActual<typeof import("../../lib/graph")>("../../lib/graph");
  return { ...actual, ...graphApi };
});

const view: GraphWorkspaceView = {
  workspace: {
    schema_version: 1,
    id: "workspace",
    name: "All intelligence",
    revision: 1,
    mode: "view",
    viewport: { x: 0, y: 0, zoom: 1 },
    created_at_unix_ms: 1,
    updated_at_unix_ms: 1,
    deleted_at_unix_ms: null,
  },
  items: [
    {
      workspace_id: "workspace",
      item_id: "indicator",
      item_kind: "intelligence",
      position: { x: 0, y: 0 },
      pinned: false,
    },
  ],
  nodes: [
    {
      id: "indicator",
      itemKind: "intelligence",
      objectType: "indicator",
      displayName: "Evil Bunny download indicator with a deliberately long name",
      available: true,
      sourceView: "intelligence",
      stixId: "indicator--example",
    },
  ],
  edges: [],
};

describe("GraphWorkspace", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    graphApi.listGraphWorkspaces.mockResolvedValue([]);
    graphApi.listGraphSourceItems.mockResolvedValue(view.nodes);
    graphApi.loadGraphItemProperties.mockResolvedValue({
      node: view.nodes[0],
      properties: { type: "indicator" },
      inbound: [],
      outbound: [],
    });
    graphApi.createGraphWorkspace.mockResolvedValue(view);
    graphApi.addGraphWorkspaceItems.mockResolvedValue({ ...view.workspace, revision: 2 });
    graphApi.loadGraphWorkspace.mockResolvedValue(view);
    graphApi.removeGraphWorkspaceItems.mockResolvedValue({ ...view.workspace, revision: 2 });
    graphApi.saveGraphWorkspaceState.mockResolvedValue(view.workspace);
  });

  it("uses a progress state while graph workspaces load", async () => {
    graphApi.listGraphWorkspaces.mockReturnValue(new Promise(() => undefined));

    render(
      <VaultNoticeProvider>
        <GraphWorkspace projectId="project" />
      </VaultNoticeProvider>,
    );

    expect(
      await screen.findByRole("progressbar", { name: "Loading graph workspaces" }),
    ).toBeVisible();
  });

  it("offers blank, all-intelligence, and selected-item workspace creation", async () => {
    graphApi.listGraphWorkspaces.mockResolvedValueOnce([]).mockResolvedValueOnce([view.workspace]);
    const user = userEvent.setup();
    render(
      <VaultNoticeProvider>
        <GraphWorkspace projectId="project" />
      </VaultNoticeProvider>,
    );

    expect(await screen.findByRole("button", { name: "Blank workspace" })).toBeVisible();
    expect(screen.getByRole("button", { name: "All intelligence" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Selected items" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "All intelligence" }));

    await waitFor(() =>
      expect(graphApi.createGraphWorkspace).toHaveBeenCalledWith(
        "project",
        "All intelligence",
        "view",
        [
          expect.objectContaining({
            itemId: "indicator",
            itemKind: "intelligence",
            pinned: false,
          }),
        ],
      ),
    );
    expect(await screen.findByRole("tab", { name: "All intelligence" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("exposes full node names through the searchable keyboard navigator", async () => {
    graphApi.listGraphWorkspaces.mockResolvedValue([view.workspace]);
    const user = userEvent.setup();
    render(
      <VaultNoticeProvider>
        <GraphWorkspace projectId="project" />
      </VaultNoticeProvider>,
    );

    const search = await screen.findByRole("textbox", { name: "Search graph" });
    await user.type(search, "Evil Bunny");

    expect(
      screen.getByRole("button", {
        name: "Focus Evil Bunny download indicator with a deliberately long name",
      }),
    ).toBeVisible();
    expect(screen.getByText("1 result")).toBeVisible();
    expect(screen.getByRole("button", { name: "STIX reference edges" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("loads selected properties once when the parent selection callback changes identity", async () => {
    const user = userEvent.setup();

    function SelectionHarness() {
      const [selectedName, setSelectedName] = useState("none");
      return (
        <>
          <output>{selectedName}</output>
          <GraphWorkspace
            projectId="project"
            onSelectionChange={(properties) =>
              setSelectedName(properties?.node.displayName ?? "none")
            }
          />
        </>
      );
    }

    graphApi.listGraphWorkspaces.mockResolvedValue([view.workspace]);
    render(
      <VaultNoticeProvider>
        <SelectionHarness />
      </VaultNoticeProvider>,
    );

    await user.type(await screen.findByRole("textbox", { name: "Search graph" }), "Evil Bunny");
    await user.click(
      screen.getByRole("button", {
        name: "Focus Evil Bunny download indicator with a deliberately long name",
      }),
    );

    expect(
      await screen.findByText("Evil Bunny download indicator with a deliberately long name", {
        selector: "output",
      }),
    ).toBeVisible();
    await waitFor(() => expect(graphApi.loadGraphItemProperties).toHaveBeenCalledTimes(1));
  });

  it("offers current project intelligence instead of leaving an empty workspace black", async () => {
    const emptyView = {
      ...view,
      workspace: { ...view.workspace, name: "Blank workspace" },
      items: [],
      nodes: [],
    };
    graphApi.listGraphWorkspaces.mockResolvedValue([emptyView.workspace]);
    graphApi.loadGraphWorkspace.mockResolvedValue(emptyView);
    const user = userEvent.setup();

    render(
      <VaultNoticeProvider>
        <GraphWorkspace projectId="project" />
      </VaultNoticeProvider>,
    );

    expect(await screen.findByText("This workspace has no items yet")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Use current project intelligence" }));

    await waitFor(() =>
      expect(graphApi.addGraphWorkspaceItems).toHaveBeenCalledWith("project", "workspace", 1, [
        expect.objectContaining({ itemId: "indicator", itemKind: "intelligence" }),
      ]),
    );
  });

  it("synchronizes imported STIX only when the analyst explicitly refreshes", async () => {
    const imported = {
      ...view.nodes[0],
      id: "malware",
      objectType: "malware",
      displayName: "New malware",
      stixId: "malware--example",
    };
    graphApi.listGraphWorkspaces.mockResolvedValue([view.workspace]);
    graphApi.listGraphSourceItems.mockResolvedValue([...view.nodes, imported]);
    const user = userEvent.setup();

    render(
      <VaultNoticeProvider>
        <GraphWorkspace projectId="project" />
      </VaultNoticeProvider>,
    );

    expect(await screen.findByRole("textbox", { name: "Search graph" })).toBeVisible();
    expect(graphApi.listGraphSourceItems).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Refresh from current project intelligence" }),
    );
    await waitFor(() =>
      expect(graphApi.addGraphWorkspaceItems).toHaveBeenCalledWith("project", "workspace", 1, [
        expect.objectContaining({ itemId: "malware", itemKind: "intelligence" }),
      ]),
    );
  });

  it("removes a selected item in View mode without implicitly adding it back", async () => {
    graphApi.listGraphWorkspaces.mockResolvedValue([view.workspace]);
    const user = userEvent.setup();
    render(
      <VaultNoticeProvider>
        <GraphWorkspace projectId="project" />
      </VaultNoticeProvider>,
    );

    await user.type(await screen.findByRole("textbox", { name: "Search graph" }), "Evil Bunny");
    await user.click(
      screen.getByRole("button", {
        name: "Focus Evil Bunny download indicator with a deliberately long name",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Remove selected from workspace" }));

    await waitFor(() =>
      expect(graphApi.removeGraphWorkspaceItems).toHaveBeenCalledWith("project", "workspace", 1, [
        "indicator",
      ]),
    );
    expect(graphApi.listGraphSourceItems).not.toHaveBeenCalled();
  });

  it("offers graph workspace quick actions from a context menu", async () => {
    graphApi.listGraphWorkspaces.mockResolvedValue([view.workspace]);
    const user = userEvent.setup();
    render(
      <VaultNoticeProvider>
        <GraphWorkspace projectId="project" />
      </VaultNoticeProvider>,
    );

    const workspaceTab = await screen.findByRole("tab", { name: "All intelligence" });
    await user.pointer({ target: workspaceTab, keys: "[MouseRight]" });

    expect(await screen.findByRole("menuitem", { name: "Open workspace" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Manage graph workspaces" })).toBeVisible();
  });
});
