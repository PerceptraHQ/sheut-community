import { join } from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import {
  buildFrontendEnvironment,
  buildFrontendSteps,
  runFrontendBuild,
} from "./build-frontend.mjs";

describe("cross-platform frontend build", () => {
  it("applies bounded build defaults without overwriting explicit environment values", () => {
    expect(buildFrontendEnvironment({ PATH: "test-path" })).toMatchObject({
      GOMAXPROCS: "2",
      PATH: "test-path",
      UV_THREADPOOL_SIZE: "2",
    });
    expect(buildFrontendEnvironment({ GOMAXPROCS: "6", UV_THREADPOOL_SIZE: "8" })).toMatchObject({
      GOMAXPROCS: "6",
      UV_THREADPOOL_SIZE: "8",
    });
  });

  it("runs Vite and the bundle gate directly through Node without a platform shell", () => {
    const repository = join("workspace", "sheut");
    const steps = buildFrontendSteps(repository);

    expect(steps).toEqual([
      {
        args: [join(repository, "node_modules", "vite", "bin", "vite.js"), "build"],
        command: process.execPath,
      },
      {
        args: [join(repository, "scripts", "check-bundle-size.mjs")],
        command: process.execPath,
      },
    ]);
  });

  it("stops after the first failed build step", () => {
    const repository = join("workspace", "sheut");
    const spawn = vi.fn().mockReturnValueOnce({ status: 17 });

    expect(runFrontendBuild({ repository, spawn })).toBe(17);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [join(repository, "node_modules", "vite", "bin", "vite.js"), "build"],
      expect.objectContaining({
        cwd: repository,
        shell: false,
        stdio: "inherit",
      }),
    );
  });
});
