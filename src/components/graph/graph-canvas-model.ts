import type { GraphEdgeSummary, GraphNodeSummary, GraphViewport } from "../../lib/graph";

export interface PositionedNode {
  id: string;
  node: GraphNodeSummary;
  x: number;
  y: number;
}

export interface GraphNeighborhood {
  focusId: string | null;
  inboundNodeIds: Set<string>;
  outboundNodeIds: Set<string>;
  connectedEdgeIds: Set<string>;
}

interface WorkspaceLayoutPosition {
  x: number;
  y: number;
  pinned: boolean;
}

export function layoutWorkspaceNodes<T extends PositionedNode>(
  nodes: T[],
  edges: GraphEdgeSummary[],
  positions: Record<string, WorkspaceLayoutPosition>,
): T[] {
  return connectedComponentLayout(nodes, edges).map((node) => {
    const position = positions[node.id];
    return position?.pinned ? { ...node, x: position.x, y: position.y } : node;
  });
}

export function graphNeighborhood(
  edges: GraphEdgeSummary[],
  selection: string[],
): GraphNeighborhood {
  const focusId = selection.length === 1 ? (selection[0] ?? null) : null;
  const inboundNodeIds = new Set<string>();
  const outboundNodeIds = new Set<string>();
  const connectedEdgeIds = new Set<string>();
  if (!focusId) return { focusId, inboundNodeIds, outboundNodeIds, connectedEdgeIds };

  for (const edge of edges) {
    if (edge.targetId === focusId) {
      inboundNodeIds.add(edge.sourceId);
      connectedEdgeIds.add(edge.id);
    }
    if (edge.sourceId === focusId) {
      outboundNodeIds.add(edge.targetId);
      connectedEdgeIds.add(edge.id);
    }
  }
  return { focusId, inboundNodeIds, outboundNodeIds, connectedEdgeIds };
}

export function connectedComponentLayout<T extends PositionedNode>(
  nodes: T[],
  edges: GraphEdgeSummary[],
): T[] {
  if (nodes.length === 0) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (edge.kind === "reference") continue;
    if (!nodeById.has(edge.sourceId) || !nodeById.has(edge.targetId)) continue;
    adjacency.get(edge.sourceId)?.add(edge.targetId);
    adjacency.get(edge.targetId)?.add(edge.sourceId);
  }

  const components: T[][] = [];
  const visited = new Set<string>();
  for (const start of [...nodes].sort(compareNodeId)) {
    if (visited.has(start.id)) continue;
    const component: T[] = [];
    const queue = [start.id];
    visited.add(start.id);
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      const node = id ? nodeById.get(id) : undefined;
      if (!node) continue;
      component.push(node);
      for (const neighborId of [...(adjacency.get(id) ?? [])].sort()) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
    components.push(component);
  }

  const layouts = components
    .map((component) => layoutConnectedComponent(component, adjacency))
    .sort(
      (left, right) =>
        right.nodes.length - left.nodes.length ||
        (left.nodes[0]?.id ?? "").localeCompare(right.nodes[0]?.id ?? ""),
    );
  const gap = 110;
  const totalArea = layouts.reduce(
    (area, layout) => area + (layout.width + gap) * (layout.height + gap),
    0,
  );
  const targetRowWidth = Math.max(
    700,
    Math.sqrt(totalArea) * 1.35,
    ...layouts.map((layout) => layout.width),
  );
  const positioned: T[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let packedWidth = 0;

  for (const layout of layouts) {
    if (cursorX > 0 && cursorX + layout.width > targetRowWidth) {
      cursorX = 0;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }
    for (const node of layout.nodes) {
      positioned.push({
        ...node,
        x: node.x - layout.minX + cursorX,
        y: node.y - layout.minY + cursorY,
      });
    }
    cursorX += layout.width + gap;
    rowHeight = Math.max(rowHeight, layout.height);
    packedWidth = Math.max(packedWidth, cursorX - gap);
  }

  const packedHeight = cursorY + rowHeight;
  return positioned.map((node) => ({
    ...node,
    x: roundLayoutCoordinate(node.x - packedWidth / 2),
    y: roundLayoutCoordinate(node.y - packedHeight / 2),
  }));
}

function layoutConnectedComponent<T extends PositionedNode>(
  component: T[],
  adjacency: Map<string, Set<string>>,
) {
  const sorted = [...component].sort(compareNodeId);
  const root = [...sorted].sort(
    (left, right) =>
      (adjacency.get(right.id)?.size ?? 0) - (adjacency.get(left.id)?.size ?? 0) ||
      compareNodeId(left, right),
  )[0];
  if (!root) return { nodes: [], minX: 0, minY: 0, width: 1, height: 1 };

  const componentIds = new Set(sorted.map((node) => node.id));
  const levels: T[][] = [[root]];
  const visited = new Set([root.id]);
  const queue: Array<{ id: string; level: number }> = [{ id: root.id, level: 0 }];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) continue;
    for (const neighborId of [...(adjacency.get(current.id) ?? [])].sort()) {
      if (!componentIds.has(neighborId) || visited.has(neighborId)) continue;
      visited.add(neighborId);
      const level = current.level + 1;
      const neighbor = sorted.find((node) => node.id === neighborId);
      if (!neighbor) continue;
      const levelNodes = levels[level] ?? [];
      levelNodes.push(neighbor);
      levels[level] = levelNodes;
      queue.push({ id: neighborId, level });
    }
  }

  const localNodes: T[] = [{ ...root, x: 0, y: 0 }];
  let previousRadius = 0;
  for (let level = 1; level < levels.length; level += 1) {
    const ring = [...(levels[level] ?? [])].sort(compareNodeId);
    if (ring.length === 0) continue;
    const radius = Math.max(previousRadius + 150, (ring.length * 150) / (Math.PI * 2));
    const angleOffset = -Math.PI / 2 + (level % 2 === 0 ? Math.PI / ring.length : 0);
    for (const [index, node] of ring.entries()) {
      const angle = angleOffset + (index / ring.length) * Math.PI * 2;
      localNodes.push({
        ...node,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }
    previousRadius = radius;
  }

  const minX = Math.min(...localNodes.map((node) => node.x)) - 82;
  const maxX = Math.max(...localNodes.map((node) => node.x)) + 82;
  const minY = Math.min(...localNodes.map((node) => node.y)) - 42;
  const maxY = Math.max(...localNodes.map((node) => node.y)) + 66;
  return { nodes: localNodes, minX, minY, width: maxX - minX, height: maxY - minY };
}

function compareNodeId(left: PositionedNode, right: PositionedNode) {
  return left.id.localeCompare(right.id);
}

function roundLayoutCoordinate(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

export function calculateMinimapViewport(
  bounds: { minX: number; minY: number; width: number; height: number },
  viewportSize: { width: number; height: number },
  transform: { x: number; y: number; k: number },
  minimapSize: { width: number; height: number },
) {
  const visibleMinX = -transform.x / transform.k;
  const visibleMinY = -transform.y / transform.k;
  const visibleMaxX = visibleMinX + viewportSize.width / transform.k;
  const visibleMaxY = visibleMinY + viewportSize.height / transform.k;
  const intersectionMinX = Math.max(bounds.minX, visibleMinX);
  const intersectionMinY = Math.max(bounds.minY, visibleMinY);
  const intersectionMaxX = Math.min(bounds.minX + bounds.width, visibleMaxX);
  const intersectionMaxY = Math.min(bounds.minY + bounds.height, visibleMaxY);
  const hasHorizontalIntersection = intersectionMaxX >= intersectionMinX;
  const hasVerticalIntersection = intersectionMaxY >= intersectionMinY;
  const x = hasHorizontalIntersection
    ? ((intersectionMinX - bounds.minX) / bounds.width) * minimapSize.width
    : visibleMaxX < bounds.minX
      ? 0
      : minimapSize.width - 2;
  const y = hasVerticalIntersection
    ? ((intersectionMinY - bounds.minY) / bounds.height) * minimapSize.height
    : visibleMaxY < bounds.minY
      ? 0
      : minimapSize.height - 2;
  const width = hasHorizontalIntersection
    ? ((intersectionMaxX - intersectionMinX) / bounds.width) * minimapSize.width
    : 2;
  const height = hasVerticalIntersection
    ? ((intersectionMaxY - intersectionMinY) / bounds.height) * minimapSize.height
    : 2;
  return {
    x: clamp(x, 0, minimapSize.width),
    y: clamp(y, 0, minimapSize.height),
    width: clamp(width, 2, minimapSize.width),
    height: clamp(height, 2, minimapSize.height),
  };
}

export function fitViewport(
  nodes: ReadonlyArray<{ x: number; y: number }>,
  size: { width: number; height: number },
): GraphViewport {
  const bounds = worldBounds(nodes);
  if (!bounds) return { x: size.width / 2, y: size.height / 2, zoom: 1 };
  const zoomLevel = clampZoom(
    Math.min((size.width - 140) / bounds.width, (size.height - 140) / bounds.height),
  );
  const centerX = bounds.minX + bounds.width / 2;
  const centerY = bounds.minY + bounds.height / 2;
  return {
    x: size.width / 2 - centerX * zoomLevel,
    y: size.height / 2 - centerY * zoomLevel,
    zoom: zoomLevel,
  };
}

export function resolveInitialViewport(
  viewport: GraphViewport,
  nodes: ReadonlyArray<{ x: number; y: number }>,
  size: { width: number; height: number },
): GraphViewport {
  if (nodes.length === 0 || viewport.x !== 0 || viewport.y !== 0 || viewport.zoom !== 1) {
    return viewport;
  }
  return fitViewport(nodes, size);
}

export function shouldPersistViewportEvent(sourceEvent: unknown): boolean {
  return sourceEvent instanceof Event;
}

export function worldBounds(nodes: ReadonlyArray<{ x: number; y: number }>) {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map((node) => node.x)) - 50;
  const maxX = Math.max(...nodes.map((node) => node.x)) + 50;
  const minY = Math.min(...nodes.map((node) => node.y)) - 50;
  const maxY = Math.max(...nodes.map((node) => node.y)) + 50;
  return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function clampZoom(value: number) {
  return Math.min(8, Math.max(0.1, value));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
