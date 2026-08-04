/** Structured-document and publication contracts; native paths remain Rust-owned. */
import { invoke } from "@tauri-apps/api/core";

export type DocumentKind = "investigation" | "analyst_note" | "report";
export type NewDocumentKind = DocumentKind;

export function documentKindLabel(kind: DocumentKind): string {
  switch (kind) {
    case "investigation":
      return "Investigation";
    case "analyst_note":
      return "Analyst Note";
    case "report":
      return "Report";
  }
}

export interface ReportAuthor {
  name: string;
  role?: string | null;
}

export interface ReportProperties {
  reportId: string;
  title: string;
  authors: ReportAuthor[];
  producingOrganisation?: string | null;
  issueDate: string;
}

export interface DocumentJsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocumentJsonNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export interface DocumentRoot extends DocumentJsonNode {
  type: "doc";
}

export interface DocumentEnvelope {
  schema_version: 1;
  id: string;
  kind: DocumentKind;
  revision: number;
  root: DocumentRoot;
  reportProperties?: ReportProperties;
}

export type DocumentExportFormat = "pdf";
export type PublicationPaperSize = "a4" | "letter";
export type PublicationOrientation = "portrait" | "landscape";
export type PublicationStatus = "draft" | "final";

export interface PublicationPageFurniture {
  header: boolean;
  footer: boolean;
  marking: boolean;
  page_numbers: boolean;
}

export interface PublicationSelectionOption {
  key: string;
  label: string;
}

export interface DocumentPublicationOptions {
  format: DocumentExportFormat;
  paperSize: PublicationPaperSize;
  orientation: PublicationOrientation;
  tlpMarking: import("./projects").TlpMarking;
  brandProfileId: string | null;
  brandProfileRevision: number | null;
  releaseVersion: string;
  publicationStatus: PublicationStatus;
  includeReleaseHistory: boolean;
  changeNote: string | null;
  pageFurniture: PublicationPageFurniture;
  includedSections: string[];
  appendices: string[];
  fileName: string;
}

export interface DocumentExportOutcome {
  saved: boolean;
}

export type PublicationSource = {
  type: "freeform_document";
  document_id: string;
  revision: number;
};

export interface PublicationReleaseEntry {
  version: string;
  change_note: string;
  published_at_unix_ms: number;
}

export interface PublicationSnapshot {
  schema_version: 1;
  id: string;
  source: PublicationSource;
  format: DocumentExportFormat;
  paper_size: PublicationPaperSize;
  orientation: PublicationOrientation;
  brand_profile_revision: { profile_id: string; revision: number } | null;
  page_furniture: PublicationPageFurniture;
  tlp_marking: import("./projects").TlpMarking | null;
  included_sections: string[];
  appendices: string[];
  output_file_name: string;
  output_location: string | null;
  release_version: string;
  publication_status: PublicationStatus;
  include_release_history: boolean;
  release_history: PublicationReleaseEntry[];
  created_at_unix_ms: number;
}

export interface PublicationRecord {
  schema_version: 1;
  id: string;
  snapshot: PublicationSnapshot;
  byte_len: number;
  sha256: string;
}

export type DocumentActivityKind =
  | "created"
  | "edited"
  | "deleted"
  | "restored"
  | "restored_revision";

export interface DocumentRevisionSummary {
  revision: number;
  savedAtUnixMs: number;
}

export interface DocumentActivityEntry {
  sequence: number;
  kind: DocumentActivityKind;
  revision: number;
  sourceRevision: number | null;
  occurredAtUnixMs: number;
}

export type DocumentTextDiffKind = "added" | "removed" | "unchanged";

export interface DocumentTextDiffSegment {
  kind: DocumentTextDiffKind;
  text: string;
}

export interface DocumentRevisionDiff {
  fromRevision: number;
  toRevision: number;
  segments: DocumentTextDiffSegment[];
  simplified: boolean;
}

export interface ImageAttachmentMetadata {
  id: string;
  documentId: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
  byteLen: number;
}

const errorMessages: Readonly<Record<string, string>> = {
  attachment_not_found: "That image attachment is no longer available.",
  document_not_found: "That document is no longer available.",
  document_revision_not_found: "That saved revision is no longer available.",
  export_failed: "The document could not be exported. Choose another location and try again.",
  invalid_document: "This document contains unsupported or malformed content.",
  invalid_attachment: "Choose a PNG, JPEG, or WebP image no larger than 10 MiB.",
  project_locked: "Unlock the project before opening its documents.",
  revision_conflict: "This document changed elsewhere. Reload it before editing again.",
  storage_unavailable: "The encrypted project store is unavailable. Try again.",
};

export function listDocuments(projectId: string): Promise<DocumentEnvelope[]> {
  return invoke<DocumentEnvelope[]>("list_documents", { projectId });
}

export function createDocument(
  projectId: string,
  kind: NewDocumentKind,
): Promise<DocumentEnvelope> {
  return invoke<DocumentEnvelope>("create_document", { projectId, kind });
}

export function loadDocument(projectId: string, documentId: string): Promise<DocumentEnvelope> {
  return invoke<DocumentEnvelope>("load_document", { projectId, documentId });
}

export function deleteDocument(projectId: string, documentId: string): Promise<void> {
  return invoke<void>("delete_document", { projectId, documentId });
}

export function restoreDocument(projectId: string, documentId: string): Promise<DocumentEnvelope> {
  return invoke<DocumentEnvelope>("restore_document", { projectId, documentId });
}

export function listDocumentRevisions(
  projectId: string,
  documentId: string,
): Promise<DocumentRevisionSummary[]> {
  return invoke<DocumentRevisionSummary[]>("list_document_revisions", {
    projectId,
    documentId,
  });
}

export function listDocumentActivity(
  projectId: string,
  documentId: string,
): Promise<DocumentActivityEntry[]> {
  return invoke<DocumentActivityEntry[]>("list_document_activity", { projectId, documentId });
}

export function compareDocumentRevisions(
  projectId: string,
  documentId: string,
  fromRevision: number,
  toRevision: number,
): Promise<DocumentRevisionDiff> {
  return invoke<DocumentRevisionDiff>("compare_document_revisions", {
    projectId,
    documentId,
    fromRevision,
    toRevision,
  });
}

export function restoreDocumentRevision(
  projectId: string,
  documentId: string,
  sourceRevision: number,
  expectedRevision: number,
): Promise<DocumentEnvelope> {
  return invoke<DocumentEnvelope>("restore_document_revision", {
    projectId,
    documentId,
    sourceRevision,
    expectedRevision,
  });
}

export function saveDocument(
  projectId: string,
  documentId: string,
  expectedRevision: number,
  root: DocumentRoot,
  reportProperties?: ReportProperties,
): Promise<DocumentEnvelope> {
  return invoke<DocumentEnvelope>("save_document", {
    projectId,
    documentId,
    expectedRevision,
    root,
    reportProperties,
  });
}

export function exportSavedDocument(
  projectId: string,
  documentId: string,
  options: DocumentPublicationOptions,
): Promise<DocumentExportOutcome> {
  return invoke<DocumentExportOutcome>("export_saved_document", {
    projectId,
    documentId,
    options,
  });
}

export function listPublicationRecords(projectId: string): Promise<PublicationRecord[]> {
  return invoke<PublicationRecord[]>("list_publication_records", { projectId });
}

export function reproducePublication(
  projectId: string,
  publicationId: string,
): Promise<DocumentExportOutcome> {
  return invoke<DocumentExportOutcome>("reproduce_publication", { projectId, publicationId });
}

export function publicationSelectionsFromRoots(roots: readonly DocumentRoot[]): {
  sections: PublicationSelectionOption[];
  appendices: PublicationSelectionOption[];
} {
  const sections = new Map<string, PublicationSelectionOption>();
  const appendices = new Map<string, PublicationSelectionOption>();
  for (const root of roots) {
    let titleConsumed = false;
    for (const node of root.content ?? []) {
      if (node.type !== "heading") continue;
      const title = documentNodeText(node).trim();
      const level = Number(node.attrs?.level ?? 2);
      if (level === 1 && !titleConsumed && title) {
        titleConsumed = true;
        continue;
      }
      const key = publicationSectionKey(title);
      if (key && !sections.has(key)) sections.set(key, { key, label: title });
    }
    visitDocumentNodes(root, (node) => {
      if (node.type !== "evidenceImage" || node.attrs?.placement !== "appendix") return;
      const key = typeof node.attrs.appendixKey === "string" ? node.attrs.appendixKey.trim() : "";
      const label =
        typeof node.attrs.appendixTitle === "string" ? node.attrs.appendixTitle.trim() : "";
      if (key && label && !appendices.has(key)) appendices.set(key, { key, label });
    });
  }
  if (sections.size === 0) sections.set("document", { key: "document", label: "Document content" });
  return { sections: [...sections.values()], appendices: [...appendices.values()] };
}

function visitDocumentNodes(node: DocumentJsonNode, visit: (node: DocumentJsonNode) => void): void {
  visit(node);
  for (const child of node.content ?? []) visitDocumentNodes(child, visit);
}

function documentNodeText(node: DocumentJsonNode): string {
  return `${node.text ?? ""}${(node.content ?? []).map(documentNodeText).join("")}`;
}

function publicationSectionKey(value: string): string {
  return value
    .split("")
    .reduce((key, character) => {
      if (/^[A-Za-z0-9]$/.test(character)) return `${key}${character.toLocaleLowerCase("en")}`;
      return key && !key.endsWith("_") ? `${key}_` : key;
    }, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function pickDocumentImage(
  projectId: string,
  documentId: string,
): Promise<ImageAttachmentMetadata | null> {
  return invoke<ImageAttachmentMetadata | null>("pick_document_image", {
    projectId,
    documentId,
  });
}

export function loadDocumentImage(
  projectId: string,
  documentId: string,
  attachmentId: string,
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("load_document_image", {
    projectId,
    documentId,
    attachmentId,
  });
}

export function documentTitle(document: DocumentEnvelope): string {
  if (document.kind === "report") return document.reportProperties?.title ?? "Untitled report";
  const title = firstText(document.root)?.trim();
  if (!title) {
    if (document.kind === "analyst_note") return "Untitled analyst note";
    return "Untitled investigation";
  }
  const characters = Array.from(title);
  return characters.length > 80 ? `${characters.slice(0, 79).join("")}…` : title;
}

function firstText(node: DocumentJsonNode): string | null {
  if (typeof node.text === "string" && node.text.trim()) return node.text;
  for (const child of node.content ?? []) {
    const text = firstText(child);
    if (text) return text;
  }
  return null;
}

export function documentErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = Reflect.get(error, "code");
    if (typeof code === "string" && code in errorMessages) return errorMessages[code];
  }
  return "Sheut could not complete that document operation. Try again.";
}
