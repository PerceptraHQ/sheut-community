import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitStixExport,
  commitStixImport,
  createStixDraft,
  createStixRelationshipDraft,
  createStixRevisionDraft,
  deleteStixDraft,
  deleteStixObject,
  discardStixExportPreview,
  discardStixImportPreview,
  listStixDrafts,
  listStixObjects,
  previewStixExport,
  previewStixImport,
  stixErrorMessage,
  updateStixDraft,
  updateStixRelationshipDraft,
} from "./stix";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const PROJECT_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const PREVIEW_ID = "e7c44850-9f67-4d26-b7e3-0d4ee82339ef";

describe("STIX command boundary", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("passes only opaque IDs, decisions, and a bounded basename over IPC", async () => {
    vi.mocked(invoke).mockResolvedValue({});

    await listStixObjects(PROJECT_ID);
    await listStixDrafts(PROJECT_ID);
    await createStixDraft(PROJECT_ID, "indicator", { pattern_type: "stix" });
    await createStixRevisionDraft(PROJECT_ID, PREVIEW_ID);
    await updateStixDraft(PROJECT_ID, PREVIEW_ID, "indicator", { pattern_type: "stix" });
    await createStixRelationshipDraft(PROJECT_ID, PROJECT_ID, PREVIEW_ID, "related-to", {
      description: "Analyst link",
    });
    await updateStixRelationshipDraft(
      PROJECT_ID,
      PREVIEW_ID,
      PROJECT_ID,
      PREVIEW_ID,
      "related-to",
      { description: "Updated analyst link" },
    );
    await deleteStixDraft(PROJECT_ID, PREVIEW_ID);
    await previewStixImport(PROJECT_ID);
    await commitStixImport(PROJECT_ID, PREVIEW_ID, ["merge_supported_fields"]);
    await discardStixImportPreview(PROJECT_ID, PREVIEW_ID);
    await previewStixExport(PROJECT_ID);
    await commitStixExport(PROJECT_ID, PREVIEW_ID, "incident-bundle");
    await discardStixExportPreview(PROJECT_ID, PREVIEW_ID);

    expect(invoke).toHaveBeenNthCalledWith(1, "list_stix_objects", { projectId: PROJECT_ID });
    expect(invoke).toHaveBeenNthCalledWith(2, "list_stix_drafts", { projectId: PROJECT_ID });
    expect(invoke).toHaveBeenNthCalledWith(3, "create_stix_draft", {
      projectId: PROJECT_ID,
      objectType: "indicator",
      properties: { pattern_type: "stix" },
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "create_stix_revision_draft", {
      projectId: PROJECT_ID,
      objectId: PREVIEW_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "update_stix_draft", {
      projectId: PROJECT_ID,
      draftId: PREVIEW_ID,
      objectType: "indicator",
      properties: { pattern_type: "stix" },
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "create_stix_relationship_draft", {
      projectId: PROJECT_ID,
      sourceId: PROJECT_ID,
      targetId: PREVIEW_ID,
      relationshipType: "related-to",
      properties: { description: "Analyst link" },
    });
    expect(invoke).toHaveBeenNthCalledWith(7, "update_stix_relationship_draft", {
      projectId: PROJECT_ID,
      draftId: PREVIEW_ID,
      sourceId: PROJECT_ID,
      targetId: PREVIEW_ID,
      relationshipType: "related-to",
      properties: { description: "Updated analyst link" },
    });
    expect(invoke).toHaveBeenNthCalledWith(8, "delete_stix_draft", {
      projectId: PROJECT_ID,
      draftId: PREVIEW_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(9, "preview_stix_import", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(10, "commit_stix_import", {
      projectId: PROJECT_ID,
      previewId: PREVIEW_ID,
      decisions: ["merge_supported_fields"],
    });
    expect(invoke).toHaveBeenNthCalledWith(11, "discard_stix_import_preview", {
      projectId: PROJECT_ID,
      previewId: PREVIEW_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(12, "preview_stix_export", {
      projectId: PROJECT_ID,
    });
    expect(invoke).toHaveBeenNthCalledWith(13, "commit_stix_export", {
      projectId: PROJECT_ID,
      previewId: PREVIEW_ID,
      fileName: "incident-bundle",
    });
    expect(invoke).toHaveBeenNthCalledWith(14, "discard_stix_export_preview", {
      projectId: PROJECT_ID,
      previewId: PREVIEW_ID,
    });
  });

  it("maps validation failures without exposing native diagnostics", () => {
    expect(
      stixErrorMessage({
        code: "stix_validation_failed",
        path: "/private/case.json",
        detail: "sensitive intelligence",
      }),
    ).toBe("That bundle is not valid STIX 2.1. Review its required fields and patterns.");
    expect(stixErrorMessage({ code: "stix_draft_in_use" })).toBe(
      "Remove relationships that reference this draft before deleting it.",
    );
  });

  it("deletes a validated object through opaque project and object IDs", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await deleteStixObject(PROJECT_ID, PREVIEW_ID);

    expect(invoke).toHaveBeenCalledWith("delete_stix_object", {
      projectId: PROJECT_ID,
      objectId: PREVIEW_ID,
    });
  });
});
