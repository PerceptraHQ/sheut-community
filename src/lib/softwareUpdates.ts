/** Privacy-safe desktop update integration. */
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

const MAX_VERSION_LENGTH = 64;
const MAX_DATE_LENGTH = 64;
const MAX_RELEASE_NOTES_LENGTH = 4_000;

export interface SoftwareUpdateSummary {
  currentVersion: string;
  version: string;
  date?: string;
  notes?: string;
}

export interface SoftwareUpdateProgress {
  downloadedBytes: number;
  totalBytes?: number;
}

let pendingUpdate: Update | null = null;

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const characters = Array.from(value);
  return characters.length === 0 ? undefined : characters.slice(0, maximum).join("");
}

function updateSummary(update: Update): SoftwareUpdateSummary {
  const version = boundedText(update.version, MAX_VERSION_LENGTH);
  const currentVersion = boundedText(update.currentVersion, MAX_VERSION_LENGTH);
  if (!version || !currentVersion)
    throw new Error("The update manifest contains an invalid version.");
  return {
    version,
    currentVersion,
    date: boundedText(update.date, MAX_DATE_LENGTH),
    notes: boundedText(update.body, MAX_RELEASE_NOTES_LENGTH),
  };
}

export async function checkForSoftwareUpdate(): Promise<SoftwareUpdateSummary | null> {
  await dismissSoftwareUpdate();
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  try {
    const summary = updateSummary(update);
    pendingUpdate = update;
    return summary;
  } catch (cause) {
    await update.close().catch(() => undefined);
    throw cause;
  }
}

export async function dismissSoftwareUpdate(): Promise<void> {
  const update = pendingUpdate;
  pendingUpdate = null;
  if (update) await update.close();
}

export async function installSoftwareUpdate(
  onProgress: (progress: SoftwareUpdateProgress) => void,
): Promise<void> {
  const update = pendingUpdate;
  if (!update) throw new Error("No update is ready to install.");

  let downloadedBytes = 0;
  let totalBytes: number | undefined;
  const report = (event: DownloadEvent) => {
    if (event.event === "Started") {
      totalBytes = validByteCount(event.data.contentLength);
      onProgress({ downloadedBytes: 0, totalBytes });
      return;
    }
    if (event.event === "Progress") {
      downloadedBytes += validByteCount(event.data.chunkLength) ?? 0;
      onProgress({ downloadedBytes, totalBytes });
      return;
    }
    onProgress({ downloadedBytes: totalBytes ?? downloadedBytes, totalBytes });
  };

  await update.downloadAndInstall(report);
  pendingUpdate = null;
  await update.close().catch(() => undefined);
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

function validByteCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
