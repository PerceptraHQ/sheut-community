import type { StixRelationshipEndpoint } from "../lib/stix";
import { readableStixName, relationshipTypeSuggestions } from "../lib/stixSchemas";
import { AutocompleteField } from "./AutocompleteField";
import { StixEndpointSelect } from "./StixEndpointSelect";

interface StixRelationshipFieldsProps {
  disabled: boolean;
  endpoints: readonly StixRelationshipEndpoint[];
  onRelationshipTypeChange: (value: string) => void;
  onSourceChange: (localId: string) => void;
  onTargetChange: (localId: string) => void;
  relationshipType: string;
  sourceId: string;
  targetId: string;
}

export function StixRelationshipFields({
  disabled,
  endpoints,
  onRelationshipTypeChange,
  onSourceChange,
  onTargetChange,
  relationshipType,
  sourceId,
  targetId,
}: StixRelationshipFieldsProps) {
  const sourceType = endpoints.find((endpoint) => endpoint.localId === sourceId)?.objectType ?? "";
  const targetType = endpoints.find((endpoint) => endpoint.localId === targetId)?.objectType ?? "";
  const suggestions = relationshipTypeSuggestions(sourceType, targetType);
  const relationshipOptions = suggestions.map((suggestion) => ({
    label: readableStixName(suggestion),
    secondary: "STIX 2.1",
    value: suggestion,
  }));

  return (
    <section className="grid gap-3 rounded-sm border border-panel-border bg-panel-deep/40 p-3">
      <div className="grid gap-1">
        <h3 className="m-0 text-copy-primary text-xs font-semibold">Relationship endpoints</h3>
        <p className="m-0 text-[11px] text-copy-faint leading-4">
          Direction matters: the source performs the selected relationship toward the target.
        </p>
      </div>
      {endpoints.length >= 2 ? (
        <>
          <div className="grid gap-3 min-[720px]:grid-cols-2">
            <StixEndpointSelect
              disabled={disabled}
              endpoints={endpoints}
              label="Source object"
              onChange={onSourceChange}
              value={sourceId}
            />
            <StixEndpointSelect
              disabled={disabled}
              endpoints={endpoints}
              label="Target object"
              onChange={onTargetChange}
              value={targetId}
            />
          </div>
          <AutocompleteField
            description="Choices are filtered to relationships STIX 2.1 defines for this source and target. You may type a valid custom open-vocabulary value."
            disabled={disabled}
            emptyMessage="No STIX 2.1 match. The typed custom relationship will be used."
            label="Relationship type"
            onChange={onRelationshipTypeChange}
            options={relationshipOptions}
            placeholder="Choose or enter a relationship"
            value={relationshipType}
          />
        </>
      ) : (
        <p className="m-0 text-copy-muted text-xs">
          Create or import at least two domain or observable objects before linking them.
        </p>
      )}
    </section>
  );
}
