import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { CreateProjectDialog } from "./CreateProjectDialog";

it("offers every TLP 2.0 marking and preserves Amber+Strict as a distinct project default", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(<CreateProjectDialog onCreate={onCreate} />);

  await user.click(screen.getByRole("button", { name: "Create project" }));
  const dialog = screen.getByRole("dialog", { name: "Create project" });
  await user.click(within(dialog).getByRole("combobox", { name: "Default TLP marking" }));

  for (const name of [
    "TLP:RED — Named recipients",
    "TLP:AMBER+STRICT — Organization only",
    "TLP:AMBER — Organization and clients",
    "TLP:GREEN — Community",
    "TLP:CLEAR — No restriction",
  ]) {
    expect(screen.getByRole("option", { name })).toBeVisible();
  }

  await user.click(screen.getByRole("option", { name: "TLP:AMBER+STRICT — Organization only" }));
  await user.type(within(dialog).getByLabelText("Project name"), "Restricted project");
  await user.click(within(dialog).getByRole("button", { name: "Create project" }));

  expect(onCreate).toHaveBeenCalledWith({
    name: "Restricted project",
    unlockMethod: "device",
    defaultTlpMarking: "amber_strict",
  });
});
