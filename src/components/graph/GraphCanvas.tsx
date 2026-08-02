import { type D3DragEvent, drag } from "d3-drag";
import { quadtree } from "d3-quadtree";
import { select } from "d3-selection";
import { type D3ZoomEvent, type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

import type {
  GraphEdgeSummary,
  GraphNodeSummary,
  GraphViewport,
  GraphWorkspaceMode,
} from "../../lib/graph";
import {
  calculateMinimapViewport,
  fitViewport,
  type GraphNeighborhood,
  graphNeighborhood,
  layoutWorkspaceNodes,
  type PositionedNode,
  resolveInitialViewport,
  shouldPersistViewportEvent,
  worldBounds,
} from "./graph-canvas-model";
import type { GraphPosition } from "./graph-store";
import { iconUrlFor, readableType } from "./stix-icon-urls";

export interface GraphCanvasHandle {
  zoomBy: (factor: number) => void;
  fit: (ids?: string[]) => void;
  reset: () => void;
  focusNode: (id: string) => void;
}

interface GraphCanvasProps {
  nodes: GraphNodeSummary[];
  edges: GraphEdgeSummary[];
  positions: Record<string, GraphPosition>;
  selection: string[];
  viewport: GraphViewport;
  mode: GraphWorkspaceMode;
  minimapVisible: boolean;
  onSelect: (id: string | null, additive?: boolean) => void;
  onMoveStart: (
    ids: string[],
    displayedOrigins: Record<string, { x: number; y: number }>,
  ) => boolean;
  onMoveBy: (deltaX: number, deltaY: number) => void;
  onMoveEnd: () => void;
  onViewportChange: (viewport: GraphViewport, final: boolean) => void;
  onConnectSelected: () => void;
}

const NODE_RADIUS = 24;
const LABEL_WIDTH = 150;

interface CanvasState {
  nodes: PositionedNode[];
  edges: GraphEdgeSummary[];
  nodeById: Map<string, PositionedNode>;
  hitTree: ReturnType<typeof quadtree<PositionedNode>>;
  selection: string[];
  mode: GraphWorkspaceMode;
  minimapVisible: boolean;
  onSelect: GraphCanvasProps["onSelect"];
  onMoveStart: GraphCanvasProps["onMoveStart"];
  onMoveBy: GraphCanvasProps["onMoveBy"];
  onMoveEnd: GraphCanvasProps["onMoveEnd"];
  onViewportChange: GraphCanvasProps["onViewportChange"];
  onConnectSelected: GraphCanvasProps["onConnectSelected"];
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  {
    nodes,
    edges,
    positions,
    selection,
    viewport,
    mode,
    minimapVisible,
    onSelect,
    onMoveStart,
    onMoveBy,
    onMoveEnd,
    onViewportChange,
    onConnectSelected,
  },
  forwardedRef,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapZoomRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipTypeRef = useRef<HTMLSpanElement>(null);
  const tooltipNameRef = useRef<HTMLSpanElement>(null);
  const sizeRef = useRef({ width: 800, height: 600 });
  const zoomTransformRef = useRef<ZoomTransform>(
    zoomIdentity.translate(viewport.x, viewport.y).scale(viewport.zoom),
  );
  const draggingRef = useRef<{ startX: number; startY: number } | null>(null);
  const iconCache = useRef(new Map<string, HTMLImageElement>());
  const frameRef = useRef(0);
  const renderRef = useRef<() => void>(() => undefined);
  const zoomBehaviorRef = useRef<ReturnType<typeof zoom<HTMLCanvasElement, unknown>> | null>(null);
  const initializedRef = useRef(false);
  const initialViewportRef = useRef(viewport);

  const rawPositionedNodes = useMemo(
    () =>
      nodes.flatMap<PositionedNode>((node) => {
        if (node.objectType === "relationship" || node.objectType === "sighting") return [];
        const position = positions[node.id];
        return position ? [{ id: node.id, node, x: position.x, y: position.y }] : [];
      }),
    [nodes, positions],
  );
  const positionedNodes = useMemo(
    () => layoutWorkspaceNodes(rawPositionedNodes, edges, positions),
    [edges, positions, rawPositionedNodes],
  );
  const nodeById = useMemo(
    () => new Map(positionedNodes.map((positioned) => [positioned.id, positioned])),
    [positionedNodes],
  );
  const hitTree = useMemo(
    () =>
      quadtree<PositionedNode>()
        .x((node) => node.x)
        .y((node) => node.y)
        .addAll(positionedNodes),
    [positionedNodes],
  );
  const stateRef = useRef<CanvasState>({
    nodes: positionedNodes,
    edges,
    nodeById,
    hitTree,
    selection,
    mode,
    minimapVisible,
    onSelect,
    onMoveStart,
    onMoveBy,
    onMoveEnd,
    onViewportChange,
    onConnectSelected,
  });
  stateRef.current = {
    nodes: positionedNodes,
    edges,
    nodeById,
    hitTree,
    selection,
    mode,
    minimapVisible,
    onSelect,
    onMoveStart,
    onMoveBy,
    onMoveEnd,
    onViewportChange,
    onConnectSelected,
  };
  const applyViewport = useCallback((next: GraphViewport, final: boolean) => {
    const canvas = canvasRef.current;
    const behavior = zoomBehaviorRef.current;
    if (!canvas || !behavior) return;
    const transform = zoomIdentity.translate(next.x, next.y).scale(next.zoom);
    behavior.transform(select(canvas), transform);
    stateRef.current.onViewportChange(next, final);
  }, []);

  useImperativeHandle(
    forwardedRef,
    () => ({
      zoomBy: (factor) => {
        const current = zoomTransformRef.current;
        const { width, height } = sizeRef.current;
        const nextZoom = clampZoom(current.k * factor);
        const worldCenterX = (width / 2 - current.x) / current.k;
        const worldCenterY = (height / 2 - current.y) / current.k;
        applyViewport(
          {
            x: width / 2 - worldCenterX * nextZoom,
            y: height / 2 - worldCenterY * nextZoom,
            zoom: nextZoom,
          },
          true,
        );
      },
      fit: (ids) => {
        const currentNodes = stateRef.current.nodes;
        const requested = ids?.length
          ? currentNodes.filter((node) => ids.includes(node.id))
          : currentNodes;
        if (requested.length === 0) return;
        applyViewport(fitViewport(requested, sizeRef.current), true);
      },
      reset: () => {
        const { width, height } = sizeRef.current;
        applyViewport({ x: width / 2, y: height / 2, zoom: 1 }, true);
      },
      focusNode: (id) => {
        const node = stateRef.current.nodeById.get(id);
        if (!node) return;
        const { width, height } = sizeRef.current;
        const nextZoom = Math.max(1, zoomTransformRef.current.k);
        applyViewport(
          { x: width / 2 - node.x * nextZoom, y: height / 2 - node.y * nextZoom, zoom: nextZoom },
          true,
        );
      },
    }),
    [applyViewport],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const render = () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const current = stateRef.current;
        renderMainCanvas(
          canvas,
          context,
          current.nodes,
          current.edges,
          current.nodeById,
          new Set(current.selection),
          zoomTransformRef.current,
          iconCache.current,
          render,
        );
        if (current.minimapVisible && minimapRef.current) {
          renderMinimap(
            minimapRef.current,
            current.nodes,
            new Set(current.selection),
            zoomTransformRef.current,
            sizeRef.current,
          );
          if (minimapZoomRef.current) {
            minimapZoomRef.current.textContent = `${Math.round(zoomTransformRef.current.k * 100)}%`;
          }
        }
      });
    };
    renderRef.current = render;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      sizeRef.current = {
        width: Math.max(1, rect.width || canvas.clientWidth || 800),
        height: Math.max(1, rect.height || canvas.clientHeight || 600),
      };
      render();
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => resize());
    observer?.observe(canvas);
    resize();

    const canvasSelection = select(canvas);
    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .filter((event: Event) => {
        if (event.type === "dblclick") return false;
        const [x, y] = eventPoint(event, canvas);
        const current = stateRef.current;
        const hit = findNode(x, y, current.hitTree, zoomTransformRef.current);
        return !(event.type === "mousedown" && hit);
      })
      .on("zoom", (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        zoomTransformRef.current = event.transform;
        if (shouldPersistViewportEvent(event.sourceEvent)) {
          stateRef.current.onViewportChange(
            { x: event.transform.x, y: event.transform.y, zoom: event.transform.k },
            eventType(event.sourceEvent) === "mouseup" ||
              eventType(event.sourceEvent) === "touchend",
          );
        }
        render();
      });
    canvasSelection.call(zoomBehavior);
    zoomBehaviorRef.current = zoomBehavior;
    const initialViewport = resolveInitialViewport(
      initialViewportRef.current,
      stateRef.current.nodes,
      sizeRef.current,
    );
    zoomBehavior.transform(
      canvasSelection,
      zoomIdentity.translate(initialViewport.x, initialViewport.y).scale(initialViewport.zoom),
    );

    const dragBehavior = drag<HTMLCanvasElement, unknown, PositionedNode>()
      .filter((event: Event) => {
        const current = stateRef.current;
        if (!isPrimaryPointer(event)) return false;
        const [x, y] = eventPoint(event, canvas);
        return Boolean(findNode(x, y, current.hitTree, zoomTransformRef.current));
      })
      .subject(
        (event: D3DragEvent<HTMLCanvasElement, unknown, PositionedNode>) =>
          findNode(
            event.x,
            event.y,
            stateRef.current.hitTree,
            zoomTransformRef.current,
          ) as PositionedNode,
      )
      .on("start", (event: D3DragEvent<HTMLCanvasElement, unknown, PositionedNode>) => {
        const subject = event.subject;
        const current = stateRef.current;
        const additive = hasAdditiveModifier(event.sourceEvent);
        if (!current.selection.includes(subject.id)) current.onSelect(subject.id, additive);
        const movingIds = current.selection.includes(subject.id) ? current.selection : [subject.id];
        const origins = Object.fromEntries(
          movingIds.flatMap((id) => {
            const node = current.nodeById.get(id);
            return node ? [[id, { x: node.x, y: node.y }]] : [];
          }),
        );
        if (!current.onMoveStart(movingIds, origins)) return;
        const [worldX, worldY] = zoomTransformRef.current.invert([event.x, event.y]);
        draggingRef.current = { startX: worldX, startY: worldY };
      })
      .on("drag", (event: D3DragEvent<HTMLCanvasElement, unknown, PositionedNode>) => {
        const origin = draggingRef.current;
        if (!origin) return;
        const [worldX, worldY] = zoomTransformRef.current.invert([event.x, event.y]);
        stateRef.current.onMoveBy(worldX - origin.startX, worldY - origin.startY);
        render();
      })
      .on("end", () => {
        if (!draggingRef.current) return;
        draggingRef.current = null;
        stateRef.current.onMoveEnd();
      });
    canvasSelection.call(dragBehavior);
    render();

    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frameRef.current);
      zoomBehaviorRef.current = null;
      initializedRef.current = false;
      canvasSelection.on(".zoom", null).on(".drag", null);
    };
  }, []);

  useEffect(() => renderRef.current());

  useEffect(() => {
    const canvas = canvasRef.current;
    const behavior = zoomBehaviorRef.current;
    if (!canvas || !behavior) return;
    const current = zoomTransformRef.current;
    if (
      nearlyEqual(current.x, viewport.x) &&
      nearlyEqual(current.y, viewport.y) &&
      nearlyEqual(current.k, viewport.zoom)
    )
      return;
    if (!initializedRef.current && viewport.x === 0 && viewport.y === 0 && viewport.zoom === 1) {
      initializedRef.current = true;
      return;
    }
    initializedRef.current = true;
    behavior.transform(
      select(canvas),
      zoomIdentity.translate(viewport.x, viewport.y).scale(viewport.zoom),
    );
  }, [viewport.x, viewport.y, viewport.zoom]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (draggingRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hovered = findNode(x, y, stateRef.current.hitTree, zoomTransformRef.current);
    updateTooltip(
      tooltipRef.current,
      tooltipTypeRef.current,
      tooltipNameRef.current,
      hovered,
      x,
      y,
    );
  };

  const handleClick = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (draggingRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const node = findNode(
      event.clientX - rect.left,
      event.clientY - rect.top,
      stateRef.current.hitTree,
      zoomTransformRef.current,
    );
    stateRef.current.onSelect(node?.id ?? null, event.shiftKey || event.metaKey);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Escape") {
      stateRef.current.onSelect(null);
      return;
    }
    if (mode === "build" && event.key.toLocaleLowerCase() === "c" && selection.length === 2) {
      event.preventDefault();
      stateRef.current.onConnectSelected();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const state = stateRef.current;
    const current = state.nodeById.get(state.selection.at(-1) ?? "") ?? state.nodes[0];
    if (!current) return;
    const next = spatialNeighbor(current, state.nodes, event.key);
    if (next) state.onSelect(next.id, event.shiftKey || event.metaKey);
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#11151b]">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none outline-none focus-visible:ring-1 focus-visible:ring-accent"
        tabIndex={0}
        aria-label="Investigation graph canvas. Use arrow keys to move between nodes."
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => hideTooltip(tooltipRef.current)}
      />
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-10 hidden max-w-64 rounded-sm border border-panel-border bg-panel-raised px-2 py-1.5 text-[11px] text-copy-secondary shadow-xl ring-1 ring-white/5"
        role="tooltip"
      >
        <span ref={tooltipTypeRef} className="block text-copy-faint uppercase tracking-wide" />
        <span ref={tooltipNameRef} className="mt-0.5 block text-copy-primary" />
      </div>
      {minimapVisible ? (
        <div className="absolute right-3 bottom-3 h-28 w-48 overflow-hidden rounded-sm border border-panel-border bg-panel-deep/95 shadow-xl">
          <canvas
            ref={minimapRef}
            className="block h-full w-full cursor-crosshair"
            aria-label="Graph minimap. Click to center the viewport."
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const bounds = worldBounds(stateRef.current.nodes);
              if (!bounds) return;
              const worldX =
                bounds.minX + ((event.clientX - rect.left) / rect.width) * bounds.width;
              const worldY =
                bounds.minY + ((event.clientY - rect.top) / rect.height) * bounds.height;
              const { width, height } = sizeRef.current;
              const zoomLevel = zoomTransformRef.current.k;
              applyViewport(
                {
                  x: width / 2 - worldX * zoomLevel,
                  y: height / 2 - worldY * zoomLevel,
                  zoom: zoomLevel,
                },
                true,
              );
            }}
          />
          <span
            ref={minimapZoomRef}
            className="pointer-events-none absolute right-1.5 bottom-1 rounded-sm bg-panel-deep/90 px-1.5 py-0.5 font-mono text-[10px] text-copy-secondary"
          >
            {Math.round(viewport.zoom * 100)}%
          </span>
        </div>
      ) : null}
    </div>
  );
});

function neighborhoodRole(
  id: string,
  neighborhood: GraphNeighborhood,
): "selected" | "inbound" | "outbound" | "both" | "unrelated" | "normal" {
  if (!neighborhood.focusId) return "normal";
  if (id === neighborhood.focusId) return "selected";
  const inbound = neighborhood.inboundNodeIds.has(id);
  const outbound = neighborhood.outboundNodeIds.has(id);
  if (inbound && outbound) return "both";
  if (inbound) return "inbound";
  if (outbound) return "outbound";
  return "unrelated";
}

function edgeFocusRole(
  edge: GraphEdgeSummary,
  neighborhood: GraphNeighborhood,
): "inbound" | "outbound" | "unrelated" {
  if (!neighborhood.focusId) return "unrelated";
  if (edge.targetId === neighborhood.focusId) return "inbound";
  if (edge.sourceId === neighborhood.focusId) return "outbound";
  return "unrelated";
}

function renderMainCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  nodes: PositionedNode[],
  edges: GraphEdgeSummary[],
  nodeById: Map<string, PositionedNode>,
  selection: Set<string>,
  transform: ZoomTransform,
  icons: Map<string, HTMLImageElement>,
  rerender: () => void,
) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, canvas.clientWidth || 800);
  const height = Math.max(1, canvas.clientHeight || 600);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  drawGrid(context, width, height, transform);
  context.save();
  context.translate(transform.x, transform.y);
  context.scale(transform.k, transform.k);
  const neighborhood = graphNeighborhood(edges, [...selection]);

  for (const edge of edges) {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target) continue;
    drawEdge(context, edge, source, target, transform.k, neighborhood);
  }
  for (const node of nodes) {
    drawNode(
      context,
      node,
      selection.has(node.id),
      neighborhoodRole(node.id, neighborhood),
      icons,
      rerender,
    );
  }
  context.restore();
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  transform: ZoomTransform,
) {
  const spacing = 36 * transform.k;
  if (spacing < 10) return;
  context.beginPath();
  context.strokeStyle = "rgba(125, 133, 151, 0.08)";
  context.lineWidth = 1;
  for (let x = transform.x % spacing; x < width; x += spacing) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = transform.y % spacing; y < height; y += spacing) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
}

function drawEdge(
  context: CanvasRenderingContext2D,
  edge: GraphEdgeSummary,
  source: PositionedNode,
  target: PositionedNode,
  zoomLevel: number,
  neighborhood: GraphNeighborhood,
) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / length;
  const uy = dy / length;
  const startX = source.x + ux * NODE_RADIUS;
  const startY = source.y + uy * NODE_RADIUS;
  const endX = target.x - ux * NODE_RADIUS;
  const endY = target.y - uy * NODE_RADIUS;
  context.save();
  const focusRole = edgeFocusRole(edge, neighborhood);
  const focused = focusRole !== "unrelated";
  const focusActive = neighborhood.focusId !== null;
  const color =
    focusRole === "inbound"
      ? "#d2a8ff"
      : focusRole === "outbound"
        ? "#73b7f0"
        : edgeColor(edge.kind);
  context.globalAlpha = focusActive && !focused ? 0.1 : 1;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = focused ? 2.8 : edge.kind === "semantic" ? 1.8 : 1.25;
  context.setLineDash(
    focusRole === "inbound"
      ? [6, 4]
      : edge.kind === "visual"
        ? [7, 5]
        : edge.kind === "reference"
          ? [2, 4]
          : [],
  );
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
  if (edge.directed) {
    const arrow = 7;
    context.beginPath();
    context.moveTo(endX, endY);
    context.lineTo(endX - ux * arrow - uy * 4, endY - uy * arrow + ux * 4);
    context.lineTo(endX - ux * arrow + uy * 4, endY - uy * arrow - ux * 4);
    context.closePath();
    context.fill();
  }
  if (edge.label && zoomLevel >= 0.55 && (!focusActive || focused)) {
    const middleX = (startX + endX) / 2;
    const middleY = (startY + endY) / 2;
    context.setLineDash([]);
    context.font = "10px Geist, sans-serif";
    const width = context.measureText(edge.label).width + 8;
    context.fillStyle = "rgba(17, 17, 19, 0.9)";
    context.fillRect(middleX - width / 2, middleY - 7, width, 14);
    context.fillStyle = "#b9b9be";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const directionLabel =
      focusRole === "inbound"
        ? `IN · ${edge.label}`
        : focusRole === "outbound"
          ? `OUT · ${edge.label}`
          : edge.label;
    context.fillText(directionLabel, middleX, middleY, 150);
  }
  context.restore();
}

function drawNode(
  context: CanvasRenderingContext2D,
  positioned: PositionedNode,
  selected: boolean,
  focusRole: "selected" | "inbound" | "outbound" | "both" | "unrelated" | "normal",
  icons: Map<string, HTMLImageElement>,
  rerender: () => void,
) {
  const { node, x, y } = positioned;
  context.save();
  context.globalAlpha = focusRole === "unrelated" ? 0.16 : 1;
  context.translate(x, y);
  context.beginPath();
  context.arc(0, 0, NODE_RADIUS + (selected ? 5 : 2), 0, Math.PI * 2);
  context.fillStyle = node.available ? "#182535" : "#2b2b2f";
  context.fill();
  context.lineWidth = selected ? 3 : node.available ? 1.5 : 2;
  context.strokeStyle = selected
    ? "#ffffff"
    : focusRole === "inbound"
      ? "#d2a8ff"
      : focusRole === "outbound"
        ? "#73b7f0"
        : focusRole === "both"
          ? "#f2cc60"
          : node.available
            ? "#5c7fa3"
            : "#b9b9be";
  context.setLineDash(node.available ? [] : [4, 3]);
  context.stroke();
  context.setLineDash([]);

  const icon = loadIcon(node.objectType, icons, rerender);
  if (icon.complete && icon.naturalWidth > 0) {
    context.drawImage(icon, -18, -18, 36, 36);
  } else {
    context.fillStyle = "#e8e8e9";
    context.font = "600 12px Geist, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(node.available ? readableType(node.objectType).slice(0, 2) : "!", 0, 0);
  }
  context.fillStyle = node.available ? "#9bb5cf" : "#d3d3d5";
  context.font = "600 9px Geist, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillText(readableType(node.objectType).toUpperCase(), 0, NODE_RADIUS + 8, LABEL_WIDTH);
  context.fillStyle = "#e8e8e9";
  context.font = "11px Geist, sans-serif";
  context.fillText(truncateLabel(node.displayName, 28), 0, NODE_RADIUS + 21, LABEL_WIDTH);
  if (focusRole === "inbound" || focusRole === "outbound" || focusRole === "both") {
    context.fillStyle =
      focusRole === "inbound" ? "#d2a8ff" : focusRole === "outbound" ? "#73b7f0" : "#f2cc60";
    context.font = "700 8px Geist, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      focusRole === "both" ? "IN + OUT" : focusRole.toUpperCase(),
      0,
      -NODE_RADIUS - 9,
    );
  }
  context.restore();
}

function renderMinimap(
  canvas: HTMLCanvasElement,
  nodes: PositionedNode[],
  selection: Set<string>,
  transform: ZoomTransform,
  viewportSize: { width: number; height: number },
) {
  const context = canvas.getContext("2d");
  const bounds = worldBounds(nodes);
  if (!context || !bounds) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth || 160;
  const height = canvas.clientHeight || 96;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(17, 17, 19, 0.92)";
  context.fillRect(0, 0, width, height);
  for (const node of nodes) {
    context.fillStyle = selection.has(node.id)
      ? "#0f85fa"
      : node.node.available
        ? "#7798ba"
        : "#d3d3d5";
    context.fillRect(
      ((node.x - bounds.minX) / bounds.width) * width - 1.5,
      ((node.y - bounds.minY) / bounds.height) * height - 1.5,
      3,
      3,
    );
  }
  const minimapViewport = calculateMinimapViewport(bounds, viewportSize, transform, {
    width,
    height,
  });
  context.strokeStyle = "#0f85fa";
  context.lineWidth = 1;
  context.fillStyle = "rgba(149, 204, 255, 0.08)";
  context.fillRect(
    minimapViewport.x,
    minimapViewport.y,
    minimapViewport.width,
    minimapViewport.height,
  );
  context.strokeRect(
    minimapViewport.x,
    minimapViewport.y,
    minimapViewport.width,
    minimapViewport.height,
  );
}

function findNode(
  screenX: number,
  screenY: number,
  tree: ReturnType<typeof quadtree<PositionedNode>>,
  transform: ZoomTransform,
) {
  const [x, y] = transform.invert([screenX, screenY]);
  return tree.find(x, y, (NODE_RADIUS + 8) / transform.k) ?? null;
}

function spatialNeighbor(current: PositionedNode, nodes: PositionedNode[], direction: string) {
  const candidates = nodes.filter((node) => {
    if (node.id === current.id) return false;
    if (direction === "ArrowLeft") return node.x < current.x;
    if (direction === "ArrowRight") return node.x > current.x;
    if (direction === "ArrowUp") return node.y < current.y;
    return node.y > current.y;
  });
  return candidates.sort((left, right) => {
    const leftPrimary =
      direction === "ArrowLeft" || direction === "ArrowRight"
        ? Math.abs(left.x - current.x)
        : Math.abs(left.y - current.y);
    const rightPrimary =
      direction === "ArrowLeft" || direction === "ArrowRight"
        ? Math.abs(right.x - current.x)
        : Math.abs(right.y - current.y);
    const leftCross =
      direction === "ArrowLeft" || direction === "ArrowRight"
        ? Math.abs(left.y - current.y)
        : Math.abs(left.x - current.x);
    const rightCross =
      direction === "ArrowLeft" || direction === "ArrowRight"
        ? Math.abs(right.y - current.y)
        : Math.abs(right.x - current.x);
    return leftPrimary + leftCross * 1.5 - (rightPrimary + rightCross * 1.5);
  })[0];
}

function updateTooltip(
  tooltip: HTMLDivElement | null,
  typeLabel: HTMLSpanElement | null,
  nameLabel: HTMLSpanElement | null,
  hovered: PositionedNode | null,
  x: number,
  y: number,
) {
  if (!tooltip || !typeLabel || !nameLabel) return;
  if (!hovered) {
    hideTooltip(tooltip);
    return;
  }
  typeLabel.textContent = readableType(hovered.node.objectType);
  nameLabel.textContent = hovered.node.displayName;
  tooltip.style.left = `${x + 14}px`;
  tooltip.style.top = `${y + 14}px`;
  tooltip.classList.remove("hidden");
}

function hideTooltip(tooltip: HTMLDivElement | null) {
  tooltip?.classList.add("hidden");
}

function loadIcon(objectType: string, cache: Map<string, HTMLImageElement>, rerender: () => void) {
  const url = iconUrlFor(objectType);
  const existing = cache.get(url);
  if (existing) return existing;
  const image = new Image();
  image.decoding = "async";
  image.addEventListener("load", rerender, { once: true });
  image.src = url;
  cache.set(url, image);
  return image;
}

function truncateLabel(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function edgeColor(kind: GraphEdgeSummary["kind"]) {
  if (kind === "semantic") return "#69a6dc";
  if (kind === "reference") return "#8690a3";
  if (kind === "draft") return "#d7ac63";
  return "#a995d7";
}

function eventPoint(event: Event, element: HTMLElement): [number, number] {
  if (event instanceof MouseEvent) return [event.offsetX, event.offsetY];
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    if (!touch) return [0, 0];
    const rect = element.getBoundingClientRect();
    return [touch.clientX - rect.left, touch.clientY - rect.top];
  }
  return [0, 0];
}

function eventType(event: unknown): string {
  return event instanceof Event ? event.type : "";
}

function isPrimaryPointer(event: Event): boolean {
  return !(event instanceof MouseEvent) || event.button === 0;
}

function hasAdditiveModifier(event: unknown): boolean {
  return event instanceof MouseEvent || event instanceof KeyboardEvent
    ? event.shiftKey || event.metaKey
    : false;
}

function clampZoom(value: number) {
  return Math.min(8, Math.max(0.1, value));
}

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) < 0.001;
}
