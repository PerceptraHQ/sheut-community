import { Button } from "@base-ui/react/button";
import { Menu } from "@base-ui/react/menu";
import {
  IconLayoutDashboard,
  IconWindowMaximize,
  IconWindowMinimize,
  IconX,
} from "@tabler/icons-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import type { ProjectSearchResult } from "../lib/projectSearch";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  loadWorkbenchLayout,
  saveWorkbenchLayout,
  type WorkbenchLayoutPreferences,
  type WorkbenchSide,
} from "../lib/workbenchLayout";
import { ProjectTitleSearch } from "./ProjectTitleSearch";

interface WindowTitleBarProps {
  closeBlocked: boolean;
  layout: WorkbenchLayoutPreferences;
  onLayoutChange: (layout: WorkbenchLayoutPreferences) => void;
  onOpenSearchResult: (result: ProjectSearchResult) => void;
  onZenModeChange: (active: boolean) => void;
  projectId: string | null;
  projectName: string | null;
  searchDisabled: boolean;
  zenMode: boolean;
}

const menuItemClass =
  "grid min-w-56 cursor-default grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 py-1.5 text-copy-secondary text-xs outline-none data-highlighted:bg-panel-hover data-highlighted:text-copy-primary data-disabled:opacity-45";

export function WindowTitleBar({
  closeBlocked,
  layout,
  onLayoutChange,
  onOpenSearchResult,
  onZenModeChange,
  projectId,
  projectName,
  searchDisabled,
  zenMode,
}: WindowTitleBarProps) {
  const [windowError, setWindowError] = useState<string | null>(null);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const patchLayout = (patch: Partial<WorkbenchLayoutPreferences>) => {
    const next = { ...layout, ...patch };
    saveWorkbenchLayout(next);
    onLayoutChange(next);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => onLayoutChange(loadWorkbenchLayout()), 0);
    return () => window.clearTimeout(timer);
  }, [onLayoutChange]);

  const runWindowAction = (action: "close" | "minimize" | "toggleMaximize") => {
    setWindowError(null);
    const currentWindow = getCurrentWindow();
    void currentWindow[action]().catch(() => setWindowError("Window action unavailable"));
  };

  const toggleFullscreen = useCallback(() => {
    setWindowError(null);
    const currentWindow = getCurrentWindow();
    void currentWindow
      .isFullscreen()
      .then((active) =>
        currentWindow.setFullscreen(!active).then(() => {
          setFullscreen(!active);
        }),
      )
      .catch(() => setWindowError("Fullscreen unavailable"));
  }, []);

  useEffect(() => {
    let resizeTimer = 0;
    const refreshFullscreen = () => {
      try {
        void getCurrentWindow()
          .isFullscreen()
          .then(setFullscreen)
          .catch(() => undefined);
      } catch {
        // The native bridge is unavailable in non-Tauri render environments.
      }
    };
    const handleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(refreshFullscreen, 100);
    };
    refreshFullscreen();
    window.addEventListener("resize", handleResize);
    return () => {
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && zenMode) {
        event.preventDefault();
        onZenModeChange(false);
      }
      if (event.key === "F11") {
        event.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onZenModeChange, toggleFullscreen, zenMode]);

  const startWindowDragging = () => {
    setWindowError(null);
    void getCurrentWindow()
      .startDragging()
      .catch(() => setWindowError("Window dragging unavailable"));
  };

  const macOs = /Macintosh|Mac OS X/u.test(navigator.userAgent);

  return (
    <header
      className="window-title-bar border-panel-border border-b bg-panel-deep"
      data-fullscreen={fullscreen}
      data-window-platform={macOs ? "macos" : "desktop"}
      title={projectName ? `${projectName} — Sheut` : "Sheut Community"}
    >
      <div className="flex h-full min-w-0 items-center gap-3 overflow-hidden px-2">
        {macOs && !fullscreen ? (
          <WindowControls closeBlocked={closeBlocked} macOs runWindowAction={runWindowAction} />
        ) : null}
        <Button
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 border-0 bg-transparent p-0 text-left outline-none"
          data-tauri-drag-region=""
          type="button"
          aria-label="Window title; drag to move, double-click to fill or restore"
          onDoubleClick={() => runWindowAction("toggleMaximize")}
          onKeyDown={(event) => {
            if (event.key === "Enter") runWindowAction("toggleMaximize");
          }}
          onMouseDown={(event) => {
            if (event.button === 0 && event.detail === 1) startWindowDragging();
          }}
        ></Button>
      </div>

      <ProjectTitleSearch
        key={projectId ?? "locked"}
        disabled={searchDisabled}
        projectId={projectId}
        onOpenResult={onOpenSearchResult}
      />

      <fieldset className="m-0 flex h-full min-w-0 items-stretch justify-end border-0 p-0">
        <legend className="sr-only">Title bar actions</legend>
        {windowError ? (
          <span className="self-center px-2 text-[11px] text-danger" role="status">
            {windowError}
          </span>
        ) : null}
        <Menu.Root open={layoutMenuOpen} onOpenChange={setLayoutMenuOpen}>
          <Menu.Trigger
            className="my-1 flex items-center gap-1 rounded-sm border-0 bg-transparent px-2 text-copy-muted text-xs outline-none hover:bg-panel-hover hover:text-copy-primary data-popup-open:bg-panel-hover"
            aria-label="Customize workbench layout"
          >
            <IconLayoutDashboard size={13} aria-hidden="true" />
            Layout
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="z-50 outline-none" align="start" sideOffset={5}>
              <Menu.Popup className="origin-[var(--transform-origin)] rounded-sm border border-panel-border bg-panel-raised p-1 shadow-xl ring-1 ring-white/5 outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
                <Menu.Group>
                  <Menu.GroupLabel className="px-2 py-1 text-[11px] text-copy-faint uppercase tracking-wider">
                    Visibility
                  </Menu.GroupLabel>
                  <LayoutCheckbox
                    checked={layout.activityBarVisible}
                    label="Activity bar"
                    onCheckedChange={(checked) => patchLayout({ activityBarVisible: checked })}
                  />
                  <LayoutCheckbox
                    checked={layout.primarySideBarVisible}
                    label="Primary sidebar"
                    onCheckedChange={(checked) => patchLayout({ primarySideBarVisible: checked })}
                  />
                  <LayoutCheckbox
                    checked={layout.secondarySideBarVisible}
                    label="Secondary sidebar"
                    onCheckedChange={(checked) => patchLayout({ secondarySideBarVisible: checked })}
                  />
                  <LayoutCheckbox
                    checked={layout.centeredLayout}
                    label="Centered layout"
                    onCheckedChange={(checked) => patchLayout({ centeredLayout: checked })}
                  />
                </Menu.Group>
                <Menu.Separator className="mx-1 my-1 h-px bg-panel-border" />
                <LayoutSideGroup
                  label="Primary dock position"
                  value={layout.activityBarPosition}
                  onValueChange={(value) => patchLayout({ activityBarPosition: value })}
                />
                <LayoutSideGroup
                  label="Secondary sidebar position"
                  value={layout.secondarySideBarPosition}
                  onValueChange={(value) => patchLayout({ secondarySideBarPosition: value })}
                />
                <Menu.Separator className="mx-1 my-1 h-px bg-panel-border" />
                <Menu.CheckboxItem
                  checked={zenMode}
                  className={menuItemClass}
                  onCheckedChange={onZenModeChange}
                >
                  <Menu.CheckboxItemIndicator
                    className="text-accent-hover data-unchecked:invisible"
                    data-layout-indicator=""
                    keepMounted
                  >
                    ✓
                  </Menu.CheckboxItemIndicator>
                  <span>Zen mode</span>
                  <kbd className="font-sans text-[11px] text-copy-faint">Esc to exit</kbd>
                </Menu.CheckboxItem>
                <Menu.Item className={menuItemClass} onClick={toggleFullscreen}>
                  <span aria-hidden="true">↗</span>
                  <span>Toggle full screen</span>
                  <kbd className="font-sans text-[11px] text-copy-faint">F11</kbd>
                </Menu.Item>
                <Menu.Item
                  className={menuItemClass}
                  onClick={() => {
                    saveWorkbenchLayout(DEFAULT_WORKBENCH_LAYOUT);
                    onLayoutChange({ ...DEFAULT_WORKBENCH_LAYOUT });
                  }}
                >
                  <span aria-hidden="true">↺</span>
                  <span>Reset layout</span>
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        {!macOs ? (
          <WindowControls
            closeBlocked={closeBlocked}
            macOs={false}
            runWindowAction={runWindowAction}
          />
        ) : null}
      </fieldset>
    </header>
  );
}

function LayoutCheckbox({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Menu.CheckboxItem
      checked={checked}
      className={menuItemClass}
      onCheckedChange={onCheckedChange}
    >
      <Menu.CheckboxItemIndicator
        className="text-accent-hover data-unchecked:invisible"
        data-layout-indicator=""
        keepMounted
      >
        ✓
      </Menu.CheckboxItemIndicator>
      <span>{label}</span>
    </Menu.CheckboxItem>
  );
}

function LayoutSideGroup({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: WorkbenchSide;
  onValueChange: (value: WorkbenchSide) => void;
}) {
  return (
    <Menu.RadioGroup
      value={value}
      onValueChange={(next: unknown) => {
        if (next === "left" || next === "right") onValueChange(next);
      }}
    >
      <Menu.GroupLabel className="px-2 pt-1.5 pb-1 text-[11px] text-copy-faint uppercase tracking-wider">
        {label}
      </Menu.GroupLabel>
      {(["left", "right"] as const).map((side) => (
        <Menu.RadioItem className={menuItemClass} key={side} value={side}>
          <Menu.RadioItemIndicator
            className="text-accent-hover data-unchecked:invisible"
            keepMounted
          >
            ●
          </Menu.RadioItemIndicator>
          <span className="capitalize">{side}</span>
        </Menu.RadioItem>
      ))}
    </Menu.RadioGroup>
  );
}

function WindowControls({
  closeBlocked,
  macOs,
  runWindowAction,
}: {
  closeBlocked: boolean;
  macOs: boolean;
  runWindowAction: (action: "close" | "minimize" | "toggleMaximize") => void;
}) {
  if (macOs) {
    return (
      <fieldset className="group m-0 flex shrink-0 items-center gap-2 border-0 p-0">
        <legend className="sr-only">Window controls</legend>
        <MacWindowButton
          close
          disabled={closeBlocked}
          label={closeBlocked ? "Wait for the current save before closing" : "Close Sheut"}
          onClick={() => runWindowAction("close")}
        >
          <IconX size={8} stroke={2.5} aria-hidden="true" />
        </MacWindowButton>
        <MacWindowButton label="Minimize" onClick={() => runWindowAction("minimize")}>
          <IconWindowMinimize size={8} stroke={2.5} aria-hidden="true" />
        </MacWindowButton>
        <MacWindowButton label="Fill or restore" onClick={() => runWindowAction("toggleMaximize")}>
          <IconWindowMaximize size={8} stroke={2.5} aria-hidden="true" />
        </MacWindowButton>
      </fieldset>
    );
  }

  return (
    <fieldset className="m-0 flex h-full items-stretch border-0 p-0">
      <legend className="sr-only">Window controls</legend>
      <WindowButton label="Minimize" onClick={() => runWindowAction("minimize")}>
        <IconWindowMinimize size={14} aria-hidden="true" />
      </WindowButton>
      <WindowButton label="Maximize or restore" onClick={() => runWindowAction("toggleMaximize")}>
        <IconWindowMaximize size={13} aria-hidden="true" />
      </WindowButton>
      <WindowButton
        close
        disabled={closeBlocked}
        label={closeBlocked ? "Wait for the current save before closing" : "Close Sheut"}
        onClick={() => runWindowAction("close")}
      >
        <IconX size={14} aria-hidden="true" />
      </WindowButton>
    </fieldset>
  );
}

function MacWindowButton({
  children,
  close = false,
  disabled = false,
  label,
  onClick,
}: {
  children: ReactNode;
  close?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  const surface = close ? "bg-[#ff5f57]" : label === "Minimize" ? "bg-[#febc2e]" : "bg-[#28c840]";
  return (
    <Button
      className={`grid size-3 place-items-center rounded-full border border-black/15 p-0 text-black/75 outline-none disabled:opacity-35 ${surface} [&_svg]:opacity-0 group-hover:[&_svg]:opacity-100 focus-visible:[&_svg]:opacity-100`}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function WindowButton({
  children,
  close = false,
  disabled = false,
  label,
  onClick,
}: {
  children: ReactNode;
  close?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className={`grid h-full w-11 place-items-center border-0 bg-transparent text-copy-muted outline-none enabled:hover:text-copy-primary disabled:opacity-35 ${close ? "enabled:hover:bg-[#c42b1c]" : "enabled:hover:bg-panel-hover"}`}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
