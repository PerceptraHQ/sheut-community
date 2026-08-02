import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Input } from "@base-ui/react/input";
import { IconRefresh, IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import {
  deleteGraphWorkspace,
  type GraphWorkspace,
  graphErrorMessage,
  listGraphWorkspaces,
  renameGraphWorkspace,
  restoreGraphWorkspace,
} from "../../lib/graph";
import { DialogFrame } from "../DialogFrame";

export function GraphWorkspaceManagerDialog({
  projectId,
  open,
  onOpenChange,
  onChanged,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [workspaces, setWorkspaces] = useState<GraphWorkspace[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await listGraphWorkspaces(projectId, true);
      setWorkspaces(loaded);
      setNames(Object.fromEntries(loaded.map((workspace) => [workspace.id, workspace.name])));
    } catch (cause) {
      setError(graphErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, open]);

  const mutate = async (workspace: GraphWorkspace, operation: () => Promise<GraphWorkspace>) => {
    setBusyId(workspace.id);
    setError(null);
    try {
      await operation();
      await Promise.all([load(), onChanged()]);
    } catch (cause) {
      setError(graphErrorMessage(cause));
    } finally {
      setBusyId(null);
    }
  };

  const active = workspaces.filter((workspace) => workspace.deleted_at_unix_ms === null);
  const deleted = workspaces.filter((workspace) => workspace.deleted_at_unix_ms !== null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogFrame width="wide">
        <div className="grid max-h-[min(42rem,calc(100dvh-2rem))] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
          <div className="border-panel-border border-b px-4 py-3">
            <Dialog.Title className="m-0 text-sm font-semibold">
              Manage graph workspaces
            </Dialog.Title>
            <Dialog.Description className="mt-1 mb-0 text-copy-muted text-xs leading-5">
              Deletion is recoverable and never removes intelligence, documents, or other project
              content.
            </Dialog.Description>
          </div>
          <div className="min-h-60 overflow-y-auto p-4">
            {error ? (
              <p className="error-message mb-3" role="alert">
                {error}
              </p>
            ) : null}
            {loading && workspaces.length === 0 ? (
              <p className="list-message">Loading workspaces…</p>
            ) : (
              <div className="grid gap-5">
                <WorkspaceSection title="Active workspaces" count={active.length}>
                  {active.map((workspace) => (
                    <div
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-sm border border-panel-border bg-panel-deep p-2"
                      key={workspace.id}
                    >
                      <Input
                        className="h-8 min-w-0 rounded-sm border border-panel-border bg-panel-base px-2 text-copy-primary text-xs outline-none focus:border-accent"
                        aria-label={`Rename ${workspace.name}`}
                        maxLength={120}
                        value={names[workspace.id] ?? workspace.name}
                        disabled={busyId !== null}
                        onChange={(event) =>
                          setNames((current) => ({
                            ...current,
                            [workspace.id]: event.currentTarget.value,
                          }))
                        }
                      />
                      <Button
                        className="control-button"
                        type="button"
                        disabled={
                          busyId !== null ||
                          !names[workspace.id]?.trim() ||
                          names[workspace.id]?.trim() === workspace.name
                        }
                        onClick={() =>
                          void mutate(workspace, () =>
                            renameGraphWorkspace(
                              projectId,
                              workspace.id,
                              workspace.revision,
                              names[workspace.id]?.trim() ?? workspace.name,
                            ),
                          )
                        }
                      >
                        Rename
                      </Button>
                      <Button
                        className="control-button danger-control"
                        type="button"
                        disabled={busyId !== null}
                        onClick={() =>
                          void mutate(workspace, () =>
                            deleteGraphWorkspace(projectId, workspace.id, workspace.revision),
                          )
                        }
                      >
                        <IconTrash size={12} aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                  ))}
                </WorkspaceSection>

                <WorkspaceSection title="Recently deleted" count={deleted.length}>
                  {deleted.map((workspace) => (
                    <div
                      className="flex min-w-0 items-center justify-between gap-3 rounded-sm border border-panel-border border-dashed bg-panel-deep p-2"
                      key={workspace.id}
                    >
                      <div className="min-w-0">
                        <p className="m-0 truncate text-copy-secondary text-xs">{workspace.name}</p>
                        <p className="mt-0.5 mb-0 text-[11px] text-copy-faint">
                          Workspace content remains in this project
                        </p>
                      </div>
                      <Button
                        className="control-button shrink-0"
                        type="button"
                        disabled={busyId !== null}
                        onClick={() =>
                          void mutate(workspace, () =>
                            restoreGraphWorkspace(projectId, workspace.id, workspace.revision),
                          )
                        }
                      >
                        <IconRefresh size={12} aria-hidden="true" />
                        Restore
                      </Button>
                    </div>
                  ))}
                </WorkspaceSection>
              </div>
            )}
          </div>
          <div className="flex justify-end border-panel-border border-t px-4 py-3">
            <Dialog.Close className="control-button">Done</Dialog.Close>
          </div>
        </div>
      </DialogFrame>
    </Dialog.Root>
  );
}

function WorkspaceSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="m-0 flex items-center gap-2 text-[11px] text-copy-faint uppercase tracking-wider">
        {title}
        <span>{count}</span>
      </h3>
      <div className="mt-2 grid gap-2">
        {count > 0 ? children : <p className="m-0 text-[11px] text-copy-faint">None</p>}
      </div>
    </section>
  );
}
