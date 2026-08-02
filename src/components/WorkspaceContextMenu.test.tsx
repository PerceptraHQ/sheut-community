import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";

it("renders shared Base UI context actions with shortcuts and destructive state", async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  render(
    <WorkspaceContextMenu
      trigger={<button type="button">Investigation row</button>}
      items={[
        { label: "Open", shortcut: "Enter", onSelect: onOpen },
        { label: "Delete document", danger: true, separatorBefore: true, onSelect: onDelete },
      ]}
    />,
  );

  await user.pointer({ target: screen.getByRole("button"), keys: "[MouseRight]" });
  expect(await screen.findByRole("menuitem", { name: /Open/u })).toBeVisible();
  await user.click(screen.getByRole("menuitem", { name: "Delete document" }));
  expect(onDelete).toHaveBeenCalledOnce();
  expect(onOpen).not.toHaveBeenCalled();
});
