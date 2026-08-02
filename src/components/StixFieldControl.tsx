import { Button } from "@base-ui/react/button";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";
import type { StixFieldDefinition } from "../lib/stixSchemas";
import { readableStixName } from "../lib/stixSchemas";
import { AutocompleteField, type AutocompleteFieldOption } from "./AutocompleteField";
import { SelectField } from "./SelectField";
import { StructuredValueField } from "./StructuredValueField";

export interface StixReferenceOption {
  displayName: string;
  objectType: string;
  stixId: string;
}

interface StixFieldControlProps {
  definition: StixFieldDefinition;
  disabled: boolean;
  name: string;
  onChange: (value: string) => void;
  referenceOptions: readonly StixReferenceOption[];
  value: string;
}

function fieldHint(definition: StixFieldDefinition): string | null {
  if (definition.kind === "string-list" || definition.kind === "reference-list") {
    return definition.kind === "reference-list"
      ? "Choose compatible project objects or enter a valid external STIX ID."
      : "Separate values with commas or new lines.";
  }
  if (definition.description) return definition.description;
  if (definition.referenceTypes?.length) {
    return `Expected: ${definition.referenceTypes.map(readableStixName).join(", ")}.`;
  }
  return null;
}

export function StixFieldControl({
  definition,
  disabled,
  name,
  onChange,
  referenceOptions,
  value,
}: StixFieldControlProps) {
  const label = readableStixName(name);
  const hint = fieldHint(definition);
  const inputId = `stix-field-${name}`;

  return (
    <div className="grid min-w-0 gap-1.5">
      {definition.kind === "reference" ||
      definition.kind === "reference-list" ? null : definition.kind === "json" ||
        definition.kind === "boolean" ||
        definition.kind === "enum" ? (
        <span className="text-copy-secondary text-xs">
          {label}
          {definition.required ? <span className="ml-1 text-accent-bright">*</span> : null}
        </span>
      ) : (
        <label className="text-copy-secondary text-xs" htmlFor={inputId}>
          {label}
          {definition.required ? <span className="ml-1 text-accent-bright">*</span> : null}
        </label>
      )}
      {definition.kind === "json" ? (
        <StructuredValueField
          disabled={disabled}
          label={label}
          onChange={onChange}
          rootKind={definition.structuredRoot}
          value={value}
        />
      ) : definition.kind === "reference" ? (
        <AutocompleteField
          ariaLabel={label}
          description="Suggestions come from compatible objects already committed in this project. External STIX IDs remain supported."
          disabled={disabled}
          emptyMessage="No compatible local object. Enter an external STIX ID if needed."
          label={label}
          onChange={onChange}
          options={compatibleReferenceOptions(definition, referenceOptions)}
          placeholder="Choose an object or enter a STIX ID"
          value={value}
        />
      ) : definition.kind === "reference-list" ? (
        <StixReferenceListField
          definition={definition}
          disabled={disabled}
          label={label}
          onChange={onChange}
          options={referenceOptions}
          value={value}
        />
      ) : definition.kind === "boolean" || definition.kind === "enum" ? (
        <SelectField
          ariaLabel={label}
          disabled={disabled}
          onChange={onChange}
          options={(definition.kind === "boolean"
            ? ["true", "false"]
            : (definition.options ?? [])
          ).map((option) => ({ value: option, label: readableStixName(option) }))}
          placeholder="Choose a value"
          required={definition.required}
          value={value || null}
        />
      ) : definition.kind === "textarea" || definition.kind === "string-list" ? (
        <textarea
          className="min-h-20 w-full resize-y rounded-sm border border-panel-border bg-panel-deep px-2.5 py-2 text-copy-primary text-xs leading-5 outline-none focus:border-accent"
          disabled={disabled}
          id={inputId}
          onChange={(event) => onChange(event.currentTarget.value)}
          required={definition.required}
          spellCheck={definition.kind === "textarea"}
          value={value}
        />
      ) : (
        <input
          className="h-9 min-w-0 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-xs outline-none focus:border-accent"
          disabled={disabled}
          id={inputId}
          inputMode={
            definition.kind === "integer" || definition.kind === "number" ? "decimal" : undefined
          }
          onChange={(event) =>
            onChange(
              definition.kind === "timestamp"
                ? toStixTimestamp(event.currentTarget.value)
                : event.currentTarget.value,
            )
          }
          required={definition.required}
          spellCheck={false}
          step={definition.kind === "timestamp" ? "0.001" : undefined}
          type={definition.kind === "timestamp" ? "datetime-local" : undefined}
          value={definition.kind === "timestamp" ? toLocalDateTime(value) : value}
        />
      )}
      {definition.kind === "timestamp" ? (
        <span className="text-[11px] text-copy-faint leading-4">
          Choose local date and time; Sheut stores it as a UTC STIX timestamp.
        </span>
      ) : null}
      {hint ? <span className="text-[11px] text-copy-faint leading-4">{hint}</span> : null}
    </div>
  );
}

function compatibleReferenceOptions(
  definition: StixFieldDefinition,
  options: readonly StixReferenceOption[],
): AutocompleteFieldOption[] {
  const allowed = definition.referenceTypes ?? [];
  return options
    .filter((option) => allowed.length === 0 || allowed.includes(option.objectType))
    .map((option) => ({
      label: option.displayName,
      secondary: readableStixName(option.objectType),
      value: option.stixId,
    }));
}

function StixReferenceListField({
  definition,
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  definition: StixFieldDefinition;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: readonly StixReferenceOption[];
  value: string;
}) {
  const [candidate, setCandidate] = useState("");
  const references = splitReferences(value);
  const compatible = compatibleReferenceOptions(definition, options);

  const addReference = () => {
    const next = candidate.trim();
    if (!next || references.includes(next)) return;
    onChange([...references, next].join("\n"));
    setCandidate("");
  };

  return (
    <div className="grid gap-2">
      {references.length ? (
        <ul className="m-0 grid list-none gap-1 p-0" aria-label={`${label} values`}>
          {references.map((reference) => {
            const local = options.find((option) => option.stixId === reference);
            return (
              <li
                className="flex min-w-0 items-center justify-between gap-2 rounded-sm border border-panel-border bg-panel-deep px-2.5 py-1.5"
                key={reference}
              >
                <span className="min-w-0">
                  <span className="block truncate text-copy-primary text-xs">
                    {local?.displayName ?? reference}
                  </span>
                  {local ? (
                    <span className="block truncate text-[10px] text-copy-faint">
                      {readableStixName(local.objectType)} · {reference}
                    </span>
                  ) : null}
                </span>
                <Button
                  aria-label={`Remove ${local?.displayName ?? reference}`}
                  className="icon-control shrink-0"
                  disabled={disabled}
                  onClick={() =>
                    onChange(references.filter((item) => item !== reference).join("\n"))
                  }
                  type="button"
                >
                  <IconX size={13} aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="grid items-end gap-2 min-[540px]:grid-cols-[minmax(0,1fr)_auto]">
        <AutocompleteField
          ariaLabel={`Add ${label}`}
          disabled={disabled}
          emptyMessage="No compatible local object. Enter an external STIX ID if needed."
          label={`Add ${label}`}
          onChange={setCandidate}
          options={compatible}
          placeholder="Choose an object or enter a STIX ID"
          value={candidate}
        />
        <Button
          aria-label="Add reference"
          className="control-button h-9"
          disabled={disabled || !candidate.trim() || references.includes(candidate.trim())}
          onClick={addReference}
          type="button"
        >
          <IconPlus size={14} aria-hidden="true" />
          Add
        </Button>
      </div>
    </div>
  );
}

function splitReferences(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toLocalDateTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 23);
}

function toStixTimestamp(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
