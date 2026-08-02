import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { GraphRelationshipDraftDialog } from "./GraphRelationshipDraftDialog";

const preview = {
  sourceId: "source-local-id",
  sourceObjectType: "domain-name",
  targetId: "target-local-id",
  targetObjectType: "ipv4-addr",
  visualLabel: null,
  visualLinkId: "visual-link-id",
};

it("keeps graph relationship creation compatible with standard and custom STIX verbs", async () => {
  const onRelationshipTypeChange = vi.fn();
  const onCommit = vi.fn();
  const user = userEvent.setup();

  function Harness() {
    const [relationshipType, setRelationshipType] = useState("");
    return (
      <GraphRelationshipDraftDialog
        busy={false}
        description=""
        onClose={vi.fn()}
        onCommit={onCommit}
        onDescriptionChange={vi.fn()}
        onRelationshipTypeChange={(value) => {
          setRelationshipType(value);
          onRelationshipTypeChange(value);
        }}
        preview={preview}
        relationshipType={relationshipType}
      />
    );
  }

  render(<Harness />);

  const input = screen.getByRole("combobox", { name: "Relationship type" });
  await user.type(input, "res");
  await user.click(screen.getByRole("option", { name: /Resolves To/u }));
  expect(onRelationshipTypeChange).toHaveBeenLastCalledWith("resolves-to");

  await user.clear(input);
  await user.type(input, "investigated-with");
  expect(onRelationshipTypeChange).toHaveBeenLastCalledWith("investigated-with");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Create draft" })).toBeEnabled();
});
