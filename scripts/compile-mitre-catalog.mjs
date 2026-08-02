import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const allowedCatalogs = new Set(["attack_enterprise", "attack_mobile", "attack_ics", "atlas"]);
const attackId = /^T\d{4}(?:\.\d{3})?$/u;
const attackTacticId = /^TA\d{4}$/u;
const atlasId = /^AML\.T\d{4}(?:\.\d{3})?$/u;
const atlasTacticId = /^AML\.TA\d{4}$/u;

export function verifySource(source, expectedSha256) {
  const digest = createHash("sha256").update(source).digest("hex");
  if (digest !== expectedSha256) {
    throw new Error(`MITRE source digest mismatch: expected ${expectedSha256}, received ${digest}`);
  }
  return digest;
}

export function compileStixCatalog(bundle, source) {
  if (!allowedCatalogs.has(source.catalog)) throw new Error("Unsupported MITRE catalog");
  if (bundle?.type !== "bundle" || !Array.isArray(bundle.objects)) {
    throw new Error("MITRE source must be a STIX Bundle");
  }
  if (bundle.objects.length > 100_000) throw new Error("MITRE source exceeds object limit");

  const atlas = source.catalog === "atlas";
  const techniquePattern = atlas ? atlasId : attackId;
  const tacticPattern = atlas ? atlasTacticId : attackTacticId;
  const matrices = bundle.objects.filter(
    (object) => object?.type === "x-mitre-matrix" && !inactive(object),
  );
  if (matrices.length !== 1 || !Array.isArray(matrices[0].tactic_refs)) {
    throw new Error("MITRE source must contain one active ordered matrix");
  }
  const tacticOrder = new Map();
  for (const [index, reference] of matrices[0].tactic_refs.entries()) {
    const id = boundedIdentifier(reference, 200, "matrix tactic reference");
    if (tacticOrder.has(id)) throw new Error(`Duplicate matrix tactic reference: ${id}`);
    tacticOrder.set(id, index);
  }
  if (tacticOrder.size === 0 || tacticOrder.size > 256) {
    throw new Error("MITRE matrix tactic count is invalid");
  }
  const tactics = [];
  const tacticIds = new Set();
  const tacticIdByShortName = new Map();
  const tacticOrderByExternalId = new Map();

  for (const object of bundle.objects) {
    if (object?.type !== "x-mitre-tactic" || inactive(object)) continue;
    const sourceId = boundedIdentifier(object.id, 200, "tactic STIX identifier");
    const order = tacticOrder.get(sourceId);
    if (order === undefined) throw new Error(`Tactic ${sourceId} is not in the active matrix`);
    const id = externalId(object, tacticPattern);
    if (!id) continue;
    if (tacticIds.has(id)) throw new Error(`Duplicate tactic identifier: ${id}`);
    const name = boundedText(object.name, 200, "tactic name");
    const shortName = boundedIdentifier(object.x_mitre_shortname, 100, "tactic short name");
    tactics.push({
      id,
      name,
      shortName,
      description: boundedText(object.description ?? name, 64_000, "tactic description"),
    });
    tacticIds.add(id);
    tacticIdByShortName.set(shortName, id);
    tacticOrderByExternalId.set(id, order);
  }
  if (tactics.length !== tacticOrder.size) {
    throw new Error("Active matrix refers to an unavailable tactic");
  }

  const techniques = [];
  const techniqueIds = new Set();
  for (const object of bundle.objects) {
    if (object?.type !== "attack-pattern" || inactive(object)) continue;
    const id = externalId(object, techniquePattern);
    if (!id) continue;
    if (techniqueIds.has(id)) throw new Error(`Duplicate technique identifier: ${id}`);
    const phaseNames = Array.isArray(object.kill_chain_phases)
      ? object.kill_chain_phases.map((phase) => phase?.phase_name).filter(Boolean)
      : [];
    const objectTacticIds = [
      ...new Set(
        phaseNames.map((phase) => {
          const tacticId = tacticIdByShortName.get(phase);
          if (!tacticId) throw new Error(`Technique ${id} refers to unknown tactic ${phase}`);
          return tacticId;
        }),
      ),
    ].sort();
    const platforms = Array.isArray(object.x_mitre_platforms)
      ? [
          ...new Set(object.x_mitre_platforms.map((value) => boundedText(value, 100, "platform"))),
        ].sort()
      : [];
    techniques.push({
      id,
      name: boundedText(object.name, 300, "technique name"),
      description: boundedText(object.description ?? object.name, 64_000, "technique description"),
      tacticIds: objectTacticIds,
      platforms,
      parentId: /\.\d{3}$/u.test(id) ? id.slice(0, -4) : null,
    });
    techniqueIds.add(id);
  }

  tactics.sort(
    (left, right) => tacticOrderByExternalId.get(left.id) - tacticOrderByExternalId.get(right.id),
  );
  techniques.sort((left, right) => left.id.localeCompare(right.id));
  if (tactics.length === 0 || techniques.length === 0) {
    throw new Error("MITRE source contains no active tactics or techniques");
  }
  for (const technique of techniques) {
    if (technique.parentId && !techniqueIds.has(technique.parentId)) {
      throw new Error(`Technique ${technique.id} has unavailable parent ${technique.parentId}`);
    }
  }

  return {
    schemaVersion: 2,
    catalog: source.catalog,
    version: boundedIdentifier(source.version, 32, "catalog version"),
    source: {
      url: boundedText(source.sourceUrl, 2_048, "source URL"),
      sha256: source.sha256,
    },
    tactics,
    techniques,
  };
}

function inactive(object) {
  return object.revoked === true || object.x_mitre_deprecated === true;
}

function externalId(object, pattern) {
  if (!Array.isArray(object.external_references)) return null;
  return object.external_references
    .map((reference) => reference?.external_id)
    .find((id) => typeof id === "string" && pattern.test(id));
}

function boundedText(value, maxCharacters, label) {
  if (typeof value !== "string") throw new Error(`Invalid ${label}`);
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (
    normalized.length === 0 ||
    Array.from(normalized).length > maxCharacters ||
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint < 32 && ![9, 10].includes(codePoint);
    })
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function boundedIdentifier(value, maxCharacters, label) {
  const normalized = boundedText(value, maxCharacters, label);
  if (/\s/u.test(normalized)) throw new Error(`Invalid ${label}`);
  return normalized;
}

async function main() {
  const sourceDirectory = process.argv[2];
  const outputDirectory = process.argv[3];
  if (!sourceDirectory || !outputDirectory) {
    throw new Error(
      "Usage: node scripts/compile-mitre-catalog.mjs <source-directory> <output-directory>",
    );
  }
  const projectRoot = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(
    await readFile(resolve(projectRoot, "scripts/mitre-catalog-sources.json"), "utf8"),
  );
  await mkdir(resolve(outputDirectory), { recursive: true });
  for (const source of manifest.sources) {
    const bytes = await readFile(resolve(sourceDirectory, source.file));
    verifySource(bytes, source.sha256);
    const catalog = compileStixCatalog(JSON.parse(bytes.toString("utf8")), source);
    await writeFile(resolve(outputDirectory, source.output), `${JSON.stringify(catalog)}\n`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) await main();
