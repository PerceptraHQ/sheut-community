import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Tabs } from "@base-ui/react/tabs";
import { IconLayoutGrid, IconSearch } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import {
  getMitreCatalog,
  listTechniqueObservations,
  type MitreCatalog,
  type MitreCatalogSnapshot,
  type MitreTechniqueSelection,
  mitreErrorMessage,
  type TechniqueAssessment,
  type TechniqueObservation,
} from "../lib/mitre";
import { MitreCatalogUpdateDialog } from "./MitreCatalogUpdateDialog";
import { MitreInterchangeDialog } from "./MitreInterchangeDialog";
import { MitreMatrix } from "./MitreMatrix";
import { ScrollAreaFrame } from "./ScrollAreaFrame";
import { SelectField } from "./SelectField";
import { WorkspaceLoadingState } from "./WorkspaceState";

type CatalogView = MitreCatalog;

const tabOptions = [
  ["attack_enterprise", "Enterprise ATT&CK"],
  ["atlas", "ATLAS"],
  ["attack_mobile", "Mobile ATT&CK"],
  ["attack_ics", "ICS ATT&CK"],
] as const;

const mappingStateOptions = [
  { value: "all", label: "All mapping states" },
  { value: "mapped", label: "Mapped techniques" },
  { value: "observed", label: "Observed" },
  { value: "suspected", label: "Suspected" },
  { value: "ruled_out", label: "Ruled out" },
] as const;

interface MitreWorkspaceProps {
  projectId: string;
  refreshKey: number;
  onSelectTechnique: (selection: MitreTechniqueSelection) => void;
  onCatalogChanged?: () => void;
}

export function MitreWorkspace({
  projectId,
  refreshKey,
  onSelectTechnique,
  onCatalogChanged,
}: MitreWorkspaceProps) {
  const [view, setView] = useState<CatalogView>("attack_enterprise");
  const [catalogs, setCatalogs] = useState<Partial<Record<MitreCatalog, MitreCatalogSnapshot>>>({});
  const [observations, setObservations] = useState<TechniqueObservation[]>([]);
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("all");
  const [mappingState, setMappingState] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogDialogOpen, setCatalogDialogOpen] = useState(false);
  const [interchangeDialogOpen, setInterchangeDialogOpen] = useState(false);
  const [selectedTechniqueKey, setSelectedTechniqueKey] = useState<string>();

  const handleSelectTechnique = (selection: MitreTechniqueSelection) => {
    setSelectedTechniqueKey(
      `${selection.catalog}:${selection.tacticId ?? "none"}:${selection.technique.id}`,
    );
    onSelectTechnique(selection);
  };

  useEffect(() => {
    let active = true;
    getMitreCatalog(view)
      .then((loaded) => {
        if (!active) return;
        setCatalogs((current) => {
          const next = { ...current };
          next[loaded.catalog] = loaded;
          return next;
        });
      })
      .catch((cause: unknown) => {
        if (active) setError(mitreErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view]);

  useEffect(() => {
    let active = true;
    listTechniqueObservations(projectId)
      .then((loaded) => {
        if (active && refreshKey >= 0) setObservations(loaded);
      })
      .catch((cause: unknown) => {
        if (active) setError(mitreErrorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [projectId, refreshKey]);

  const activeCatalog = catalogs[view];
  const platformOptions = useMemo(() => {
    const values = new Set(activeCatalog?.techniques.flatMap((item) => item.platforms) ?? []);
    return [
      { value: "all", label: "All platforms" },
      ...Array.from(values)
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({ value, label: value })),
    ];
  }, [activeCatalog]);

  const matchesMappingState = (catalog: MitreCatalogSnapshot, techniqueId: string) => {
    if (mappingState === "all") return true;
    const entries = observations.filter(
      (entry) =>
        entry.reference.catalog === catalog.catalog &&
        entry.reference.version === catalog.version &&
        entry.reference.techniqueId === techniqueId,
    );
    if (mappingState === "mapped") return entries.length > 0;
    return entries.some((entry) => entry.assessment === (mappingState as TechniqueAssessment));
  };
  const query = search.trim().toLocaleLowerCase();
  const visibleTechniques =
    activeCatalog?.techniques.filter((technique) => {
      const searchMatch =
        query.length === 0 ||
        `${technique.id} ${technique.name} ${technique.description}`
          .toLocaleLowerCase()
          .includes(query);
      const platformMatch = platform === "all" || technique.platforms.includes(platform);
      return searchMatch && platformMatch && matchesMappingState(activeCatalog, technique.id);
    }) ?? [];

  return (
    <Tabs.Root
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"
      value={view}
      onValueChange={(value) => {
        if (typeof value === "string") {
          setLoading(true);
          setError(null);
          setView(value as CatalogView);
          setPlatform("all");
        }
      }}
    >
      <div className="grid gap-2 border-panel-border border-b bg-panel-deep px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Tabs.List className="flex min-w-0 gap-1" aria-label="MITRE knowledge base">
            {tabOptions.map(([value, label]) => (
              <Tabs.Tab
                className="cursor-pointer rounded-sm border border-transparent bg-transparent px-2.5 py-1.5 text-[11px] text-copy-muted transition-colors hover:bg-panel-hover hover:text-copy-primary data-active:border-accent/70 data-active:bg-[#102b46] data-active:text-copy-primary"
                key={value}
                value={value}
              >
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              className="control-button"
              type="button"
              onClick={() => setInterchangeDialogOpen(true)}
            >
              Import / export
            </Button>
            <Button
              className="control-button"
              type="button"
              onClick={() => setCatalogDialogOpen(true)}
            >
              Catalogs
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2">
          <label
            className="flex h-9 min-w-0 items-center gap-2 rounded-sm border border-panel-border bg-panel-base px-2.5 text-copy-faint focus-within:border-accent"
            htmlFor="mitre-technique-search"
          >
            <IconSearch size={14} aria-hidden="true" />
            <Input
              id="mitre-technique-search"
              className="min-w-0 flex-1 border-0 bg-transparent text-xs text-copy-primary outline-none placeholder:text-copy-faint"
              type="search"
              aria-label="Search MITRE techniques"
              placeholder="Search name, ID, or description"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </label>
          <SelectField
            ariaLabel="Filter by platform"
            onChange={setPlatform}
            options={platformOptions}
            placeholder="All platforms"
            value={platform}
          />
          <SelectField
            ariaLabel="Filter by mapping state"
            onChange={setMappingState}
            options={mappingStateOptions}
            placeholder="All mapping states"
            value={mappingState}
          />
        </div>
        <p className="m-0 text-[11px] text-copy-faint">
          Select a mapped technique to inspect it. Select an unmapped technique to create its first
          project mapping in Properties.
        </p>
      </div>

      <Tabs.Panel className="min-h-0 overflow-hidden" value={view}>
        <ScrollAreaFrame className="h-full" contentClassName="p-3">
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : loading && !activeCatalog ? (
            <WorkspaceLoadingState
              icon={<IconLayoutGrid size={26} aria-hidden="true" />}
              title="Loading MITRE ATT&CK"
              description="Opening the pinned offline catalog and project mappings."
            />
          ) : (
            <div className="grid select-none gap-6">
              {activeCatalog ? (
                <MitreMatrix
                  catalog={activeCatalog}
                  key={`${activeCatalog.catalog}-${activeCatalog.version}`}
                  observations={observations}
                  techniques={visibleTechniques}
                  onSelectTechnique={handleSelectTechnique}
                  selectedTechniqueKey={selectedTechniqueKey}
                />
              ) : null}
            </div>
          )}
        </ScrollAreaFrame>
      </Tabs.Panel>
      {catalogDialogOpen ? (
        <MitreCatalogUpdateDialog
          open
          onOpenChange={setCatalogDialogOpen}
          onCatalogChanged={(catalog) => {
            setCatalogs((current) => ({ ...current, [catalog.catalog]: catalog }));
            onCatalogChanged?.();
          }}
        />
      ) : null}
      {interchangeDialogOpen ? (
        <MitreInterchangeDialog
          open
          projectId={projectId}
          onOpenChange={setInterchangeDialogOpen}
          onImported={() => {
            listTechniqueObservations(projectId)
              .then(setObservations)
              .catch((cause: unknown) => setError(mitreErrorMessage(cause)));
          }}
        />
      ) : null}
    </Tabs.Root>
  );
}
