import type { GraphNodeSummary } from "../../lib/graph";

export interface TimelinePoint {
  timestamp: number;
  cumulative: number;
  exact: number;
}

export function cumulativeTimeline(nodes: GraphNodeSummary[]): TimelinePoint[] {
  const datedNodes = nodes
    .map((node) => ({ node, dates: timelineDates(node) }))
    .filter((entry) => entry.dates.length > 0);
  const timestamps = [...new Set(datedNodes.flatMap((entry) => entry.dates))].sort(
    (left, right) => left - right,
  );
  return timestamps.map((timestamp) => ({
    timestamp,
    cumulative: datedNodes.filter(
      (entry) => (entry.dates[0] ?? Number.POSITIVE_INFINITY) <= timestamp,
    ).length,
    exact: datedNodes.filter((entry) => entry.dates.includes(timestamp)).length,
  }));
}

export function nodeVisibleAtTimeline(
  node: GraphNodeSummary,
  cutoff: number | null,
  cumulative: boolean,
) {
  if (cutoff === null) return true;
  const dates = timelineDates(node);
  if (dates.length === 0) return true;
  return cumulative ? (dates[0] ?? Number.POSITIVE_INFINITY) <= cutoff : dates.includes(cutoff);
}

export function timelineDates(node: GraphNodeSummary): number[] {
  return [
    ...new Set(
      (node.timelineDates ?? []).map((value) => Date.parse(value)).filter(Number.isFinite),
    ),
  ].sort((left, right) => left - right);
}
