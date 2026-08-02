import { Toggle } from "@base-ui/react/toggle";

import type { GraphNodeSummary } from "../../lib/graph";
import { graphLegendEntries } from "./graph-legend-model";
import { iconUrlFor, readableType } from "./stix-icon-urls";

interface GraphLegendProps {
  nodes: GraphNodeSummary[];
  hiddenTypes: Set<string>;
  onToggle: (objectType: string) => void;
}

export function GraphLegend({ nodes, hiddenTypes, onToggle }: GraphLegendProps) {
  const entries = graphLegendEntries(nodes);
  if (entries.length === 0) return null;
  return (
    <aside
      className="absolute bottom-3 left-3 z-10 max-h-52 w-52 overflow-y-auto rounded-sm border border-panel-border bg-panel-deep/95 p-2 shadow-xl backdrop-blur-sm"
      aria-label="STIX object type legend"
    >
      <h3 className="m-0 px-1 pb-1.5 text-[10px] font-bold text-copy-secondary uppercase tracking-wider">
        Object types
      </h3>
      <div className="grid grid-cols-1 gap-0.5">
        {entries.map(({ objectType, count }) => {
          const visible = !hiddenTypes.has(objectType);
          const label = readableType(objectType);
          return (
            <Toggle
              key={objectType}
              pressed={visible}
              onPressedChange={() => onToggle(objectType)}
              aria-label={`${visible ? "Hide" : "Show"} ${label} nodes`}
              className="flex min-w-0 items-center gap-2 rounded-sm border-0 bg-transparent px-1.5 py-1 text-left text-copy-secondary opacity-45 hover:bg-panel-hover data-pressed:opacity-100 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <img className="size-5 shrink-0" src={iconUrlFor(objectType)} alt="" />
              <span className="min-w-0 flex-1 truncate text-[11px] capitalize">{label}</span>
              <span className="font-mono text-[10px] text-copy-faint">{count}</span>
            </Toggle>
          );
        })}
      </div>
    </aside>
  );
}
