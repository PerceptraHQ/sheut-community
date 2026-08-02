import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Input } from "@base-ui/react/input";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import {
  IconArrowDownLeft,
  IconArrowRight,
  IconArrowUpRight,
  IconLink,
  IconX,
} from "@tabler/icons-react";
import { type SyntheticEvent, useId, useState } from "react";
import type { StixRelationshipEndpoint } from "../lib/stix";
import { connectionsForEndpoint, type StixConnection } from "../lib/stixConnections";
import {
  initialStixFieldValues,
  readableStixName,
  relationshipTypeSuggestions,
} from "../lib/stixSchemas";
import { AutocompleteField } from "./AutocompleteField";
import { ComboboxField } from "./ComboboxField";
import { DialogFrame } from "./DialogFrame";
import { StixTypeIcon } from "./StixTypeIcon";

type RelationshipDirection = "incoming" | "outgoing";

export interface StixRelationshipCreateInput {
  properties: Record<string, unknown>;
  relationshipType: string;
  sourceId: string;
  targetId: string;
}

interface StixConnectionsDialogProps {
  connections: readonly StixConnection[];
  endpoint: StixRelationshipEndpoint;
  endpoints: readonly StixRelationshipEndpoint[];
  onCreate: (input: StixRelationshipCreateInput) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function StixConnectionsDialog({
  connections,
  endpoint,
  endpoints,
  onCreate,
  onOpenChange,
  open,
}: StixConnectionsDialogProps) {
  const directionLabelId = useId();
  const descriptionId = useId();
  const [direction, setDirection] = useState<RelationshipDirection>("outgoing");
  const [counterpartId, setCounterpartId] = useState("");
  const [relationshipType, setRelationshipType] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableCounterparts = endpoints.filter(
    (candidate) => candidate.localId !== endpoint.localId,
  );
  const counterpart = availableCounterparts.find(
    (candidate) => candidate.localId === counterpartId,
  );
  const source = direction === "outgoing" ? endpoint : counterpart;
  const target = direction === "outgoing" ? counterpart : endpoint;
  const suggestions =
    source && target ? relationshipTypeSuggestions(source.objectType, target.objectType) : [];
  const relationshipOptions = suggestions.map((value) => ({
    label: readableStixName(value),
    secondary: "STIX 2.1",
    value,
  }));
  const { incoming, outgoing } = connectionsForEndpoint(connections, endpoint.localId);

  const resetDependentFields = () => {
    setCounterpartId("");
    setRelationshipType("");
    setDescription("");
    setError(null);
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    setError(null);
    if (!source || !target || source.localId === target.localId) {
      setError("Choose a different source and target object.");
      return;
    }
    const canonicalType = relationshipType.trim();
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(canonicalType)) {
      setError("Relationship type must be 1–64 lowercase letters, digits, or hyphens.");
      return;
    }
    const properties = initialStixFieldValues("relationship");
    if (description.trim()) properties.description = description.trim();
    setSaving(true);
    try {
      await onCreate({
        properties,
        relationshipType: canonicalType,
        sourceId: source.localId,
        targetId: target.localId,
      });
      resetDependentFields();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Sheut could not create this relationship draft.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogFrame width="wide">
        <header className="flex items-start justify-between gap-3 border-panel-border border-b px-4 py-3">
          <div className="min-w-0">
            <Dialog.Title className="m-0 truncate text-sm font-semibold">
              Connections for {endpoint.displayName}
            </Dialog.Title>
            <Dialog.Description className="mt-1 mb-0 text-copy-muted text-xs leading-5">
              Inspect canonical STIX direction and create a local relationship draft.
            </Dialog.Description>
          </div>
          <Dialog.Close
            render={<Button className="icon-control" />}
            aria-label="Close"
            disabled={saving}
          >
            <IconX size={16} aria-hidden="true" />
          </Dialog.Close>
        </header>

        <div className="grid max-h-[min(48rem,88vh)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
          <div className="overflow-y-auto p-4">
            <div className="grid gap-3 min-[720px]:grid-cols-2">
              <ConnectionList direction="incoming" connections={incoming} />
              <ConnectionList direction="outgoing" connections={outgoing} />
            </div>
          </div>

          <form
            className="grid gap-3 border-panel-border border-t bg-panel-base p-4"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <div>
              <h3 className="m-0 text-copy-primary text-xs font-semibold">Add relationship</h3>
              <p className="mt-1 mb-0 text-[11px] text-copy-faint leading-4">
                Choose which side of the STIX relationship this object occupies.
              </p>
            </div>
            {availableCounterparts.length > 0 ? (
              <>
                <div>
                  <span className="text-copy-secondary text-xs" id={directionLabelId}>
                    Direction
                  </span>
                  <RadioGroup
                    aria-labelledby={directionLabelId}
                    className="mt-1.5 grid grid-cols-2 gap-2"
                    disabled={saving}
                    onValueChange={(next) => {
                      setDirection(next);
                      resetDependentFields();
                    }}
                    value={direction}
                  >
                    <DirectionOption direction="outgoing" endpointName={endpoint.displayName} />
                    <DirectionOption direction="incoming" endpointName={endpoint.displayName} />
                  </RadioGroup>
                </div>
                <div className="grid gap-3 min-[720px]:grid-cols-2">
                  <ComboboxField
                    disabled={saving}
                    label={direction === "outgoing" ? "Target object" : "Source object"}
                    onChange={(next) => {
                      setCounterpartId(next);
                      setRelationshipType("");
                      setError(null);
                    }}
                    options={availableCounterparts.map((candidate) => ({
                      icon: <StixTypeIcon objectType={candidate.objectType} size={14} />,
                      label: candidate.displayName,
                      secondary: readableStixName(candidate.objectType),
                      value: candidate.localId,
                    }))}
                    placeholder="Choose an object"
                    value={counterpartId || null}
                  />
                  <AutocompleteField
                    description={
                      counterpart
                        ? "Suggested values match this directed source/target pair; custom STIX vocabulary is allowed."
                        : undefined
                    }
                    disabled={saving || !counterpart}
                    emptyMessage="No standard match. The custom value will be used."
                    label="Relationship type"
                    onChange={setRelationshipType}
                    options={relationshipOptions}
                    placeholder={
                      counterpart
                        ? "Choose or enter a relationship"
                        : "Choose the other object first"
                    }
                    value={relationshipType}
                  />
                </div>
                <label
                  className="grid min-w-0 gap-1.5 text-copy-secondary text-xs"
                  htmlFor={descriptionId}
                >
                  Description (optional)
                  <Input
                    className="h-9 min-w-0 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-xs outline-none focus:border-accent"
                    disabled={saving}
                    id={descriptionId}
                    maxLength={500}
                    onChange={(event) => setDescription(event.currentTarget.value)}
                    placeholder="Why this directed relationship is justified"
                    value={description}
                  />
                </label>
                {source && target && relationshipType.trim() ? (
                  <p className="m-0 flex min-w-0 items-center gap-2 rounded-sm border border-panel-border bg-panel-deep px-2.5 py-2 text-copy-secondary text-xs">
                    <span className="truncate">{source.displayName}</span>
                    <span className="shrink-0 text-accent-hover">
                      {readableStixName(relationshipType)}
                    </span>
                    <IconArrowRight className="shrink-0" size={13} aria-hidden="true" />
                    <span className="truncate">{target.displayName}</span>
                  </p>
                ) : null}
              </>
            ) : (
              <p className="m-0 text-copy-muted text-xs">
                Create or import another domain or observable object before adding a relationship.
              </p>
            )}
            {error ? (
              <p className="error-message m-0" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close render={<Button className="control-button" />} disabled={saving}>
                Close
              </Dialog.Close>
              <Button
                className="primary-button"
                disabled={saving || !source || !target || !relationshipType.trim()}
                type="submit"
              >
                {saving ? "Creating…" : "Create relationship draft"}
              </Button>
            </div>
          </form>
        </div>
      </DialogFrame>
    </Dialog.Root>
  );
}

function DirectionOption({
  direction,
  endpointName,
}: {
  direction: RelationshipDirection;
  endpointName: string;
}) {
  const outgoing = direction === "outgoing";
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI documents wrapping Radio.Root in a label so the entire option is clickable.
    <label className="flex cursor-default items-center gap-2 rounded-sm border border-panel-border bg-panel-deep px-2.5 py-2 text-copy-secondary text-xs has-[[data-checked]]:border-accent has-[[data-checked]]:text-copy-primary">
      <Radio.Root
        className="flex size-4 shrink-0 items-center justify-center rounded-full border border-copy-faint data-checked:border-accent data-checked:bg-accent"
        value={direction}
      >
        <Radio.Indicator className="size-1.5 rounded-full bg-panel-deep data-unchecked:hidden" />
      </Radio.Root>
      <span className="min-w-0">
        <span className="block font-semibold">{outgoing ? "Outgoing" : "Incoming"}</span>
        <span className="block truncate text-[11px] text-copy-faint">
          {outgoing ? `${endpointName} is the source` : `${endpointName} is the target`}
        </span>
      </span>
    </label>
  );
}

function ConnectionList({
  direction,
  connections,
}: {
  direction: RelationshipDirection;
  connections: readonly StixConnection[];
}) {
  const incoming = direction === "incoming";
  return (
    <section className="rounded-sm border border-panel-border bg-panel-deep/40 p-3">
      <h3 className="m-0 flex items-center gap-1.5 text-[11px] text-copy-faint uppercase tracking-wider">
        {incoming ? (
          <IconArrowDownLeft size={12} aria-hidden="true" />
        ) : (
          <IconArrowUpRight size={12} aria-hidden="true" />
        )}
        {incoming ? "Incoming relationships" : "Outgoing relationships"} {connections.length}
      </h3>
      {connections.length > 0 ? (
        <ul className="mt-2 mb-0 grid list-none gap-2 p-0">
          {connections.map((connection) => {
            const counterpart = incoming ? connection.source : connection.target;
            return (
              <li
                className="rounded-sm border border-panel-border bg-panel-deep px-2.5 py-2"
                key={connection.id}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <StixTypeIcon objectType={counterpart.objectType} size={14} />
                    <span className="min-w-0">
                      <span className="block truncate text-copy-secondary text-xs">
                        {counterpart.displayName}
                      </span>
                      <span className="block text-[11px] text-copy-faint">
                        {readableStixName(counterpart.objectType)}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 rounded-sm border border-panel-border px-1.5 py-0.5 text-[10px] text-copy-faint uppercase">
                    {connection.state === "draft" ? "Draft" : "Committed"}
                  </span>
                </div>
                <span className="mt-2 flex items-center gap-1.5 text-[11px] text-copy-secondary">
                  <IconLink size={11} aria-hidden="true" />
                  {readableStixName(connection.relationshipType)}
                  {!counterpart.available ? " · unavailable endpoint" : ""}
                </span>
                <code className="mt-0.5 block truncate text-[10px] text-copy-faint">
                  {connection.relationshipType}
                </code>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 mb-0 text-[11px] text-copy-faint">None</p>
      )}
    </section>
  );
}
