import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  pinned: boolean;
}

export interface LayoutLink {
  sourceId: string;
  targetId: string;
}

export interface LayoutRequest {
  seed: number;
  width: number;
  height: number;
  nodes: LayoutNode[];
  links: LayoutLink[];
}

interface SimulationLayoutNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  pinned: boolean;
}

interface SimulationLayoutLink extends SimulationLinkDatum<SimulationLayoutNode> {
  source: string | SimulationLayoutNode;
  target: string | SimulationLayoutNode;
}

const ITERATIONS = 240;

export function arrangeGraph(request: LayoutRequest): LayoutNode[] {
  const nodes = request.nodes
    .map<SimulationLayoutNode>((node) => ({
      ...node,
      fx: node.pinned ? node.x : null,
      fy: node.pinned ? node.y : null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = request.links
    .filter((link) => nodeIds.has(link.sourceId) && nodeIds.has(link.targetId))
    .sort((left, right) =>
      `${left.sourceId}\0${left.targetId}`.localeCompare(`${right.sourceId}\0${right.targetId}`),
    )
    .map<SimulationLayoutLink>((link) => ({
      source: link.sourceId,
      target: link.targetId,
    }));

  if (nodes.length === 0) return [];

  const shortestSide = Math.max(1, Math.min(request.width, request.height));
  const linkDistance = Math.max(90, Math.min(160, shortestSide / 5));
  const simulation = forceSimulation(nodes)
    .stop()
    .randomSource(seededRandom(request.seed))
    .alpha(1)
    .alphaMin(0.001)
    .alphaDecay(1 - 0.001 ** (1 / ITERATIONS))
    .velocityDecay(0.42)
    .force(
      "links",
      forceLink<SimulationLayoutNode, SimulationLayoutLink>(links)
        .id((node) => node.id)
        .distance(linkDistance)
        .strength(0.45),
    )
    .force("charge", forceManyBody<SimulationLayoutNode>().strength(-280).distanceMax(700))
    .force("collision", forceCollide<SimulationLayoutNode>(48).strength(0.9).iterations(2))
    .force("center", forceCenter<SimulationLayoutNode>(0, 0).strength(0.08));

  simulation.tick(ITERATIONS).stop();

  return nodes.map((node) => ({
    id: node.id,
    x: node.pinned ? (node.fx ?? node.x) : roundCoordinate(node.x),
    y: node.pinned ? (node.fy ?? node.y) : roundCoordinate(node.y),
    pinned: node.pinned,
  }));
}

function seededRandom(seed: number): () => number {
  let state = Number.isFinite(seed) ? seed >>> 0 : 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
