/** Offline MITRE catalog and encrypted observation facade for the webview. */
import { invoke } from "@tauri-apps/api/core";

export type MitreCatalog = "attack_enterprise" | "attack_mobile" | "attack_ics" | "atlas";
export type TechniqueAssessment = "observed" | "suspected" | "ruled_out";
export type TechniqueOutcome = "unknown" | "attempted" | "successful" | "prevented";
export type AnalyticConfidence = "low" | "medium" | "high";

export interface MitreCatalogSource {
  url: string;
  sha256: string;
}

export interface MitreTactic {
  id: string;
  name: string;
  shortName: string;
  description: string;
}

export interface MitreTechnique {
  id: string;
  name: string;
  description: string;
  tacticIds: string[];
  platforms: string[];
  parentId: string | null;
}

export interface MitreCatalogSnapshot {
  schemaVersion: 2;
  catalog: MitreCatalog;
  version: string;
  source: MitreCatalogSource;
  tactics: MitreTactic[];
  techniques: MitreTechnique[];
}

export type MitreCatalogOrigin = "bundled" | "local_file";
export type MitreCatalogVersionRelation = "upgrade" | "same" | "downgrade";

export interface MitreCatalogStatus {
  catalog: MitreCatalog;
  version: string;
  origin: MitreCatalogOrigin;
}

export interface MitreCatalogUpdatePreview {
  previewId: string;
  catalog: MitreCatalog;
  currentVersion: string;
  candidateVersion: string;
  relation: MitreCatalogVersionRelation;
  sourceUrl: string;
  sha256: string;
  tacticCount: number;
  techniqueCount: number;
}

export interface MitreTechniqueReference {
  catalog: MitreCatalog;
  version: string;
  techniqueId: string;
  tacticId: string | null;
}

export interface TechniqueObservationValues {
  assessment: TechniqueAssessment;
  outcome: TechniqueOutcome;
  confidence: AnalyticConfidence;
  narrative: string;
  firstSeenUnixMs: number | null;
  lastSeenUnixMs: number | null;
}

export interface TechniqueObservation extends TechniqueObservationValues {
  id: string;
  reference: MitreTechniqueReference;
  revision: number;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
}

export interface MitreTechniqueSelection {
  catalog: MitreCatalog;
  version: string;
  tacticId: string | null;
  technique: MitreTechnique;
  createMapping?: boolean;
  requestKey?: number;
}

export interface MitreMappingImportPreview {
  previewId: string;
  observationCount: number;
  duplicateCount: number;
}

export interface NavigatorImportPreview {
  previewId: string;
  name: string;
  catalog: MitreCatalog;
  catalogVersion: string;
  entryCount: number;
  commentCount: number;
  disabledCount: number;
  scoredCount: number;
}

export interface ObservationImportOutcome {
  imported: number;
  skipped: number;
}

export interface MitreExportOutcome {
  saved: boolean;
}

const errorMessages: Readonly<Record<string, string>> = {
  invalid_mitre_catalog: "That file is not a supported official MITRE STIX 2.1 catalog.",
  invalid_mitre_reference: "That MITRE mapping contains invalid or unsupported values.",
  invalid_mitre_mapping: "That file is not a supported Sheut mapping or Navigator layer.",
  mitre_catalog_downgrade:
    "This file is older than the active catalog. Confirm the downgrade before installing it.",
  mitre_catalog_limit_exceeded: "That catalog exceeds Sheut’s safe file or object limits.",
  mitre_mapping_limit_exceeded:
    "That project mapping or Navigator layer exceeds the 16 MiB safety limit. Catalog STIX files use a separate 96 MiB limit.",
  mitre_reference_unavailable: "That technique is not available in the bundled catalog version.",
  project_locked: "Unlock the project before working with MITRE mappings.",
  revision_conflict: "That observation changed elsewhere. Reload it before editing again.",
  storage_unavailable: "The encrypted project store is unavailable. Try again.",
  technique_observation_not_found: "That project mapping is no longer available.",
};

export function getMitreCatalog(catalog: MitreCatalog): Promise<MitreCatalogSnapshot> {
  return invoke<MitreCatalogSnapshot>("get_mitre_catalog", { catalog });
}

export function listMitreCatalogStatuses(): Promise<MitreCatalogStatus[]> {
  return invoke<MitreCatalogStatus[]>("list_mitre_catalog_statuses");
}

export function previewMitreCatalogUpdate(): Promise<MitreCatalogUpdatePreview | null> {
  return invoke<MitreCatalogUpdatePreview | null>("preview_mitre_catalog_update");
}

export function commitMitreCatalogUpdate(
  previewId: string,
  allowDowngrade: boolean,
): Promise<MitreCatalogSnapshot> {
  return invoke<MitreCatalogSnapshot>("commit_mitre_catalog_update", {
    previewId,
    allowDowngrade,
  });
}

export function resetMitreCatalog(catalog: MitreCatalog): Promise<MitreCatalogSnapshot> {
  return invoke<MitreCatalogSnapshot>("reset_mitre_catalog", { catalog });
}

export function listTechniqueObservations(projectId: string): Promise<TechniqueObservation[]> {
  return invoke<TechniqueObservation[]>("list_technique_observations", { projectId });
}

export function createTechniqueObservation(
  projectId: string,
  reference: MitreTechniqueReference,
  values: TechniqueObservationValues,
): Promise<TechniqueObservation> {
  return invoke<TechniqueObservation>("create_technique_observation", {
    projectId,
    reference,
    ...values,
  });
}

export function updateTechniqueObservation(
  projectId: string,
  observationId: string,
  expectedRevision: number,
  values: TechniqueObservationValues,
): Promise<TechniqueObservation> {
  return invoke<TechniqueObservation>("update_technique_observation", {
    projectId,
    observationId,
    expectedRevision,
    ...values,
  });
}

export function deleteTechniqueObservation(
  projectId: string,
  observationId: string,
  expectedRevision: number,
): Promise<void> {
  return invoke<void>("delete_technique_observation", {
    projectId,
    observationId,
    expectedRevision,
  });
}

export function previewMitreMappingImport(
  projectId: string,
): Promise<MitreMappingImportPreview | null> {
  return invoke<MitreMappingImportPreview | null>("preview_mitre_mapping_import", { projectId });
}

export function commitMitreMappingImport(
  projectId: string,
  previewId: string,
  replaceExisting: boolean,
): Promise<ObservationImportOutcome> {
  return invoke<ObservationImportOutcome>("commit_mitre_mapping_import", {
    projectId,
    previewId,
    replaceExisting,
  });
}

export function exportMitreMapping(
  projectId: string,
  fileName: string,
): Promise<MitreExportOutcome> {
  return invoke<MitreExportOutcome>("export_mitre_mapping", { projectId, fileName });
}

export function previewNavigatorImport(projectId: string): Promise<NavigatorImportPreview | null> {
  return invoke<NavigatorImportPreview | null>("preview_navigator_import", { projectId });
}

export function commitNavigatorImport(
  projectId: string,
  previewId: string,
  values: Pick<TechniqueObservationValues, "assessment" | "outcome" | "confidence"> & {
    defaultNarrative: string;
    includeDisabled: boolean;
  },
): Promise<ObservationImportOutcome> {
  return invoke<ObservationImportOutcome>("commit_navigator_import", {
    projectId,
    previewId,
    ...values,
  });
}

export function exportNavigatorProjection(
  projectId: string,
  catalog: MitreCatalog,
  layerName: string,
  fileName: string,
): Promise<MitreExportOutcome> {
  return invoke<MitreExportOutcome>("export_navigator_projection", {
    projectId,
    catalog,
    layerName,
    fileName,
  });
}

export function mitreErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    return errorMessages[code] ?? "The MITRE mapping action could not be completed.";
  }
  return "The MITRE mapping action could not be completed.";
}
