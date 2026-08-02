import type { GraphNodeSummary } from "../../lib/graph";

export function graphLegendEntries(nodes: GraphNodeSummary[]) {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.objectType === "relationship" || node.objectType === "sighting") continue;
    counts.set(node.objectType, (counts.get(node.objectType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([objectType, count]) => ({ objectType, count }));
}
