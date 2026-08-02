import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogDescription } from "./CatalogDescription";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

describe("catalog description links", () => {
  beforeEach(() => openUrl.mockReset().mockResolvedValue(undefined));

  it("renders approved MITRE Markdown links and opens them outside the webview", () => {
    render(
      <CatalogDescription description="Use [Valid Accounts](https://attack.mitre.org/techniques/T1078) for remote access." />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Technique description" }));
    fireEvent.click(screen.getByRole("link", { name: "Valid Accounts" }));
    expect(openUrl).toHaveBeenCalledWith("https://attack.mitre.org/techniques/T1078");
    expect(screen.queryByText(/\[Valid Accounts\]/u)).not.toBeInTheDocument();
  });

  it("does not activate untrusted links or interpret raw HTML", () => {
    render(
      <CatalogDescription
        description={'See [payload](javascript:alert(1)) and <img src=x onerror="alert(1)">.'}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Technique description" }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/payload/u)).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders MITRE inline code without interpreting arbitrary HTML", () => {
    render(
      <CatalogDescription description="Run `at` and inspect the <code>at.allow</code> file before <strong>execution</strong>." />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Technique description" }));
    expect(screen.getByText("at", { selector: "code" })).toBeVisible();
    expect(screen.getByText("at.allow", { selector: "code" })).toBeVisible();
    expect(document.querySelector("strong")).toBeNull();
  });
});
