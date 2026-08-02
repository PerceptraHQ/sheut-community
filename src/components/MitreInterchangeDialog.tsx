import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import { useState } from "react";
import {
  type AnalyticConfidence,
  commitMitreMappingImport,
  commitNavigatorImport,
  exportMitreMapping,
  exportNavigatorProjection,
  type MitreCatalog,
  type MitreMappingImportPreview,
  mitreErrorMessage,
  type NavigatorImportPreview,
  previewMitreMappingImport,
  previewNavigatorImport,
  type TechniqueAssessment,
  type TechniqueOutcome,
} from "../lib/mitre";
import { DialogFrame } from "./DialogFrame";
import { ScrollAreaFrame } from "./ScrollAreaFrame";
import { SelectField } from "./SelectField";
import { useVaultNotices } from "./VaultNotices";

const catalogOptions = [
  { value: "attack_enterprise", label: "Enterprise ATT&CK" },
  { value: "attack_mobile", label: "Mobile ATT&CK" },
  { value: "attack_ics", label: "ICS ATT&CK" },
  { value: "atlas", label: "ATLAS" },
] as const;

const assessmentOptions = [
  { value: "suspected", label: "Suspected" },
  { value: "observed", label: "Observed" },
  { value: "ruled_out", label: "Ruled out" },
] as const;

const outcomeOptions = [
  { value: "unknown", label: "Unknown" },
  { value: "attempted", label: "Attempted" },
  { value: "successful", label: "Successful" },
  { value: "prevented", label: "Prevented" },
] as const;

const confidenceOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

const catalogNames: Readonly<Record<MitreCatalog, string>> = {
  attack_enterprise: "Enterprise ATT&CK",
  attack_mobile: "Mobile ATT&CK",
  attack_ics: "ICS ATT&CK",
  atlas: "ATLAS",
};

const navigatorCatalogs = [
  { name: "Enterprise ATT&CK", domain: "enterprise-attack", layer: "4.5" },
  { name: "Mobile ATT&CK", domain: "mobile-attack", layer: "4.5" },
  { name: "ICS ATT&CK", domain: "ics-attack", layer: "4.5" },
  { name: "ATLAS", domain: "atlas-atlas", layer: "4.3" },
] as const;

interface MitreInterchangeDialogProps {
  open: boolean;
  projectId: string;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function MitreInterchangeDialog({
  open,
  projectId,
  onOpenChange,
  onImported,
}: MitreInterchangeDialogProps) {
  const notices = useVaultNotices();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mappingPreview, setMappingPreview] = useState<MitreMappingImportPreview | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [mappingFileName, setMappingFileName] = useState("sheut-mapping");
  const [navigatorPreview, setNavigatorPreview] = useState<NavigatorImportPreview | null>(null);
  const [assessment, setAssessment] = useState<TechniqueAssessment>("suspected");
  const [outcome, setOutcome] = useState<TechniqueOutcome>("unknown");
  const [confidence, setConfidence] = useState<AnalyticConfidence>("low");
  const [defaultNarrative, setDefaultNarrative] = useState(
    "Imported from the reviewed Navigator layer.",
  );
  const [includeDisabled, setIncludeDisabled] = useState(false);
  const [catalog, setCatalog] = useState<MitreCatalog>("attack_enterprise");
  const [layerName, setLayerName] = useState("Sheut project mapping");
  const [navigatorFileName, setNavigatorFileName] = useState("sheut-navigator-layer");

  const run = async (operation: () => Promise<void>) => {
    setWorking(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(mitreErrorMessage(cause));
    } finally {
      setWorking(false);
    }
  };

  const chooseMapping = () => {
    void run(async () => {
      const preview = await previewMitreMappingImport(projectId);
      if (preview) {
        setMappingPreview(preview);
        setReplaceExisting(false);
      }
    });
  };

  const importMapping = () => {
    if (!mappingPreview) return;
    void run(async () => {
      const result = await notices.promise(
        () => commitMitreMappingImport(projectId, mappingPreview.previewId, replaceExisting),
        {
          loading: { title: "Importing mapping", type: "info" },
          success: (outcome) => ({
            title: "Mapping imported",
            description: `${outcome.imported} imported · ${outcome.skipped} skipped`,
            type: "success",
          }),
          error: (cause) => ({
            title: "Mapping not imported",
            description: mitreErrorMessage(cause),
            type: "info",
          }),
        },
      );
      if (result.imported > 0) onImported();
      setMappingPreview(null);
      setReplaceExisting(false);
    });
  };

  const exportMapping = () => {
    void run(async () => {
      const result = await exportMitreMapping(projectId, mappingFileName);
      if (result.saved) {
        notices.add({
          title: "Mapping exported",
          description: "The lossless Sheut mapping file was saved locally.",
          type: "success",
        });
      }
    });
  };

  const chooseNavigator = () => {
    void run(async () => {
      const preview = await previewNavigatorImport(projectId);
      if (preview) {
        setNavigatorPreview(preview);
        setIncludeDisabled(false);
      }
    });
  };

  const importNavigator = () => {
    if (!navigatorPreview) return;
    void run(async () => {
      const result = await notices.promise(
        () =>
          commitNavigatorImport(projectId, navigatorPreview.previewId, {
            assessment,
            outcome,
            confidence,
            defaultNarrative,
            includeDisabled,
          }),
        {
          loading: { title: "Creating project mappings", type: "info" },
          success: (value) => ({
            title: "Navigator layer imported",
            description: `${value.imported} mappings created`,
            type: "success",
          }),
          error: (cause) => ({
            title: "Navigator layer not imported",
            description: mitreErrorMessage(cause),
            type: "info",
          }),
        },
      );
      if (result.imported > 0) onImported();
      setNavigatorPreview(null);
    });
  };

  const exportNavigator = () => {
    void run(async () => {
      const result = await exportNavigatorProjection(
        projectId,
        catalog,
        layerName,
        navigatorFileName,
      );
      if (result.saved) {
        notices.add({
          title: "Navigator projection exported",
          description: "The compatible layer was saved locally.",
          type: "success",
        });
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      <DialogFrame width="wide">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 text-sm font-semibold">MITRE interchange</Dialog.Title>
          <Dialog.Close
            render={<Button className="icon-control" />}
            aria-label="Close"
            disabled={working}
          >
            <span aria-hidden="true">×</span>
          </Dialog.Close>
        </header>
        <Tabs.Root
          defaultValue="mapping"
          className="grid h-[min(78vh,44rem)] grid-rows-[auto_minmax(0,1fr)]"
        >
          <Tabs.List className="grid grid-cols-2 gap-1 border-panel-border border-b bg-panel-deep p-2">
            <Tabs.Tab
              className="cursor-pointer rounded-sm border-0 bg-transparent px-3 py-2 text-copy-muted text-xs outline-none hover:bg-panel-hover hover:text-copy-primary data-active:bg-accent data-active:text-white"
              value="mapping"
            >
              Sheut mapping
            </Tabs.Tab>
            <Tabs.Tab
              className="cursor-pointer rounded-sm border-0 bg-transparent px-3 py-2 text-copy-muted text-xs outline-none hover:bg-panel-hover hover:text-copy-primary data-active:bg-accent data-active:text-white"
              value="navigator"
            >
              ATT&CK Navigator
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel className="min-h-0 overflow-hidden" value="mapping">
            <ScrollAreaFrame className="h-full" contentClassName="p-4">
              <div className="grid gap-5">
                <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
                  The versioned Sheut mapping file is the lossless portable form. It preserves local
                  mapping IDs, revisions, typed assessment fields, narratives, and timestamps.
                </Dialog.Description>
                <section className="grid gap-3 rounded-sm border border-panel-border bg-panel-deep p-3">
                  <h3 className="m-0 text-copy-primary text-xs">Import mapping</h3>
                  <p className="m-0 text-xs text-copy-muted">
                    Project mapping and Navigator files are limited to 16 MiB and validated in Rust
                    before the encrypted project is changed. Full catalog STIX updates are handled
                    separately under Catalogs with a 96 MiB limit.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button className="control-button" disabled={working} onClick={chooseMapping}>
                      Choose mapping file
                    </Button>
                    {mappingPreview ? (
                      <span className="text-xs text-copy-secondary">
                        {mappingPreview.observationCount} mappings · {mappingPreview.duplicateCount}{" "}
                        existing IDs
                      </span>
                    ) : null}
                  </div>
                  {mappingPreview && mappingPreview.duplicateCount > 0 ? (
                    <label className="flex items-start gap-2 text-xs text-copy-secondary">
                      <input
                        type="checkbox"
                        checked={replaceExisting}
                        onChange={(event) => setReplaceExisting(event.currentTarget.checked)}
                      />
                      Replace mappings with matching IDs. Unchecked conflicts are otherwise skipped.
                    </label>
                  ) : null}
                  {mappingPreview ? (
                    <Button
                      className="primary-button justify-self-start"
                      disabled={working}
                      onClick={importMapping}
                    >
                      Import mapping
                    </Button>
                  ) : null}
                </section>
                <section className="grid gap-3 rounded-sm border border-panel-border bg-panel-deep p-3">
                  <h3 className="m-0 text-copy-primary text-xs">Export mapping</h3>
                  <label className="grid gap-1 text-xs text-copy-secondary">
                    File name
                    <input
                      className="text-input"
                      maxLength={96}
                      value={mappingFileName}
                      onChange={(event) => setMappingFileName(event.currentTarget.value)}
                    />
                  </label>
                  <Button
                    className="control-button justify-self-start"
                    disabled={working || mappingFileName.trim().length === 0}
                    onClick={exportMapping}
                  >
                    Export mapping
                  </Button>
                </section>
              </div>
            </ScrollAreaFrame>
          </Tabs.Panel>

          <Tabs.Panel className="min-h-0 overflow-hidden" value="navigator">
            <ScrollAreaFrame className="h-full" contentClassName="p-4">
              <div className="grid gap-5">
                <section className="grid gap-3 rounded-sm border border-accent/40 bg-accent/5 p-3">
                  <div>
                    <h3 className="m-0 text-copy-primary text-xs">How Navigator works in Sheut</h3>
                    <p className="mt-1 mb-0 text-xs text-copy-muted leading-5">
                      First create mappings by selecting techniques in the matrix. Then export one
                      catalog as a Navigator layer, or import an existing layer and explicitly turn
                      its entries into typed project mappings.
                    </p>
                  </div>
                  <ol className="m-0 grid gap-1 pl-4 text-xs text-copy-secondary">
                    <li>
                      Select an unmapped technique and complete the mapping form in Properties.
                    </li>
                    <li>Export the chosen catalog for use in ATT&CK Navigator.</li>
                    <li>Preview imported layers before creating any project mappings.</li>
                  </ol>
                  <div className="grid grid-cols-2 gap-2">
                    {navigatorCatalogs.map((item) => (
                      <div
                        className="rounded-sm border border-panel-border bg-panel-base px-2.5 py-2"
                        key={item.domain}
                      >
                        <p className="m-0 text-[11px] font-medium text-copy-primary">{item.name}</p>
                        <p className="mt-1 mb-0 font-mono text-[11px] text-copy-faint">
                          {item.domain} · layer {item.layer}
                        </p>
                      </div>
                    ))}
                  </div>
                  <Button
                    className="control-button justify-self-start"
                    type="button"
                    onClick={() => onOpenChange(false)}
                  >
                    Create mappings in matrix
                  </Button>
                </section>
                <p className="m-0 text-copy-muted text-xs leading-5">
                  Navigator JSON is a compatible projection, not Sheut’s source of truth. It never
                  creates STIX objects. Scores, colors, and enabled state are not silently converted
                  into assessment, outcome, or confidence.
                </p>
                <section className="grid gap-3 rounded-sm border border-panel-border bg-panel-deep p-3">
                  <h3 className="m-0 text-copy-primary text-xs">
                    Import an existing Navigator layer
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button className="control-button" disabled={working} onClick={chooseNavigator}>
                      Choose Navigator layer
                    </Button>
                    {navigatorPreview ? (
                      <span className="text-xs text-copy-secondary">{navigatorPreview.name}</span>
                    ) : null}
                  </div>
                  {navigatorPreview ? (
                    <>
                      <p className="m-0 text-xs text-copy-muted">
                        {navigatorPreview.entryCount} entries · {navigatorPreview.commentCount}{" "}
                        comments · {navigatorPreview.scoredCount} scored ·{" "}
                        {navigatorPreview.disabledCount} disabled
                      </p>
                      <p className="m-0 text-xs text-copy-faint">
                        {catalogNames[navigatorPreview.catalog]} {navigatorPreview.catalogVersion}.
                        Existing comments become narratives; the defaults below apply to every
                        imported entry.
                      </p>
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">
                        <SelectField
                          ariaLabel="Imported assessment"
                          label="Assessment"
                          options={assessmentOptions}
                          placeholder="Assessment"
                          value={assessment}
                          onChange={(value) => {
                            const next = value as TechniqueAssessment;
                            setAssessment(next);
                            if (next === "ruled_out") setOutcome("unknown");
                          }}
                        />
                        <SelectField
                          ariaLabel="Imported outcome"
                          label="Outcome"
                          options={
                            assessment === "ruled_out" ? [outcomeOptions[0]] : outcomeOptions
                          }
                          placeholder="Outcome"
                          value={outcome}
                          onChange={(value) => setOutcome(value as TechniqueOutcome)}
                        />
                        <SelectField
                          ariaLabel="Imported confidence"
                          label="Confidence"
                          options={confidenceOptions}
                          placeholder="Confidence"
                          value={confidence}
                          onChange={(value) => setConfidence(value as AnalyticConfidence)}
                        />
                      </div>
                      <label className="grid gap-1 text-xs text-copy-secondary">
                        Narrative for entries without comments
                        <textarea
                          className="min-h-16 resize-y rounded-sm border border-panel-border bg-panel-base p-2 text-copy-primary text-xs outline-none focus:border-accent"
                          maxLength={4000}
                          value={defaultNarrative}
                          onChange={(event) => setDefaultNarrative(event.currentTarget.value)}
                        />
                      </label>
                      {navigatorPreview.disabledCount > 0 ? (
                        <label className="flex items-start gap-2 text-xs text-copy-secondary">
                          <input
                            type="checkbox"
                            checked={includeDisabled}
                            onChange={(event) => setIncludeDisabled(event.currentTarget.checked)}
                          />
                          Include disabled Navigator entries. They use the same typed defaults and
                          are not interpreted as ruled out.
                        </label>
                      ) : null}
                      <Button
                        className="primary-button justify-self-start"
                        disabled={working || defaultNarrative.trim().length === 0}
                        onClick={importNavigator}
                      >
                        Create mappings
                      </Button>
                    </>
                  ) : null}
                </section>
                <section className="grid gap-3 rounded-sm border border-panel-border bg-panel-deep p-3">
                  <h3 className="m-0 text-copy-primary text-xs">
                    Export project mappings as a Navigator layer
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <SelectField
                      ariaLabel="Navigator catalog"
                      label="Catalog"
                      options={catalogOptions}
                      placeholder="Catalog"
                      value={catalog}
                      onChange={(value) => setCatalog(value as MitreCatalog)}
                    />
                    <label className="grid gap-1 text-xs text-copy-secondary">
                      Layer name
                      <input
                        className="text-input"
                        maxLength={160}
                        value={layerName}
                        onChange={(event) => setLayerName(event.currentTarget.value)}
                      />
                    </label>
                  </div>
                  <label className="grid gap-1 text-xs text-copy-secondary">
                    File name
                    <input
                      className="text-input"
                      maxLength={96}
                      value={navigatorFileName}
                      onChange={(event) => setNavigatorFileName(event.currentTarget.value)}
                    />
                  </label>
                  <Button
                    className="control-button justify-self-start"
                    disabled={
                      working ||
                      layerName.trim().length === 0 ||
                      navigatorFileName.trim().length === 0
                    }
                    onClick={exportNavigator}
                  >
                    Export Navigator layer
                  </Button>
                </section>
              </div>
            </ScrollAreaFrame>
          </Tabs.Panel>
        </Tabs.Root>
        {error ? (
          <p className="error-message mx-4 mb-4" role="alert">
            {error}
          </p>
        ) : null}
      </DialogFrame>
    </Dialog.Root>
  );
}
