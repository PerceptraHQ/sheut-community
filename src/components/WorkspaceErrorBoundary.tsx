import { Button } from "@base-ui/react/button";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface WorkspaceErrorBoundaryProps {
  children: ReactNode;
  onLeave: () => void;
}

interface WorkspaceErrorBoundaryState {
  failed: boolean;
  code: string;
  reason: string;
  componentStack: string;
}

const IDENTIFIER_PATTERN =
  /\b(?:[a-z][a-z0-9-]*--)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const LOCAL_PATH_PATTERN = /(?:\/[\w.@+-]+){2,}(?:\.[\w-]+)?/gu;
const MAX_REASON_CHARACTERS = 240;
const MAX_STACK_CHARACTERS = 600;

export function sanitizeComponentStack(componentStack: string | null | undefined): string {
  return (componentStack ?? "")
    .replace(LOCAL_PATH_PATTERN, "[local path]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_STACK_CHARACTERS);
}

export function sanitizeWorkspaceError(error: unknown): { code: string; reason: string } {
  const raw = error instanceof Error ? error.message : "Unknown workspace rendering failure";
  const printable = Array.from(raw, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  }).join("");
  const reason = printable
    .replace(IDENTIFIER_PATTERN, "[local identifier]")
    .replace(LOCAL_PATH_PATTERN, "[local path]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_REASON_CHARACTERS);
  const safeReason = reason || "Unknown workspace rendering failure";
  let hash = 0x811c9dc5;
  for (const character of safeReason) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return {
    code: (hash >>> 0).toString(16).toUpperCase().padStart(8, "0"),
    reason: safeReason,
  };
}

export class WorkspaceErrorBoundary extends Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  state: WorkspaceErrorBoundaryState = {
    failed: false,
    code: "00000000",
    reason: "",
    componentStack: "",
  };

  static getDerivedStateFromError(error: unknown): WorkspaceErrorBoundaryState {
    return { failed: true, ...sanitizeWorkspaceError(error), componentStack: "" };
  }

  componentDidCatch(_error: unknown, info: ErrorInfo) {
    const componentStack = sanitizeComponentStack(info.componentStack);
    if (componentStack && componentStack !== this.state.componentStack) {
      this.setState({ componentStack });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="grid h-full min-h-72 place-items-center p-8 text-center" role="alert">
        <div className="max-w-md">
          <p className="m-0 text-[11px] text-danger uppercase tracking-[0.12em]">
            Workspace unavailable
          </p>
          <h1 className="mt-2 mb-0 text-lg font-semibold">This workspace could not be rendered</h1>
          <p className="mt-2 mb-0 text-copy-muted text-sm leading-6">
            Your local project data is unchanged. Return to the project overview and try again.
          </p>
          <div className="mt-4 rounded-sm border border-panel-border bg-panel-deep p-3 text-left">
            <p className="m-0 font-mono text-[11px] text-copy-faint">
              Diagnostic {this.state.code}
            </p>
            <p className="mt-1.5 mb-0 select-text font-mono text-[11px] text-copy-secondary leading-5">
              {this.state.reason}
            </p>
            {this.state.componentStack ? (
              <p className="mt-2 mb-0 select-text border-panel-border border-t pt-2 font-mono text-[11px] text-copy-faint leading-5">
                {this.state.componentStack}
              </p>
            ) : null}
          </div>
          <Button className="control-button mt-5" type="button" onClick={this.props.onLeave}>
            Return to project overview
          </Button>
        </div>
      </section>
    );
  }
}
