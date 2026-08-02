import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareDocumentRevisions,
  createDocument,
  deleteDocument,
  documentErrorMessage,
  exportSavedDocument,
  listDocumentActivity,
  listDocumentRevisions,
  listDocuments,
  listPublicationRecords,
  loadDocumentImage,
  pickDocumentImage,
  renderSavedDocument,
  reproducePublication,
  restoreDocument,
  restoreDocumentRevision,
  saveDocument,
} from "./documents";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const PROJECT_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const DOCUMENT_ID = "e7c44850-9f67-4d26-b7e3-0d4ee82339ef";

describe("document command boundary", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("uses narrow opaque identifiers and structured JSON", async () => {
    const root = { type: "doc" as const, content: [] };
    vi.mocked(invoke).mockResolvedValue({});

    await listDocuments(PROJECT_ID);
    await createDocument(PROJECT_ID, "investigation");
    await deleteDocument(PROJECT_ID, DOCUMENT_ID);
    await restoreDocument(PROJECT_ID, DOCUMENT_ID);
    await listDocumentRevisions(PROJECT_ID, DOCUMENT_ID);
    await listDocumentActivity(PROJECT_ID, DOCUMENT_ID);
    await compareDocumentRevisions(PROJECT_ID, DOCUMENT_ID, 1, 2);
    await restoreDocumentRevision(PROJECT_ID, DOCUMENT_ID, 1, 2);
    await saveDocument(PROJECT_ID, DOCUMENT_ID, 4, root);
    await renderSavedDocument(PROJECT_ID, DOCUMENT_ID);
    await exportSavedDocument(PROJECT_ID, DOCUMENT_ID, {
      format: "pdf",
      paperSize: "letter",
      orientation: "landscape",
      tlpMarking: "amber_strict",
      brandProfileId: "110b83fb-9fdb-4133-a29b-e75725bb6d0c",
      brandProfileRevision: 3,
      releaseVersion: "2.0",
      publicationStatus: "final",
      includeReleaseHistory: false,
      changeNote: "Major reassessment.",
      pageFurniture: { header: true, footer: true, marking: true, page_numbers: true },
      includedSections: ["executive_summary"],
      appendices: ["evidence_images"],
      fileName: "incident-summary",
    });
    await pickDocumentImage(PROJECT_ID, DOCUMENT_ID);
    await loadDocumentImage(PROJECT_ID, DOCUMENT_ID, "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb");

    expect(invoke).toHaveBeenNthCalledWith(1, "list_documents", { projectId: PROJECT_ID });
    expect(invoke).toHaveBeenNthCalledWith(2, "create_document", {
      projectId: PROJECT_ID,
      kind: "investigation",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "delete_document", {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "restore_document", {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "list_document_revisions", {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "list_document_activity", {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(7, "compare_document_revisions", {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      fromRevision: 1,
      toRevision: 2,
    });
    expect(invoke).toHaveBeenNthCalledWith(8, "restore_document_revision", {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      sourceRevision: 1,
      expectedRevision: 2,
    });
    expect(invoke).toHaveBeenNthCalledWith(9, "save_document", {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      expectedRevision: 4,
      root,
    });
    expect(invoke).toHaveBeenNthCalledWith(10, "render_saved_document", {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(11, "export_saved_document", {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      options: {
        format: "pdf",
        paperSize: "letter",
        orientation: "landscape",
        tlpMarking: "amber_strict",
        brandProfileId: "110b83fb-9fdb-4133-a29b-e75725bb6d0c",
        brandProfileRevision: 3,
        releaseVersion: "2.0",
        publicationStatus: "final",
        includeReleaseHistory: false,
        changeNote: "Major reassessment.",
        pageFurniture: { header: true, footer: true, marking: true, page_numbers: true },
        includedSections: ["executive_summary"],
        appendices: ["evidence_images"],
        fileName: "incident-summary",
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(12, "pick_document_image", {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(13, "load_document_image", {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      attachmentId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
    });
  });

  it("turns revision conflicts into actionable redacted copy", () => {
    expect(
      documentErrorMessage({
        code: "revision_conflict",
        sql: "UPDATE documents",
        path: "/private/case/project.sheut",
      }),
    ).toBe("This document changed elsewhere. Reload it before editing again.");
  });

  it("lists and reproduces immutable publication records through narrow commands", async () => {
    await listPublicationRecords(PROJECT_ID);
    await reproducePublication(PROJECT_ID, DOCUMENT_ID);

    expect(invoke).toHaveBeenNthCalledWith(1, "list_publication_records", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "reproduce_publication", {
      projectId: PROJECT_ID,
      publicationId: DOCUMENT_ID,
    });
  });
});
