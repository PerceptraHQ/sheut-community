import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SoftwareUpdateConsentDialog } from "./SoftwareUpdateConsentDialog";

describe("SoftwareUpdateConsentDialog", () => {
  it("asks before enabling launch-time network checks", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn().mockResolvedValue(undefined);
    render(<SoftwareUpdateConsentDialog onDecision={onDecision} />);

    expect(screen.getByRole("heading", { name: "Keep Sheut up to date" })).toBeVisible();
    expect(
      screen.getByText(/no project, report, graph, evidence, or telemetry data/i),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Check automatically" }));

    expect(onDecision).toHaveBeenCalledWith(true);
  });

  it("keeps launch-time checks off when declined", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn().mockResolvedValue(undefined);
    render(<SoftwareUpdateConsentDialog onDecision={onDecision} />);

    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(onDecision).toHaveBeenCalledWith(false);
  });
});
