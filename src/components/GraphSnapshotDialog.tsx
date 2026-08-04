import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { type GraphWorkspace, listGraphWorkspaces } from "../lib/graph";
import { DialogFrame } from "./DialogFrame";

interface GraphSnapshotDialogProps {
  onInsert: (workspace: GraphWorkspace, placement: "inline" | "appendix") => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projectId: string;
}

export function GraphSnapshotDialog({
  onInsert,
  onOpenChange,
  open,
  projectId,
}: GraphSnapshotDialogProps) {
  const [workspaces, setWorkspaces] = useState<GraphWorkspace[]>([]);
  const [selected, setSelected] = useState<GraphWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void listGraphWorkspaces(projectId)
      .then((items) => {
        if (active) setWorkspaces(items);
      })
      .catch(() => {
        if (active) setError("Graph workspaces could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, projectId]);
  const insert = async (placement: "inline" | "appendix") => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await onInsert(selected, placement);
    } catch {
      setError("The graph snapshot could not be created. Reload the workspace and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogFrame width="command">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 text-sm font-semibold">Insert graph snapshot</Dialog.Title>
          <Dialog.Close render={<Button className="icon-control" />} aria-label="Close">
            <IconX size={16} stroke={1.7} aria-hidden="true" />
          </Dialog.Close>
        </header>
        <div className="grid gap-3 p-4">
          <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
            Sheut renders the selected revision to a frozen PNG and stores it as an encrypted
            document attachment. Publishing never substitutes a newer graph.
          </Dialog.Description>
          <Field.Root>
            <Field.Label className="mb-1.5 block text-copy-secondary text-xs">
              Graph workspace
            </Field.Label>
            <div className="report-data-results" role="listbox" aria-label="Graph workspace">
              {loading ? (
                <p className="list-message">Loading graphs…</p>
              ) : workspaces.length === 0 ? (
                <p className="list-message">No graph workspaces are available.</p>
              ) : (
                workspaces.map((workspace) => (
                  <Button
                    className="report-data-option"
                    type="button"
                    role="option"
                    aria-selected={selected?.id === workspace.id}
                    key={workspace.id}
                    onClick={() => setSelected(workspace)}
                  >
                    <span
                      className="report-data-radio"
                      data-selected={selected?.id === workspace.id || undefined}
                    />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-copy-primary text-sm">
                        {workspace.name}
                      </span>
                      <span className="block text-copy-faint text-[11px]">
                        Revision {workspace.revision}
                      </span>
                    </span>
                  </Button>
                ))
              )}
            </div>
          </Field.Root>
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex min-h-12 items-center justify-end gap-2 border-panel-border border-t px-4 py-2">
          <Dialog.Close render={<Button className="control-button" type="button" />}>
            Cancel
          </Dialog.Close>
          <Button
            className="control-button"
            type="button"
            disabled={!selected || busy}
            onClick={() => void insert("appendix")}
          >
            Analytical figures
          </Button>
          <Button
            className="control-button control-button-primary"
            type="button"
            disabled={!selected || busy}
            onClick={() => void insert("inline")}
          >
            {busy ? "Rendering…" : "Insert inline"}
          </Button>
        </footer>
      </DialogFrame>
    </Dialog.Root>
  );
}
