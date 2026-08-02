import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { GraphNodeSummary } from "../../lib/graph";
import { GraphLegend } from "./GraphLegend";
import { graphLegendEntries } from "./graph-legend-model";

const nodes: GraphNodeSummary[] = [
  graphNode("indicator-one", "indicator"),
  graphNode("indicator-two", "indicator"),
  graphNode("malware-one", "malware"),
  graphNode("relationship-one", "relationship"),
];

describe("GraphLegend", () => {
  it("lists visible STIX object types and never presents relationship objects as nodes", () => {
    expect(graphLegendEntries(nodes)).toEqual([
      { objectType: "indicator", count: 2 },
      { objectType: "malware", count: 1 },
    ]);
  });

  it("toggles an object type through an accessible Base UI control", async () => {
    const onToggle = vi.fn();
    render(<GraphLegend nodes={nodes} hiddenTypes={new Set()} onToggle={onToggle} />);

    const indicator = screen.getByRole("button", { name: "Hide indicator nodes" });
    expect(indicator).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(indicator);

    expect(onToggle).toHaveBeenCalledWith("indicator");
    expect(screen.queryByText("relationship", { exact: false })).not.toBeInTheDocument();
  });
});

function graphNode(id: string, objectType: string): GraphNodeSummary {
  return {
    id,
    itemKind: "intelligence",
    objectType,
    displayName: id,
    available: true,
    sourceView: "intelligence",
    stixId: null,
  };
}
