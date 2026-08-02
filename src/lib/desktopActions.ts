import { isReportHelpTopicId, type ReportHelpTopicId } from "./reportHelpIds";

export const DESKTOP_ACTION_EVENT = "sheut://desktop-action";
export const WORKSPACE_ACTION_EVENT = "sheut:workspace-action";

export const DESKTOP_ACTION_IDS = [
  "file.new-report",
  "file.save",
  "file.publish",
  "file.lock-project",
  "view.command-palette",
  "view.overview",
  "view.documents",
  "view.intelligence",
  "view.evidence",
  "view.mitre",
  "view.graph",
  "view.settings",
  "view.toggle-primary-sidebar",
  "view.toggle-secondary-sidebar",
  "view.toggle-zen",
  "help.guides",
  "help.guide.investigations-and-analyst-notes",
  "help.guide.threat-actor-profile",
  "help.guide.intrusion-analysis",
  "help.guide.campaign-report",
  "help.guide.executive-report",
  "help.guide.blank-guided-report",
  "help.guide.illicit-ecosystem-report",
  "help.about",
] as const;

export type DesktopActionId = (typeof DESKTOP_ACTION_IDS)[number];
export type WorkspaceActionId = "file.new-report" | "file.save" | "file.publish";

interface ShortcutEvent {
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

const desktopActionIds = new Set<string>(DESKTOP_ACTION_IDS);

export function isDesktopActionId(value: unknown): value is DesktopActionId {
  return typeof value === "string" && desktopActionIds.has(value);
}

export function desktopActionFromKeyboardEvent(event: ShortcutEvent): DesktopActionId | null {
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = event.key.toLocaleLowerCase("en");
  if (key === "s" && !event.shiftKey) return "file.save";
  if (key === "p" && event.shiftKey) return "file.publish";
  if (key === "n" && event.shiftKey) return "file.new-report";
  if (key === "k" && !event.shiftKey) return "view.command-palette";
  return null;
}

export function helpTopicFromDesktopAction(action: DesktopActionId): ReportHelpTopicId | null {
  const prefix = "help.guide.";
  if (!action.startsWith(prefix)) return null;
  const topic = action.slice(prefix.length);
  return isReportHelpTopicId(topic) ? topic : null;
}

export function dispatchWorkspaceAction(action: WorkspaceActionId): void {
  window.dispatchEvent(
    new CustomEvent<WorkspaceActionId>(WORKSPACE_ACTION_EVENT, { detail: action }),
  );
}

export function isWorkspaceActionEvent(event: Event): event is CustomEvent<WorkspaceActionId> {
  return (
    event instanceof CustomEvent &&
    (event.detail === "file.new-report" ||
      event.detail === "file.save" ||
      event.detail === "file.publish")
  );
}
