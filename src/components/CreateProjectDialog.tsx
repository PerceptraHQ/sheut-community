import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { IconPlus, IconX } from "@tabler/icons-react";
import { type SyntheticEvent, useState } from "react";
import { projectErrorMessage, type TlpMarking } from "../lib/projects";
import { DialogFrame } from "./DialogFrame";
import { SelectField } from "./SelectField";
import { tlpSelectOptions } from "./TlpBadge";

interface CreateProjectDialogProps {
  onCreate: (request: CreateProjectRequest) => Promise<void>;
}

export interface CreateProjectRequest {
  name: string;
  unlockMethod: "device" | "passphrase";
  defaultTlpMarking: TlpMarking;
  passphrase?: string;
}

export function CreateProjectDialog({ onCreate }: CreateProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [defaultTlpMarking, setDefaultTlpMarking] = useState<TlpMarking>("amber");
  const [unlockMethod, setUnlockMethod] = useState<"device" | "passphrase">("device");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setName("");
      setDefaultTlpMarking("amber");
      setUnlockMethod("device");
      setPassphrase("");
      setConfirmation("");
      setError(null);
    }
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    setError(null);
    if (unlockMethod === "passphrase" && passphrase !== confirmation) {
      setError("The passphrases do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await onCreate({
        name,
        unlockMethod,
        defaultTlpMarking,
        ...(unlockMethod === "passphrase" ? { passphrase } : {}),
      });
      setOpen(false);
      setName("");
      setDefaultTlpMarking("amber");
      setUnlockMethod("device");
      setPassphrase("");
      setConfirmation("");
    } catch (cause) {
      setError(projectErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger className="primary-button">
        <IconPlus size={15} stroke={1.8} aria-hidden="true" />
        Create project
      </Dialog.Trigger>
      <DialogFrame>
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 text-sm font-semibold">Create project</Dialog.Title>
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
            The project name remains visible while locked. Project contents and the database key
            stay encrypted.
          </Dialog.Description>
          <div className="grid gap-1.5">
            <label className="font-medium text-copy-secondary text-xs" htmlFor="project-name">
              Project name
            </label>
            <input
              className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-sm outline-none placeholder:text-copy-faint focus:border-accent"
              id="project-name"
              name="projectName"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              maxLength={120}
              required
              autoComplete="off"
              disabled={submitting}
            />
            <p className="m-0 text-[11px] text-copy-faint">1–120 characters; no line breaks.</p>
          </div>
          <div className="grid gap-1.5">
            <SelectField
              ariaLabel="Default TLP marking"
              disabled={submitting}
              label="Default TLP marking"
              onChange={(value) => setDefaultTlpMarking(value as TlpMarking)}
              options={tlpSelectOptions}
              placeholder="Choose a TLP marking"
              required
              value={defaultTlpMarking}
            />
            <p className="m-0 text-[11px] text-copy-faint leading-4">
              New reports inherit this marking. You can override it for an individual publication.
            </p>
          </div>
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 font-medium text-copy-secondary text-xs">
              Unlock protection
            </legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-sm border border-panel-border p-2.5 text-xs">
              <input
                type="radio"
                aria-label="Use this device"
                name="unlockMethod"
                value="device"
                checked={unlockMethod === "device"}
                onChange={() => setUnlockMethod("device")}
                disabled={submitting}
              />
              <span>
                <span className="block font-medium text-copy-secondary">Use this device</span>
                <span className="mt-0.5 block text-copy-faint leading-4">
                  Store the random project key in the operating system credential store.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-sm border border-panel-border p-2.5 text-xs">
              <input
                type="radio"
                aria-label="Require passphrase"
                name="unlockMethod"
                value="passphrase"
                checked={unlockMethod === "passphrase"}
                onChange={() => setUnlockMethod("passphrase")}
                disabled={submitting}
              />
              <span>
                <span className="block font-medium text-copy-secondary">Require passphrase</span>
                <span className="mt-0.5 block text-copy-faint leading-4">
                  Ask on every fresh unlock. A forgotten passphrase cannot be recovered.
                </span>
              </span>
            </label>
          </fieldset>
          {unlockMethod === "passphrase" ? (
            <div className="grid gap-3 border-panel-border border-t pt-3">
              <div className="grid gap-1.5">
                <label
                  className="font-medium text-copy-secondary text-xs"
                  htmlFor="project-passphrase"
                >
                  Passphrase
                </label>
                <input
                  className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-sm outline-none focus:border-accent"
                  id="project-passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.currentTarget.value)}
                  minLength={12}
                  maxLength={1024}
                  autoComplete="new-password"
                  required
                  disabled={submitting}
                />
                <p className="m-0 text-[11px] text-copy-faint">At least 12 characters.</p>
              </div>
              <div className="grid gap-1.5">
                <label
                  className="font-medium text-copy-secondary text-xs"
                  htmlFor="project-passphrase-confirmation"
                >
                  Confirm passphrase
                </label>
                <input
                  className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-sm outline-none focus:border-accent"
                  id="project-passphrase-confirmation"
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.currentTarget.value)}
                  minLength={12}
                  maxLength={1024}
                  autoComplete="new-password"
                  required
                  disabled={submitting}
                />
              </div>
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
            <Button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create project"}
            </Button>
          </div>
        </form>
      </DialogFrame>
    </Dialog.Root>
  );
}
