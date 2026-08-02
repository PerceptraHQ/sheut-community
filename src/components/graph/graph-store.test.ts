import { describe, expect, it } from "vitest";

import type { GraphWorkspaceView } from "../../lib/graph";
import { createGraphStore, GraphMutationQueue } from "./graph-store";

const view: GraphWorkspaceView = {
  workspace: {
    schema_version: 1,
    id: "workspace",
    name: "Test graph",
    revision: 1,
    mode: "build",
    viewport: { x: 0, y: 0, zoom: 1 },
    created_at_unix_ms: 1,
    updated_at_unix_ms: 1,
    deleted_at_unix_ms: null,
  },
  items: [
    {
      workspace_id: "workspace",
      item_id: "one",
      item_kind: "intelligence",
      position: { x: 10, y: 20 },
      pinned: false,
    },
    {
      workspace_id: "workspace",
      item_id: "two",
      item_kind: "document",
      position: { x: 50, y: 60 },
      pinned: true,
    },
  ],
  nodes: [],
  edges: [],
};

describe("graph store", () => {
  it("keeps drag movement local and exposes only the final pointer-up positions", () => {
    const store = createGraphStore(view);

    expect(store.getState().beginMove(["one", "two"])).toBe(true);
    store.getState().moveBy(25, -10);
    store.getState().moveBy(30, 5);

    expect(store.getState().finishMove()).toEqual([
      { itemId: "one", itemKind: "intelligence", x: 40, y: 25, pinned: false },
      { itemId: "two", itemKind: "document", x: 80, y: 65, pinned: true },
    ]);
  });

  it("allows persisted node movement in view mode and supports undo and redo", () => {
    const store = createGraphStore({
      ...view,
      workspace: { ...view.workspace, mode: "view" },
    });

    expect(store.getState().beginMove(["one"], { one: { x: 100, y: 120 } })).toBe(true);
    store.getState().moveBy(15, 0);
    expect(store.getState().finishMove()).toEqual([
      { itemId: "one", itemKind: "intelligence", x: 115, y: 120, pinned: true },
    ]);
    expect(store.getState().positions.one.x).toBe(115);

    store.getState().undo();
    expect(store.getState().positions.one.x).toBe(10);
    expect(store.getState().positions.one.pinned).toBe(false);
    store.getState().redo();
    expect(store.getState().positions.one.x).toBe(115);
  });

  it("records auto-arranged positions in view mode", () => {
    const store = createGraphStore({
      ...view,
      workspace: { ...view.workspace, mode: "view" },
    });

    store
      .getState()
      .setPositions([{ itemId: "one", itemKind: "intelligence", x: 240, y: 180, pinned: false }]);

    expect(store.getState().positions.one.x).toBe(240);
    expect(store.getState().undoCount).toBe(1);
  });
});

describe("GraphMutationQueue", () => {
  it("runs mutations one at a time in enqueue order even after a rejection", async () => {
    const queue = new GraphMutationQueue();
    const events: string[] = [];
    const first = queue.enqueue(async () => {
      events.push("first:start");
      await Promise.resolve();
      events.push("first:end");
      throw new Error("conflict");
    });
    const second = queue.enqueue(() => {
      events.push("second");
      return Promise.resolve(2);
    });

    await expect(first).rejects.toThrow("conflict");
    await expect(second).resolves.toBe(2);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });
});
