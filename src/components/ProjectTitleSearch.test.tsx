import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import * as documentsApi from "../lib/documents";
import * as graphApi from "../lib/graph";
import * as stixApi from "../lib/stix";
import { ProjectTitleSearch } from "./ProjectTitleSearch";

vi.mock("../lib/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/documents")>()),
  listDocuments: vi.fn(),
}));

vi.mock("../lib/graph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/graph")>()),
  listGraphWorkspaces: vi.fn(),
}));

vi.mock("../lib/stix", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/stix")>()),
  listStixDrafts: vi.fn(),
  listStixObjects: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(documentsApi.listDocuments).mockReset().mockResolvedValue([]);
  vi.mocked(graphApi.listGraphWorkspaces).mockReset().mockResolvedValue([]);
  vi.mocked(stixApi.listStixDrafts).mockReset().mockResolvedValue([]);
  vi.mocked(stixApi.listStixObjects)
    .mockReset()
    .mockResolvedValue([
      {
        localId: "object-apt1",
        stixId: "intrusion-set--apt1",
        objectType: "intrusion-set",
        displayName: "APT1",
        modified: "2026-07-31T07:00:00Z",
      },
    ]);
});

it("offers project-data autocomplete without opening the command palette", async () => {
  const user = userEvent.setup();
  const onOpenResult = vi.fn();
  render(<ProjectTitleSearch disabled={false} projectId="project-1" onOpenResult={onOpenResult} />);

  const search = screen.getByRole("combobox", { name: "Search project data" });
  await user.click(search);
  await user.type(search, "APT1");

  const result = await screen.findByRole("option", { name: /APT1/u });
  await user.click(result);

  await waitFor(() =>
    expect(onOpenResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: "intelligence:object-apt1", label: "APT1" }),
    ),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
