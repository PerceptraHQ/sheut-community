import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as graphApi from "../lib/graph";
import { GraphSnapshotDialog } from "./GraphSnapshotDialog";

vi.mock("../lib/graph", async (importOriginal) => ({
  ...(await importOriginal<typeof graphApi>()),
  listGraphWorkspaces: vi.fn(),
}));

const workspace: graphApi.GraphWorkspace = {
  schema_version: 1,
  id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
  name: "Infrastructure map",
  revision: 7,
  mode: "view",
  viewport: { x: 0, y: 0, zoom: 1 },
  created_at_unix_ms: 1,
  updated_at_unix_ms: 2,
  deleted_at_unix_ms: null,
};

beforeEach(() => {
  vi.mocked(graphApi.listGraphWorkspaces).mockReset().mockResolvedValue([workspace]);
});

it("inserts the selected graph revision as an inline frozen snapshot", async () => {
  const user = userEvent.setup();
  const onInsert = vi.fn().mockResolvedValue(undefined);
  render(
    <GraphSnapshotDialog
      open
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      onOpenChange={vi.fn()}
      onInsert={onInsert}
    />,
  );

  await user.click(await screen.findByRole("option", { name: /Infrastructure map/ }));
  await user.click(screen.getByRole("button", { name: "Insert inline" }));

  expect(onInsert).toHaveBeenCalledWith(workspace, "inline");
});

it("can place a frozen graph in the analytical figures appendix", async () => {
  const user = userEvent.setup();
  const onInsert = vi.fn().mockResolvedValue(undefined);
  render(
    <GraphSnapshotDialog
      open
      projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
      onOpenChange={vi.fn()}
      onInsert={onInsert}
    />,
  );

  await user.click(await screen.findByRole("option", { name: /Infrastructure map/ }));
  await user.click(screen.getByRole("button", { name: "Analytical figures" }));

  expect(onInsert).toHaveBeenCalledWith(workspace, "appendix");
});
