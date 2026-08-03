import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { DialogFrame } from "./DialogFrame";

interface SoftwareUpdateConsentDialogProps {
  onDecision: (enabled: boolean) => Promise<void>;
}

export function SoftwareUpdateConsentDialog({ onDecision }: SoftwareUpdateConsentDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const decide = async (enabled: boolean) => {
    setSubmitting(true);
    setError(false);
    try {
      await onDecision(enabled);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open>
      <DialogFrame>
        <header className="border-panel-border border-b px-5 py-4">
          <Dialog.Title className="m-0 text-base font-semibold">Keep Sheut up to date</Dialog.Title>
          <Dialog.Description className="mt-1.5 mb-0 text-copy-muted text-xs leading-5">
            Sheut can check for a newer version once when the application starts. You always choose
            when to update.
          </Dialog.Description>
        </header>

        <div className="grid gap-3 p-5 text-xs">
          <p className="m-0 text-copy-muted leading-5">
            The check requests a static release manifest over HTTPS. No project, report, graph,
            evidence, or telemetry data is included.
          </p>
          <p className="m-0 text-copy-faint text-[11px] leading-5">
            Choose Not now to keep launch-time checks off. You can check manually or change this
            choice later in Data &amp; security settings.
          </p>
          {error ? (
            <p className="error-message" role="alert">
              Sheut could not save this choice. Automatic update checks remain off.
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-panel-border border-t px-5 py-3">
          <Button
            className="control-button"
            type="button"
            disabled={submitting}
            onClick={() => void decide(false)}
          >
            Not now
          </Button>
          <Button
            className="primary-button"
            type="button"
            disabled={submitting}
            onClick={() => void decide(true)}
          >
            {submitting ? "Saving…" : "Check automatically"}
          </Button>
        </footer>
      </DialogFrame>
    </Dialog.Root>
  );
}
