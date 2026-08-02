import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { StixFieldControl } from "./StixFieldControl";

const referenceOptions = [
  {
    displayName: "Known analyst",
    objectType: "identity",
    stixId: "identity--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
  },
  {
    displayName: "piracy.example",
    objectType: "domain-name",
    stixId: "domain-name--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
  },
];

it("uses a semantic date-time control and emits a STIX UTC timestamp", () => {
  const onChange = vi.fn();
  render(
    <StixFieldControl
      definition={{ kind: "timestamp", required: true }}
      disabled={false}
      name="valid_from"
      onChange={onChange}
      referenceOptions={[]}
      value="2026-08-01T10:15:00.000Z"
    />,
  );

  const input = screen.getByLabelText("Valid From*");
  expect(input).toHaveAttribute("type", "datetime-local");
  expect(input).toHaveAttribute("step", "0.001");

  fireEvent.change(input, { target: { value: "2026-08-02T12:30" } });
  expect(onChange).toHaveBeenLastCalledWith(new Date("2026-08-02T12:30").toISOString());
  expect(screen.getByText(/stores it as a UTC STIX timestamp/i)).toBeVisible();
});

it("suggests compatible local objects for a single reference and accepts an external STIX ID", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <StixFieldControl
      definition={{ kind: "reference", referenceTypes: ["identity"] }}
      disabled={false}
      name="created_by_ref"
      onChange={onChange}
      referenceOptions={referenceOptions}
      value=""
    />,
  );

  const input = screen.getByRole("combobox", { name: "Created By Ref" });
  await user.type(input, "Known");
  expect(screen.getByRole("option", { name: /Known analyst/u })).toBeVisible();
  expect(screen.queryByRole("option", { name: /piracy\.example/u })).toBeNull();

  fireEvent.change(input, {
    target: { value: "identity--6f9619ff-8b86-d011-b42d-00cf4fc964ff" },
  });
  expect(onChange).toHaveBeenLastCalledWith("identity--6f9619ff-8b86-d011-b42d-00cf4fc964ff");
});

it("adds and removes compatible local or external references without a JSON field", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(
    <StixFieldControl
      definition={{ kind: "reference-list", referenceTypes: ["domain-name"] }}
      disabled={false}
      name="object_refs"
      onChange={onChange}
      referenceOptions={referenceOptions}
      value=""
    />,
  );

  const input = screen.getByRole("combobox", { name: "Add Object Refs" });
  await user.type(input, "piracy");
  expect(screen.getByRole("option", { name: /piracy\.example/u })).toBeVisible();
  expect(screen.queryByRole("option", { name: /Known analyst/u })).toBeNull();
  await user.click(screen.getByRole("option", { name: /piracy\.example/u }));
  await user.click(screen.getByRole("button", { name: "Add reference" }));
  expect(onChange).toHaveBeenLastCalledWith("domain-name--e7c44850-9f67-4d26-b7e3-0d4ee82339ef");

  rerender(
    <StixFieldControl
      definition={{ kind: "reference-list", referenceTypes: ["domain-name"] }}
      disabled={false}
      name="object_refs"
      onChange={onChange}
      referenceOptions={referenceOptions}
      value="domain-name--e7c44850-9f67-4d26-b7e3-0d4ee82339ef"
    />,
  );
  await user.click(screen.getByRole("button", { name: "Remove piracy.example" }));
  expect(onChange).toHaveBeenLastCalledWith("");
});
