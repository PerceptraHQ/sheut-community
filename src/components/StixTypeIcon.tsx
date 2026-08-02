import { iconUrlFor } from "./graph/stix-icon-urls";

interface StixTypeIconProps {
  objectType: string;
  size?: number;
}

export function StixTypeIcon({ objectType, size = 16 }: StixTypeIconProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      data-stix-type={objectType}
      draggable={false}
      height={size}
      src={iconUrlFor(objectType)}
      width={size}
    />
  );
}
