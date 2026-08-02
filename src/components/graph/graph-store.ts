import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  GraphItemKind,
  GraphViewport,
  GraphWorkspaceMode,
  GraphWorkspaceSeed,
  GraphWorkspaceView,
} from "../../lib/graph";

export interface GraphPosition {
  x: number;
  y: number;
  pinned: boolean;
  itemKind: GraphItemKind;
}

interface MoveSession {
  ids: string[];
  historyBefore: Record<string, GraphPosition>;
  origins: Record<string, GraphPosition>;
}

interface HistoryEntry {
  before: Record<string, GraphPosition>;
  after: Record<string, GraphPosition>;
}

export interface GraphStoreState {
  mode: GraphWorkspaceMode;
  viewport: GraphViewport;
  positions: Record<string, GraphPosition>;
  selection: string[];
  searchQuery: string;
  moving: boolean;
  undoCount: number;
  redoCount: number;
  beginMove: (
    ids: string[],
    displayedOrigins?: Record<string, { x: number; y: number }>,
  ) => boolean;
  moveBy: (deltaX: number, deltaY: number) => void;
  finishMove: () => GraphWorkspaceSeed[];
  cancelMove: () => void;
  select: (id: string | null, additive?: boolean) => void;
  setMode: (mode: GraphWorkspaceMode) => void;
  setSearchQuery: (query: string) => void;
  setViewport: (viewport: GraphViewport) => void;
  setPositions: (positions: GraphWorkspaceSeed[], recordHistory?: boolean) => void;
  togglePinned: (ids: string[]) => GraphWorkspaceSeed[];
  undo: () => GraphWorkspaceSeed[];
  redo: () => GraphWorkspaceSeed[];
}

export type GraphStore = StoreApi<GraphStoreState>;

export function createGraphStore(view: GraphWorkspaceView): GraphStore {
  let moveSession: MoveSession | null = null;
  const undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];
  const initialPositions = positionsFromView(view);

  return createStore<GraphStoreState>((set, get) => ({
    mode: view.workspace.mode,
    viewport: view.workspace.viewport,
    positions: initialPositions,
    selection: [],
    searchQuery: "",
    moving: false,
    undoCount: 0,
    redoCount: 0,
    beginMove: (ids, displayedOrigins = {}) => {
      const state = get();
      if (state.moving) return false;
      const movableIds = [...new Set(ids)].filter((id) => id in state.positions);
      if (movableIds.length === 0) return false;
      const historyBefore = clonePositions(state.positions);
      const origins = clonePositions(state.positions);
      for (const id of movableIds) {
        const displayed = displayedOrigins[id];
        const origin = origins[id];
        if (!displayed || !origin) continue;
        origins[id] = { ...origin, x: displayed.x, y: displayed.y, pinned: true };
      }
      moveSession = { ids: movableIds, historyBefore, origins };
      set({ positions: origins, moving: true });
      return true;
    },
    moveBy: (deltaX, deltaY) => {
      if (!moveSession || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
      const next = clonePositions(moveSession.origins);
      for (const id of moveSession.ids) {
        const origin = moveSession.origins[id];
        if (!origin) continue;
        next[id] = { ...origin, x: origin.x + deltaX, y: origin.y + deltaY };
      }
      set({ positions: next });
    },
    finishMove: () => {
      if (!moveSession) return [];
      const session = moveSession;
      moveSession = null;
      const after = clonePositions(get().positions);
      if (!positionsEqual(session.historyBefore, after)) {
        undoStack.push({ before: session.historyBefore, after });
        redoStack = [];
      }
      set({
        moving: false,
        undoCount: undoStack.length,
        redoCount: redoStack.length,
      });
      return seedsFor(session.ids, after);
    },
    cancelMove: () => {
      if (!moveSession) return;
      const before = moveSession.historyBefore;
      moveSession = null;
      set({ positions: before, moving: false });
    },
    select: (id, additive = false) => {
      if (id === null) {
        set({ selection: [] });
        return;
      }
      const current = get().selection;
      if (!additive) {
        set({ selection: [id] });
        return;
      }
      set({
        selection: current.includes(id)
          ? current.filter((selectedId) => selectedId !== id)
          : [...current, id],
      });
    },
    setMode: (mode) => set({ mode }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setViewport: (viewport) => set({ viewport }),
    setPositions: (positions, recordHistory = true) => {
      const before = clonePositions(get().positions);
      const after = clonePositions(before);
      for (const position of positions) {
        if (!(position.itemId in after)) continue;
        after[position.itemId] = {
          x: position.x,
          y: position.y,
          pinned: position.pinned,
          itemKind: position.itemKind,
        };
      }
      if (recordHistory && !positionsEqual(before, after)) {
        undoStack.push({ before, after: clonePositions(after) });
        redoStack = [];
      }
      set({
        positions: after,
        undoCount: undoStack.length,
        redoCount: redoStack.length,
      });
    },
    togglePinned: (ids) => {
      if (get().mode !== "build") return [];
      const before = clonePositions(get().positions);
      const after = clonePositions(before);
      const validIds = [...new Set(ids)].filter((id) => id in after);
      for (const id of validIds) after[id] = { ...after[id], pinned: !after[id].pinned };
      if (!positionsEqual(before, after)) {
        undoStack.push({ before, after: clonePositions(after) });
        redoStack = [];
        set({
          positions: after,
          undoCount: undoStack.length,
          redoCount: redoStack.length,
        });
      }
      return seedsFor(validIds, after);
    },
    undo: () => {
      const entry = undoStack.pop();
      if (!entry) return [];
      redoStack.push(entry);
      const positions = clonePositions(entry.before);
      set({
        positions,
        undoCount: undoStack.length,
        redoCount: redoStack.length,
      });
      return seedsFor(changedPositionIds(entry.before, entry.after), positions);
    },
    redo: () => {
      const entry = redoStack.pop();
      if (!entry) return [];
      undoStack.push(entry);
      const positions = clonePositions(entry.after);
      set({
        positions,
        undoCount: undoStack.length,
        redoCount: redoStack.length,
      });
      return seedsFor(changedPositionIds(entry.before, entry.after), positions);
    },
  }));
}

export class GraphMutationQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function positionsFromView(view: GraphWorkspaceView): Record<string, GraphPosition> {
  return Object.fromEntries(
    view.items.map((item) => [
      item.item_id,
      {
        x: item.position.x,
        y: item.position.y,
        pinned: item.pinned,
        itemKind: item.item_kind,
      },
    ]),
  );
}

function clonePositions(positions: Record<string, GraphPosition>): Record<string, GraphPosition> {
  return Object.fromEntries(
    Object.entries(positions).map(([id, position]) => [id, { ...position }]),
  );
}

function positionsEqual(
  left: Record<string, GraphPosition>,
  right: Record<string, GraphPosition>,
): boolean {
  const ids = Object.keys(left);
  if (ids.length !== Object.keys(right).length) return false;
  return ids.every((id) => {
    const other = right[id];
    const position = left[id];
    return (
      other?.x === position.x &&
      other.y === position.y &&
      other.pinned === position.pinned &&
      other.itemKind === position.itemKind
    );
  });
}

function seedsFor(ids: string[], positions: Record<string, GraphPosition>): GraphWorkspaceSeed[] {
  return ids.flatMap((itemId) => {
    const position = positions[itemId];
    return position
      ? [
          {
            itemId,
            itemKind: position.itemKind,
            x: position.x,
            y: position.y,
            pinned: position.pinned,
          },
        ]
      : [];
  });
}

function changedPositionIds(
  before: Record<string, GraphPosition>,
  after: Record<string, GraphPosition>,
): string[] {
  return Object.keys(before).filter((id) => {
    const left = before[id];
    const right = after[id];
    return (
      !right ||
      left.x !== right.x ||
      left.y !== right.y ||
      left.pinned !== right.pinned ||
      left.itemKind !== right.itemKind
    );
  });
}
