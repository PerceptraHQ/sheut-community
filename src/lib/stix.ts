/** STIX interchange facade; local drafts become STIX only through explicit export. */
import { invoke } from "@tauri-apps/api/core";

export type DuplicateDecision =
  | "keep_existing"
  | "replace_version"
  | "merge_supported_fields"
  | "cancel";

export const stixObjectTypes = [
  "attack-pattern",
  "campaign",
  "course-of-action",
  "grouping",
  "identity",
  "incident",
  "indicator",
  "infrastructure",
  "intrusion-set",
  "location",
  "malware",
  "malware-analysis",
  "note",
  "observed-data",
  "opinion",
  "report",
  "threat-actor",
  "tool",
  "vulnerability",
  "artifact",
  "autonomous-system",
  "directory",
  "domain-name",
  "email-addr",
  "email-message",
  "file",
  "ipv4-addr",
  "ipv6-addr",
  "mac-addr",
  "mutex",
  "network-traffic",
  "process",
  "software",
  "url",
  "user-account",
  "windows-registry-key",
  "x509-certificate",
  "relationship",
  "sighting",
  "marking-definition",
  "language-content",
  "extension-definition",
] as const;

export type StixObjectType = (typeof stixObjectTypes)[number];

export interface StixObjectSummary {
  localId: string;
  stixId: string;
  objectType: string;
  displayName: string;
  modified: string | null;
  relationship?: StixCommittedRelationshipSummary;
}

export interface StixCommittedRelationshipSummary {
  relationshipType: string;
  sourceRef: string;
  targetRef: string;
  sourceId?: string;
  targetId?: string;
}

export interface StixDraftSummary {
  localId: string;
  objectType: string;
  properties: Record<string, unknown>;
  sourceId?: string;
  targetId?: string;
  relationshipType?: string;
  replacesStixId?: string;
}

export interface StixRelationshipEndpoint {
  localId: string;
  objectType: string;
  displayName: string;
}

export interface DuplicateStixObject {
  stixId: string;
  objectType: string;
  modified: string | null;
}

export interface StixImportPreview {
  previewId: string;
  objectCount: number;
  duplicates: DuplicateStixObject[];
}

export interface StixImportOutcome {
  imported: number;
  skipped: number;
}

export interface StixExportPreview {
  previewId: string;
  objectCount: number;
}

export interface StixExportOutcome {
  saved: boolean;
}

const errorMessages: Readonly<Record<string, string>> = {
  duplicate_decision_required: "Choose how to handle every duplicate before importing.",
  export_failed: "Sheut could not save that STIX bundle. Check the destination and try again.",
  import_cancelled: "The STIX import was cancelled without changing the project.",
  invalid_stix: "Choose a valid STIX 2.1 Bundle JSON file.",
  project_locked: "Unlock the project before working with intelligence.",
  stix_draft_in_use: "Remove relationships that reference this draft before deleting it.",
  stix_object_in_use:
    "Remove STIX relationships, references, or revision drafts that use this object first.",
  stix_limit_exceeded: "That bundle exceeds Sheut's safe import limits.",
  stix_validation_failed:
    "That bundle is not valid STIX 2.1. Review its required fields and patterns.",
  unsupported_stix_version: "Sheut Community imports STIX 2.1 only. STIX 2.0 was not imported.",
};

export function listStixObjects(projectId: string): Promise<StixObjectSummary[]> {
  return invoke<StixObjectSummary[]>("list_stix_objects", { projectId });
}

export function listStixDrafts(projectId: string): Promise<StixDraftSummary[]> {
  return invoke<StixDraftSummary[]>("list_stix_drafts", { projectId });
}

export function createStixDraft(
  projectId: string,
  objectType: string,
  properties: Record<string, unknown>,
): Promise<StixDraftSummary> {
  return invoke<StixDraftSummary>("create_stix_draft", { projectId, objectType, properties });
}

export function createStixRevisionDraft(
  projectId: string,
  objectId: string,
): Promise<StixDraftSummary> {
  return invoke<StixDraftSummary>("create_stix_revision_draft", { projectId, objectId });
}

export function updateStixDraft(
  projectId: string,
  draftId: string,
  objectType: string,
  properties: Record<string, unknown>,
): Promise<StixDraftSummary> {
  return invoke<StixDraftSummary>("update_stix_draft", {
    projectId,
    draftId,
    objectType,
    properties,
  });
}

export function createStixRelationshipDraft(
  projectId: string,
  sourceId: string,
  targetId: string,
  relationshipType: string,
  properties: Record<string, unknown>,
): Promise<StixDraftSummary> {
  return invoke<StixDraftSummary>("create_stix_relationship_draft", {
    projectId,
    sourceId,
    targetId,
    relationshipType,
    properties,
  });
}

export function updateStixRelationshipDraft(
  projectId: string,
  draftId: string,
  sourceId: string,
  targetId: string,
  relationshipType: string,
  properties: Record<string, unknown>,
): Promise<StixDraftSummary> {
  return invoke<StixDraftSummary>("update_stix_relationship_draft", {
    projectId,
    draftId,
    sourceId,
    targetId,
    relationshipType,
    properties,
  });
}

export function deleteStixDraft(projectId: string, draftId: string): Promise<void> {
  return invoke<void>("delete_stix_draft", { projectId, draftId });
}

export function deleteStixObject(projectId: string, objectId: string): Promise<void> {
  return invoke<void>("delete_stix_object", { projectId, objectId });
}

export function previewStixImport(projectId: string): Promise<StixImportPreview | null> {
  return invoke<StixImportPreview | null>("preview_stix_import", { projectId });
}

export function commitStixImport(
  projectId: string,
  previewId: string,
  decisions: DuplicateDecision[],
): Promise<StixImportOutcome> {
  return invoke<StixImportOutcome>("commit_stix_import", {
    projectId,
    previewId,
    decisions,
  });
}

export function discardStixImportPreview(projectId: string, previewId: string): Promise<void> {
  return invoke<void>("discard_stix_import_preview", { projectId, previewId });
}

export function previewStixExport(projectId: string): Promise<StixExportPreview> {
  return invoke<StixExportPreview>("preview_stix_export", { projectId });
}

export function commitStixExport(
  projectId: string,
  previewId: string,
  fileName: string,
): Promise<StixExportOutcome> {
  return invoke<StixExportOutcome>("commit_stix_export", {
    projectId,
    previewId,
    fileName,
  });
}

export function discardStixExportPreview(projectId: string, previewId: string): Promise<void> {
  return invoke<void>("discard_stix_export_preview", { projectId, previewId });
}

export function stixErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = Reflect.get(error, "code");
    if (typeof code === "string" && code in errorMessages) return errorMessages[code];
  }
  return "Sheut could not complete that STIX operation. Try again.";
}
