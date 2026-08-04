import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportPropertiesDialog } from "./ReportPropertiesDialog";

describe("ReportPropertiesDialog", () => {
  it("renders clearly styled, labelled property inputs", () => {
    render(
      <ReportPropertiesDialog
        open
        properties={{
          reportId: "RPT-0001",
          title: "Untitled report",
          authors: [{ name: "Analyst", role: "Lead" }],
          producingOrganisation: "Research unit",
          issueDate: "2026-08-03",
        }}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Report administration" })).toBeVisible();
    expect(
      screen.getByText(/generate the PDF cover and Report administration page/i),
    ).toBeVisible();
    expect(screen.getByText(/Version, status, TLP, and release history/i)).toBeVisible();

    for (const input of [
      screen.getByLabelText("Title"),
      screen.getByLabelText("Producing organisation"),
      screen.getByLabelText("Issue date"),
      screen.getByLabelText("Author 1 name"),
      screen.getByLabelText("Author 1 role"),
    ]) {
      expect(input).toHaveClass("control-input");
    }
  });
});
