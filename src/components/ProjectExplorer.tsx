import { Button } from "@base-ui/react/button";
import {
  IconChevronDown,
  IconFolders,
  IconGitFork,
  IconLayoutGrid,
  IconPhoto,
  IconTopologyStar3,
} from "@tabler/icons-react";
import type { ProjectSummary } from "../lib/projects";

const projectSections = [
  { id: "investigations", label: "Documents", icon: IconFolders, implemented: true },
  { id: "intelligence", label: "Intelligence", icon: IconGitFork, implemented: true },
  { id: "evidence", label: "Evidence", icon: IconPhoto, implemented: true },
  { id: "mitre", label: "MITRE ATT&CK", icon: IconLayoutGrid, implemented: true },
  { id: "graph", label: "Graph", icon: IconTopologyStar3, implemented: true },
] as const;

interface ProjectExplorerProps {
  project: ProjectSummary | null;
  activeView:
    | "overview"
    | "investigations"
    | "intelligence"
    | "evidence"
    | "mitre"
    | "graph"
    | "settings";
  navigationBlocked: boolean;
  onSelectOverview: () => void;
  onSelectView: (view: "investigations" | "intelligence" | "evidence" | "mitre" | "graph") => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function ProjectExplorer({
  project,
  activeView,
  navigationBlocked,
  onSelectOverview,
  onSelectView,
  collapsed,
  onToggleCollapsed,
}: ProjectExplorerProps) {
  return (
    <aside
      className="project-explorer min-w-0 border-panel-border border-r bg-panel-base"
      aria-label="Project explorer"
      data-collapsed={collapsed}
    >
      <header className="project-explorer-header border-panel-border border-b">
        {!collapsed ? (
          <div className="min-w-0">
            <p className="m-0 truncate font-black text-copy-primary text-xs tracking-wide">SHEUT</p>
            <p className="m-0 font-semibold text-[11px] text-copy-faint">Community Edition</p>
          </div>
        ) : null}
        <Button
          className="icon-control panel-collapse-control"
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand project explorer" : "Collapse project explorer"}
          title={collapsed ? "Expand project explorer" : "Collapse project explorer"}
        >
          <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
        </Button>
      </header>

      {project ? (
        <Button
          className="flex h-9 w-full items-center gap-1 border-0 border-panel-border border-b bg-transparent px-2 text-copy-muted enabled:cursor-pointer enabled:hover:bg-panel-hover disabled:cursor-not-allowed disabled:opacity-55"
          type="button"
          onClick={onSelectOverview}
          disabled={navigationBlocked}
          title={navigationBlocked ? "Wait for the document save to finish" : "Project overview"}
          aria-label="Project overview"
        >
          {!collapsed ? <IconChevronDown size={14} stroke={1.7} aria-hidden="true" /> : null}
          {!collapsed ? (
            <span className="min-w-0 truncate font-bold text-xs text-copy-secondary uppercase tracking-wider">
              Overview
            </span>
          ) : null}
        </Button>
      ) : (
        <div className="flex h-9 items-center gap-1 border-panel-border border-b px-2 text-copy-muted">
          {!collapsed ? <IconChevronDown size={14} stroke={1.7} aria-hidden="true" /> : null}
          {!collapsed ? (
            <p className="m-0 min-w-0 truncate font-bold text-xs text-copy-secondary uppercase tracking-wider">
              No project open
            </p>
          ) : null}
        </div>
      )}

      <div className="py-1.5">
        {project ? (
          projectSections.map((section) => {
            const Icon = section.icon;
            return (
              <Button
                className="project-section-button"
                type="button"
                disabled={!section.implemented}
                key={section.label}
                aria-current={activeView === section.id ? "page" : undefined}
                aria-label={section.label}
                title={section.implemented ? section.label : `${section.label} — planned`}
                onClick={() => {
                  if (
                    section.id === "investigations" ||
                    section.id === "intelligence" ||
                    section.id === "evidence" ||
                    section.id === "mitre" ||
                    section.id === "graph"
                  ) {
                    onSelectView(section.id);
                  }
                }}
              >
                <Icon size={15} stroke={1.6} aria-hidden="true" />
                {!collapsed ? <span>{section.label}</span> : null}
              </Button>
            );
          })
        ) : !collapsed ? (
          <p className="m-0 px-3 py-2 text-copy-faint text-xs leading-5">
            Open a local project to browse its contents.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
