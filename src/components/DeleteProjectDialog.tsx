import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@base-ui/react/button";
import { IconX } from "@tabler/icons-react";
import { useId, useState } from "react";
import { type ProjectSummary, projectErrorMessage } from "../lib/projects";
import { AlertDialogFrame } from "./AlertDialogFrame";

interface DeleteProjectDialogProps {
  project: ProjectSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (projectId: string) => Promise<void>;
}

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDelete,
}: DeleteProjectDialogProps) {
  const confirmationId = useId();
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectName = project.name ?? project.id;
  const confirmed = confirmation === projectName;

  const reset = () => {
    setConfirmation("");
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (deleting) return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const handleDelete = async () => {
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(project.id);
      reset();
      onOpenChange(false);
    } catch (cause) {
      setError(projectErrorMessage(cause));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialogFrame>
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <AlertDialog.Title className="m-0 truncate pr-3 text-sm font-semibold">
            Delete {projectName}
          </AlertDialog.Title>
          <AlertDialog.Close
            render={<Button className="icon-control" />}
            aria-label="Close"
            disabled={deleting}
          >
            <IconX size={16} stroke={1.7} aria-hidden="true" />
          </AlertDialog.Close>
        </header>
        <div className="grid gap-4 p-4">
          <AlertDialog.Description className="m-0 text-copy-muted text-xs leading-5">
            This permanently removes the encrypted database, documents, attachments, and recovery
            points stored for this project. Export anything you need first.
          </AlertDialog.Description>
          <div className="grid gap-1.5">
            <label className="font-medium text-copy-secondary text-xs" htmlFor={confirmationId}>
              Type {projectName} to confirm
            </label>
            <input
              className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-sm outline-none focus:border-danger"
              id={confirmationId}
              value={confirmation}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              autoComplete="off"
              disabled={deleting}
            />
          </div>
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
            <AlertDialog.Close render={<Button className="control-button" />} disabled={deleting}>
              Cancel
            </AlertDialog.Close>
            <Button
              className="danger-button"
              type="button"
              disabled={!confirmed || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? "Deleting…" : "Delete project"}
            </Button>
          </div>
        </div>
      </AlertDialogFrame>
    </AlertDialog.Root>
  );
}
