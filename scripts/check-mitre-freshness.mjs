import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const officialReleases = Object.freeze({
  attack: "https://api.github.com/repos/mitre-attack/attack-stix-data/releases/latest",
  atlas: "https://api.github.com/repos/mitre-atlas/atlas-data/releases/latest",
});

function normalizedVersion(value, label) {
  if (typeof value !== "string") throw new Error(`${label} release tag is missing`);
  const version = value.startsWith("v") ? value.slice(1) : value;
  if (!/^[0-9]{1,4}(?:\.[0-9]{1,4}){1,2}$/u.test(version)) {
    throw new Error(`${label} release tag is malformed`);
  }
  return version;
}

export function assertCatalogFreshness(manifest, releases) {
  if (!manifest || !Array.isArray(manifest.sources)) {
    throw new Error("MITRE catalog source manifest is malformed");
  }
  const attackCatalogs = ["attack_enterprise", "attack_mobile", "attack_ics"];
  const attackVersions = attackCatalogs.map((catalog) => {
    const matches = manifest.sources.filter((source) => source?.catalog === catalog);
    if (matches.length !== 1) throw new Error(`MITRE manifest must define ${catalog} once`);
    return normalizedVersion(matches[0].version, catalog);
  });
  if (new Set(attackVersions).size !== 1) {
    throw new Error("All ATT&CK domains must be pinned to the same release");
  }
  const atlasMatches = manifest.sources.filter((source) => source?.catalog === "atlas");
  if (atlasMatches.length !== 1) throw new Error("MITRE manifest must define atlas once");

  const pinnedAttack = attackVersions[0];
  const pinnedAtlas = normalizedVersion(atlasMatches[0].version, "ATLAS");
  const latestAttack = normalizedVersion(releases.attack, "ATT&CK");
  const latestAtlas = normalizedVersion(releases.atlas, "ATLAS");
  if (pinnedAttack !== latestAttack) {
    throw new Error(
      `ATT&CK catalogs are pinned to ${pinnedAttack} but the official latest release is ${latestAttack}`,
    );
  }
  if (pinnedAtlas !== latestAtlas) {
    throw new Error(
      `ATLAS is pinned to ${pinnedAtlas} but the official latest release is ${latestAtlas}`,
    );
  }
  return { attack: pinnedAttack, atlas: pinnedAtlas };
}

async function latestTag(url, label) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "sheut-community-release-gate",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers, redirect: "error" });
  if (!response.ok) throw new Error(`${label} release lookup failed with HTTP ${response.status}`);
  const body = await response.json();
  if (!body || typeof body.tag_name !== "string") {
    throw new Error(`${label} release response is malformed`);
  }
  return body.tag_name;
}

async function main() {
  const manifest = JSON.parse(
    await readFile(new URL("./mitre-catalog-sources.json", import.meta.url), "utf8"),
  );
  const [attack, atlas] = await Promise.all([
    latestTag(officialReleases.attack, "ATT&CK"),
    latestTag(officialReleases.atlas, "ATLAS"),
  ]);
  const current = assertCatalogFreshness(manifest, { attack, atlas });
  console.log(`MITRE freshness: ATT&CK ${current.attack}, ATLAS ${current.atlas}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
