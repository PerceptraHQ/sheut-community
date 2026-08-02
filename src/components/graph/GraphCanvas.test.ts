import { describe, expect, it } from "vitest";

import {
  calculateMinimapViewport,
  connectedComponentLayout,
  graphNeighborhood,
  layoutWorkspaceNodes,
  resolveInitialViewport,
  shouldPersistViewportEvent,
} from "./graph-canvas-model";

describe("resolveInitialViewport", () => {
  it("centers a default workspace viewport around its positioned nodes", () => {
    expect(
      resolveInitialViewport({ x: 0, y: 0, zoom: 1 }, [{ x: 0, y: 0 }], {
        width: 800,
        height: 600,
      }),
    ).toEqual({ x: 400, y: 300, zoom: 4.6 });
  });

  it("preserves a viewport that the user already positioned", () => {
    expect(
      resolveInitialViewport({ x: 120, y: 80, zoom: 1.5 }, [{ x: 0, y: 0 }], {
        width: 800,
        height: 600,
      }),
    ).toEqual({ x: 120, y: 80, zoom: 1.5 });
  });
});

describe("shouldPersistViewportEvent", () => {
  it("does not persist D3's programmatic initialization event", () => {
    expect(shouldPersistViewportEvent(null)).toBe(false);
  });

  it("persists real pointer and wheel zoom events", () => {
    expect(shouldPersistViewportEvent(new MouseEvent("mouseup"))).toBe(true);
    expect(shouldPersistViewportEvent(new WheelEvent("wheel"))).toBe(true);
  });
});

describe("calculateMinimapViewport", () => {
  it("maps the live D3 viewport into minimap coordinates", () => {
    expect(
      calculateMinimapViewport(
        { minX: -100, minY: -50, width: 400, height: 200 },
        { width: 800, height: 400 },
        { x: 0, y: 0, k: 4 },
        { width: 200, height: 100 },
      ),
    ).toEqual({ x: 50, y: 25, width: 100, height: 50 });
  });

  it("clamps a viewport larger than the graph world to the minimap bounds", () => {
    expect(
      calculateMinimapViewport(
        { minX: -50, minY: -50, width: 100, height: 100 },
        { width: 800, height: 600 },
        { x: 400, y: 300, k: 1 },
        { width: 200, height: 100 },
      ),
    ).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });
});

describe("graphNeighborhood", () => {
  it("separates inbound and outbound nodes around the focused node", () => {
    const neighborhood = graphNeighborhood(
      [
        {
          id: "inbound-edge",
          kind: "semantic",
          sourceId: "indicator",
          targetId: "malware",
          label: "indicates",
          canonicalLabel: "indicates",
          directed: true,
        },
        {
          id: "outbound-edge",
          kind: "reference",
          sourceId: "malware",
          targetId: "campaign",
          label: "object ref",
          canonicalLabel: "object_refs",
          directed: true,
        },
        {
          id: "unrelated-edge",
          kind: "visual",
          sourceId: "tool",
          targetId: "report",
          label: "",
          canonicalLabel: "visual",
          directed: true,
        },
      ],
      ["malware"],
    );

    expect(neighborhood.focusId).toBe("malware");
    expect([...neighborhood.inboundNodeIds]).toEqual(["indicator"]);
    expect([...neighborhood.outboundNodeIds]).toEqual(["campaign"]);
    expect([...neighborhood.connectedEdgeIds]).toEqual(["inbound-edge", "outbound-edge"]);
  });
});

describe("connectedComponentLayout", () => {
  it("packs disconnected STIX clusters separately without overlapping node centers", () => {
    const nodes = [
      positionedNode("alpha", "indicator"),
      positionedNode("bravo", "malware"),
      positionedNode("charlie", "tool"),
      positionedNode("delta", "campaign"),
      positionedNode("echo", "identity"),
      positionedNode("foxtrot", "report"),
    ];
    const edges = [
      graphEdge("alpha-bravo", "alpha", "bravo"),
      graphEdge("bravo-charlie", "bravo", "charlie"),
      graphEdge("delta-echo", "delta", "echo"),
    ];

    const layout = connectedComponentLayout(nodes, edges);

    expect(layout.map((node) => node.id).sort()).toEqual(nodes.map((node) => node.id).sort());
    for (let left = 0; left < layout.length; left += 1) {
      for (let right = left + 1; right < layout.length; right += 1) {
        const a = layout[left];
        const b = layout[right];
        expect(a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0).toBeGreaterThanOrEqual(120);
      }
    }
  });

  it("returns identical positions for identical graph data in any input order", () => {
    const nodes = [
      positionedNode("alpha", "indicator"),
      positionedNode("bravo", "malware"),
      positionedNode("charlie", "tool"),
    ];
    const edges = [
      graphEdge("alpha-bravo", "alpha", "bravo"),
      graphEdge("bravo-charlie", "bravo", "charlie"),
    ];

    const forward = connectedComponentLayout(nodes, edges);
    const reversed = connectedComponentLayout([...nodes].reverse(), [...edges].reverse());

    expect(positionRecord(reversed)).toEqual(positionRecord(forward));
  });

  it("does not let reference-edge visibility change the component layout", () => {
    const nodes = [positionedNode("report", "report"), positionedNode("malware", "malware")];
    const semanticOnly = connectedComponentLayout(nodes, []);
    const withReference = connectedComponentLayout(nodes, [
      { ...graphEdge("report-ref", "report", "malware"), kind: "reference" },
    ]);

    expect(positionRecord(withReference)).toEqual(positionRecord(semanticOnly));
  });

  it("clusters unpinned nodes while preserving manually positioned nodes in every mode", () => {
    const nodes = [positionedNode("alpha", "indicator"), positionedNode("bravo", "malware")];
    const edges = [graphEdge("alpha-bravo", "alpha", "bravo")];

    const layout = layoutWorkspaceNodes(nodes, edges, {
      alpha: { x: 480, y: 320, pinned: true },
      bravo: { x: 10, y: 10, pinned: false },
    });

    expect(layout.find((node) => node.id === "alpha")).toMatchObject({ x: 480, y: 320 });
    expect(layout.find((node) => node.id === "bravo")).not.toMatchObject({ x: 10, y: 10 });
  });

  it("lays out a 1,000-node workspace without dropping or corrupting nodes", () => {
    const nodes = Array.from({ length: 1_000 }, (_, index) =>
      positionedNode(`node-${index.toString().padStart(4, "0")}`, "indicator"),
    );
    const edges = nodes
      .slice(1)
      .map((node, index) => graphEdge(`edge-${index}`, nodes[index]?.id ?? "", node.id));

    const layout = connectedComponentLayout(nodes, edges);

    expect(layout).toHaveLength(1_000);
    expect(new Set(layout.map((node) => node.id)).size).toBe(1_000);
    expect(layout.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  });
});

function positionedNode(id: string, objectType: string) {
  return {
    id,
    x: 0,
    y: 0,
    node: {
      id,
      itemKind: "intelligence" as const,
      objectType,
      displayName: id,
      available: true,
      sourceView: "intelligence",
      stixId: null,
    },
  };
}

function graphEdge(id: string, sourceId: string, targetId: string) {
  return {
    id,
    kind: "semantic" as const,
    sourceId,
    targetId,
    label: "related to",
    canonicalLabel: "related-to",
    directed: true,
  };
}

function positionRecord(nodes: Array<{ id: string; x: number; y: number }>) {
  return Object.fromEntries(
    [...nodes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => [node.id, { x: node.x, y: node.y }]),
  );
}
