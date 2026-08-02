import { Button } from "@base-ui/react/button";
import { Checkbox } from "@base-ui/react/checkbox";
import { Dialog } from "@base-ui/react/dialog";
import { Input } from "@base-ui/react/input";
import { IconCheck, IconFilePlus, IconFolderSearch, IconStack2 } from "@tabler/icons-react";
import { type ReactNode, useId, useState } from "react";

import type { GraphNodeSummary } from "../../lib/graph";
import { DialogFrame } from "../DialogFrame";

export function CreateWorkspaceDialog({
  busy,
  onOpenChange,
  onBlank,
  onAll,
  onSelected,
}: {
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onBlank: () => void;
  onAll: () => void;
  onSelected: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <DialogFrame width="wide">
        <div className="p-4">
          <Dialog.Title className="m-0 text-sm font-semibold">New graph workspace</Dialog.Title>
          <Dialog.Description className="mt-1 mb-0 text-copy-muted text-xs">
            Choose a starting point. You can add or remove members later in Build mode.
          </Dialog.Description>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <WorkspaceChoice
              icon={<IconFilePlus size={18} aria-hidden="true" />}
              title="Blank workspace"
              description="Start empty in Build mode."
              disabled={busy}
              onClick={onBlank}
            />
            <WorkspaceChoice
              icon={<IconStack2 size={18} aria-hidden="true" />}
              title="All intelligence"
              description="Create a viewer from all intelligence."
              disabled={busy}
              onClick={onAll}
            />
            <WorkspaceChoice
              icon={<IconFolderSearch size={18} aria-hidden="true" />}
              title="Selected items"
              description="Search and choose project items."
              disabled={busy}
              onClick={onSelected}
            />
          </div>
          <div className="mt-4 flex justify-end border-panel-border border-t pt-3">
            <Dialog.Close className="control-button">Cancel</Dialog.Close>
          </div>
        </div>
      </DialogFrame>
    </Dialog.Root>
  );
}

function WorkspaceChoice({
  icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="group min-h-32 rounded-md border border-panel-border bg-panel-base p-4 text-left outline-none transition hover:not-data-disabled:border-accent hover:not-data-disabled:bg-panel-hover disabled:opacity-45"
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={title}
    >
      <span className="text-accent-hover">{icon}</span>
      <span className="mt-3 block text-copy-primary text-sm">{title}</span>
      <span className="mt-1 block text-copy-faint text-xs leading-5">{description}</span>
    </Button>
  );
}

export function SelectedItemsDialog({
  onOpenChange,
  items,
  busy,
  title,
  description,
  actionLabel,
  onCreate,
}: {
  onOpenChange: (open: boolean) => void;
  items: GraphNodeSummary[];
  busy: boolean;
  title: string;
  description: string;
  actionLabel: string;
  onCreate: (items: GraphNodeSummary[]) => void;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const normalized = query.trim().toLocaleLowerCase();
  const visible = items.filter((item) =>
    `${item.displayName} ${item.objectType} ${item.stixId ?? ""}`
      .toLocaleLowerCase()
      .includes(normalized),
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery("");
          setSelected([]);
        }
      }}
    >
      <DialogFrame width="wide">
        <div className="grid max-h-[min(42rem,calc(100dvh-2rem))] min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]">
          <div className="border-panel-border border-b px-4 py-3">
            <Dialog.Title className="m-0 text-sm font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="mt-1 mb-0 text-copy-muted text-xs leading-5">
              {description}
            </Dialog.Description>
          </div>
          <label
            className="mx-4 mt-3 flex h-9 min-w-0 items-center gap-2 rounded-sm border border-panel-border bg-panel-deep px-2.5 focus-within:border-accent"
            htmlFor={searchId}
          >
            <IconFolderSearch size={14} className="text-copy-faint" aria-hidden="true" />
            <Input
              id={searchId}
              className="min-w-0 flex-1 border-0 bg-transparent text-copy-primary text-xs outline-none placeholder:text-copy-faint"
              aria-label="Search items for graph workspace"
              placeholder="Search by name, type, or STIX ID"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div className="min-h-48 overflow-y-auto p-4">
            <fieldset className="m-0 grid gap-1 border-0 p-0">
              <legend className="sr-only">Project items</legend>
              {visible.map((item) => (
                <Checkbox.Root
                  key={item.id}
                  className="group grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-sm border border-transparent px-2 py-2 hover:bg-panel-hover data-checked:border-accent/50 data-checked:bg-[#102b46]"
                  checked={selected.includes(item.id)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked
                        ? [...new Set([...current, item.id])]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                >
                  <span className="grid size-4 place-items-center rounded-sm border border-panel-border bg-panel-deep text-copy-primary group-data-checked:border-accent group-data-checked:bg-accent">
                    <Checkbox.Indicator>
                      <IconCheck
                        data-testid="selected-item-checkmark"
                        size={11}
                        aria-hidden="true"
                      />
                    </Checkbox.Indicator>
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words text-copy-secondary text-xs leading-4">
                      {item.displayName}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-copy-faint uppercase">
                      {item.objectType.replaceAll("-", " ")}
                    </span>
                  </span>
                  <span className="max-w-48 break-all font-mono text-[11px] text-copy-faint">
                    {item.stixId}
                  </span>
                </Checkbox.Root>
              ))}
              {visible.length === 0 ? (
                <p className="m-0 py-8 text-center text-copy-faint text-xs">
                  No matching project items.
                </p>
              ) : null}
            </fieldset>
          </div>
          <div className="flex items-center justify-between gap-3 border-panel-border border-t px-4 py-3">
            <span className="text-[11px] text-copy-faint">{selected.length} selected</span>
            <div className="flex gap-2">
              <Dialog.Close className="control-button" disabled={busy}>
                Cancel
              </Dialog.Close>
              <Button
                className="control-button primary-control"
                type="button"
                disabled={busy || selected.length === 0}
                onClick={() => onCreate(items.filter((item) => selected.includes(item.id)))}
              >
                {busy ? "Working…" : actionLabel}
              </Button>
            </div>
          </div>
        </div>
      </DialogFrame>
    </Dialog.Root>
  );
}
