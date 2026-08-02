import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { GraphNodeSummary } from "../../lib/graph";
import { SelectedItemsDialog } from "./GraphWorkspaceDialogs";

const items: GraphNodeSummary[] = [
  graphNode("one", "indicator", "First indicator"),
  graphNode("two", "malware", "Second malware"),
];

describe("SelectedItemsDialog", () => {
  it("renders every item unchecked until that specific row is selected", async () => {
    render(
      <SelectedItemsDialog
        onOpenChange={() => undefined}
        items={items}
        busy={false}
        title="Selected items"
        description="Choose project items"
        actionLabel="Create workspace"
        onCreate={() => undefined}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Selected items" });
    const checkboxes = within(dialog).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(within(dialog).queryAllByTestId("selected-item-checkmark")).toHaveLength(0);

    await userEvent.click(checkboxes[0]);

    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(within(dialog).getAllByTestId("selected-item-checkmark")).toHaveLength(1);
  });

  it("submits only explicitly selected objects", async () => {
    const onCreate = vi.fn();
    render(
      <SelectedItemsDialog
        onOpenChange={() => undefined}
        items={items}
        busy={false}
        title="Selected items"
        description="Choose project items"
        actionLabel="Create workspace"
        onCreate={onCreate}
      />,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: /Second malware/u }));
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(onCreate).toHaveBeenCalledWith([items[1]]);
  });
});

function graphNode(id: string, objectType: string, displayName: string): GraphNodeSummary {
  return {
    id,
    itemKind: "intelligence",
    objectType,
    displayName,
    available: true,
    sourceView: "intelligence",
    stixId: `${objectType}--${id}`,
  };
}
