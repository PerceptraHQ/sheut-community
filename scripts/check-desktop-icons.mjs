import { access, readFile, stat } from "node:fs/promises";
import { buildPlatformIconSvg, DESKTOP_ICON_PROFILES } from "./desktop-icon-profiles.mjs";

const repository = new URL("../", import.meta.url);
const requiredIcons = [
  "32x32.png",
  "64x64.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.icns",
  "icon.ico",
  "StoreLogo.png",
  "Square44x44Logo.png",
  "Square150x150Logo.png",
  "Square310x310Logo.png",
];

for (const name of requiredIcons) {
  const icon = new URL(`src-tauri/icons/${name}`, repository);
  await access(icon);
  if ((await stat(icon)).size === 0) throw new Error(`Desktop icon is empty: ${name}`);
}

for (const platform of ["android", "ios"]) {
  try {
    await access(new URL(`src-tauri/icons/${platform}`, repository));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      continue;
    }
    throw error;
  }
  throw new Error(`Mobile icon directory must not exist: src-tauri/icons/${platform}`);
}

const source = await readFile(new URL("src/assets/sheut-logo.svg", repository), "utf8");
if (!source.includes('viewBox="0 0 2334.000000 2334.000000"')) {
  throw new Error("src/assets/sheut-logo.svg must keep a square source canvas");
}
if (!source.includes('<rect width="2334" height="2334" fill="#000000"/>')) {
  throw new Error("src/assets/sheut-logo.svg must keep its solid black background");
}
if (!source.includes('fill="#ffffff"')) {
  throw new Error("src/assets/sheut-logo.svg must keep its white Sheut mark");
}

for (const platform of Object.keys(DESKTOP_ICON_PROFILES)) {
  const platformSource = buildPlatformIconSvg(source, platform);
  if (!platformSource.includes(`data-platform="${platform}"`)) {
    throw new Error(`Desktop icon profile is missing: ${platform}`);
  }
}

const rustEntryPoint = await readFile(new URL("src-tauri/src/lib.rs", repository), "utf8");
if (rustEntryPoint.includes("mobile_entry_point")) {
  throw new Error("Sheut is desktop-only; do not add a Tauri mobile entry point");
}

console.log(`Desktop icons: ${requiredIcons.length} required files; no mobile trees`);
