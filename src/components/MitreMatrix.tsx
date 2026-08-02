import { Button } from "@base-ui/react/button";
import type {
  MitreCatalogSnapshot,
  MitreTechnique,
  MitreTechniqueSelection,
  TechniqueObservation,
} from "../lib/mitre";
import { ScrollAreaFrame } from "./ScrollAreaFrame";

interface MitreMatrixProps {
  catalog: MitreCatalogSnapshot;
  observations: readonly TechniqueObservation[];
  techniques: readonly MitreTechnique[];
  onSelectTechnique: (selection: MitreTechniqueSelection) => void;
  selectedTechniqueKey?: string;
}

const catalogNames: Readonly<Record<MitreCatalogSnapshot["catalog"], string>> = {
  attack_enterprise: "Enterprise ATT&CK",
  attack_mobile: "Mobile ATT&CK",
  attack_ics: "ICS ATT&CK",
  atlas: "ATLAS",
};

function titleCase(value: string) {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function observationsFor(
  observations: readonly TechniqueObservation[],
  catalog: MitreCatalogSnapshot,
  techniqueId: string,
  tacticId: string,
) {
  return observations.filter(
    (observation) =>
      observation.reference.catalog === catalog.catalog &&
      observation.reference.version === catalog.version &&
      observation.reference.techniqueId === techniqueId &&
      (observation.reference.tacticId === null || observation.reference.tacticId === tacticId),
  );
}

function TechniqueCell({
  catalog,
  observations,
  onSelectTechnique,
  tacticId,
  technique,
  selected,
}: {
  catalog: MitreCatalogSnapshot;
  observations: readonly TechniqueObservation[];
  onSelectTechnique: (selection: MitreTechniqueSelection) => void;
  tacticId: string;
  technique: MitreTechnique;
  selected: boolean;
}) {
  const annotations = observationsFor(observations, catalog, technique.id, tacticId);
  const latest = [...annotations].sort(
    (left, right) => right.updatedAtUnixMs - left.updatedAtUnixMs,
  )[0];
  const stateClass = latest
    ? latest.assessment === "observed"
      ? "border-accent/80 bg-[#102b46]"
      : latest.assessment === "suspected"
        ? "border-[#4b79aa] bg-[#172638]"
        : "border-copy-faint/60 bg-[#242832]"
    : "border-panel-border bg-panel-deep";
  return (
    <Button
      className={`grid w-full cursor-pointer gap-1 rounded-sm border px-2 py-2 text-left transition-colors hover:border-accent-hover hover:bg-panel-hover focus-visible:border-accent-hover ${stateClass} ${selected ? "ring-1 ring-accent-hover ring-offset-1 ring-offset-panel-base" : ""}`}
      type="button"
      aria-label={`${technique.name} ${technique.id}`}
      aria-pressed={selected}
      onClick={() =>
        onSelectTechnique({
          catalog: catalog.catalog,
          version: catalog.version,
          tacticId,
          technique,
          createMapping: annotations.length === 0,
        })
      }
    >
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate font-medium text-xs text-copy-primary">{technique.name}</span>
        <span className="shrink-0 font-mono text-[11px] text-copy-faint">{technique.id}</span>
      </span>
      {latest ? (
        <span className="text-[11px] text-accent-hover">
          {titleCase(latest.assessment)} · {titleCase(latest.outcome)} ·{" "}
          {titleCase(latest.confidence)}
          {annotations.length > 1 ? ` · ${annotations.length} entries` : ""}
        </span>
      ) : (
        <span className="text-[11px] text-copy-faint">Not mapped · click to add</span>
      )}
    </Button>
  );
}

export function MitreMatrix({
  catalog,
  observations,
  techniques,
  onSelectTechnique,
  selectedTechniqueKey,
}: MitreMatrixProps) {
  const visibleIds = new Set(techniques.map((technique) => technique.id));
  return (
    <section className="grid min-h-0 gap-2" aria-label={`${catalogNames[catalog.catalog]} matrix`}>
      <header className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="m-0 text-sm font-semibold">
          {catalogNames[catalog.catalog]} {catalog.version}
        </h2>
        <span className="text-[11px] text-copy-faint">{techniques.length} techniques shown</span>
      </header>
      <ScrollAreaFrame
        className="min-h-0 w-full pb-2"
        contentClassName="flex min-w-max gap-2 pb-3"
        horizontal
        vertical={false}
      >
        {catalog.tactics.map((tactic) => {
          const tacticTechniques = techniques.filter((technique) =>
            technique.tacticIds.includes(tactic.id),
          );
          const roots = tacticTechniques.filter(
            (technique) => technique.parentId === null || !visibleIds.has(technique.parentId),
          );
          return (
            <section
              className="w-56 shrink-0 rounded-sm border border-panel-border bg-panel-base"
              key={tactic.id}
              aria-labelledby={`${catalog.catalog}-${tactic.id}`}
            >
              <header className="border-panel-border border-b px-2.5 py-2">
                <h3
                  className="m-0 truncate text-[11px] font-semibold text-copy-secondary uppercase tracking-wider"
                  id={`${catalog.catalog}-${tactic.id}`}
                  title={tactic.name}
                >
                  {tactic.name}
                </h3>
                <p className="mt-0.5 mb-0 font-mono text-[11px] text-copy-faint">{tactic.id}</p>
                <p className="mt-1 mb-0 text-[11px] text-copy-faint">
                  {tacticTechniques.length} technique{tacticTechniques.length === 1 ? "" : "s"}
                </p>
              </header>
              <div className="grid gap-1.5 p-1.5">
                {roots.map((technique) => {
                  const children = tacticTechniques.filter(
                    (candidate) => candidate.parentId === technique.id,
                  );
                  return (
                    <div className="grid gap-1" key={technique.id}>
                      <TechniqueCell
                        catalog={catalog}
                        observations={observations}
                        onSelectTechnique={onSelectTechnique}
                        tacticId={tactic.id}
                        technique={technique}
                        selected={
                          selectedTechniqueKey === `${catalog.catalog}:${tactic.id}:${technique.id}`
                        }
                      />
                      {children.length > 0 ? (
                        <details className="group pl-2">
                          <summary className="cursor-pointer py-1 text-[11px] text-copy-faint hover:text-copy-secondary">
                            {children.length} sub-technique{children.length === 1 ? "" : "s"}
                          </summary>
                          <div className="grid gap-1 border-panel-border border-l pl-1.5">
                            {children.map((child) => (
                              <TechniqueCell
                                catalog={catalog}
                                key={child.id}
                                observations={observations}
                                onSelectTechnique={onSelectTechnique}
                                tacticId={tactic.id}
                                technique={child}
                                selected={
                                  selectedTechniqueKey ===
                                  `${catalog.catalog}:${tactic.id}:${child.id}`
                                }
                              />
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  );
                })}
                {roots.length === 0 ? (
                  <p className="m-0 px-1 py-2 text-[11px] text-copy-faint">No matches</p>
                ) : null}
              </div>
            </section>
          );
        })}
      </ScrollAreaFrame>
    </section>
  );
}
