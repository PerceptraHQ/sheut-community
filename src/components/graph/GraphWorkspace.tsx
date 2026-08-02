import { Button } from "@base-ui/react/button";
import { Tabs } from "@base-ui/react/tabs";
import {
  IconFilePlus,
  IconFolderSearch,
  IconGraph,
  IconPlus,
  IconSettings,
  IconStack2,
} from "@tabler/icons-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "zustand";

import {
  addGraphWorkspaceItems,
  commitGraphRelationshipDraft,
  createGraphVisualLink,
  createGraphWorkspace,
  type GraphEdgeKind,
  type GraphItemProperties,
  type GraphNodeSummary,
  type GraphRelationshipDraftPreview,
  type GraphViewport,
  type GraphWorkspace as GraphWorkspaceRecord,
  type GraphWorkspaceSeed,
  type GraphWorkspaceView,
  graphErrorMessage,
  listGraphSourceItems,
  listGraphWorkspaces,
  loadGraphItemProperties,
  loadGraphWorkspace,
  previewGraphRelationshipDraft,
  removeGraphWorkspaceItems,
  saveGraphWorkspaceState,
} from "../../lib/graph";
import { relationshipTypeSuggestions } from "../../lib/stixSchemas";
import { useVaultNotices } from "../VaultNotices";
import { WorkspaceContextMenu } from "../WorkspaceContextMenu";
import { WorkspaceLoadingState } from "../WorkspaceState";
import type { GraphCanvasHandle } from "./GraphCanvas";
import { GraphLegend } from "./GraphLegend";
import { GraphTimeline } from "./GraphTimeline";
import { GraphToolbar } from "./GraphToolbar";
import type { LayoutResponse } from "./graph-layout.worker";
import { createGraphStore, GraphMutationQueue, type GraphStore } from "./graph-store";
import { nodeVisibleAtTimeline } from "./graph-timeline-model";

const GraphCanvas = lazy(async () => ({
  default: (await import("./GraphCanvas")).GraphCanvas,
}));
const GraphWorkspaceManagerDialog = lazy(async () => ({
  default: (await import("./GraphWorkspaceManagerDialog")).GraphWorkspaceManagerDialog,
}));
const GraphRelationshipDraftDialog = lazy(async () => ({
  default: (await import("./GraphRelationshipDraftDialog")).GraphRelationshipDraftDialog,
}));
const CreateWorkspaceDialog = lazy(async () => ({
  default: (await import("./GraphWorkspaceDialogs")).CreateWorkspaceDialog,
}));
const SelectedItemsDialog = lazy(async () => ({
  default: (await import("./GraphWorkspaceDialogs")).SelectedItemsDialog,
}));
interface GraphWorkspaceProps {
  projectId: string;
  onSelectionChange?: (properties: GraphItemProperties | null) => void;
  onFocusModeChange?: (active: boolean) => void;
}

export function GraphWorkspace({
  projectId,
  onSelectionChange,
  onFocusModeChange,
}: GraphWorkspaceProps) {
  const [workspaces, setWorkspaces] = useState<GraphWorkspaceRecord[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<GraphWorkspaceView | null>(null);
  const [store, setStore] = useState<GraphStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDialogOpen, setSelectedDialogOpen] = useState(false);
  const [creationDialogOpen, setCreationDialogOpen] = useState(false);
  const [managerDialogOpen, setManagerDialogOpen] = useState(false);
  const [sourceItems, setSourceItems] = useState<GraphNodeSummary[]>([]);

  const activateView = useCallback((view: GraphWorkspaceView, preserveSelection: string[] = []) => {
    const nextStore = createGraphStore(view);
    for (const id of preserveSelection) nextStore.getState().select(id, true);
    setActiveView(view);
    setActiveWorkspaceId(view.workspace.id);
    setStore(nextStore);
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    const discovered = await listGraphWorkspaces(projectId);
    setWorkspaces(discovered);
    return discovered;
  }, [projectId]);

  const activateWorkspace = useCallback(
    async (workspaceId: string) => {
      setLoading(true);
      setError(null);
      onSelectionChange?.(null);
      try {
        activateView(await loadWorkspaceWithCurrentIntelligence(projectId, workspaceId));
      } catch (cause) {
        setError(graphErrorMessage(cause));
      } finally {
        setLoading(false);
      }
    },
    [activateView, onSelectionChange, projectId],
  );

  useEffect(() => {
    let active = true;
    listGraphWorkspaces(projectId)
      .then(async (discovered) => {
        if (!active) return;
        setWorkspaces(discovered);
        const first = discovered[0];
        if (first) {
          const view = await loadWorkspaceWithCurrentIntelligence(projectId, first.id);
          if (active) activateView(view);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(graphErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activateView, projectId]);

  const createWorkspace = async (
    name: string,
    mode: "view" | "build",
    items: GraphWorkspaceSeed[],
  ) => {
    setCreating(true);
    setError(null);
    try {
      const created = await createGraphWorkspace(projectId, name, mode, items);
      activateView(created);
      setWorkspaces((current) => [
        ...current.filter((workspace) => workspace.id !== created.workspace.id),
        created.workspace,
      ]);
      const refreshed = await refreshWorkspaces();
      if (refreshed.length === 0) setWorkspaces([created.workspace]);
      setSelectedDialogOpen(false);
    } catch (cause) {
      setError(graphErrorMessage(cause));
    } finally {
      setCreating(false);
    }
  };

  const createAllIntelligence = async () => {
    setCreating(true);
    setError(null);
    try {
      const sources = await listGraphSourceItems(projectId);
      setSourceItems(sources);
      await createWorkspace(
        "All intelligence",
        "view",
        seedItems(sources.filter((item) => item.itemKind === "intelligence")),
      );
    } catch (cause) {
      setError(graphErrorMessage(cause));
      setCreating(false);
    }
  };

  const openSelectedDialog = async () => {
    setCreationDialogOpen(false);
    setSelectedDialogOpen(true);
    if (sourceItems.length > 0) return;
    try {
      setSourceItems(await listGraphSourceItems(projectId));
    } catch (cause) {
      setError(graphErrorMessage(cause));
    }
  };

  const reconcileWorkspaces = async () => {
    const discovered = await listGraphWorkspaces(projectId);
    setWorkspaces(discovered);
    const next =
      discovered.find((workspace) => workspace.id === activeWorkspaceId) ?? discovered[0];
    if (next) {
      activateView(await loadGraphWorkspace(projectId, next.id));
      return;
    }
    setActiveWorkspaceId(null);
    setActiveView(null);
    setStore(null);
  };

  const hasWorkspaces = workspaces.length > 0 || activeView !== null;
  return (
    <section
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-workbench"
      aria-label="Graph workspaces"
    >
      {hasWorkspaces ? (
        <Tabs.Root
          value={activeWorkspaceId}
          onValueChange={(value) => {
            if (typeof value === "string" && value !== activeWorkspaceId)
              void activateWorkspace(value);
          }}
        >
          <div className="flex min-w-0 items-center gap-1 border-panel-border border-b bg-panel-base px-2 py-1">
            <Tabs.List
              className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
              aria-label="Graph workspace tabs"
            >
              {workspaces.map((workspace) => (
                <WorkspaceContextMenu
                  key={workspace.id}
                  trigger={
                    <Tabs.Tab
                      value={workspace.id}
                      className="h-7 shrink-0 cursor-pointer rounded-sm border border-transparent bg-transparent px-2.5 text-[11px] text-copy-muted outline-none hover:bg-panel-hover hover:text-copy-primary data-active:border-accent/60 data-active:bg-[#102b46] data-active:text-copy-primary"
                    >
                      {workspace.name}
                    </Tabs.Tab>
                  }
                  items={[
                    {
                      label: "Open workspace",
                      onSelect: () => void activateWorkspace(workspace.id),
                    },
                    {
                      label: "New graph workspace",
                      separatorBefore: true,
                      onSelect: () => setCreationDialogOpen(true),
                    },
                    {
                      label: "Manage graph workspaces",
                      onSelect: () => setManagerDialogOpen(true),
                    },
                  ]}
                />
              ))}
            </Tabs.List>
            <Button
              className="icon-control h-7 w-7 shrink-0"
              type="button"
              aria-label="New graph workspace"
              title="New graph workspace"
              onClick={() => setCreationDialogOpen(true)}
            >
              <IconPlus size={14} aria-hidden="true" />
            </Button>
            <Button
              className="icon-control h-7 w-7 shrink-0"
              type="button"
              aria-label="Manage graph workspaces"
              title="Manage graph workspaces"
              onClick={() => setManagerDialogOpen(true)}
            >
              <IconSettings size={14} aria-hidden="true" />
            </Button>
          </div>
        </Tabs.Root>
      ) : null}

      <div className="min-h-0">
        {error ? (
          <p className="error-message m-3" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? (
          <GraphMessage
            icon={<IconGraph size={24} aria-hidden="true" />}
            title="Loading graph workspaces"
          />
        ) : activeView && store ? (
          <GraphStage
            key={activeView.workspace.id}
            projectId={projectId}
            view={activeView}
            store={store}
            onReload={async (preserveSelection = []) => {
              const latest = await loadGraphWorkspace(projectId, activeView.workspace.id);
              activateView(latest, preserveSelection);
              await refreshWorkspaces();
            }}
            onError={setError}
            onSelectionChange={onSelectionChange}
            onFocusModeChange={onFocusModeChange}
          />
        ) : (
          <EmptyGraph
            busy={creating}
            onBlank={() => void createWorkspace("Blank workspace", "build", [])}
            onAll={() => void createAllIntelligence()}
            onSelected={() => void openSelectedDialog()}
            onManage={() => setManagerDialogOpen(true)}
          />
        )}
      </div>

      {selectedDialogOpen ? (
        <Suspense fallback={null}>
          <SelectedItemsDialog
            onOpenChange={setSelectedDialogOpen}
            items={sourceItems}
            busy={creating}
            title="Create a selected-items workspace"
            description="Search local project content. The workspace stores references and positions, not copies."
            actionLabel="Create workspace"
            onCreate={(items) =>
              void createWorkspace("Selected intelligence", "build", seedItems(items))
            }
          />
        </Suspense>
      ) : null}
      {creationDialogOpen ? (
        <Suspense fallback={null}>
          <CreateWorkspaceDialog
            busy={creating}
            onOpenChange={setCreationDialogOpen}
            onBlank={() => {
              setCreationDialogOpen(false);
              void createWorkspace("Blank workspace", "build", []);
            }}
            onAll={() => {
              setCreationDialogOpen(false);
              void createAllIntelligence();
            }}
            onSelected={() => void openSelectedDialog()}
          />
        </Suspense>
      ) : null}
      {managerDialogOpen ? (
        <Suspense fallback={null}>
          <GraphWorkspaceManagerDialog
            projectId={projectId}
            open
            onOpenChange={setManagerDialogOpen}
            onChanged={reconcileWorkspaces}
          />
        </Suspense>
      ) : null}
    </section>
  );
}

async function loadWorkspaceWithCurrentIntelligence(
  projectId: string,
  workspaceId: string,
): Promise<GraphWorkspaceView> {
  return loadGraphWorkspace(projectId, workspaceId);
}

function GraphStage({
  projectId,
  view,
  store,
  onReload,
  onError,
  onSelectionChange,
  onFocusModeChange,
}: {
  projectId: string;
  view: GraphWorkspaceView;
  store: GraphStore;
  onReload: (preserveSelection?: string[]) => Promise<void>;
  onError: (message: string | null) => void;
  onSelectionChange?: (properties: GraphItemProperties | null) => void;
  onFocusModeChange?: (active: boolean) => void;
}) {
  const notices = useVaultNotices();
  const mode = useStore(store, (state) => state.mode);
  const viewport = useStore(store, (state) => state.viewport);
  const positions = useStore(store, (state) => state.positions);
  const selection = useStore(store, (state) => state.selection);
  const query = useStore(store, (state) => state.searchQuery);
  const moving = useStore(store, (state) => state.moving);
  const undoCount = useStore(store, (state) => state.undoCount);
  const redoCount = useStore(store, (state) => state.redoCount);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [relationshipPreview, setRelationshipPreview] =
    useState<GraphRelationshipDraftPreview | null>(null);
  const [relationshipType, setRelationshipType] = useState("");
  const [relationshipDescription, setRelationshipDescription] = useState("");
  const [relationshipBusy, setRelationshipBusy] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addItems, setAddItems] = useState<GraphNodeSummary[]>([]);
  const [addBusy, setAddBusy] = useState(false);
  const [refreshingIntelligence, setRefreshingIntelligence] = useState(false);
  const [timelineCutoff, setTimelineCutoff] = useState<number | null>(null);
  const [timelineCumulative, setTimelineCumulative] = useState(true);
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<Set<string>>(() => new Set());
  const [edgeKinds, setEdgeKinds] = useState<GraphEdgeKind[]>(["semantic", "visual", "draft"]);
  const queueRef = useRef(new GraphMutationQueue());
  const revisionRef = useRef(view.workspace.revision);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const viewportTimerRef = useRef<number | null>(null);
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const workerRef = useRef<Worker | null>(null);

  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return view.nodes.filter((node) =>
      `${node.displayName} ${node.objectType} ${node.stixId ?? ""}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [query, view.nodes]);
  const graphNodes = useMemo(
    () =>
      view.nodes.filter(
        (node) =>
          node.objectType !== "relationship" &&
          node.objectType !== "sighting" &&
          !hiddenNodeTypes.has(node.objectType) &&
          nodeVisibleAtTimeline(node, timelineCutoff, timelineCumulative),
      ),
    [hiddenNodeTypes, timelineCumulative, timelineCutoff, view.nodes],
  );
  const graphEdges = useMemo(() => {
    const nodeIds = new Set(graphNodes.map((node) => node.id));
    return view.edges.filter(
      (edge) =>
        edgeKinds.includes(edge.kind) && nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId),
    );
  }, [edgeKinds, graphNodes, view.edges]);
  const selectedVisualLink = useMemo(() => {
    if (selection.length !== 2) return null;
    const selectedIds = new Set(selection);
    return (
      view.edges.find(
        (edge) =>
          edge.kind === "visual" &&
          selectedIds.has(edge.sourceId) &&
          selectedIds.has(edge.targetId),
      ) ?? null
    );
  }, [selection, view.edges]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  const persist = useCallback(
    (nextMode: "view" | "build", nextViewport: GraphViewport, changed: GraphWorkspaceSeed[]) => {
      void queueRef.current
        .enqueue(async () => {
          const batches = changed.length === 0 ? [[]] : chunk(changed, 1_000);
          let saved: GraphWorkspaceRecord | null = null;
          for (const positions of batches) {
            saved = await saveGraphWorkspaceState(
              projectId,
              view.workspace.id,
              revisionRef.current,
              nextMode,
              { viewport: nextViewport, positions },
            );
            revisionRef.current = saved.revision;
          }
          return saved;
        })
        .catch(async (cause) => {
          if (isRevisionConflict(cause)) {
            await onReload(selection);
            return;
          }
          onError(graphErrorMessage(cause));
        });
    },
    [onError, onReload, projectId, selection, view.workspace.id],
  );

  useEffect(
    () => () => {
      if (viewportTimerRef.current !== null) window.clearTimeout(viewportTimerRef.current);
      workerRef.current?.terminate();
      if (focusMode) onFocusModeChange?.(false);
    },
    [focusMode, onFocusModeChange],
  );

  useEffect(() => {
    const selected = selection.at(-1);
    if (!selected) {
      onSelectionChangeRef.current?.(null);
      return;
    }
    let active = true;
    loadGraphItemProperties(projectId, view.workspace.id, selected)
      .then((properties) => {
        if (active) onSelectionChangeRef.current?.(properties);
      })
      .catch((cause: unknown) => {
        if (active) onError(graphErrorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [onError, projectId, selection, view.workspace.id]);

  const handleViewportChange = (next: GraphViewport, final: boolean) => {
    store.getState().setViewport(next);
    if (viewportTimerRef.current !== null) window.clearTimeout(viewportTimerRef.current);
    viewportTimerRef.current = window.setTimeout(
      () => {
        persist(store.getState().mode, store.getState().viewport, []);
      },
      final ? 0 : 500,
    );
  };

  const arrange = () => {
    if (arranging || view.nodes.length === 0) return;
    setArranging(true);
    const worker = new Worker(new URL("./graph-layout.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current?.terminate();
    workerRef.current = worker;
    const requestId = crypto.randomUUID();
    worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
      if (event.data.requestId !== requestId) return;
      const seeds = event.data.nodes.flatMap<GraphWorkspaceSeed>((node) => {
        const current = positions[node.id];
        return current
          ? [
              {
                itemId: node.id,
                itemKind: current.itemKind,
                x: node.x,
                y: node.y,
                pinned: node.pinned,
              },
            ]
          : [];
      });
      store.getState().setPositions(seeds);
      persist(mode, store.getState().viewport, seeds);
      setArranging(false);
      worker.terminate();
      canvasRef.current?.fit();
    };
    worker.onerror = () => {
      setArranging(false);
      onError("Sheut could not arrange this graph. Your current layout is unchanged.");
      worker.terminate();
    };
    worker.postMessage({
      requestId,
      seed: stableSeed(view.workspace.id),
      width: 1_200,
      height: 800,
      nodes: view.nodes.flatMap((node) => {
        const position = positions[node.id];
        return position
          ? [{ id: node.id, x: position.x, y: position.y, pinned: position.pinned }]
          : [];
      }),
      links: view.edges.map((edge) => ({ sourceId: edge.sourceId, targetId: edge.targetId })),
    });
  };

  const saveSeeds = (seeds: GraphWorkspaceSeed[]) => {
    if (seeds.length > 0) persist(store.getState().mode, store.getState().viewport, seeds);
  };

  const connectSelected = () => {
    if (mode !== "build" || selection.length !== 2) return;
    const [sourceId, targetId] = selection;
    if (!sourceId || !targetId) return;
    void queueRef.current
      .enqueue(async () => {
        const saved = await createGraphVisualLink(
          projectId,
          view.workspace.id,
          revisionRef.current,
          sourceId,
          targetId,
          null,
        );
        revisionRef.current = saved.revision;
        await onReload(selection);
      })
      .catch(async (cause) => {
        if (isRevisionConflict(cause)) {
          await onReload(selection);
          return;
        }
        onError(graphErrorMessage(cause));
      });
  };

  const openRelationshipPreview = async () => {
    if (!selectedVisualLink) return;
    setRelationshipBusy(true);
    onError(null);
    try {
      const preview = await previewGraphRelationshipDraft(
        projectId,
        view.workspace.id,
        selectedVisualLink.id,
      );
      const suggestions = relationshipTypeSuggestions(
        preview.sourceObjectType,
        preview.targetObjectType,
      );
      setRelationshipType(suggestions[0] ?? "related-to");
      setRelationshipDescription("");
      setRelationshipPreview(preview);
    } catch (cause) {
      onError(graphErrorMessage(cause));
    } finally {
      setRelationshipBusy(false);
    }
  };

  const commitRelationshipDraft = async () => {
    if (!relationshipPreview || !relationshipType.trim()) return;
    setRelationshipBusy(true);
    try {
      await commitGraphRelationshipDraft(
        projectId,
        view.workspace.id,
        relationshipPreview.visualLinkId,
        relationshipType.trim(),
        relationshipDescription.trim() ? { description: relationshipDescription.trim() } : {},
      );
      setRelationshipPreview(null);
      notices.add({
        title: "STIX relationship draft created",
        description: "The visual link remains in this workspace as a separate local artifact.",
        type: "success",
      });
    } catch (cause) {
      onError(graphErrorMessage(cause));
    } finally {
      setRelationshipBusy(false);
    }
  };

  const openAddItems = async () => {
    setAddDialogOpen(true);
    setAddBusy(true);
    try {
      const sources = await listGraphSourceItems(projectId);
      setAddItems(sources.filter((item) => !(item.id in positions)));
    } catch (cause) {
      onError(graphErrorMessage(cause));
    } finally {
      setAddBusy(false);
    }
  };

  const addSelectedItems = async (items: GraphNodeSummary[]) => {
    if (items.length === 0) return;
    setAddBusy(true);
    const seeds = seedItems(items);
    try {
      await queueRef.current.enqueue(async () => {
        for (const batch of chunk(seeds, 1_000)) {
          const saved = await addGraphWorkspaceItems(
            projectId,
            view.workspace.id,
            revisionRef.current,
            batch,
          );
          revisionRef.current = saved.revision;
        }
        setAddDialogOpen(false);
        await onReload(selection);
      });
    } catch (cause) {
      onError(graphErrorMessage(cause));
    } finally {
      setAddBusy(false);
    }
  };

  const refreshProjectIntelligence = async () => {
    if (refreshingIntelligence) return;
    setRefreshingIntelligence(true);
    onError(null);
    try {
      const sources = await listGraphSourceItems(projectId);
      const missing = sources.filter(
        (item) => item.itemKind === "intelligence" && !(item.id in positions),
      );
      if (missing.length === 0) {
        notices.add({
          title: "Graph is current",
          description: "Every local STIX object and draft is already in this workspace.",
          type: "info",
        });
        return;
      }
      const seeds = seedItemsAfter(missing, positions);
      await queueRef.current.enqueue(async () => {
        for (const batch of chunk(seeds, 1_000)) {
          const saved = await addGraphWorkspaceItems(
            projectId,
            view.workspace.id,
            revisionRef.current,
            batch,
          );
          revisionRef.current = saved.revision;
        }
        await onReload(selection);
      });
      notices.add({
        title: "Project intelligence added",
        description: `${missing.length} ${missing.length === 1 ? "item" : "items"} added without changing the underlying STIX data.`,
        type: "success",
      });
    } catch (cause) {
      onError(graphErrorMessage(cause));
    } finally {
      setRefreshingIntelligence(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-moving={moving || undefined}>
      <GraphToolbar
        mode={mode}
        query={query}
        minimapVisible={minimapVisible}
        focusMode={focusMode}
        edgeKinds={edgeKinds}
        selectedCount={selection.length}
        undoCount={undoCount}
        redoCount={redoCount}
        onQueryChange={store.getState().setSearchQuery}
        onModeChange={(nextMode) => {
          store.getState().setMode(nextMode);
          persist(nextMode, store.getState().viewport, []);
        }}
        onUndo={() => saveSeeds(store.getState().undo())}
        onRedo={() => saveSeeds(store.getState().redo())}
        onArrange={arrange}
        onZoomIn={() => canvasRef.current?.zoomBy(1.25)}
        onZoomOut={() => canvasRef.current?.zoomBy(0.8)}
        onFitSelection={() => canvasRef.current?.fit(selection)}
        onFitAll={() => canvasRef.current?.fit()}
        onReset={() => canvasRef.current?.reset()}
        onToggleMinimap={() => setMinimapVisible((visible) => !visible)}
        onToggleFocusMode={() => {
          setFocusMode((current) => {
            onFocusModeChange?.(!current);
            return !current;
          });
        }}
        onEdgeKindsChange={setEdgeKinds}
        onTogglePinned={() => saveSeeds(store.getState().togglePinned(selection))}
        onRemoveSelected={() => {
          if (selection.length === 0) return;
          void queueRef.current
            .enqueue(async () => {
              const saved = await removeGraphWorkspaceItems(
                projectId,
                view.workspace.id,
                revisionRef.current,
                selection,
              );
              revisionRef.current = saved.revision;
              await onReload();
            })
            .catch((cause) => onError(graphErrorMessage(cause)));
        }}
        onConnectSelected={connectSelected}
        canConvertSelection={selectedVisualLink !== null}
        onConvertSelection={() => void openRelationshipPreview()}
        onAddItems={() => void openAddItems()}
        refreshingIntelligence={refreshingIntelligence}
        onRefreshIntelligence={
          view.workspace.name === "All intelligence"
            ? () => void refreshProjectIntelligence()
            : undefined
        }
      />
      {arranging ? (
        <div
          className="border-panel-border border-b bg-[#102b46] px-3 py-1 text-[11px] text-copy-secondary"
          role="status"
        >
          Arranging this workspace once in the background…
        </div>
      ) : null}
      {view.nodes.length === 0 ? (
        <EmptyWorkspace
          busy={refreshingIntelligence}
          onUseCurrentIntelligence={() => void refreshProjectIntelligence()}
        />
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <Suspense
            fallback={
              <div className="min-w-0 flex-1">
                <WorkspaceLoadingState
                  icon={<IconGraph size={24} aria-hidden="true" />}
                  title="Preparing graph canvas"
                  description="Loading the local interaction engine."
                />
              </div>
            }
          >
            <GraphCanvas
              ref={canvasRef}
              nodes={graphNodes}
              edges={graphEdges}
              positions={positions}
              selection={selection}
              viewport={viewport}
              mode={mode}
              minimapVisible={minimapVisible}
              onSelect={store.getState().select}
              onMoveStart={store.getState().beginMove}
              onMoveBy={store.getState().moveBy}
              onMoveEnd={() => saveSeeds(store.getState().finishMove())}
              onViewportChange={handleViewportChange}
              onConnectSelected={connectSelected}
            />
            <GraphLegend
              nodes={view.nodes}
              hiddenTypes={hiddenNodeTypes}
              onToggle={(objectType) =>
                setHiddenNodeTypes((current) => {
                  const next = new Set(current);
                  if (next.has(objectType)) next.delete(objectType);
                  else next.add(objectType);
                  return next;
                })
              }
            />
          </Suspense>
        </div>
      )}
      {view.nodes.length > 0 ? (
        <GraphTimeline
          nodes={view.nodes.filter(
            (node) => node.objectType !== "relationship" && node.objectType !== "sighting",
          )}
          cutoff={timelineCutoff}
          cumulative={timelineCumulative}
          onCutoffChange={setTimelineCutoff}
          onCumulativeChange={setTimelineCumulative}
        />
      ) : null}
      {query ? (
        <div className="absolute bottom-3 left-3 z-10 max-h-52 w-72 overflow-y-auto rounded-sm border border-panel-border bg-panel-base/95 p-1 shadow-xl">
          <p className="m-0 px-2 py-1 text-[11px] text-copy-faint" aria-live="polite">
            {matches.length} {matches.length === 1 ? "result" : "results"}
          </p>
          {matches.map((node) => (
            <Button
              key={node.id}
              className="flex w-full min-w-0 items-start gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left hover:bg-panel-hover"
              type="button"
              aria-label={`Focus ${node.displayName}`}
              onClick={() => {
                store.getState().select(node.id);
                canvasRef.current?.focusNode(node.id);
              }}
            >
              <span className="mt-0.5 shrink-0 text-[11px] text-accent-hover uppercase">
                {node.objectType.replaceAll("-", " ")}
              </span>
              <span className="min-w-0 text-copy-secondary text-xs leading-4">
                {node.displayName}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {selection.length === 0
          ? "No graph node selected"
          : `${selection.length} graph ${selection.length === 1 ? "node" : "nodes"} selected`}
      </p>
      {relationshipPreview ? (
        <Suspense fallback={null}>
          <GraphRelationshipDraftDialog
            preview={relationshipPreview}
            relationshipType={relationshipType}
            description={relationshipDescription}
            busy={relationshipBusy}
            onRelationshipTypeChange={setRelationshipType}
            onDescriptionChange={setRelationshipDescription}
            onClose={() => setRelationshipPreview(null)}
            onCommit={() => void commitRelationshipDraft()}
          />
        </Suspense>
      ) : null}
      {addDialogOpen ? (
        <Suspense fallback={null}>
          <SelectedItemsDialog
            onOpenChange={setAddDialogOpen}
            items={addItems}
            busy={addBusy}
            title="Add project items"
            description="Choose additional local project items. Existing workspace members are hidden."
            actionLabel="Add to workspace"
            onCreate={(items) => void addSelectedItems(items)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function EmptyWorkspace({
  busy,
  onUseCurrentIntelligence,
}: {
  busy: boolean;
  onUseCurrentIntelligence: () => void;
}) {
  return (
    <div className="grid min-h-72 flex-1 place-items-center p-8 text-center">
      <div className="max-w-md">
        <IconGraph
          className="mx-auto text-accent-hover"
          size={30}
          stroke={1.4}
          aria-hidden="true"
        />
        <h2 className="mt-4 mb-0 text-base font-semibold">This workspace has no items yet</h2>
        <p className="mt-2 mb-0 text-copy-muted text-sm leading-6">
          Your STIX objects remain in the encrypted project database. Add the current intelligence
          references here to view them as a graph; the source objects are not copied or changed.
        </p>
        <Button
          className="primary-button mt-5"
          type="button"
          disabled={busy}
          onClick={onUseCurrentIntelligence}
        >
          <IconStack2 size={15} aria-hidden="true" />
          {busy ? "Loading project intelligence…" : "Use current project intelligence"}
        </Button>
      </div>
    </div>
  );
}

function EmptyGraph({
  busy,
  onBlank,
  onAll,
  onSelected,
  onManage,
}: {
  busy: boolean;
  onBlank: () => void;
  onAll: () => void;
  onSelected: () => void;
  onManage: () => void;
}) {
  return (
    <div className="grid h-full min-h-80 place-items-center p-8">
      <div className="w-full max-w-3xl text-center">
        <IconGraph
          className="mx-auto text-accent-hover"
          size={32}
          stroke={1.35}
          aria-hidden="true"
        />
        <h1 className="mt-4 mb-0 text-lg font-semibold">Start an investigation graph</h1>
        <p className="mx-auto mt-2 mb-0 max-w-lg text-copy-muted text-sm leading-6">
          Build a visual workspace without changing the underlying intelligence. Everything stays
          encrypted in this local project.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <WorkspaceChoice
            icon={<IconFilePlus size={18} aria-hidden="true" />}
            title="Blank workspace"
            description="Start in Build mode and add project items manually."
            disabled={busy}
            onClick={onBlank}
          />
          <WorkspaceChoice
            icon={<IconStack2 size={18} aria-hidden="true" />}
            title="All intelligence"
            description="Open a viewer containing every imported intelligence object."
            disabled={busy}
            onClick={onAll}
          />
          <WorkspaceChoice
            icon={<IconFolderSearch size={18} aria-hidden="true" />}
            title="Selected items"
            description="Search the project and choose exactly what to include."
            disabled={busy}
            onClick={onSelected}
          />
        </div>
        <Button className="control-button mx-auto mt-4" type="button" onClick={onManage}>
          <IconSettings size={12} aria-hidden="true" />
          Manage deleted workspaces
        </Button>
      </div>
    </div>
  );
}

function WorkspaceChoice({
  icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="group min-h-32 rounded-md border border-panel-border bg-panel-base p-4 text-left outline-none transition hover:not-data-disabled:border-accent hover:not-data-disabled:bg-panel-hover disabled:opacity-45"
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={title}
    >
      <span className="text-accent-hover">{icon}</span>
      <span className="mt-3 block text-copy-primary text-sm">{title}</span>
      <span className="mt-1 block text-copy-faint text-xs leading-5">{description}</span>
    </Button>
  );
}

function GraphMessage({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <WorkspaceLoadingState
      icon={icon}
      title={title}
      description="Resolving local nodes, links, and saved positions."
    />
  );
}

function seedItems(items: GraphNodeSummary[]): GraphWorkspaceSeed[] {
  const columns = Math.max(1, Math.ceil(Math.sqrt(items.length)));
  return items.map((item, index) => ({
    itemId: item.id,
    itemKind: item.itemKind,
    x: ((index % columns) - (columns - 1) / 2) * 180,
    y: (Math.floor(index / columns) - (Math.ceil(items.length / columns) - 1) / 2) * 130,
    pinned: false,
  }));
}

function seedItemsAfter(
  items: GraphNodeSummary[],
  existing: Record<string, { x: number; y: number }>,
): GraphWorkspaceSeed[] {
  const seeds = seedItems(items);
  const current = Object.values(existing);
  if (current.length === 0 || seeds.length === 0) return seeds;
  const currentMaxX = Math.max(...current.map((position) => position.x));
  const seedMinX = Math.min(...seeds.map((seed) => seed.x));
  const shiftX = currentMaxX + 240 - seedMinX;
  return seeds.map((seed) => ({ ...seed, x: seed.x + shiftX }));
}

function stableSeed(value: string) {
  let seed = 2_166_136_261;
  for (const character of value) {
    seed ^= character.codePointAt(0) ?? 0;
    seed = Math.imul(seed, 16_777_619);
  }
  return seed >>> 0;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isRevisionConflict(cause: unknown) {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    String(cause.code) === "revision_conflict"
  );
}
