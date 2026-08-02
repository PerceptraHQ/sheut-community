import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { IconX } from "@tabler/icons-react";
import { type SyntheticEvent, useEffect, useState } from "react";
import {
  listProjectBackups,
  type ProjectBackupSummary,
  type ProjectSummary,
  projectErrorMessage,
  restoreDeviceProjectBackup,
  restorePassphraseProjectBackup,
} from "../lib/projects";
import { DialogFrame } from "./DialogFrame";

interface RestoreProjectDialogProps {
  project: ProjectSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: () => void;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function RestoreProjectDialog({
  project,
  open,
  onOpenChange,
  onRestored,
}: RestoreProjectDialogProps) {
  const [backups, setBackups] = useState<ProjectBackupSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    listProjectBackups(project.id)
      .then((items) => {
        if (!active) return;
        setBackups(items);
        setSelectedId(items[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (active) setError(projectErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, project.id]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setBackups([]);
      setSelectedId(null);
      setPassphrase("");
      setError(null);
    }
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    if (!selectedId) return;
    setSubmitting(true);
    setError(null);
    try {
      if (project.unlockMethod === "passphrase") {
        await restorePassphraseProjectBackup(project.id, selectedId, passphrase);
      } else {
        await restoreDeviceProjectBackup(project.id, selectedId);
      }
      setPassphrase("");
      onOpenChange(false);
      onRestored();
    } catch (cause) {
      setError(projectErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <DialogFrame>
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 truncate pr-3 text-sm font-semibold">
            Restore {project.name ?? "Unnamed local project"}
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
            Choose an internal recovery point. The current database is archived before it is
            replaced.
          </Dialog.Description>
          {loading ? <p className="m-0 text-copy-faint text-xs">Loading recovery points…</p> : null}
          {!loading && backups.length === 0 ? (
            <p className="m-0 text-copy-faint text-xs">No recovery points are available.</p>
          ) : null}
          {backups.length > 0 ? (
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 font-medium text-copy-secondary text-xs">
                Recovery point
              </legend>
              {backups.map((backup) => (
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-sm border border-panel-border p-2.5 text-copy-secondary text-xs"
                  key={backup.id}
                >
                  <input
                    type="radio"
                    name="backupId"
                    value={backup.id}
                    checked={selectedId === backup.id}
                    onChange={() => setSelectedId(backup.id)}
                    disabled={submitting}
                  />
                  <span>{dateFormatter.format(new Date(backup.createdAtUnixMs))}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {project.unlockMethod === "passphrase" && backups.length > 0 ? (
            <div className="grid gap-1.5">
              <label
                className="font-medium text-copy-secondary text-xs"
                htmlFor="recovery-passphrase"
              >
                Passphrase
              </label>
              <input
                className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-sm outline-none focus:border-accent"
                id="recovery-passphrase"
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
          ) : null}
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
            <Dialog.Close className="control-button" disabled={submitting}>
              Cancel
            </Dialog.Close>
            <Button
              className="primary-button"
              type="submit"
              disabled={submitting || selectedId === null}
            >
              {submitting ? "Restoring…" : "Restore recovery point"}
            </Button>
          </div>
        </form>
      </DialogFrame>
    </Dialog.Root>
  );
}
