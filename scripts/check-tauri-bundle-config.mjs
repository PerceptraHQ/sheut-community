import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const semanticVersion = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

export function validateWindowsBundleVersion(applicationVersion, windowsVersion) {
  const application = semanticVersion.exec(applicationVersion);
  const windows = semanticVersion.exec(windowsVersion);
  if (!application || !windows) throw new Error("Tauri bundle versions must be semantic versions");

  if (application.slice(1, 4).join(".") !== windows.slice(1, 4).join(".")) {
    throw new Error("The Windows bundle override must use the same release core as the app");
  }

  const prerelease = windows[4];
  if (prerelease !== undefined && (!/^\d+$/u.test(prerelease) || Number(prerelease) > 65_535)) {
    throw new Error(
      "The Windows MSI bundle version needs one numeric prerelease identifier from 0 through 65535",
    );
  }
}

async function main() {
  const repository = new URL("../", import.meta.url);
  const [packageJson, tauriConfig, windowsConfig] = await Promise.all([
    readFile(new URL("package.json", repository), "utf8"),
    readFile(new URL("src-tauri/tauri.conf.json", repository), "utf8"),
    readFile(new URL("src-tauri/tauri.windows.conf.json", repository), "utf8"),
  ]).then((files) => files.map((file) => JSON.parse(file)));

  if (packageJson.version !== tauriConfig.version) {
    throw new Error("package.json and the base Tauri configuration must use the same app version");
  }
  validateWindowsBundleVersion(tauriConfig.version, windowsConfig.version);
  console.log(
    `Tauri bundle versions: app ${tauriConfig.version}; Windows MSI ${windowsConfig.version}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
