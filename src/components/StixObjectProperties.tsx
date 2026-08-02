import type { StixFieldDefinition, StixObjectSchema } from "../lib/stixSchemas";
import { StixFieldControl, type StixReferenceOption } from "./StixFieldControl";

interface StixObjectPropertiesProps {
  disabled: boolean;
  onValueChange: (name: string, value: string) => void;
  referenceOptions: readonly StixReferenceOption[];
  schema: StixObjectSchema;
  values: Readonly<Record<string, string>>;
}

function fieldWidth(definition: StixFieldDefinition): string {
  return definition.kind === "textarea" ||
    definition.kind === "json" ||
    definition.kind.endsWith("list")
    ? "min-[720px]:col-span-2"
    : "";
}

function PropertyGroup({
  disabled,
  fields,
  onValueChange,
  referenceOptions,
  title,
  values,
}: {
  disabled: boolean;
  fields: ReadonlyArray<readonly [string, StixFieldDefinition]>;
  onValueChange: (name: string, value: string) => void;
  referenceOptions: readonly StixReferenceOption[];
  title: string;
  values: Readonly<Record<string, string>>;
}) {
  if (!fields.length) return null;
  return (
    <section
      className="grid gap-3"
      aria-labelledby={`stix-${title.toLowerCase().replaceAll(" ", "-")}`}
    >
      <div className="flex items-center gap-2 border-panel-border border-b pb-2">
        <h3
          className="m-0 text-copy-primary text-xs font-semibold"
          id={`stix-${title.toLowerCase().replaceAll(" ", "-")}`}
        >
          {title}
        </h3>
        <span className="text-[11px] text-copy-faint">{fields.length}</span>
      </div>
      <div className="grid items-start gap-4 min-[720px]:grid-cols-2">
        {fields.map(([name, definition]) => (
          <div className={fieldWidth(definition)} key={name}>
            <StixFieldControl
              definition={definition}
              disabled={disabled}
              name={name}
              onChange={(value) => onValueChange(name, value)}
              referenceOptions={referenceOptions}
              value={values[name] ?? ""}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function StixObjectProperties({
  disabled,
  onValueChange,
  referenceOptions,
  schema,
  values,
}: StixObjectPropertiesProps) {
  const fields = Object.entries(schema.fields).filter(([, definition]) => !definition.managed);
  const requiredFields = fields.filter(([, definition]) => definition.required);
  const optionalFields = fields.filter(([, definition]) => !definition.required);

  return (
    <div className="grid gap-6">
      {schema.requirements?.length ? (
        <section className="grid gap-1 rounded-sm border border-panel-border bg-panel-raised/40 px-3 py-2">
          <h3 className="m-0 text-copy-primary text-xs font-semibold">Conditional rules</h3>
          {schema.requirements.map((requirement) => (
            <p className="m-0 text-copy-muted text-xs leading-4" key={requirement}>
              {requirement}
            </p>
          ))}
        </section>
      ) : null}
      <PropertyGroup
        disabled={disabled}
        fields={requiredFields}
        onValueChange={onValueChange}
        referenceOptions={referenceOptions}
        title="Required properties"
        values={values}
      />
      <PropertyGroup
        disabled={disabled}
        fields={optionalFields}
        onValueChange={onValueChange}
        referenceOptions={referenceOptions}
        title="Optional properties"
        values={values}
      />
    </div>
  );
}
