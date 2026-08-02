import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORKBENCH_LAYOUT,
  loadWorkbenchLayout,
  saveWorkbenchLayout,
} from "./workbenchLayout";

describe("workbench layout preferences", () => {
  it("accepts only bounded booleans and left/right positions", () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          activityBarPosition: "bottom",
          activityBarVisible: false,
          centeredLayout: true,
          primarySideBarPosition: "right",
          primarySideBarVisible: "yes",
          secondarySideBarPosition: "left",
          secondarySideBarVisible: false,
        }),
    };

    expect(loadWorkbenchLayout(storage)).toEqual({
      activityBarPosition: "left",
      activityBarVisible: false,
      centeredLayout: true,
      primarySideBarVisible: true,
      secondarySideBarPosition: "left",
      secondarySideBarVisible: false,
    });
  });

  it("migrates the old primary-sidebar position into one coupled primary dock", () => {
    const storage = {
      getItem: () => JSON.stringify({ primarySideBarPosition: "right" }),
    };

    expect(loadWorkbenchLayout(storage).activityBarPosition).toBe("right");
  });

  it("falls back when persisted JSON is missing or malformed", () => {
    expect(loadWorkbenchLayout({ getItem: () => "{" })).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    expect(loadWorkbenchLayout({ getItem: () => null })).toEqual(DEFAULT_WORKBENCH_LAYOUT);
  });

  it("writes one versioned local preference value", () => {
    const setItem = vi.fn();
    saveWorkbenchLayout(DEFAULT_WORKBENCH_LAYOUT, { setItem });
    expect(setItem).toHaveBeenCalledWith(
      "sheut.workbench-layout.v1",
      JSON.stringify(DEFAULT_WORKBENCH_LAYOUT),
    );
  });
});
