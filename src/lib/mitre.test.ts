import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitMitreCatalogUpdate,
  commitMitreMappingImport,
  commitNavigatorImport,
  createTechniqueObservation,
  deleteTechniqueObservation,
  exportMitreMapping,
  exportNavigatorProjection,
  getMitreCatalog,
  listMitreCatalogStatuses,
  listTechniqueObservations,
  type MitreTechniqueReference,
  previewMitreCatalogUpdate,
  previewMitreMappingImport,
  previewNavigatorImport,
  resetMitreCatalog,
  type TechniqueObservationValues,
  updateTechniqueObservation,
} from "./mitre";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const PROJECT_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const OBSERVATION_ID = "e7c44850-9f67-4d26-b7e3-0d4ee82339ef";

describe("MITRE command boundary", () => {
  beforeEach(() => vi.mocked(invoke).mockReset().mockResolvedValue({}));

  it("uses typed catalog and project-scoped observation commands", async () => {
    const reference: MitreTechniqueReference = {
      catalog: "attack_enterprise",
      version: "19.1",
      techniqueId: "T1059.001",
      tacticId: "TA0002",
    };
    const values: TechniqueObservationValues = {
      assessment: "observed",
      outcome: "successful",
      confidence: "high",
      narrative: "Endpoint telemetry confirmed PowerShell execution.",
      firstSeenUnixMs: 1_000,
      lastSeenUnixMs: 2_000,
    };

    await getMitreCatalog("attack_enterprise");
    await listMitreCatalogStatuses();
    await previewMitreCatalogUpdate();
    await commitMitreCatalogUpdate(OBSERVATION_ID, false);
    await resetMitreCatalog("attack_enterprise");
    await listTechniqueObservations(PROJECT_ID);
    await createTechniqueObservation(PROJECT_ID, reference, values);
    await updateTechniqueObservation(PROJECT_ID, OBSERVATION_ID, 2, values);
    await deleteTechniqueObservation(PROJECT_ID, OBSERVATION_ID, 2);

    expect(invoke).toHaveBeenNthCalledWith(1, "get_mitre_catalog", {
      catalog: "attack_enterprise",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "list_mitre_catalog_statuses");
    expect(invoke).toHaveBeenNthCalledWith(3, "preview_mitre_catalog_update");
    expect(invoke).toHaveBeenNthCalledWith(4, "commit_mitre_catalog_update", {
      previewId: OBSERVATION_ID,
      allowDowngrade: false,
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "reset_mitre_catalog", {
      catalog: "attack_enterprise",
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "list_technique_observations", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(7, "create_technique_observation", {
      projectId: PROJECT_ID,
      reference,
      ...values,
    });
    expect(invoke).toHaveBeenNthCalledWith(8, "update_technique_observation", {
      projectId: PROJECT_ID,
      observationId: OBSERVATION_ID,
      expectedRevision: 2,
      ...values,
    });
    expect(invoke).toHaveBeenNthCalledWith(9, "delete_technique_observation", {
      projectId: PROJECT_ID,
      observationId: OBSERVATION_ID,
      expectedRevision: 2,
    });
  });

  it("keeps lossless mappings and Navigator projections behind typed project commands", async () => {
    await previewMitreMappingImport(PROJECT_ID);
    await commitMitreMappingImport(PROJECT_ID, OBSERVATION_ID, true);
    await exportMitreMapping(PROJECT_ID, "operation-mapping");
    await previewNavigatorImport(PROJECT_ID);
    await commitNavigatorImport(PROJECT_ID, OBSERVATION_ID, {
      assessment: "suspected",
      outcome: "unknown",
      confidence: "low",
      defaultNarrative: "Imported from a reviewed Navigator layer.",
      includeDisabled: false,
    });
    await exportNavigatorProjection(
      PROJECT_ID,
      "attack_enterprise",
      "Operation Northwind",
      "operation-navigator",
    );

    expect(invoke).toHaveBeenNthCalledWith(1, "preview_mitre_mapping_import", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "commit_mitre_mapping_import", {
      projectId: PROJECT_ID,
      previewId: OBSERVATION_ID,
      replaceExisting: true,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "export_mitre_mapping", {
      projectId: PROJECT_ID,
      fileName: "operation-mapping",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "preview_navigator_import", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "commit_navigator_import", {
      projectId: PROJECT_ID,
      previewId: OBSERVATION_ID,
      assessment: "suspected",
      outcome: "unknown",
      confidence: "low",
      defaultNarrative: "Imported from a reviewed Navigator layer.",
      includeDisabled: false,
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "export_navigator_projection", {
      projectId: PROJECT_ID,
      catalog: "attack_enterprise",
      layerName: "Operation Northwind",
      fileName: "operation-navigator",
    });
  });
});
