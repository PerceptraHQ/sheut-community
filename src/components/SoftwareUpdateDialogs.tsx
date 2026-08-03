import { useState } from "react";
import type { SoftwareUpdateProgress, SoftwareUpdateSummary } from "../lib/softwareUpdates";
import { SoftwareUpdateConsentDialog } from "./SoftwareUpdateConsentDialog";
import { SoftwareUpdateDialog } from "./SoftwareUpdateDialog";

interface SoftwareUpdateDialogsProps {
  askForConsent: boolean;
  installing: boolean;
  onConsentDecision: (enabled: boolean) => Promise<void>;
  onInstall: (onProgress: (progress: SoftwareUpdateProgress) => void) => Promise<void>;
  onLater: () => void;
  update: SoftwareUpdateSummary | null;
}

export default function SoftwareUpdateDialogs({
  askForConsent,
  installing,
  onConsentDecision,
  onInstall,
  onLater,
  update,
}: SoftwareUpdateDialogsProps) {
  const [error, setError] = useState(false);
  const [progress, setProgress] = useState<SoftwareUpdateProgress | null>(null);
  if (askForConsent) {
    return <SoftwareUpdateConsentDialog onDecision={onConsentDecision} />;
  }
  if (!update) return null;
  return (
    <SoftwareUpdateDialog
      error={error}
      installing={installing}
      onInstall={() => {
        setError(false);
        setProgress(null);
        void onInstall(setProgress).catch(() => setError(true));
      }}
      onLater={onLater}
      progress={progress}
      update={update}
    />
  );
}
