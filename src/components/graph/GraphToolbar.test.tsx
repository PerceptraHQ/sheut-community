import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GraphToolbar } from "./GraphToolbar";

describe("GraphToolbar", () => {
  it("keeps movement history available in View mode", () => {
    const handler = vi.fn();
    render(
      <GraphToolbar
        mode="view"
        query=""
        minimapVisible={true}
        focusMode={false}
        edgeKinds={["semantic", "visual", "draft"]}
        selectedCount={0}
        undoCount={1}
        redoCount={1}
        onQueryChange={handler}
        onModeChange={handler}
        onUndo={handler}
        onRedo={handler}
        onArrange={handler}
        onZoomIn={handler}
        onZoomOut={handler}
        onFitSelection={handler}
        onFitAll={handler}
        onReset={handler}
        onToggleMinimap={handler}
        onToggleFocusMode={handler}
        onEdgeKindsChange={handler}
        onTogglePinned={handler}
        onRemoveSelected={handler}
        onConnectSelected={handler}
        canConvertSelection={false}
        onConvertSelection={handler}
        onAddItems={handler}
      />,
    );

    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Switch to Build mode to add project items" }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
