import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { SelectField } from "./SelectField";

it("keeps long option labels inside the full-width anchored popup", async () => {
  const user = userEvent.setup();
  render(
    <SelectField
      ariaLabel="Filter by platform"
      onChange={vi.fn()}
      options={[
        {
          value: "long",
          label: "A very long platform label that must wrap without widening the dialog",
          secondary: "ATT&CK",
        },
      ]}
      placeholder="All platforms"
      value={null}
    />,
  );

  await user.click(screen.getByRole("combobox", { name: "Filter by platform" }));

  expect(
    screen.getByRole("combobox", { name: "Filter by platform" }).querySelector("span"),
  ).toHaveClass("min-w-0", "flex-1", "text-left");
  expect(screen.getByRole("listbox", { hidden: true })).toHaveClass(
    "w-full",
    "max-w-[var(--available-width)]",
  );
  const option = screen.getByRole("option", { hidden: true });
  const itemText = screen
    .getByText(/A very long platform label/u)
    .closest("[data-slot='item-text']");
  expect(option).toHaveClass("w-full", "min-w-0");
  expect(itemText).toHaveClass("col-start-2", "min-w-0", "flex-1");
  expect(itemText?.parentElement).toBe(option);
});
