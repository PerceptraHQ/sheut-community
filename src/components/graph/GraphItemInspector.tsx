import { Button } from "@base-ui/react/button";
import {
  IconArrowDownLeft,
  IconArrowUpRight,
  IconExternalLink,
  IconLink,
} from "@tabler/icons-react";

import type { GraphEdgeSummary, GraphItemProperties } from "../../lib/graph";

export function GraphItemInspector({
  properties,
  onOpenSource,
}: {
  properties: GraphItemProperties;
  onOpenSource: (sourceView: string) => void;
}) {
  const entries = propertyEntries(properties.properties);
  return (
    <div className="divide-y divide-panel-border text-xs">
      <section className="px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="m-0 text-[11px] text-accent-hover uppercase tracking-wider">
              {properties.node.objectType.replaceAll("-", " ")}
            </p>
            <h3 className="mt-1 mb-0 break-words text-copy-primary text-sm leading-5">
              {properties.node.displayName}
            </h3>
          </div>
          <span
            className={`mt-0.5 shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px] uppercase ${
              properties.node.available
                ? "border-[#31577e] text-[#8cb8df]"
                : "border-copy-faint border-dashed text-copy-secondary"
            }`}
          >
            {properties.node.available ? "Available" : "Unavailable"}
          </span>
        </div>
        {properties.node.stixId ? (
          <p className="mt-2 mb-0 break-all font-mono text-[11px] text-copy-faint">
            {properties.node.stixId}
          </p>
        ) : null}
        {properties.node.sourceView !== "unavailable" ? (
          <Button
            className="control-button mt-3 w-full justify-center"
            type="button"
            onClick={() => onOpenSource(properties.node.sourceView)}
          >
            <IconExternalLink size={12} aria-hidden="true" />
            Open source workspace
          </Button>
        ) : null}
      </section>

      <section className="px-3 py-3" aria-labelledby="graph-properties-title">
        <h3
          className="m-0 text-[11px] text-copy-faint uppercase tracking-wider"
          id="graph-properties-title"
        >
          Typed properties
        </h3>
        {entries.length > 0 ? (
          <dl className="mt-2 mb-0 grid gap-2">
            {entries.map(([name, value]) => (
              <div className="min-w-0" key={name}>
                <dt className="text-[11px] text-copy-faint">{name.replaceAll("_", " ")}</dt>
                <dd className="mt-0.5 mb-0 break-words text-[11px] text-copy-secondary leading-4">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 mb-0 text-[11px] text-copy-faint">
            No readable properties are available.
          </p>
        )}
      </section>

      <EdgeList
        title="Inbound links"
        icon={<IconArrowDownLeft size={12} aria-hidden="true" />}
        edges={properties.inbound}
      />
      <EdgeList
        title="Outbound links"
        icon={<IconArrowUpRight size={12} aria-hidden="true" />}
        edges={properties.outbound}
      />
    </div>
  );
}

function EdgeList({
  title,
  icon,
  edges,
}: {
  title: string;
  icon: React.ReactNode;
  edges: GraphEdgeSummary[];
}) {
  return (
    <section className="px-3 py-3">
      <h3 className="m-0 flex items-center gap-1.5 text-[11px] text-copy-faint uppercase tracking-wider">
        {icon}
        {title}
        <span>{edges.length}</span>
      </h3>
      {edges.length > 0 ? (
        <ul className="mt-2 mb-0 grid list-none gap-1 p-0">
          {edges.map((edge) => (
            <li
              className="rounded-sm border border-panel-border bg-panel-deep px-2 py-1.5"
              key={edge.id}
            >
              <span className="flex items-center gap-1.5 text-[11px] text-copy-secondary">
                <IconLink size={11} aria-hidden="true" />
                {edge.label || "Visual link"}
              </span>
              <span className="mt-0.5 block font-mono text-[11px] text-copy-faint">
                {edge.canonicalLabel}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 mb-0 text-[11px] text-copy-faint">None</p>
      )}
    </section>
  );
}

export function propertyEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([name, property]) => {
    if (property === null || property === undefined) return [];
    if (
      typeof property === "string" ||
      typeof property === "number" ||
      typeof property === "boolean"
    ) {
      return [[name, String(property)]];
    }
    if (Array.isArray(property)) {
      return [[name, property.map((item) => readablePropertyValue(item)).join(" · ")]];
    }
    return [[name, readablePropertyValue(property)]];
  });
}

function readablePropertyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(readablePropertyValue).filter(Boolean).join(" · ");
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.description ?? "";
  if (typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  const killChainName = record.kill_chain_name;
  const phaseName = record.phase_name;
  if (typeof killChainName === "string" && typeof phaseName === "string") {
    return `${readableLabel(killChainName)} — ${readableLabel(phaseName)}`;
  }
  return Object.entries(record)
    .filter(([, nested]) => nested !== null && nested !== undefined)
    .map(([key, nested]) => `${readableLabel(key)}: ${readablePropertyValue(nested)}`)
    .join(" · ");
}

function readableLabel(value: string) {
  return value.replaceAll(/[-_]+/gu, " ");
}
