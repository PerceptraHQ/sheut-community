import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { IconLock, IconX } from "@tabler/icons-react";
import { type SyntheticEvent, useState } from "react";
import { projectErrorMessage } from "../lib/projects";
import { DialogFrame } from "./DialogFrame";

interface UnlockProjectDialogProps {
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlock: (passphrase: string) => Promise<void>;
}

export function UnlockProjectDialog({
  projectName,
  open,
  onOpenChange,
  onUnlock,
}: UnlockProjectDialogProps) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setPassphrase("");
      setError(null);
    }
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onUnlock(passphrase);
      setPassphrase("");
      onOpenChange(false);
    } catch (cause) {
      setError(projectErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <DialogFrame width="compact">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 truncate pr-3 text-sm font-semibold">
            Unlock {projectName}
          </Dialog.Title>
          <Dialog.Close
            className="grid size-7 cursor-pointer place-items-center rounded-sm border-0 bg-transparent text-copy-muted hover:bg-panel-hover hover:text-copy-primary disabled:cursor-not-allowed"
            aria-label="Close"
            disabled={submitting}
          >
            <IconX size={16} stroke={1.7} aria-hidden="true" />
          </Dialog.Close>
        </header>
        <form className="grid gap-4 p-4" onSubmit={(event) => void handleSubmit(event)}>
          <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
            Enter this project’s passphrase. Sheut does not store it and cannot recover it.
          </Dialog.Description>
          <div className="grid gap-1.5">
            <label className="font-medium text-copy-secondary text-xs" htmlFor="unlock-passphrase">
              Passphrase
            </label>
            <input
              className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-sm outline-none focus:border-accent"
              id="unlock-passphrase"
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.currentTarget.value)}
              minLength={12}
              maxLength={1024}
              autoComplete="current-password"
              required
              disabled={submitting}
            />
          </div>
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
            <Dialog.Close className="control-button" disabled={submitting}>
              Cancel
            </Dialog.Close>
            <Button className="primary-button" type="submit" disabled={submitting}>
              <IconLock size={14} stroke={1.8} aria-hidden="true" />
              {submitting ? "Unlocking…" : "Unlock"}
            </Button>
          </div>
        </form>
      </DialogFrame>
    </Dialog.Root>
  );
}
