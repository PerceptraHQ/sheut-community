import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();

export function buildFrontendEnvironment(environment = process.env) {
  return {
    ...environment,
    GOMAXPROCS: environment.GOMAXPROCS ?? "2",
    UV_THREADPOOL_SIZE: environment.UV_THREADPOOL_SIZE ?? "2",
  };
}

export function buildFrontendSteps(repository = repositoryRoot) {
  return [
    {
      command: process.execPath,
      args: [join(repository, "node_modules", "vite", "bin", "vite.js"), "build"],
    },
    {
      command: process.execPath,
      args: [join(repository, "scripts", "check-bundle-size.mjs")],
    },
  ];
}

export function runFrontendBuild({
  environment = process.env,
  repository = repositoryRoot,
  spawn = spawnSync,
} = {}) {
  const buildEnvironment = buildFrontendEnvironment(environment);

  for (const step of buildFrontendSteps(repository)) {
    const result = spawn(step.command, step.args, {
      cwd: repository,
      env: buildEnvironment,
      shell: false,
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }

  return 0;
}

if (import.meta.main) {
  process.exitCode = runFrontendBuild();
}
