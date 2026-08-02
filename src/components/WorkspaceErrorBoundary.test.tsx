import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  sanitizeComponentStack,
  sanitizeWorkspaceError,
  WorkspaceErrorBoundary,
} from "./WorkspaceErrorBoundary";

function BrokenWorkspace(): never {
  throw new Error("render failed");
}

describe("WorkspaceErrorBoundary", () => {
  it("keeps recovery controls visible when a workspace crashes", async () => {
    const onLeave = vi.fn();
    const user = userEvent.setup();
    render(
      <WorkspaceErrorBoundary onLeave={onLeave}>
        <BrokenWorkspace />
      </WorkspaceErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("This workspace could not be rendered");
    expect(screen.getByRole("alert")).toHaveTextContent("render failed");
    expect(screen.getByText(/^Diagnostic [A-F0-9]{8}$/u)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Return to project overview" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("redacts local identifiers and paths from visible diagnostics", () => {
    expect(
      sanitizeWorkspaceError(
        new Error(
          "Failed at /Users/analyst/project/file.ts for indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        ),
      ).reason,
    ).toBe("Failed at [local path] for [local identifier]");
    expect(
      sanitizeComponentStack("at GraphCanvas (/Users/analyst/project/GraphCanvas.tsx:12:3)"),
    ).toBe("at GraphCanvas ([local path]:12:3)");
  });
});
