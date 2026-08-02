import { Button } from "@base-ui/react/button";
import { IconFolders, IconSettings } from "@tabler/icons-react";
import sheutLogo from "../assets/sheut-logo.svg";

interface ActivityRailProps {
  activeView: string;
  onSelectProjects: () => void;
  onSelectSettings: () => void;
}

export function ActivityRail({
  activeView,
  onSelectProjects,
  onSelectSettings,
}: ActivityRailProps) {
  return (
    <aside
      className="activity-rail border-panel-border border-r bg-panel-deep"
      aria-label="Application"
    >
      <div className="grid h-11 shrink-0 place-items-center border-panel-border border-b">
        <img className="size-6 rounded-sm object-contain" src={sheutLogo} alt="Sheut" />
      </div>
      <nav className="flex flex-col items-center gap-1 py-2" aria-label="Activity rail">
        <Button
          className="rail-button grid size-9 cursor-pointer place-items-center rounded-sm border-0 bg-transparent text-copy-muted hover:bg-panel-hover hover:text-copy-primary"
          type="button"
          aria-label="Projects"
          aria-current={activeView !== "settings" ? "page" : undefined}
          title="Projects"
          onClick={onSelectProjects}
        >
          <IconFolders size={19} stroke={1.65} aria-hidden="true" />
        </Button>
      </nav>
      <div className="mt-auto grid place-items-center border-panel-border border-t py-2">
        <Button
          className="rail-button grid size-9 cursor-pointer place-items-center rounded-sm border-0 bg-transparent text-copy-muted hover:bg-panel-hover hover:text-copy-primary"
          type="button"
          aria-label="Settings"
          aria-current={activeView === "settings" ? "page" : undefined}
          title="Settings"
          onClick={onSelectSettings}
        >
          <IconSettings size={19} stroke={1.65} aria-hidden="true" />
        </Button>
      </div>
    </aside>
  );
}
