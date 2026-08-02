import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StixConnection } from "../lib/stixConnections";
import { StixConnectionsDialog, type StixRelationshipCreateInput } from "./StixConnectionsDialog";

const APT1 = {
  localId: "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
  objectType: "intrusion-set",
  displayName: "APT1",
};
const UGLY_GORILLA = {
  localId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
  objectType: "threat-actor",
  displayName: "Ugly Gorilla",
};
const JACK_WANG = {
  localId: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
  objectType: "identity",
  displayName: "JackWang",
};

const committedAttribution: StixConnection = {
  id: "765815fb-d993-4a1d-959f-7f7bcc4a5eb3",
  relationshipType: "attributed-to",
  source: { ...APT1, available: true, stixId: "intrusion-set--apt1" },
  state: "committed",
  target: { ...UGLY_GORILLA, available: true, stixId: "threat-actor--ugly" },
};

describe("StixConnectionsDialog", () => {
  it("shows incoming and outgoing relationships and creates an outgoing attribution", async () => {
    const onCreate = vi
      .fn<(input: StixRelationshipCreateInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <StixConnectionsDialog
        connections={[committedAttribution]}
        endpoint={APT1}
        endpoints={[APT1, UGLY_GORILLA, JACK_WANG]}
        onCreate={onCreate}
        onOpenChange={vi.fn()}
        open
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Connections for APT1" });
    expect(within(dialog).getByRole("heading", { name: "Incoming relationships 0" })).toBeVisible();
    expect(within(dialog).getByRole("heading", { name: "Outgoing relationships 1" })).toBeVisible();
    expect(within(dialog).getByText("Committed")).toBeVisible();

    await user.click(within(dialog).getByRole("combobox", { name: "Target object" }));
    await user.click(screen.getByRole("option", { name: /Ugly Gorilla/u }));
    const relationship = within(dialog).getByRole("combobox", { name: "Relationship type" });
    await user.type(relationship, "attr");
    await user.click(screen.getByRole("option", { name: /Attributed To/u }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "Description (optional)" }),
      "Published assessment",
    );
    await user.click(within(dialog).getByRole("button", { name: "Create relationship draft" }));

    const input = onCreate.mock.calls[0]?.[0];
    expect(input?.sourceId).toBe(APT1.localId);
    expect(input?.targetId).toBe(UGLY_GORILLA.localId);
    expect(input?.relationshipType).toBe("attributed-to");
    expect(input?.properties.description).toBe("Published assessment");
    expect(within(dialog).getByRole("combobox", { name: "Target object" })).toHaveValue("");
  }, 30_000);

  it("creates incoming attribution with the selected object fixed as target", async () => {
    const onCreate = vi
      .fn<(input: StixRelationshipCreateInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <StixConnectionsDialog
        connections={[committedAttribution]}
        endpoint={UGLY_GORILLA}
        endpoints={[APT1, UGLY_GORILLA, JACK_WANG]}
        onCreate={onCreate}
        onOpenChange={vi.fn()}
        open
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Connections for Ugly Gorilla" });
    await user.click(within(dialog).getByRole("radio", { name: /Incoming/u }));
    await user.click(within(dialog).getByRole("combobox", { name: "Source object" }));
    await user.click(screen.getByRole("option", { name: /APT1/u }));
    await user.type(within(dialog).getByRole("combobox", { name: "Relationship type" }), "attr");
    await user.click(screen.getByRole("option", { name: /Attributed To/u }));
    await user.click(within(dialog).getByRole("button", { name: "Create relationship draft" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: APT1.localId,
        targetId: UGLY_GORILLA.localId,
        relationshipType: "attributed-to",
      }),
    );
  });

  it("keeps inspection available when there is no second relationship endpoint", () => {
    render(
      <StixConnectionsDialog
        connections={[]}
        endpoint={APT1}
        endpoints={[APT1]}
        onCreate={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Connections for APT1" });
    expect(
      within(dialog).getByText(/Create or import another domain or observable object/u),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Create relationship draft" }),
    ).toBeDisabled();
  });
});
