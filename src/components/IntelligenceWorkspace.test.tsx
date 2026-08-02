import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  updateStixDraft,
  updateStixRelationshipDraft,
} from "../lib/stix";
import { IntelligenceWorkspace } from "./IntelligenceWorkspace";
import { VaultNoticeProvider } from "./VaultNotices";

vi.mock("../lib/stix", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/stix")>()),
  commitStixExport: vi.fn(),
  commitStixImport: vi.fn(),
  createStixDraft: vi.fn(),
  createStixRevisionDraft: vi.fn(),
  createStixRelationshipDraft: vi.fn(),
  deleteStixDraft: vi.fn(),
  deleteStixObject: vi.fn(),
  discardStixExportPreview: vi.fn(),
  discardStixImportPreview: vi.fn(),
  listStixObjects: vi.fn(),
  listStixDrafts: vi.fn(),
  previewStixExport: vi.fn(),
  previewStixImport: vi.fn(),
  updateStixDraft: vi.fn(),
  updateStixRelationshipDraft: vi.fn(),
  stixErrorMessage: () => "STIX operation failed",
}));

const PROJECT_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const PREVIEW_ID = "e7c44850-9f67-4d26-b7e3-0d4ee82339ef";

function renderWorkspace() {
  return render(
    <VaultNoticeProvider>
      <IntelligenceWorkspace projectId={PROJECT_ID} />
    </VaultNoticeProvider>,
  );
}

describe("IntelligenceWorkspace", () => {
  beforeEach(() => {
    vi.mocked(listStixObjects).mockReset().mockResolvedValue([]);
    vi.mocked(listStixDrafts).mockReset().mockResolvedValue([]);
    vi.mocked(createStixDraft).mockReset();
    vi.mocked(createStixRevisionDraft).mockReset();
    vi.mocked(createStixRelationshipDraft).mockReset();
    vi.mocked(updateStixDraft).mockReset();
    vi.mocked(updateStixRelationshipDraft).mockReset();
    vi.mocked(deleteStixDraft).mockReset().mockResolvedValue();
    vi.mocked(deleteStixObject).mockReset().mockResolvedValue();
    vi.mocked(previewStixImport).mockReset();
    vi.mocked(commitStixImport).mockReset();
    vi.mocked(discardStixImportPreview).mockReset().mockResolvedValue();
    vi.mocked(previewStixExport).mockReset();
    vi.mocked(commitStixExport).mockReset();
    vi.mocked(discardStixExportPreview).mockReset().mockResolvedValue();
  });

  it("uses a progress state while encrypted intelligence loads", () => {
    vi.mocked(listStixObjects).mockReturnValue(new Promise(() => undefined));
    vi.mocked(listStixDrafts).mockReturnValue(new Promise(() => undefined));

    renderWorkspace();

    expect(screen.getByRole("progressbar", { name: "Loading intelligence" })).toBeVisible();
  });

  it("creates a stable local draft through structured fields", async () => {
    vi.mocked(createStixDraft).mockResolvedValue({
      localId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
      objectType: "indicator",
      properties: {
        pattern: "[domain-name:value = 'evil.example']",
        pattern_type: "stix",
      },
    });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "New draft" }));
    const dialog = await screen.findByRole("dialog", { name: "New STIX draft" });
    expect(within(dialog).getByText(/Pattern language/u)).toHaveTextContent(
      "STIX, PCRE, Sigma, Snort, Suricata, or YARA",
    );
    const pattern = within(dialog).getByRole("textbox", { name: /^Pattern\*$/u });
    fireEvent.change(pattern, { target: { value: "[domain-name:value = 'evil.example']" } });
    await user.click(within(dialog).getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(createStixDraft).toHaveBeenCalledWith(
        PROJECT_ID,
        "indicator",
        expect.objectContaining({
          pattern: "[domain-name:value = 'evil.example']",
          pattern_type: "stix",
        }),
      ),
    );
  });

  it("shows required and optional fields without asking analysts to write JSON", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "New draft" }));
    const dialog = await screen.findByRole("dialog", { name: "New STIX draft" });
    await user.click(within(dialog).getByRole("combobox", { name: "Object type" }));
    await user.click(screen.getByRole("option", { name: "Attack Pattern" }));

    expect(within(dialog).getByRole("heading", { name: "Required properties" })).toBeVisible();
    expect(within(dialog).getByRole("heading", { name: "Optional properties" })).toBeVisible();
    expect(within(dialog).getByLabelText(/^Name/u)).toBeRequired();
    expect(within(dialog).getByLabelText("Description")).not.toBeRequired();
    expect(within(dialog).getByLabelText("Aliases")).toBeVisible();
    expect(within(dialog).getByText("Kill Chain Phases")).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "Add optional field" })).toBeNull();
    expect(within(dialog).queryByText(/enter valid json/i)).toBeNull();
    expect(within(dialog).queryByLabelText(/json value/i)).toBeNull();
  });

  it("lists typed objects without putting raw intelligence on the canvas", async () => {
    vi.mocked(listStixObjects).mockResolvedValue([
      {
        localId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        stixId: "domain-name--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        objectType: "domain-name",
        displayName: "evil.example",
        modified: null,
      },
    ]);

    renderWorkspace();

    expect(await screen.findByText("Domain Name")).toBeInTheDocument();
    expect(screen.getByText("evil.example")).toBeInTheDocument();
    expect(screen.getByText(/domain-name--e7c44850/)).toBeInTheDocument();
  });

  it("filters validated objects and drafts by display name or STIX type", async () => {
    vi.mocked(listStixObjects).mockResolvedValue([
      {
        localId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        stixId: "threat-actor--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        objectType: "threat-actor",
        displayName: "Midnight Lynx",
        modified: "2026-07-30T10:00:00.000Z",
      },
      {
        localId: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
        stixId: "malware--7a9619ff-8b86-d011-b42d-00cf4fc964ff",
        objectType: "malware",
        displayName: "Copper Loader",
        modified: "2026-07-30T10:00:00.000Z",
      },
    ]);
    vi.mocked(listStixDrafts).mockResolvedValue([
      {
        localId: "4f3d8e34-7c64-4d41-8b68-d7a334e1a884",
        objectType: "attack-pattern",
        properties: { name: "Credential access" },
      },
    ]);
    const user = userEvent.setup();
    renderWorkspace();

    const search = await screen.findByRole("searchbox", {
      name: "Search intelligence by name or type",
    });
    await user.type(search, "Midnight");
    expect(screen.getByText("Midnight Lynx")).toBeVisible();
    expect(screen.queryByText("Copper Loader")).toBeNull();
    expect(screen.queryByText("Credential access")).toBeNull();

    await user.clear(search);
    await user.type(search, "attack pattern");
    expect(screen.getByText("Credential access")).toBeVisible();
    expect(screen.queryByText("Midnight Lynx")).toBeNull();
  });

  it("creates a semantic relationship from stable local endpoint IDs", async () => {
    vi.mocked(listStixObjects).mockResolvedValue([
      {
        localId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        stixId: "domain-name--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        objectType: "domain-name",
        displayName: "example.test",
        modified: null,
      },
      {
        localId: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
        stixId: "ipv4-addr--7a9619ff-8b86-d011-b42d-00cf4fc964ff",
        objectType: "ipv4-addr",
        displayName: "198.51.100.4",
        modified: null,
      },
    ]);
    vi.mocked(createStixRelationshipDraft).mockResolvedValue({
      localId: PREVIEW_ID,
      objectType: "relationship",
      properties: {},
      sourceId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
      targetId: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
      relationshipType: "resolves-to",
    });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "New draft" }));
    const dialog = await screen.findByRole("dialog", { name: "New STIX draft" });
    await user.click(within(dialog).getByRole("combobox", { name: "Object type" }));
    await user.click(screen.getByRole("option", { name: "Relationship" }));
    await user.click(within(dialog).getByRole("combobox", { name: "Source object" }));
    await user.click(screen.getByRole("option", { name: /example\.test/u }));
    await user.click(within(dialog).getByRole("combobox", { name: "Target object" }));
    await user.click(screen.getByRole("option", { name: /198\.51\.100\.4/u }));
    const relationshipTypeInput = within(dialog).getByRole("combobox", {
      name: "Relationship type",
    });
    await user.clear(relationshipTypeInput);
    await user.type(relationshipTypeInput, "res");
    expect(screen.getByRole("option", { name: /Resolves To/u })).toHaveTextContent("STIX 2.1");
    await user.click(screen.getByRole("option", { name: /Resolves To/u }));
    expect(relationshipTypeInput).toHaveValue("resolves-to");
    await user.click(within(dialog).getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(createStixRelationshipDraft).toHaveBeenCalledOnce());
    const call = vi.mocked(createStixRelationshipDraft).mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Relationship draft call was not recorded");
    const [projectId, sourceId, targetId, relationshipType, properties] = call;
    expect([projectId, sourceId, targetId, relationshipType]).toEqual([
      PROJECT_ID,
      "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
      "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
      "resolves-to",
    ]);
    expect(typeof properties.created).toBe("string");
    expect(typeof properties.modified).toBe("string");
    expect(createStixDraft).not.toHaveBeenCalled();
  });

  it("opens object-scoped connections and keeps a newly created relationship draft visible", async () => {
    const apt1Id = "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb";
    const actorId = "6f9619ff-8b86-d011-b42d-00cf4fc964ff";
    vi.mocked(listStixObjects).mockResolvedValue([
      {
        localId: apt1Id,
        stixId: "intrusion-set--da1065ce-972c-4605-8755-9cd1074e3b5a",
        objectType: "intrusion-set",
        displayName: "APT1",
        modified: "2015-05-15T09:12:16.000Z",
      },
      {
        localId: actorId,
        stixId: "threat-actor--6d179234-61fc-40c4-ae86-3d53308d8e65",
        objectType: "threat-actor",
        displayName: "Ugly Gorilla",
        modified: "2015-05-15T09:12:16.000Z",
      },
    ]);
    const relationshipDraft = {
      localId: PREVIEW_ID,
      objectType: "relationship",
      properties: {},
      sourceId: apt1Id,
      targetId: actorId,
      relationshipType: "attributed-to",
    };
    vi.mocked(listStixDrafts).mockResolvedValueOnce([]).mockResolvedValueOnce([relationshipDraft]);
    vi.mocked(createStixRelationshipDraft).mockResolvedValue(relationshipDraft);
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Connections for APT1" }));
    const dialog = screen.getByRole("dialog", { name: "Connections for APT1" });
    await user.click(within(dialog).getByRole("combobox", { name: "Target object" }));
    await user.click(screen.getByRole("option", { name: /Ugly Gorilla/u }));
    await user.type(within(dialog).getByRole("combobox", { name: "Relationship type" }), "attr");
    await user.click(screen.getByRole("option", { name: /Attributed To/u }));
    await user.click(within(dialog).getByRole("button", { name: "Create relationship draft" }));

    await waitFor(() =>
      expect(createStixRelationshipDraft).toHaveBeenCalledWith(
        PROJECT_ID,
        apt1Id,
        actorId,
        "attributed-to",
        expect.any(Object),
      ),
    );
    expect(await within(dialog).findByText("Draft")).toBeVisible();
  });

  it("requires destructive confirmation before deleting a local draft", async () => {
    vi.mocked(listStixDrafts).mockResolvedValue([
      {
        localId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        objectType: "indicator",
        properties: { pattern: "[domain-name:value = 'evil.example']" },
      },
    ]);
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Delete indicator draft" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete STIX draft?" });
    expect(deleteStixDraft).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Delete draft" }));

    await waitFor(() =>
      expect(deleteStixDraft).toHaveBeenCalledWith(
        PROJECT_ID,
        "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
      ),
    );
  });

  it("offers draft quick actions from the workspace context menu", async () => {
    vi.mocked(listStixDrafts).mockResolvedValue([
      {
        localId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        objectType: "indicator",
        properties: { name: "Beacon indicator" },
      },
    ]);
    const user = userEvent.setup();
    renderWorkspace();

    const draftRow = (await screen.findByText("Beacon indicator")).closest("li");
    expect(draftRow).not.toBeNull();
    await user.pointer({ target: draftRow as HTMLLIElement, keys: "[MouseRight]" });

    expect(await screen.findByRole("menuitem", { name: "View connections" })).toBeVisible();
    expect(await screen.findByRole("menuitem", { name: "Edit draft" })).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Delete draft" }));
    expect(screen.getByRole("alertdialog", { name: "Delete STIX draft?" })).toBeVisible();
  });

  it("requires destructive confirmation before deleting a validated STIX object", async () => {
    const localId = "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb";
    vi.mocked(listStixObjects).mockResolvedValue([
      {
        localId,
        stixId: "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        objectType: "indicator",
        displayName: "Malicious domain",
        modified: "2026-07-30T10:00:00.000Z",
      },
    ]);
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Delete Indicator" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete STIX object?" });
    expect(deleteStixObject).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Delete object" }));

    await waitFor(() => expect(deleteStixObject).toHaveBeenCalledWith(PROJECT_ID, localId));
  });

  it("renders canonical STIX machine types as readable workbench labels", async () => {
    vi.mocked(listStixObjects).mockResolvedValue([
      {
        localId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        stixId: "threat-actor--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        objectType: "threat-actor",
        displayName: "Example actor",
        modified: "2026-07-30T10:00:00.000Z",
      },
    ]);
    vi.mocked(listStixDrafts).mockResolvedValue([
      {
        localId: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
        objectType: "attack-pattern",
        properties: { name: "Example technique" },
      },
    ]);

    renderWorkspace();

    expect(await screen.findByText("Threat Actor")).toBeVisible();
    expect(screen.getByText("Attack Pattern")).toBeVisible();
    expect(screen.queryByText("threat-actor")).toBeNull();
    expect(screen.queryByText("attack-pattern")).toBeNull();
  });

  it("opens a committed object as a server-created revision draft", async () => {
    const localId = "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb";
    vi.mocked(listStixObjects).mockResolvedValue([
      {
        localId,
        stixId: "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        objectType: "indicator",
        displayName: "Malicious domain",
        modified: "2026-07-30T10:00:00.000Z",
      },
    ]);
    vi.mocked(createStixRevisionDraft).mockResolvedValue({
      localId,
      objectType: "indicator",
      replacesStixId: "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
      properties: {
        created: "2026-07-30T10:00:00.000Z",
        modified: "2026-07-30T10:00:00.000Z",
        pattern: "[domain-name:value = 'evil.example']",
        pattern_type: "stix",
        valid_from: "2026-07-30T10:00:00.000Z",
      },
    });
    renderWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: "Edit Indicator" }));

    expect(createStixRevisionDraft).toHaveBeenCalledWith(PROJECT_ID, localId);
    const dialog = await screen.findByRole("dialog", { name: "Edit STIX revision" });
    expect(within(dialog).getByRole("combobox", { name: "Object type" })).toBeDisabled();
    expect(within(dialog).getByRole("textbox", { name: /^Pattern\*$/u })).toHaveValue(
      "[domain-name:value = 'evil.example']",
    );
  });

  it("requires preview confirmation before committing an import", async () => {
    vi.mocked(previewStixImport).mockResolvedValue({
      previewId: PREVIEW_ID,
      objectCount: 1,
      duplicates: [],
    });
    vi.mocked(commitStixImport).mockResolvedValue({ imported: 1, skipped: 0 });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Import bundle" }));
    expect(await screen.findByRole("heading", { name: "Review STIX import" })).toBeInTheDocument();
    expect(commitStixImport).not.toHaveBeenCalled();

    const importButton = screen.getByRole("button", { name: "Import 1 object" });
    expect(importButton).toHaveClass("primary-button");
    await user.click(importButton);
    await waitFor(() => expect(commitStixImport).toHaveBeenCalledWith(PROJECT_ID, PREVIEW_ID, []));
  });

  it("previews an export before opening the native save flow", async () => {
    vi.mocked(listStixObjects).mockResolvedValue([
      {
        localId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        stixId: "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        objectType: "indicator",
        displayName: "Malicious domain",
        modified: "2020-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(previewStixExport).mockResolvedValue({
      previewId: PREVIEW_ID,
      objectCount: 1,
    });
    vi.mocked(commitStixExport).mockResolvedValue({ saved: true });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole("button", { name: "Export bundle" }));
    expect(await screen.findByRole("heading", { name: "Export STIX bundle" })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("File name"));
    await user.type(screen.getByLabelText("File name"), "apt1-review");
    const exportButton = screen.getByRole("button", { name: "Choose save location" });
    expect(exportButton).toHaveClass("primary-button");
    await user.click(exportButton);

    await waitFor(() =>
      expect(commitStixExport).toHaveBeenCalledWith(PROJECT_ID, PREVIEW_ID, "apt1-review"),
    );
    await waitFor(() => expect(listStixObjects).toHaveBeenCalledTimes(2));
  });
});
