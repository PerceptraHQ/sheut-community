import type { StixRelationshipEndpoint } from "../lib/stix";
import { readableStixName } from "../lib/stixSchemas";
import { ComboboxField } from "./ComboboxField";
import { StixTypeIcon } from "./StixTypeIcon";

interface StixEndpointSelectProps {
  disabled: boolean;
  endpoints: readonly StixRelationshipEndpoint[];
  label: string;
  onChange: (localId: string) => void;
  value: string;
}

export function StixEndpointSelect({
  disabled,
  endpoints,
  label,
  onChange,
  value,
}: StixEndpointSelectProps) {
  return (
    <ComboboxField
      disabled={disabled}
      label={label}
      onChange={onChange}
      options={endpoints.map((endpoint) => ({
        value: endpoint.localId,
        label: endpoint.displayName,
        secondary: readableStixName(endpoint.objectType),
        icon: <StixTypeIcon objectType={endpoint.objectType} size={14} />,
      }))}
      placeholder="Choose an object"
      value={value || null}
    />
  );
}
