import { Slider } from "@base-ui/react/slider";
import { Toggle } from "@base-ui/react/toggle";

import type { GraphNodeSummary } from "../../lib/graph";
import { cumulativeTimeline, type TimelinePoint } from "./graph-timeline-model";

interface GraphTimelineProps {
  nodes: GraphNodeSummary[];
  cutoff: number | null;
  cumulative: boolean;
  onCutoffChange: (cutoff: number | null) => void;
  onCumulativeChange: (cumulative: boolean) => void;
}

export function GraphTimeline({
  nodes,
  cutoff,
  cumulative,
  onCutoffChange,
  onCumulativeChange,
}: GraphTimelineProps) {
  const points = cumulativeTimeline(nodes);
  if (points.length === 0) return null;
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  const activeIndex = timelineIndex(points, cutoff);
  const active = points[activeIndex] ?? last;
  const maximum = last.cumulative;
  const visibleDatedCount = cumulative ? active.cumulative : active.exact;
  const width = 1_000;
  const height = 38;
  const coordinates = points.map((point, index) => ({
    x: points.length === 1 ? width / 2 : (index / (points.length - 1)) * width,
    y: height - (point.cumulative / maximum) * (height - 6),
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;

  return (
    <figure
      className="mt-2 mb-0 border-panel-border border-t bg-panel-deep px-3 py-2"
      aria-label={`Cumulative STIX timeline with ${maximum} dated objects`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <figcaption className="text-[10px] font-bold text-copy-secondary uppercase tracking-wider">
            Timeline
          </figcaption>
          <p className="m-0 mt-0.5 font-mono text-[10px] text-copy-faint">
            {visibleDatedCount} of {maximum} dated objects · {formatTimelineDate(active.timestamp)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] text-copy-faint">{maximum} dated objects</span>
          <Toggle
            pressed={cumulative}
            onPressedChange={onCumulativeChange}
            aria-label="Show timeline cumulatively"
            className="h-6 rounded-sm border border-panel-border bg-panel-base px-2 text-[10px] font-semibold text-copy-secondary data-pressed:border-accent data-pressed:bg-[#102b46] data-pressed:text-copy-primary focus-visible:outline-2 focus-visible:outline-accent"
          >
            Cumulative
          </Toggle>
        </div>
      </div>
      <div className="relative mt-1.5 h-8">
        <svg
          className="pointer-events-none absolute inset-0 block h-full w-full overflow-visible"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${formatTimelineDate(first.timestamp)} through ${formatTimelineDate(last.timestamp)}`}
        >
          <polygon points={area} fill="rgba(3, 79, 158, 0.22)" />
          <polyline
            points={line}
            fill="none"
            stroke="#95ccff"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <Slider.Root
        value={activeIndex}
        min={0}
        max={Math.max(0, points.length - 1)}
        step={1}
        disabled={points.length === 1}
        onValueChange={(index: number) => {
          const point = points[index];
          if (point) onCutoffChange(point.timestamp);
        }}
        className="mt-2 h-5"
      >
        <Slider.Control className="flex h-full w-full touch-none items-center select-none">
          <Slider.Track className="relative h-1 w-full bg-[#35404d] select-none">
            <Slider.Indicator className="bg-accent select-none" />
            {points.map((point, index) => (
              <span
                key={point.timestamp}
                data-testid="timeline-checkpoint"
                className={`pointer-events-none absolute top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 border-panel-deep border-x ${index === activeIndex ? "h-3 w-1 bg-accent-bright" : "h-2.5 w-[3px] bg-copy-muted"}`}
                style={{
                  left: `${points.length === 1 ? 50 : (index / (points.length - 1)) * 100}%`,
                }}
                title={timelinePointLabel(point)}
                aria-hidden="true"
              />
            ))}
            <Slider.Thumb
              aria-label="Timeline cutoff"
              aria-valuetext={timelinePointLabel(active)}
              className="z-[2] size-3.5 rounded-full border-2 border-panel-deep bg-accent shadow-sm select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-hover"
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <div className="mt-0.5 flex justify-between font-mono text-[10px] text-copy-faint">
        <time dateTime={new Date(first.timestamp).toISOString()}>
          {formatTimelineDate(first.timestamp)}
        </time>
        <time dateTime={new Date(last.timestamp).toISOString()}>
          {formatTimelineDate(last.timestamp)}
        </time>
      </div>
    </figure>
  );
}

function timelineIndex(points: TimelinePoint[], cutoff: number | null) {
  if (cutoff === null) return Math.max(0, points.length - 1);
  const exact = points.findIndex((point) => point.timestamp === cutoff);
  if (exact >= 0) return exact;
  const next = points.findIndex((point) => point.timestamp > cutoff);
  return next <= 0 ? 0 : next - 1;
}

function formatTimelineDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

function timelinePointLabel(point: TimelinePoint) {
  return `${formatTimelineDate(point.timestamp)}; ${point.exact} STIX ${point.exact === 1 ? "change" : "changes"}; ${point.cumulative} dated ${point.cumulative === 1 ? "object" : "objects"} cumulative`;
}
