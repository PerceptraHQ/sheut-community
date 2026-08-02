import { describe, expect, it } from "vitest";

import { arrangeGraph, type LayoutRequest } from "./layout";

const request: LayoutRequest = {
  seed: 42,
  width: 900,
  height: 600,
  nodes: [
    { id: "indicator", x: -120, y: 30, pinned: false },
    { id: "malware", x: 20, y: 80, pinned: true },
    { id: "campaign", x: 160, y: -40, pinned: false },
  ],
  links: [
    { sourceId: "indicator", targetId: "malware" },
    { sourceId: "malware", targetId: "campaign" },
  ],
};

describe("arrangeGraph", () => {
  it("returns identical positions for identical input and seed", () => {
    expect(arrangeGraph(request)).toEqual(arrangeGraph(request));
  });

  it("never moves pinned nodes", () => {
    const result = arrangeGraph(request);

    expect(result.find((node) => node.id === "malware")).toEqual({
      id: "malware",
      x: 20,
      y: 80,
      pinned: true,
    });
  });

  it("does not mutate the caller's nodes or links", () => {
    const snapshot = structuredClone(request);

    arrangeGraph(request);

    expect(request).toEqual(snapshot);
  });
});
