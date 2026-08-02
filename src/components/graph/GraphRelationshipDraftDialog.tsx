import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Input } from "@base-ui/react/input";
import { useId } from "react";

import type { GraphRelationshipDraftPreview } from "../../lib/graph";
import { readableStixName, relationshipTypeSuggestions } from "../../lib/stixSchemas";
import { AutocompleteField } from "../AutocompleteField";
import { DialogFrame } from "../DialogFrame";

export function GraphRelationshipDraftDialog({
  preview,
  relationshipType,
  description,
  busy,
  onRelationshipTypeChange,
  onDescriptionChange,
  onClose,
  onCommit,
}: {
  preview: GraphRelationshipDraftPreview;
  relationshipType: string;
  description: string;
  busy: boolean;
  onRelationshipTypeChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onClose: () => void;
  onCommit: () => void;
}) {
  const descriptionId = useId();
  const suggestions = relationshipTypeSuggestions(
    preview.sourceObjectType,
    preview.targetObjectType,
  );
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogFrame width="standard">
        <div className="grid gap-4 p-4">
          <div>
            <Dialog.Title className="m-0 text-sm font-semibold">
              Create STIX relationship draft
            </Dialog.Title>
            <Dialog.Description className="mt-1 mb-0 text-copy-muted text-xs leading-5">
              This creates a separate local draft. It does not remove or convert the visual link.
            </Dialog.Description>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-sm border border-panel-border bg-panel-deep px-3 py-2 text-center text-[11px]">
            <span className="break-words text-copy-secondary">
              {readableStixName(preview.sourceObjectType)}
            </span>
            <span className="text-accent-hover" aria-hidden="true">
              →
            </span>
            <span className="break-words text-copy-secondary">
              {readableStixName(preview.targetObjectType)}
            </span>
          </div>
          <AutocompleteField
            description="Suggestions are compatible STIX 2.1 relationships for these endpoint types."
            disabled={busy}
            label="Relationship type"
            onChange={onRelationshipTypeChange}
            options={suggestions.map((value) => ({
              value,
              label: readableStixName(value),
              secondary: "STIX 2.1",
            }))}
            placeholder="Choose or type a relationship"
            value={relationshipType}
          />
          <label
            className="grid min-w-0 gap-1.5 text-copy-secondary text-xs"
            htmlFor={descriptionId}
          >
            Description (optional)
            <Input
              id={descriptionId}
              className="h-9 min-w-0 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-xs outline-none focus:border-accent"
              value={description}
              maxLength={500}
              disabled={busy}
              onChange={(event) => onDescriptionChange(event.currentTarget.value)}
              placeholder="Why this semantic relationship is justified"
            />
          </label>
          <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
            <Dialog.Close className="control-button" disabled={busy}>
              Cancel
            </Dialog.Close>
            <Button
              className="control-button primary-control"
              type="button"
              disabled={busy || !relationshipType.trim()}
              onClick={onCommit}
            >
              {busy ? "Creating…" : "Create draft"}
            </Button>
          </div>
        </div>
      </DialogFrame>
    </Dialog.Root>
  );
}
