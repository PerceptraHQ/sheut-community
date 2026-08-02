import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { GraphNodeSummary } from "../../lib/graph";
import { GraphTimeline } from "./GraphTimeline";
import { cumulativeTimeline, nodeVisibleAtTimeline, timelineDates } from "./graph-timeline-model";

const nodes: GraphNodeSummary[] = [
  {
    id: "one",
    itemKind: "intelligence",
    objectType: "indicator",
    displayName: "One",
    available: true,
    sourceView: "intelligence",
    stixId: null,
    timelineDates: ["2020-01-01T00:00:00.000Z", "2020-01-03T00:00:00.000Z"],
  },
  {
    id: "two",
    itemKind: "intelligence",
    objectType: "malware",
    displayName: "Two",
    available: true,
    sourceView: "intelligence",
    stixId: null,
    timelineDates: ["2020-01-02T00:00:00.000Z"],
  },
  {
    id: "three",
    itemKind: "intelligence",
    objectType: "tool",
    displayName: "Three",
    available: true,
    sourceView: "intelligence",
    stixId: null,
    timelineDates: ["2020-01-02T00:00:00.000Z"],
  },
];

describe("GraphTimeline", () => {
  it("aggregates dated STIX objects cumulatively", () => {
    expect(cumulativeTimeline(nodes).map((point) => point.cumulative)).toEqual([1, 3, 3]);
    expect(cumulativeTimeline(nodes).map((point) => point.exact)).toEqual([1, 2, 1]);

    render(<TimelineHarness />);

    expect(screen.getByLabelText("Cumulative STIX timeline with 3 dated objects")).toBeVisible();
    expect(screen.getByText("3 dated objects")).toBeVisible();
    expect(screen.getAllByTestId("timeline-checkpoint")).toHaveLength(3);
    expect(screen.getByRole("slider", { name: "Timeline cutoff" })).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/1 STIX change.*3 dated objects cumulative/u),
    );
  });

  it("changes the active cumulative cutoff through the accessible slider", async () => {
    const user = userEvent.setup();
    render(<TimelineHarness />);

    const slider = screen.getByRole("slider", { name: "Timeline cutoff" });
    slider.focus();
    await user.keyboard("{Home}");

    expect(screen.getByText(/1 of 3 dated objects/u)).toBeVisible();
  });

  it("keeps undated objects visible and supports cumulative or exact-date filtering", () => {
    const cutoff = Date.parse("2020-01-01T00:00:00.000Z");
    expect(nodeVisibleAtTimeline(nodes[0], cutoff, true)).toBe(true);
    expect(nodeVisibleAtTimeline(nodes[1], cutoff, true)).toBe(false);
    expect(nodeVisibleAtTimeline({ ...nodes[2], timelineDates: undefined }, cutoff, true)).toBe(
      true,
    );
    expect(nodeVisibleAtTimeline(nodes[1], cutoff, false)).toBe(false);
  });

  it("uses every distinct valid STIX timestamp as a navigable timeline stop", () => {
    expect(timelineDates(nodes[0]).map((timestamp) => new Date(timestamp).toISOString())).toEqual([
      "2020-01-01T00:00:00.000Z",
      "2020-01-03T00:00:00.000Z",
    ]);
  });
});

function TimelineHarness() {
  const [cutoff, setCutoff] = useState<number | null>(null);
  const [cumulative, setCumulative] = useState(true);
  return (
    <GraphTimeline
      nodes={nodes}
      cutoff={cutoff}
      cumulative={cumulative}
      onCutoffChange={setCutoff}
      onCumulativeChange={setCumulative}
    />
  );
}
