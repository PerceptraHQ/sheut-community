import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toolbar } from "@base-ui/react/toolbar";
import { Tooltip } from "@base-ui/react/tooltip";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowsMaximize,
  IconFocusCentered,
  IconFolderPlus,
  IconLayoutDistributeHorizontal,
  IconLinkPlus,
  IconMap2,
  IconMaximize,
  IconMinus,
  IconPin,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import type { GraphEdgeKind, GraphWorkspaceMode } from "../../lib/graph";

interface GraphToolbarProps {
  mode: GraphWorkspaceMode;
  query: string;
  minimapVisible: boolean;
  focusMode: boolean;
  edgeKinds: GraphEdgeKind[];
  selectedCount: number;
  undoCount: number;
  redoCount: number;
  onQueryChange: (query: string) => void;
  onModeChange: (mode: GraphWorkspaceMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onArrange: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitSelection: () => void;
  onFitAll: () => void;
  onReset: () => void;
  onToggleMinimap: () => void;
  onToggleFocusMode: () => void;
  onEdgeKindsChange: (kinds: GraphEdgeKind[]) => void;
  onTogglePinned: () => void;
  onRemoveSelected: () => void;
  onConnectSelected: () => void;
  canConvertSelection: boolean;
  onConvertSelection: () => void;
  onAddItems: () => void;
  refreshingIntelligence?: boolean;
  onRefreshIntelligence?: () => void;
}

const buttonClassName =
  "flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-sm border border-transparent bg-transparent px-1.5 text-copy-muted outline-none transition-colors hover:not-data-disabled:bg-panel-hover hover:not-data-disabled:text-copy-primary data-pressed:border-accent/70 data-pressed:bg-[#102b46] data-pressed:text-copy-primary data-disabled:cursor-not-allowed data-disabled:opacity-35";

export function GraphToolbar({
  mode,
  query,
  minimapVisible,
  focusMode,
  edgeKinds,
  selectedCount,
  undoCount,
  redoCount,
  onQueryChange,
  onModeChange,
  onUndo,
  onRedo,
  onArrange,
  onZoomIn,
  onZoomOut,
  onFitSelection,
  onFitAll,
  onReset,
  onToggleMinimap,
  onToggleFocusMode,
  onEdgeKindsChange,
  onTogglePinned,
  onRemoveSelected,
  onConnectSelected,
  canConvertSelection,
  onConvertSelection,
  onAddItems,
  refreshingIntelligence = false,
  onRefreshIntelligence,
}: GraphToolbarProps) {
  const buildMode = mode === "build";
  return (
    <Tooltip.Provider delay={300}>
      <Toolbar.Root
        className="flex min-w-0 flex-wrap items-center gap-1 border-panel-border border-b bg-panel-deep px-2 py-1.5"
        aria-label="Graph tools"
      >
        <label
          className="flex h-7 min-w-40 flex-1 basis-52 items-center gap-2 rounded-sm border border-panel-border bg-panel-base px-2 text-copy-faint focus-within:border-accent"
          htmlFor="graph-search"
        >
          <IconSearch size={13} aria-hidden="true" />
          <Toolbar.Input
            id="graph-search"
            className="min-w-0 flex-1 border-0 bg-transparent text-copy-primary text-xs outline-none placeholder:text-copy-faint"
            aria-label="Search graph"
            placeholder="Search nodes"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
          />
        </label>

        <Toolbar.Separator className="mx-1 h-4 w-px bg-panel-border" />
        <ToggleGroup
          className="flex items-center gap-px rounded-sm border border-panel-border p-px"
          aria-label="Graph mode"
          value={[mode]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "view" || next === "build") onModeChange(next);
          }}
        >
          <GraphToggle label="View mode" value="view">
            View
          </GraphToggle>
          <GraphToggle label="Build mode" value="build">
            Build
          </GraphToggle>
        </ToggleGroup>

        <Toolbar.Separator className="mx-1 h-4 w-px bg-panel-border" />
        <ToggleGroup
          multiple
          className="flex items-center gap-px rounded-sm border border-panel-border p-px"
          aria-label="Visible graph edge types"
          value={edgeKinds}
          onValueChange={onEdgeKindsChange}
        >
          <GraphToggle label="Semantic relationship edges" value="semantic">
            Semantic
          </GraphToggle>
          <GraphToggle label="STIX reference edges" value="reference">
            Refs
          </GraphToggle>
          <GraphToggle label="Workspace-only visual links" value="visual">
            Visual
          </GraphToggle>
          <GraphToggle label="Local draft relationship edges" value="draft">
            Draft
          </GraphToggle>
        </ToggleGroup>

        <Toolbar.Separator className="mx-1 h-4 w-px bg-panel-border" />
        <Toolbar.Group className="flex gap-px" aria-label="Edit graph">
          {onRefreshIntelligence ? (
            <GraphButton
              label={
                refreshingIntelligence
                  ? "Refreshing project intelligence"
                  : "Refresh from current project intelligence"
              }
              disabled={refreshingIntelligence}
              onClick={onRefreshIntelligence}
            >
              <IconRefresh size={14} aria-hidden="true" />
            </GraphButton>
          ) : null}
          <GraphButton
            label={buildMode ? "Add project items" : "Switch to Build mode to add project items"}
            disabled={!buildMode}
            onClick={onAddItems}
          >
            <IconFolderPlus size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton label="Undo" disabled={undoCount === 0} onClick={onUndo}>
            <IconArrowBackUp size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton label="Redo" disabled={redoCount === 0} onClick={onRedo}>
            <IconArrowForwardUp size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton label="Auto-arrange" onClick={onArrange}>
            <IconLayoutDistributeHorizontal size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton
            label={
              buildMode
                ? selectedCount > 0
                  ? `Pin or unpin ${selectedCount} selected`
                  : "Pin selected"
                : "Switch to Build mode to pin items"
            }
            disabled={!buildMode || selectedCount === 0}
            onClick={onTogglePinned}
          >
            <IconPin size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton
            label="Remove selected from workspace"
            disabled={selectedCount === 0}
            onClick={onRemoveSelected}
          >
            <IconTrash size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton
            label={
              buildMode
                ? "Connect two selected nodes with a visual link"
                : "Switch to Build mode to connect items"
            }
            disabled={!buildMode || selectedCount !== 2}
            onClick={onConnectSelected}
          >
            <IconLinkPlus size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton
            label={
              buildMode
                ? "Create a separate STIX relationship draft from the selected visual link"
                : "Switch to Build mode to create a STIX relationship draft"
            }
            disabled={!buildMode || !canConvertSelection}
            onClick={onConvertSelection}
          >
            <IconSparkles size={14} aria-hidden="true" />
          </GraphButton>
        </Toolbar.Group>

        <Toolbar.Separator className="mx-1 h-4 w-px bg-panel-border" />
        <Toolbar.Group className="flex gap-px" aria-label="Graph viewport">
          <GraphButton label="Zoom in" onClick={onZoomIn}>
            <IconPlus size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton label="Zoom out" onClick={onZoomOut}>
            <IconMinus size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton
            label="Fit selection"
            disabled={selectedCount === 0}
            onClick={onFitSelection}
          >
            <IconFocusCentered size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton label="Fit all" onClick={onFitAll}>
            <IconArrowsMaximize size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton label="Reset viewport" onClick={onReset}>
            <IconMaximize size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton
            label={minimapVisible ? "Hide minimap" : "Show minimap"}
            active={minimapVisible}
            onClick={onToggleMinimap}
          >
            <IconMap2 size={14} aria-hidden="true" />
          </GraphButton>
          <GraphButton
            label={focusMode ? "Exit canvas focus mode" : "Enter canvas focus mode"}
            active={focusMode}
            onClick={onToggleFocusMode}
          >
            <IconFocusCentered size={14} aria-hidden="true" />
          </GraphButton>
        </Toolbar.Group>
      </Toolbar.Root>
    </Tooltip.Provider>
  );
}

function GraphButton({
  label,
  children,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Toolbar.Button
            className={buttonClassName}
            type="button"
            aria-label={label}
            aria-pressed={active || undefined}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} className="z-50">
          <Tooltip.Popup className="rounded-sm border border-panel-border bg-panel-raised px-2 py-1 text-[11px] text-copy-secondary shadow-xl ring-1 ring-white/5 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function GraphToggle({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Toggle
            className={`${buttonClassName} min-w-12 px-2 text-[11px]`}
            value={value}
            aria-label={label}
          />
        }
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} className="z-50">
          <Tooltip.Popup className="rounded-sm border border-panel-border bg-panel-raised px-2 py-1 text-[11px] text-copy-secondary shadow-xl ring-1 ring-white/5">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
