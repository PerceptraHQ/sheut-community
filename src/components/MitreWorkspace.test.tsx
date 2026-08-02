import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as mitreApi from "../lib/mitre";
import { MitreWorkspace } from "./MitreWorkspace";

vi.mock("../lib/mitre", async (importOriginal) => {
  const original = await importOriginal<typeof mitreApi>();
  return {
    ...original,
    getMitreCatalog: vi.fn(),
    listTechniqueObservations: vi.fn(),
  };
});

const enterprise: mitreApi.MitreCatalogSnapshot = {
  schemaVersion: 2,
  catalog: "attack_enterprise",
  version: "19.1",
  source: { url: "https://example.invalid/enterprise.json", sha256: "a".repeat(64) },
  tactics: [{ id: "TA0002", name: "Execution", shortName: "execution", description: "" }],
  techniques: [
    {
      id: "T1059.001",
      name: "PowerShell",
      description: "PowerShell execution",
      tacticIds: ["TA0002"],
      platforms: ["Windows"],
      parentId: "T1059",
    },
  ],
};

const atlas: mitreApi.MitreCatalogSnapshot = {
  schemaVersion: 2,
  catalog: "atlas",
  version: "2026.06",
  source: { url: "https://example.invalid/atlas.json", sha256: "b".repeat(64) },
  tactics: [{ id: "AML.TA0002", name: "ML Attack Staging", shortName: "staging", description: "" }],
  techniques: [
    {
      id: "AML.T0000",
      name: "Search Open Technical Databases",
      description: "Model-oriented reconnaissance",
      tacticIds: ["AML.TA0002"],
      platforms: [],
      parentId: null,
    },
  ],
};

describe("MITRE mapping workspace", () => {
  beforeEach(() => {
    vi.mocked(mitreApi.getMitreCatalog).mockImplementation((catalog) => {
      if (catalog === "attack_enterprise") return Promise.resolve(enterprise);
      if (catalog === "atlas") return Promise.resolve(atlas);
      return Promise.reject(new Error("not loaded in this test"));
    });
    vi.mocked(mitreApi.listTechniqueObservations).mockResolvedValue([
      {
        id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        reference: {
          catalog: "attack_enterprise",
          version: "19.1",
          techniqueId: "T1059.001",
          tacticId: "TA0002",
        },
        assessment: "observed",
        outcome: "successful",
        confidence: "high",
        narrative: "Endpoint telemetry confirmed execution.",
        firstSeenUnixMs: null,
        lastSeenUnixMs: null,
        revision: 1,
        createdAtUnixMs: 1_000,
        updatedAtUnixMs: 1_000,
      },
    ]);
  });

  it("uses a progress state while the offline catalog loads", () => {
    vi.mocked(mitreApi.getMitreCatalog).mockReturnValue(new Promise(() => undefined));

    render(
      <MitreWorkspace
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        refreshKey={0}
        onSelectTechnique={vi.fn()}
      />,
    );

    expect(screen.getByRole("progressbar", { name: "Loading MITRE ATT&CK" })).toBeVisible();
  });

  it("keeps each knowledge base in a selected tab and exposes mapping state without color alone", async () => {
    const onSelectTechnique = vi.fn();
    render(
      <MitreWorkspace
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        refreshKey={0}
        onSelectTechnique={onSelectTechnique}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Enterprise ATT&CK 19.1" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "ATLAS 2026.06" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Enterprise ATT&CK" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Observed · Successful · High")).toBeVisible();
    expect(screen.getByText("1 technique")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /PowerShell T1059\.001/i }));
    expect(onSelectTechnique).toHaveBeenCalledWith(
      expect.objectContaining({
        catalog: "attack_enterprise",
        version: "19.1",
        tacticId: "TA0002",
        createMapping: false,
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "ATLAS" }));
    expect(await screen.findByRole("heading", { name: "ATLAS 2026.06" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "ATLAS" })).toHaveAttribute("aria-selected", "true");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search MITRE techniques" }), {
      target: { value: "model-oriented" },
    });
    await waitFor(() => expect(screen.queryByText("PowerShell")).not.toBeInTheDocument());
    expect(screen.getByText("Search Open Technical Databases")).toBeVisible();
    expect(screen.getByText("Not mapped · click to add")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /Search Open Technical Databases AML\.T0000/i }),
    );
    expect(onSelectTechnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        catalog: "atlas",
        createMapping: true,
      }),
    );
  });
});
