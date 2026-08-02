import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { AutocompleteField } from "./AutocompleteField";
import { ComboboxField } from "./ComboboxField";

function CustomRelationshipCombobox({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <AutocompleteField
      emptyMessage="No standard match. The custom value will be used."
      label="Relationship type"
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      options={[{ value: "resolves-to", label: "Resolves To", secondary: "STIX 2.1" }]}
      placeholder="Choose or enter a relationship"
      value={value}
    />
  );
}

it("keeps every option label in the full-width grid column when no checkmark is rendered", () => {
  render(
    <ComboboxField
      label="Object type"
      onChange={vi.fn()}
      options={[
        { value: "attack-pattern", label: "Attack Pattern" },
        { value: "indicator", label: "Indicator" },
      ]}
      placeholder="Choose an object type"
      value="indicator"
    />,
  );

  const input = screen.getByRole("combobox", { name: "Object type" });
  expect(input).toHaveAttribute("autocomplete", "off");
  fireEvent.click(screen.getByRole("button", { name: "Open Object type" }));

  expect(screen.getByText("Attack Pattern").parentElement).toHaveClass("col-start-2");
  expect(screen.getByText("Indicator").parentElement).toHaveClass("col-start-2");
  expect(screen.getByText("Attack Pattern")).toHaveClass("min-w-0", "flex-1", "break-words");
  expect(screen.getByRole("listbox", { hidden: true }).parentElement).toHaveClass(
    "w-full",
    "min-w-0",
  );
});

it("accepts a custom open-vocabulary value while keeping standard options selectable", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<CustomRelationshipCombobox onChange={onChange} />);

  const input = screen.getByRole("combobox", { name: "Relationship type" });
  await user.type(input, "investigated-with");
  expect(onChange).toHaveBeenLastCalledWith("investigated-with");
  expect(
    screen.getByText((content) =>
      content.startsWith("No standard match. The custom value will be used."),
    ),
  ).toBeVisible();

  await user.clear(input);
  await user.type(input, "res");
  await user.click(screen.getByRole("option", { name: /Resolves To/u }));
  expect(onChange).toHaveBeenLastCalledWith("resolves-to");
  expect(input).toHaveValue("resolves-to");
});
