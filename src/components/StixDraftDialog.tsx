import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { IconX } from "@tabler/icons-react";
import { type SyntheticEvent, useState } from "react";
import {
  type StixDraftSummary,
  type StixObjectSummary,
  type StixObjectType,
  type StixRelationshipEndpoint,
  stixObjectTypes,
} from "../lib/stix";
import {
  initialStixFieldValues,
  readableStixName,
  type StixFieldDefinition,
  stixObjectSchemas,
} from "../lib/stixSchemas";
import { ComboboxField } from "./ComboboxField";
import { DialogFrame } from "./DialogFrame";
import { StixCustomProperties, type StixCustomPropertyRow } from "./StixCustomProperties";
import { StixObjectProperties } from "./StixObjectProperties";
import { StixRelationshipFields } from "./StixRelationshipFields";
import { StixTypeIcon } from "./StixTypeIcon";

export interface StixDraftSaveInput {
  objectType: StixObjectType;
  properties: Record<string, unknown>;
  relationship?: { sourceId: string; targetId: string; relationshipType: string };
}

interface StixDraftDialogProps {
  draft: StixDraftSummary | null;
  endpoints: readonly StixRelationshipEndpoint[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: StixDraftSaveInput) => Promise<void>;
  referenceObjects: readonly StixObjectSummary[];
}

const objectTypeOptions = stixObjectTypes.map((type) => ({
  value: type,
  label: readableStixName(type),
  icon: <StixTypeIcon objectType={type} size={14} />,
}));

function formValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value))
    return value.every((item) => typeof item === "string")
      ? value.join("\n")
      : JSON.stringify(value, null, 2);
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

function initialEditorState(objectType: StixObjectType, draft: StixDraftSummary | null) {
  const properties = draft?.properties ?? initialStixFieldValues(objectType);
  const schema = stixObjectSchemas[objectType];
  const values = Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [name, formValue(value)]),
  );
  const customRows = Object.entries(properties)
    .filter(([name]) => !Object.hasOwn(schema.fields, name))
    .map(([name, value], index) => ({
      id: index + 1,
      name,
      value: JSON.stringify(value, null, 2),
    }));
  return { values, customRows };
}

function parseValue(name: string, raw: string, definition: StixFieldDefinition): unknown {
  const value = raw.trim();
  if (!value) {
    if (definition.required) throw new Error(`${readableStixName(name)} is required.`);
    return undefined;
  }
  if (definition.kind === "integer" || definition.kind === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (definition.kind === "integer" && !Number.isInteger(parsed))) {
      throw new Error(`${readableStixName(name)} must be a valid ${definition.kind}.`);
    }
    return parsed;
  }
  if (definition.kind === "boolean") {
    if (value !== "true" && value !== "false")
      throw new Error(`${readableStixName(name)} must be true or false.`);
    return value === "true";
  }
  if (definition.kind === "string-list" || definition.kind === "reference-list") {
    const items = value
      .split(/[\n,]/u)
      .map((item) => item.trim())
      .filter(Boolean);
    if (definition.required && items.length === 0)
      throw new Error(`${readableStixName(name)} needs at least one value.`);
    return items;
  }
  if (definition.kind === "json") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`${readableStixName(name)} contains an invalid structured value.`);
    }
  }
  return raw.trim();
}

export function StixDraftDialog({
  draft,
  endpoints,
  open,
  onOpenChange,
  onSave,
  referenceObjects,
}: StixDraftDialogProps) {
  const initialType = (draft?.objectType as StixObjectType | undefined) ?? "indicator";
  const initial = initialEditorState(initialType, draft);
  const [objectType, setObjectType] = useState<StixObjectType>(initialType);
  const [values, setValues] = useState<Record<string, string>>(initial.values);
  const [customRows, setCustomRows] = useState<StixCustomPropertyRow[]>(initial.customRows);
  const [nextCustomId, setNextCustomId] = useState(initial.customRows.length + 1);
  const [sourceId, setSourceId] = useState(draft?.sourceId ?? "");
  const [targetId, setTargetId] = useState(draft?.targetId ?? "");
  const [relationshipType, setRelationshipType] = useState(draft?.relationshipType ?? "related-to");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schema = stixObjectSchemas[objectType];

  const resetForType = (nextType: StixObjectType) => {
    const next = initialEditorState(nextType, null);
    setObjectType(nextType);
    setValues(next.values);
    setCustomRows([]);
    setSourceId("");
    setTargetId("");
    setRelationshipType("related-to");
  };

  const buildProperties = () => {
    const properties: Record<string, unknown> = {};
    const managedValues = { ...values };
    if (Object.hasOwn(schema.fields, "modified")) managedValues.modified = new Date().toISOString();
    for (const [name, definition] of Object.entries(schema.fields)) {
      if (name === "source_ref" || name === "target_ref" || name === "relationship_type") continue;
      const parsed = parseValue(name, managedValues[name] ?? "", definition);
      if (parsed !== undefined) properties[name] = parsed;
    }
    for (const row of customRows) {
      const name = row.name.trim();
      if (!/^x_[a-z0-9_]{1,246}$/u.test(name))
        throw new Error(
          "Custom property names must start with x_ and use lowercase letters, digits, or underscores.",
        );
      if (Object.hasOwn(properties, name) || Object.hasOwn(schema.fields, name))
        throw new Error(`${name} is already defined.`);
      try {
        properties[name] = JSON.parse(row.value) as unknown;
      } catch {
        throw new Error(`${name} contains an invalid structured value.`);
      }
    }
    return properties;
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    setError(null);
    if (objectType === "relationship" && (!sourceId || !targetId || sourceId === targetId)) {
      setError("Choose two different STIX objects for the relationship.");
      return;
    }
    if (objectType === "relationship" && !/^[a-z][a-z0-9-]{0,63}$/u.test(relationshipType)) {
      setError("Relationship type must be 1–64 lowercase letters, digits, or hyphens.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        objectType,
        properties: buildProperties(),
        ...(objectType === "relationship"
          ? { relationship: { sourceId, targetId, relationshipType } }
          : {}),
      });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sheut could not save this draft.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogFrame width="wide">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 text-sm font-semibold">
            {draft?.replacesStixId
              ? "Edit STIX revision"
              : draft
                ? "Edit STIX draft"
                : "New STIX draft"}
          </Dialog.Title>
          <Dialog.Close
            render={<Button className="icon-control" />}
            aria-label="Close"
            disabled={saving}
          >
            <IconX size={16} aria-hidden="true" />
          </Dialog.Close>
        </header>
        <form
          className="grid max-h-[min(48rem,88vh)] grid-rows-[1fr_auto] overflow-hidden"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="grid gap-5 overflow-y-auto p-4">
            <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
              Required fields follow STIX 2.1 Errata 01. Sheut manages IDs and object timestamps.
              {draft?.replacesStixId
                ? " This revision preserves the committed STIX identity and replaces it only after validated export."
                : " Drafts retain stable local IDs until confirmed export."}
            </Dialog.Description>
            <ComboboxField
              disabled={saving || Boolean(draft?.replacesStixId)}
              label="Object type"
              onChange={resetForType}
              options={objectTypeOptions}
              placeholder="Choose an object type"
              value={objectType}
            />
            {objectType === "relationship" ? (
              <StixRelationshipFields
                disabled={saving}
                endpoints={endpoints}
                onRelationshipTypeChange={setRelationshipType}
                onSourceChange={setSourceId}
                onTargetChange={setTargetId}
                relationshipType={relationshipType}
                sourceId={sourceId}
                targetId={targetId}
              />
            ) : null}
            <StixObjectProperties
              key={objectType}
              disabled={saving}
              onValueChange={(name, value) =>
                setValues((current) => ({ ...current, [name]: value }))
              }
              referenceOptions={referenceObjects}
              schema={schema}
              values={values}
            />
            <StixCustomProperties
              disabled={saving}
              onAdd={() => {
                setCustomRows((current) => [
                  ...current,
                  { id: nextCustomId, name: "x_", value: '""' },
                ]);
                setNextCustomId((current) => current + 1);
              }}
              onRemove={(id) =>
                setCustomRows((current) => current.filter((item) => item.id !== id))
              }
              onUpdate={(id, update) =>
                setCustomRows((current) =>
                  current.map((item) => (item.id === id ? { ...item, ...update } : item)),
                )
              }
              rows={customRows}
            />
            {error ? (
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <footer className="flex justify-end gap-2 border-panel-border border-t bg-panel-base px-4 py-3">
            <Dialog.Close render={<Button className="control-button" />} disabled={saving}>
              Cancel
            </Dialog.Close>
            <Button
              className="primary-button"
              type="submit"
              disabled={saving || (objectType === "relationship" && endpoints.length < 2)}
            >
              {saving ? "Saving…" : "Save draft"}
            </Button>
          </footer>
        </form>
      </DialogFrame>
    </Dialog.Root>
  );
}
