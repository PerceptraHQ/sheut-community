import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as mitreApi from "../lib/mitre";
import { MitreTechniqueInspector } from "./MitreTechniqueInspector";

vi.mock("../lib/mitre", async (importOriginal) => {
  const original = await importOriginal<typeof mitreApi>();
  return {
    ...original,
    createTechniqueObservation: vi.fn(),
    deleteTechniqueObservation: vi.fn(),
    listTechniqueObservations: vi.fn(),
    updateTechniqueObservation: vi.fn(),
  };
});

vi.mock("./VaultNotices", () => ({
  useVaultNotices: () => ({
    add: vi.fn(),
    promise: <T,>(operation: () => Promise<T>) => operation(),
  }),
}));

const selection: mitreApi.MitreTechniqueSelection = {
  catalog: "attack_enterprise",
  version: "19.1",
  tacticId: "TA0002",
  technique: {
    id: "T1059.001",
    name: "PowerShell",
    description: "PowerShell may be used to execute commands.",
    tacticIds: ["TA0002"],
    platforms: ["Windows"],
    parentId: "T1059",
  },
};

describe("MITRE technique inspector", () => {
  beforeEach(() => {
    vi.mocked(mitreApi.listTechniqueObservations).mockReset().mockResolvedValue([]);
    vi.mocked(mitreApi.deleteTechniqueObservation).mockReset().mockResolvedValue();
    vi.mocked(mitreApi.createTechniqueObservation)
      .mockReset()
      .mockImplementation((_projectId, reference, values) =>
        Promise.resolve({
          id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
          reference,
          ...values,
          revision: 1,
          createdAtUnixMs: 1_000,
          updatedAtUnixMs: 1_000,
        }),
      );
  });

  it("creates a typed project observation for the selected technique", async () => {
    const onObservationChange = vi.fn();
    render(
      <MitreTechniqueInspector
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        selection={selection}
        onObservationChange={onObservationChange}
      />,
    );

    expect(await screen.findByRole("heading", { name: "PowerShell" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    fireEvent.change(screen.getByLabelText("Analyst narrative"), {
      target: { value: "Endpoint telemetry confirmed PowerShell execution." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));

    await waitFor(() => expect(mitreApi.createTechniqueObservation).toHaveBeenCalledOnce());
    expect(mitreApi.createTechniqueObservation).toHaveBeenCalledWith(
      "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
      {
        catalog: "attack_enterprise",
        version: "19.1",
        techniqueId: "T1059.001",
        tacticId: "TA0002",
      },
      expect.objectContaining({
        assessment: "suspected",
        outcome: "unknown",
        confidence: "medium",
        narrative: "Endpoint telemetry confirmed PowerShell execution.",
      }),
    );
    expect(onObservationChange).toHaveBeenCalledOnce();
  });

  it("opens the mapping form immediately for an unmapped matrix selection", async () => {
    render(
      <MitreTechniqueInspector
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        selection={{ ...selection, createMapping: true }}
        onObservationChange={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "New mapping" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save mapping" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add mapping" })).not.toBeInTheDocument();
  });

  it("removes only the selected mapping after confirmation", async () => {
    const mapped = {
      id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
      reference: {
        catalog: "attack_enterprise" as const,
        version: "19.1",
        techniqueId: "T1059.001",
        tacticId: "TA0002",
      },
      assessment: "suspected" as const,
      outcome: "unknown" as const,
      confidence: "medium" as const,
      narrative: "Added accidentally.",
      firstSeenUnixMs: null,
      lastSeenUnixMs: null,
      revision: 2,
      createdAtUnixMs: 1_000,
      updatedAtUnixMs: 2_000,
    };
    vi.mocked(mitreApi.listTechniqueObservations).mockResolvedValue([mapped]);
    const onObservationChange = vi.fn();
    render(
      <MitreTechniqueInspector
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        selection={selection}
        onObservationChange={onObservationChange}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove mapping" }));

    await waitFor(() =>
      expect(mitreApi.deleteTechniqueObservation).toHaveBeenCalledWith(
        "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
        mapped.id,
        2,
      ),
    );
    expect(onObservationChange).toHaveBeenCalledOnce();
  });
});
