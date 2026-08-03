const SOFTWARE_UPDATE_PREFERENCE_KEY = "sheut.software-updates.v1";

export type SoftwareUpdateConsent = "unknown" | "disabled" | "enabled";

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PreferenceStorage {
  return window.localStorage;
}

export function getSoftwareUpdateConsent(
  storage: PreferenceStorage = defaultStorage(),
): SoftwareUpdateConsent {
  try {
    const raw = storage.getItem(SOFTWARE_UPDATE_PREFERENCE_KEY);
    if (raw === '{"consent":"enabled"}') return "enabled";
    if (raw === '{"consent":"disabled"}') return "disabled";
  } catch {
    // A missing, unreadable, or malformed preference must never enable network access.
  }
  return "unknown";
}

export function setSoftwareUpdateConsent(
  enabled: boolean,
  storage: PreferenceStorage = defaultStorage(),
): SoftwareUpdateConsent {
  const consent = enabled ? "enabled" : "disabled";
  storage.setItem(SOFTWARE_UPDATE_PREFERENCE_KEY, JSON.stringify({ consent }));
  return consent;
}
