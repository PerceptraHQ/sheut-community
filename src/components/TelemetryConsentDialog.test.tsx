import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TelemetryConsentDialog } from "./TelemetryConsentDialog";

describe("TelemetryConsentDialog", () => {
  it("keeps telemetry off until the user explicitly opts in", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn().mockResolvedValue(undefined);

    render(<TelemetryConsentDialog onDecision={onDecision} />);

    const dialog = screen.getByRole("dialog", { name: "Anonymous diagnostics and usage" });
    expect(dialog).toHaveTextContent("Never collected");
    expect(dialog).toHaveTextContent("graph nodes, edges, labels, or properties");
    expect(dialog).toHaveTextContent("report titles, sections, fields, rows, or prose");
    expect(dialog).toHaveTextContent("evidence metadata or files");
    expect(onDecision).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep telemetry off" }));
    expect(onDecision).toHaveBeenCalledWith(false);
  });

  it("enables telemetry only from the explicit sharing action", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn().mockResolvedValue(undefined);

    render(<TelemetryConsentDialog onDecision={onDecision} />);
    await user.click(screen.getByRole("button", { name: "Share anonymous diagnostics" }));

    expect(onDecision).toHaveBeenCalledWith(true);
  });
});
