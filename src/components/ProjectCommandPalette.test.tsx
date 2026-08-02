import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentEnvelope } from "../lib/documents";
import * as documentsApi from "../lib/documents";
import * as graphApi from "../lib/graph";
import * as stixApi from "../lib/stix";
import { ProjectCommandPalette } from "./ProjectCommandPalette";

vi.mock("../lib/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/documents")>()),
  listDocuments: vi.fn(),
}));
vi.mock("../lib/stix", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/stix")>()),
  listStixDrafts: vi.fn(),
  listStixObjects: vi.fn(),
}));
vi.mock("../lib/graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/graph")>()),
  listGraphWorkspaces: vi.fn(),
}));

const document: DocumentEnvelope = {
  schema_version: 1,
  id: "document-1",
  kind: "investigation",
  revision: 1,
  root: {
    type: "doc",
    content: [
      { type: "heading", content: [{ type: "text", text: "Operation Lantern" }] },
      { type: "paragraph", content: [{ type: "text", text: "Persistence clue" }] },
    ],
  },
};

describe("ProjectCommandPalette", () => {
  beforeEach(() => {
    vi.mocked(documentsApi.listDocuments).mockReset().mockResolvedValue([document]);
    vi.mocked(stixApi.listStixObjects).mockReset().mockResolvedValue([]);
    vi.mocked(stixApi.listStixDrafts).mockReset().mockResolvedValue([]);
    vi.mocked(graphApi.listGraphWorkspaces).mockReset().mockResolvedValue([]);
  });

  it("searches local project content and opens a document result", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onOpenDocument = vi.fn();
    render(
      <ProjectCommandPalette
        open
        projectId="project-1"
        onOpenChange={onOpenChange}
        onNavigate={vi.fn()}
        onOpenDocument={onOpenDocument}
      />,
    );

    const search = await screen.findByRole("combobox", { name: "Search project and commands" });
    await waitFor(() => expect(documentsApi.listDocuments).toHaveBeenCalledWith("project-1"));
    await user.type(search, "Persistence clue");
    await user.click(await screen.findByRole("option", { name: /Operation Lantern/ }));

    expect(onOpenDocument).toHaveBeenCalledWith(document);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("exposes workspace navigation and settings as commands", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <ProjectCommandPalette
        open
        projectId="project-1"
        onOpenChange={vi.fn()}
        onNavigate={onNavigate}
        onOpenDocument={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("option", { name: /Graph workspace/ }));
    expect(onNavigate).toHaveBeenCalledWith("graph");
  });
});
