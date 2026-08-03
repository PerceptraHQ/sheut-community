import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function validateReleaseTag(tag, applicationVersion) {
  if (tag !== `v${applicationVersion}`) {
    throw new Error(`Release tag ${tag} must match app version v${applicationVersion}`);
  }
}

async function main() {
  const repository = new URL("../", import.meta.url);
  const packageJson = JSON.parse(await readFile(new URL("package.json", repository), "utf8"));
  const tag = process.argv[2];
  validateReleaseTag(tag, packageJson.version);
  console.log(`Release tag matches app version: ${tag}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
