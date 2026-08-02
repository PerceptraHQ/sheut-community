export type WorkbenchSide = "left" | "right";

export interface WorkbenchLayoutPreferences {
  activityBarPosition: WorkbenchSide;
  activityBarVisible: boolean;
  centeredLayout: boolean;
  primarySideBarVisible: boolean;
  secondarySideBarPosition: WorkbenchSide;
  secondarySideBarVisible: boolean;
}

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayoutPreferences = {
  activityBarPosition: "left",
  activityBarVisible: true,
  centeredLayout: false,
  primarySideBarVisible: true,
  secondarySideBarPosition: "right",
  secondarySideBarVisible: true,
};

const STORAGE_KEY = "sheut.workbench-layout.v1";

export function loadWorkbenchLayout(
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): WorkbenchLayoutPreferences {
  if (!storage) return DEFAULT_WORKBENCH_LAYOUT;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!isRecord(parsed)) return DEFAULT_WORKBENCH_LAYOUT;
    const activityBarPosition =
      parsed.activityBarPosition === undefined
        ? side(parsed.primarySideBarPosition, "left")
        : side(parsed.activityBarPosition, "left");
    return {
      activityBarPosition,
      activityBarVisible: bool(parsed.activityBarVisible, true),
      centeredLayout: bool(parsed.centeredLayout, false),
      primarySideBarVisible: bool(parsed.primarySideBarVisible, true),
      secondarySideBarPosition: side(parsed.secondarySideBarPosition, "right"),
      secondarySideBarVisible: bool(parsed.secondarySideBarVisible, true),
    };
  } catch {
    return DEFAULT_WORKBENCH_LAYOUT;
  }
}

export function saveWorkbenchLayout(
  preferences: WorkbenchLayoutPreferences,
  storage: Pick<Storage, "setItem"> | null = browserStorage(),
) {
  storage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function side(value: unknown, fallback: WorkbenchSide): WorkbenchSide {
  return value === "left" || value === "right" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
