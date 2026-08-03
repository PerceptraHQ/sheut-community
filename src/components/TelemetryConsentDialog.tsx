import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { DialogFrame } from "./DialogFrame";

interface TelemetryConsentDialogProps {
  onDecision: (enabled: boolean) => Promise<void>;
}

export function TelemetryConsentDialog({ onDecision }: TelemetryConsentDialogProps) {
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
          <Dialog.Title className="m-0 text-base font-semibold">
            Anonymous diagnostics and usage
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 mb-0 text-copy-muted text-xs leading-5">
            Help improve Sheut by sharing small, fixed records about feature use and application
            failures. Telemetry stays off unless you choose to enable it.
          </Dialog.Description>
        </header>

        <div className="grid gap-4 p-5 text-xs">
          <section aria-labelledby="telemetry-collected-title">
            <h2
              className="m-0 text-copy-primary text-xs font-semibold"
              id="telemetry-collected-title"
            >
              Collected after opt-in
            </h2>
            <p className="mt-1 mb-0 text-copy-muted leading-5">
              Application version, operating-system family, CPU architecture, a random installation
              identifier, event time, and one fixed event name such as graph opened or publication
              completed.
            </p>
          </section>
          <section aria-labelledby="telemetry-never-collected-title">
            <h2
              className="m-0 text-copy-primary text-xs font-semibold"
              id="telemetry-never-collected-title"
            >
              Never collected
            </h2>
            <p className="mt-1 mb-0 text-copy-muted leading-5">
              Project names or identifiers; graph nodes, edges, labels, or properties; report
              titles, sections, fields, rows, or prose; STIX objects; evidence metadata or files;
              analyst notes; attachments; searches; paths; URLs; error messages; credentials; or
              identity.
            </p>
          </section>
          <p className="m-0 text-copy-faint text-[11px] leading-5">
            You can change this choice at any time in Data &amp; security settings. Turning it off
            removes the local installation identifier and stops future reports.
          </p>
          {error ? (
            <p className="error-message" role="alert">
              Sheut could not save this choice. Telemetry remains off.
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
            Keep telemetry off
          </Button>
          <Button
            className="primary-button"
            type="button"
            disabled={submitting}
            onClick={() => void decide(true)}
          >
            {submitting ? "Saving…" : "Share anonymous diagnostics"}
          </Button>
        </footer>
      </DialogFrame>
    </Dialog.Root>
  );
}
