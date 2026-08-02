import { IconLoader2 } from "@tabler/icons-react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { WorkspaceLoadingState } from "./WorkspaceState";

it("announces a centered indeterminate workspace loading state", () => {
  render(
    <WorkspaceLoadingState
      icon={<IconLoader2 aria-hidden="true" />}
      title="Loading intelligence"
      description="Reading encrypted project data."
    />,
  );

  expect(screen.getByRole("progressbar", { name: "Loading intelligence" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Loading intelligence");
  expect(screen.getByText("Reading encrypted project data.")).toBeVisible();
});
