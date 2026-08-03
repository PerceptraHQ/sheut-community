import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSoftwareUpdateConsent, setSoftwareUpdateConsent } from "./softwareUpdatePreferences";
import {
  checkForSoftwareUpdate,
  dismissSoftwareUpdate,
  installSoftwareUpdate,
} from "./softwareUpdates";

vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

describe("software update boundary", () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.mocked(check).mockReset();
    vi.mocked(relaunch).mockReset();
    await dismissSoftwareUpdate();
  });

  it("keeps automatic network checks unknown until the user decides", () => {
    expect(getSoftwareUpdateConsent()).toBe("unknown");

    setSoftwareUpdateConsent(true);

    expect(getSoftwareUpdateConsent()).toBe("enabled");
    expect(localStorage.getItem("sheut.software-updates.v1")).toBe('{"consent":"enabled"}');
  });

  it("fails closed when the local preference is malformed or contains extra fields", () => {
    localStorage.setItem(
      "sheut.software-updates.v1",
      '{"automaticChecks":true,"reportTitle":"must never leave this device"}',
    );

    expect(getSoftwareUpdateConsent()).toBe("unknown");
  });

  it("returns only bounded release metadata from the fixed plugin check", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(check).mockResolvedValue({
      version: "0.2.0",
      currentVersion: "0.1.0",
      date: "2026-08-03T12:00:00Z",
      body: "A".repeat(10_000),
      close,
      downloadAndInstall: vi.fn(),
    } as never);

    await expect(checkForSoftwareUpdate()).resolves.toEqual({
      version: "0.2.0",
      currentVersion: "0.1.0",
      date: "2026-08-03T12:00:00Z",
      notes: "A".repeat(4_000),
    });
    expect(check).toHaveBeenCalledWith();
  });

  it("downloads, verifies, installs, and relaunches only after explicit confirmation", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const downloadAndInstall = vi.fn((listener: (event: DownloadEvent) => void) => {
      listener({ event: "Started", data: { contentLength: 100 } });
      listener({ event: "Progress", data: { chunkLength: 25 } });
      listener({ event: "Finished" });
      return Promise.resolve();
    });
    vi.mocked(check).mockResolvedValue({
      version: "0.2.0",
      currentVersion: "0.1.0",
      date: undefined,
      body: undefined,
      close,
      downloadAndInstall,
    } as never);
    const onProgress = vi.fn();

    await checkForSoftwareUpdate();
    await installSoftwareUpdate(onProgress);

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      downloadedBytes: 0,
      totalBytes: 100,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      downloadedBytes: 25,
      totalBytes: 100,
    });
    expect(onProgress).toHaveBeenLastCalledWith({
      downloadedBytes: 100,
      totalBytes: 100,
    });
    expect(close).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("releases a declined update without downloading it", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const downloadAndInstall = vi.fn();
    vi.mocked(check).mockResolvedValue({
      version: "0.2.0",
      currentVersion: "0.1.0",
      date: undefined,
      body: undefined,
      close,
      downloadAndInstall,
    } as never);

    await checkForSoftwareUpdate();
    await dismissSoftwareUpdate();

    expect(close).toHaveBeenCalledOnce();
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });
});
