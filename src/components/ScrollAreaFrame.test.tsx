import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScrollAreaFrame } from "./ScrollAreaFrame";

describe("ScrollAreaFrame", () => {
  it("does not let a horizontal child scroller capture vertical wheel input", () => {
    const { container } = render(
      <ScrollAreaFrame horizontal vertical={false}>
        <div>Matrix columns</div>
      </ScrollAreaFrame>,
    );

    expect(screen.getByText("Matrix columns")).toBeVisible();
    const viewport = container.querySelector(".sheut-scroll-viewport");
    expect(viewport).toHaveStyle({
      overflowX: "scroll",
      overflowY: "hidden",
      overscrollBehaviorY: "auto",
    });
  });

  it("keeps a vertical panel from creating a hidden horizontal scroll axis", () => {
    const { container } = render(<ScrollAreaFrame>Properties</ScrollAreaFrame>);

    expect(screen.getByText("Properties")).toBeVisible();
    const viewport = container.querySelector(".sheut-scroll-viewport");
    expect(viewport).toHaveStyle({
      overflowX: "hidden",
      overflowY: "scroll",
      overscrollBehaviorY: "contain",
    });
  });
});
