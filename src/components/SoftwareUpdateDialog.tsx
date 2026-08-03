import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import type { SoftwareUpdateProgress, SoftwareUpdateSummary } from "../lib/softwareUpdates";
import { DialogFrame } from "./DialogFrame";

interface SoftwareUpdateDialogProps {
  error?: boolean;
  installing: boolean;
  onInstall: () => void;
  onLater: () => void;
  progress: SoftwareUpdateProgress | null;
  update: SoftwareUpdateSummary;
}

export function SoftwareUpdateDialog({
  error = false,
  installing,
  onInstall,
  onLater,
  progress,
  update,
}: SoftwareUpdateDialogProps) {
  const downloaded = progress?.downloadedBytes ?? 0;
  const total = progress?.totalBytes;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !installing && onLater()}>
      <DialogFrame>
        <header className="border-panel-border border-b px-5 py-4">
          <Dialog.Title className="m-0 text-base font-semibold">
            A Sheut update is available
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 mb-0 text-copy-muted text-xs leading-5">
            Version {update.version} is ready. Sheut will restart after the update finishes.
          </Dialog.Description>
        </header>

        <div className="grid gap-4 p-5 text-xs">
          <dl className="m-0 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <dt className="text-copy-faint">Installed</dt>
            <dd className="m-0 text-copy-secondary">{update.currentVersion}</dd>
            <dt className="text-copy-faint">Available</dt>
            <dd className="m-0 text-copy-secondary">{update.version}</dd>
          </dl>

          {update.notes ? (
            <section aria-labelledby="software-update-notes">
              <h2 className="m-0 text-xs font-semibold" id="software-update-notes">
                Release notes
              </h2>
              <p className="mt-1 mb-0 whitespace-pre-wrap text-copy-muted leading-5">
                {update.notes}
              </p>
            </section>
          ) : null}

          {installing ? (
            <div className="grid gap-1.5" aria-live="polite">
              <progress
                className="h-1.5 w-full accent-accent-primary"
                aria-label="Downloading update"
                aria-valuemax={total}
                aria-valuemin={0}
                aria-valuenow={total === undefined ? undefined : Math.min(downloaded, total)}
                max={total ?? 1}
                value={total === undefined ? undefined : Math.min(downloaded, total)}
              />
              <p className="m-0 text-copy-faint text-[11px]">
                {total === undefined
                  ? "Getting the update ready…"
                  : `${Math.round((Math.min(downloaded, total) / Math.max(total, 1)) * 100)}% downloaded`}
              </p>
            </div>
          ) : null}
          {error ? (
            <p className="error-message m-0" role="alert">
              Sheut could not finish the update. Check your connection and try again.
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-panel-border border-t px-5 py-3">
          <Button className="control-button" type="button" disabled={installing} onClick={onLater}>
            Later
          </Button>
          <Button
            className="primary-button"
            type="button"
            disabled={installing}
            onClick={onInstall}
          >
            {installing ? "Installing…" : error ? "Try again" : "Update and restart"}
          </Button>
        </footer>
      </DialogFrame>
    </Dialog.Root>
  );
}
