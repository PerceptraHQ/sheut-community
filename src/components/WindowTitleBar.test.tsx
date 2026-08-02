import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { DEFAULT_WORKBENCH_LAYOUT } from "../lib/workbenchLayout";
import { WindowTitleBar } from "./WindowTitleBar";

const windowApi = vi.hoisted(() => ({
  close: vi.fn(() => Promise.resolve()),
  isFullscreen: vi.fn(() => Promise.resolve(false)),
  minimize: vi.fn(() => Promise.resolve()),
  setFullscreen: vi.fn(() => Promise.resolve()),
  startDragging: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => windowApi }));

beforeEach(() => vi.clearAllMocks());

it("keeps the title bar focused on project search and window actions", () => {
  render(
    <WindowTitleBar
      closeBlocked={false}
      layout={DEFAULT_WORKBENCH_LAYOUT}
      onLayoutChange={vi.fn()}
      onOpenSearchResult={vi.fn()}
      onZenModeChange={vi.fn()}
      projectId={null}
      projectName="Operation Northwind"
      searchDisabled={false}
      zenMode={false}
    />,
  );

  const titleBar = screen.getByRole("banner");
  expect(within(titleBar).queryByRole("img", { name: "Sheut" })).not.toBeInTheDocument();
  expect(within(titleBar).queryByText("SHEUT")).not.toBeInTheDocument();
  expect(within(titleBar).getByRole("combobox", { name: "Search project data" })).toBeVisible();
  expect(within(titleBar).getByRole("group", { name: "Title bar actions" })).toContainElement(
    screen.getByRole("button", { name: "Customize workbench layout" }),
  );
});

it("starts native window dragging from the title surface with the primary pointer", async () => {
  render(
    <WindowTitleBar
      closeBlocked={false}
      layout={DEFAULT_WORKBENCH_LAYOUT}
      onLayoutChange={vi.fn()}
      onOpenSearchResult={vi.fn()}
      onZenModeChange={vi.fn()}
      projectId={null}
      projectName="Operation Northwind"
      searchDisabled={false}
      zenMode={false}
    />,
  );

  const titleSurface = screen.getByRole("button", {
    name: "Window title; drag to move, double-click to fill or restore",
  });
  fireEvent.mouseDown(titleSurface, { button: 2, detail: 1 });
  fireEvent.mouseDown(titleSurface, { button: 0, detail: 1 });
  fireEvent.doubleClick(titleSurface);

  await waitFor(() => {
    expect(windowApi.startDragging).toHaveBeenCalledOnce();
    expect(windowApi.toggleMaximize).toHaveBeenCalledOnce();
  });
});

it("exposes allowlisted desktop window controls", async () => {
  const user = userEvent.setup();
  render(
    <WindowTitleBar
      closeBlocked={false}
      layout={DEFAULT_WORKBENCH_LAYOUT}
      onLayoutChange={vi.fn()}
      onOpenSearchResult={vi.fn()}
      onZenModeChange={vi.fn()}
      projectId={null}
      projectName="Operation Northwind"
      searchDisabled={false}
      zenMode={false}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Minimize" }));
  await user.click(screen.getByRole("button", { name: "Maximize or restore" }));
  await user.keyboard("{F11}");
  await user.click(screen.getByRole("button", { name: "Close Sheut" }));

  await waitFor(() => {
    expect(windowApi.minimize).toHaveBeenCalledOnce();
    expect(windowApi.toggleMaximize).toHaveBeenCalledOnce();
    expect(windowApi.isFullscreen).toHaveBeenCalled();
    expect(windowApi.setFullscreen).toHaveBeenCalledWith(true);
    expect(windowApi.close).toHaveBeenCalledOnce();
  });
  expect(screen.getByRole("banner")).toHaveAttribute("title", "Operation Northwind — Sheut");
});

it("hides custom macOS traffic lights while native full screen is active", async () => {
  const userAgent = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Macintosh");
  windowApi.isFullscreen.mockResolvedValueOnce(true);

  render(
    <WindowTitleBar
      closeBlocked={false}
      layout={DEFAULT_WORKBENCH_LAYOUT}
      onLayoutChange={vi.fn()}
      onOpenSearchResult={vi.fn()}
      onZenModeChange={vi.fn()}
      projectId={null}
      projectName={null}
      searchDisabled={false}
      zenMode={false}
    />,
  );

  await waitFor(() =>
    expect(screen.getByRole("banner")).toHaveAttribute("data-fullscreen", "true"),
  );
  expect(screen.queryByRole("button", { name: "Close Sheut" })).not.toBeInTheDocument();

  userAgent.mockRestore();
});

it("keeps unchecked layout-menu indicators mounted so labels do not collapse", async () => {
  const user = userEvent.setup();
  render(
    <WindowTitleBar
      closeBlocked={false}
      layout={{ ...DEFAULT_WORKBENCH_LAYOUT, activityBarVisible: false }}
      onLayoutChange={vi.fn()}
      onOpenSearchResult={vi.fn()}
      onZenModeChange={vi.fn()}
      projectId={null}
      projectName={null}
      searchDisabled={false}
      zenMode={false}
    />,
  );

  screen.getByRole("button", { name: "Customize workbench layout" }).focus();
  await user.keyboard("{Enter}");
  const activityBar = await screen.findByRole("menuitemcheckbox", { name: "Activity bar" });
  expect(activityBar.querySelector("[data-layout-indicator]")).not.toBeNull();
  expect(activityBar.querySelector("[data-layout-indicator]")).toHaveAttribute("data-unchecked");
});

it("exposes the Base UI layout menu and blocks close during a save", async () => {
  const onLayoutChange = vi.fn();
  render(
    <WindowTitleBar
      closeBlocked
      layout={DEFAULT_WORKBENCH_LAYOUT}
      onLayoutChange={onLayoutChange}
      onOpenSearchResult={vi.fn()}
      onZenModeChange={vi.fn()}
      projectId={null}
      projectName={null}
      searchDisabled={false}
      zenMode={false}
    />,
  );

  expect(screen.getByRole("button", { name: /Wait for the current save/u })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Customize workbench layout" })).toHaveAttribute(
    "aria-haspopup",
    "menu",
  );
  const user = userEvent.setup();
  screen.getByRole("button", { name: "Customize workbench layout" }).focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByText("Primary dock position")).toBeVisible();
  expect(screen.queryByText("Primary sidebar position")).not.toBeInTheDocument();
  await waitFor(() => expect(onLayoutChange).toHaveBeenCalledWith(DEFAULT_WORKBENCH_LAYOUT));
});
