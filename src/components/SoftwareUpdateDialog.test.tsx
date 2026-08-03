import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SoftwareUpdateDialog } from "./SoftwareUpdateDialog";

describe("SoftwareUpdateDialog", () => {
  it("shows bounded release details and requires explicit installation", async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    const onLater = vi.fn();
    render(
      <SoftwareUpdateDialog
        update={{
          currentVersion: "0.1.0",
          version: "0.2.0",
          notes: "Security and reliability improvements.",
        }}
        progress={null}
        installing={false}
        onInstall={onInstall}
        onLater={onLater}
      />,
    );

    expect(screen.getByRole("heading", { name: "A Sheut update is available" })).toBeVisible();
    expect(screen.getByText("Security and reliability improvements.")).toBeVisible();
    expect(screen.getByText(/version 0.2.0 is ready/i)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Update and restart" }));
    expect(onInstall).toHaveBeenCalledOnce();
    expect(onLater).not.toHaveBeenCalled();
  });

  it("keeps controls visible and reports download progress", () => {
    render(
      <SoftwareUpdateDialog
        update={{ currentVersion: "0.1.0", version: "0.2.0" }}
        progress={{ downloadedBytes: 25, totalBytes: 100 }}
        installing
        onInstall={vi.fn()}
        onLater={vi.fn()}
      />,
    );

    expect(screen.getByRole("progressbar", { name: "Downloading update" })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(screen.getByRole("button", { name: "Installing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Later" })).toBeDisabled();
  });

  it("keeps the choice visible when an update cannot be installed", () => {
    render(
      <SoftwareUpdateDialog
        error
        update={{ currentVersion: "0.1.0", version: "0.2.0" }}
        progress={null}
        installing={false}
        onInstall={vi.fn()}
        onLater={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sheut could not finish the update. Check your connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});
