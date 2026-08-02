import { Progress } from "@base-ui/react/progress";
import type { ReactNode } from "react";

interface WorkspaceLoadingStateProps {
  description?: string;
  icon: ReactNode;
  title: string;
}

export function WorkspaceLoadingState({ description, icon, title }: WorkspaceLoadingStateProps) {
  return (
    <div className="grid h-full min-h-72 place-items-center p-8 text-center" aria-busy="true">
      <div className="w-full max-w-64">
        <span className="mx-auto block w-fit text-accent-hover">{icon}</span>
        <Progress.Root className="mt-4" value={null}>
          <Progress.Label className="sr-only">{title}</Progress.Label>
          <Progress.Track className="h-1 overflow-hidden rounded-full bg-panel-raised">
            <Progress.Indicator className="workspace-progress-indicator h-full rounded-full bg-accent-hover" />
          </Progress.Track>
        </Progress.Root>
        <p className="mt-3 mb-0 font-semibold text-copy-secondary text-xs" role="status">
          {title}
        </p>
        {description ? (
          <p className="mt-1 mb-0 text-[11px] text-copy-faint leading-4">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

interface WorkspaceEmptyStateProps extends WorkspaceLoadingStateProps {
  action?: ReactNode;
}

export function WorkspaceEmptyState({
  action,
  description,
  icon,
  title,
}: WorkspaceEmptyStateProps) {
  return (
    <div className="grid h-full min-h-72 place-items-center p-8 text-center">
      <div className="w-full max-w-sm">
        <span className="mx-auto block w-fit text-copy-faint">{icon}</span>
        <p className="mt-4 mb-0 font-semibold text-copy-secondary text-sm">{title}</p>
        {description ? (
          <p className="mt-1 mb-0 text-copy-faint text-xs leading-5">{description}</p>
        ) : null}
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}
