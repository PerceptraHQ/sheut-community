import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTelemetryPreference,
  recordTelemetryEvent,
  setTelemetryPreference,
} from "./telemetry";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("telemetry command facade", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("reads consent without exposing an installation identifier", async () => {
    vi.mocked(invoke).mockResolvedValue({ consent: "disabled" });

    await expect(getTelemetryPreference()).resolves.toEqual({ consent: "disabled" });
    expect(invoke).toHaveBeenCalledWith("get_telemetry_preference");
  });

  it("changes consent through a boolean-only command", async () => {
    vi.mocked(invoke).mockResolvedValue({ consent: "enabled" });

    await expect(setTelemetryPreference(true)).resolves.toEqual({ consent: "enabled" });
    expect(invoke).toHaveBeenCalledWith("set_telemetry_preference", { enabled: true });
  });

  it("reports only a fixed event name with no free-form context", async () => {
    vi.mocked(invoke).mockResolvedValue(true);

    await expect(recordTelemetryEvent("graph_opened")).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("record_telemetry_event", {
      eventName: "graph_opened",
    });
  });
});
