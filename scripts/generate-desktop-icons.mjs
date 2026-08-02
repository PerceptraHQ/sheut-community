import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlatformIconSvg } from "./desktop-icon-profiles.mjs";

const repository = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const destination = join(repository, "src-tauri", "icons");
const temporaryRoot = await mkdtemp(join(tmpdir(), "sheut-desktop-icons-"));

const platformOutputs = Object.freeze({
  linux: ["32x32.png", "64x64.png", "128x128.png", "128x128@2x.png", "icon.png"],
  macos: ["icon.icns"],
  windows: [
    "icon.ico",
    "StoreLogo.png",
    "Square30x30Logo.png",
    "Square44x44Logo.png",
    "Square71x71Logo.png",
    "Square89x89Logo.png",
    "Square107x107Logo.png",
    "Square142x142Logo.png",
    "Square150x150Logo.png",
    "Square284x284Logo.png",
    "Square310x310Logo.png",
  ],
});

function generateIconSet(source, output) {
  const result = spawnSync(
    "corepack",
    ["pnpm", "exec", "tauri", "icon", source, "--output", output],
    { cwd: repository, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Tauri icon generation failed");
  }
}

try {
  const canonicalLogo = await readFile(join(repository, "src", "assets", "sheut-logo.svg"), "utf8");
  await mkdir(destination, { recursive: true });

  for (const [platform, outputs] of Object.entries(platformOutputs)) {
    const platformRoot = join(temporaryRoot, platform);
    const source = join(platformRoot, `${platform}.svg`);
    const generated = join(platformRoot, "generated");
    await mkdir(platformRoot, { recursive: true });
    await writeFile(source, buildPlatformIconSvg(canonicalLogo, platform), "utf8");
    generateIconSet(source, generated);

    for (const name of outputs) {
      const generatedIcon = join(generated, name);
      if ((await stat(generatedIcon)).size === 0) {
        throw new Error(`Generated desktop icon is empty: ${platform}/${name}`);
      }
      await copyFile(generatedIcon, join(destination, name));
    }
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Generated rounded desktop icons for macOS, Windows, and Linux");
