import { invoke } from "@tauri-apps/api/core";

export interface EvidenceFileMetadata {
  id: string;
  revision: number;
  mediaType: string;
  fileName: string;
  byteLen: number;
  sha256: string;
  title: string;
  description: string;
  source: string;
  capturedAt: string | null;
  sourceUrl: string;
  tags: string[];
  analystNotes: string;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
}

export interface EvidenceMetadataInput {
  title: string;
  description: string;
  source: string;
  capturedAt: string | null;
  sourceUrl: string;
  tags: string[];
  analystNotes: string;
}

export function importEvidenceImage(projectId: string): Promise<EvidenceFileMetadata | null> {
  return invoke<EvidenceFileMetadata | null>("import_evidence_image", { projectId });
}

export function importEvidenceFile(projectId: string): Promise<EvidenceFileMetadata | null> {
  return invoke<EvidenceFileMetadata | null>("import_evidence_file", { projectId });
}

export function listEvidenceFiles(projectId: string): Promise<EvidenceFileMetadata[]> {
  return invoke<EvidenceFileMetadata[]>("list_evidence_files", { projectId });
}

export function loadEvidenceImage(projectId: string, evidenceId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("load_evidence_image", { projectId, evidenceId });
}

export function updateEvidenceMetadata(
  projectId: string,
  evidenceId: string,
  expectedRevision: number,
  input: EvidenceMetadataInput,
): Promise<EvidenceFileMetadata> {
  return invoke<EvidenceFileMetadata>("update_evidence_metadata", {
    projectId,
    evidenceId,
    expectedRevision,
    input,
  });
}

export function deleteEvidenceFile(
  projectId: string,
  evidenceId: string,
  expectedRevision: number,
): Promise<void> {
  return invoke<void>("delete_evidence_file", { projectId, evidenceId, expectedRevision });
}

export function evidenceErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && typeof Reflect.get(error, "code") === "string"
      ? (Reflect.get(error, "code") as string)
      : "";
  if (code === "revision_conflict")
    return "This evidence metadata changed elsewhere. Reload it and retry.";
  if (code === "attachment_not_found") return "That Evidence file is no longer available.";
  if (code === "project_locked") return "Unlock the project before opening its Evidence library.";
  if (code === "invalid_attachment")
    return "Check the title, date, source URL, tags, and notes, then try again.";
  return "The Evidence operation could not be completed. Try again.";
}
