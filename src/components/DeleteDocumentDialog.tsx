import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@base-ui/react/button";
import { useState } from "react";
import { type DocumentEnvelope, documentErrorMessage, documentTitle } from "../lib/documents";
import { AlertDialogFrame } from "./AlertDialogFrame";

interface DeleteDocumentDialogProps {
  document: DocumentEnvelope | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => Promise<void>;
}

export function DeleteDocumentDialog({
  document,
  open,
  onOpenChange,
  onDelete,
}: DeleteDocumentDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!document) return null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (deleting) return;
    setError(null);
    onOpenChange(nextOpen);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      onOpenChange(false);
    } catch (cause) {
      setError(documentErrorMessage(cause));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialogFrame width="compact">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <AlertDialog.Title className="m-0 truncate pr-3 text-sm font-semibold">
            Delete {documentTitle(document)}
          </AlertDialog.Title>
          <AlertDialog.Close
            render={<Button className="icon-control" />}
            aria-label="Close"
            disabled={deleting}
          >
            <span aria-hidden="true">×</span>
          </AlertDialog.Close>
        </header>
        <div className="grid gap-4 p-4">
          <AlertDialog.Description className="m-0 text-copy-muted text-xs leading-5">
            This removes the document from the workspace. Use Undo in the notification to restore
            the encrypted document and its attachments.
          </AlertDialog.Description>
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
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? "Deleting…" : "Delete document"}
            </Button>
          </div>
        </div>
      </AlertDialogFrame>
    </AlertDialog.Root>
  );
}
