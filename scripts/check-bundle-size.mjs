import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const STARTUP_GZIP_LIMIT_BYTES = 80 * 1024;
export const ICON_GZIP_LIMIT_BYTES = 5 * 1024;
export const EDITOR_ICON_GZIP_LIMIT_BYTES = 4 * 1024;
export const GRAPH_GZIP_LIMIT_BYTES = 75 * 1024;
export const GRAPH_WORKER_GZIP_LIMIT_BYTES = 20 * 1024;
export const STIX_ICON_REGISTRY_GZIP_LIMIT_BYTES = 8 * 1024;

export function collectStartupChunks(manifest) {
  const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry === true);
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one startup entry, found ${entries.length}`);
  }

  const files = new Set();
  const visited = new Set();

  function visit(key) {
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const chunk = manifest[key];
    if (!chunk) {
      throw new Error(`Manifest import is missing: ${key}`);
    }
    if (chunk.file?.endsWith(".js")) {
      files.add(chunk.file);
    }
    for (const importedKey of chunk.imports ?? []) {
      visit(importedKey);
    }
  }

  visit(entries[0][0]);
  return files;
}

export function verifyBundleBudgets(
  manifest,
  gzipBytesByFile,
  {
    startupLimitBytes = STARTUP_GZIP_LIMIT_BYTES,
    iconLimitBytes = ICON_GZIP_LIMIT_BYTES,
    editorIconLimitBytes = EDITOR_ICON_GZIP_LIMIT_BYTES,
    graphLimitBytes = GRAPH_GZIP_LIMIT_BYTES,
    graphWorkerLimitBytes = GRAPH_WORKER_GZIP_LIMIT_BYTES,
    stixIconRegistryLimitBytes = STIX_ICON_REGISTRY_GZIP_LIMIT_BYTES,
  } = {},
) {
  const startupFiles = collectStartupChunks(manifest);
  const iconFiles = Object.values(manifest)
    .filter(
      (chunk) =>
        chunk.name === "icons" || /(?:^|\/)icons(?:-[a-zA-Z0-9_]+)?\.js$/.test(chunk.file ?? ""),
    )
    .map((chunk) => chunk.file);
  const editorIconFiles = Object.values(manifest)
    .filter((chunk) => chunk.name === "editor-icons")
    .map((chunk) => chunk.file);
  const graphEntryFiles = Object.values(manifest)
    .filter((chunk) => chunk.name === "GraphWorkspace")
    .map((chunk) => chunk.file);
  const graphIconFiles = Object.values(manifest)
    .filter((chunk) => chunk.name === "graph-icons")
    .map((chunk) => chunk.file);
  const graphWorkerFiles = [...gzipBytesByFile.keys()].filter((file) =>
    /(?:^|\/)graph-layout\.worker-[a-zA-Z0-9_-]+\.js$/.test(file),
  );
  const stixIconRegistryFiles = Object.values(manifest)
    .filter((chunk) => chunk.name === "stix-icon-urls")
    .map((chunk) => chunk.file);

  if (iconFiles.length === 0) {
    throw new Error("Build manifest has no isolated icon chunk");
  }
  if (iconFiles.some((file) => !startupFiles.has(file))) {
    throw new Error("The icon chunk must be a static named import in the startup graph");
  }
  if (editorIconFiles.length === 0) {
    throw new Error("Build manifest has no isolated editor icon chunk");
  }
  if (editorIconFiles.some((file) => startupFiles.has(file))) {
    throw new Error("The editor icon chunk must stay out of the startup graph");
  }
  if (graphEntryFiles.length !== 1) {
    throw new Error(`Expected one lazy GraphWorkspace chunk, found ${graphEntryFiles.length}`);
  }
  if (startupFiles.has(graphEntryFiles[0])) {
    throw new Error("The graph workspace must stay out of the startup graph");
  }
  if (graphIconFiles.length === 0) {
    throw new Error("Build manifest has no isolated graph icon chunk");
  }
  if (graphIconFiles.some((file) => startupFiles.has(file))) {
    throw new Error("Graph-only icons must stay out of the startup graph");
  }
  if (graphWorkerFiles.length !== 1) {
    throw new Error(`Expected one graph layout worker, found ${graphWorkerFiles.length}`);
  }
  if (stixIconRegistryFiles.length !== 1) {
    throw new Error(`Expected one STIX icon registry chunk, found ${stixIconRegistryFiles.length}`);
  }
  if (stixIconRegistryFiles.some((file) => startupFiles.has(file))) {
    throw new Error("The STIX icon registry must stay out of the startup graph");
  }

  const bytesFor = (file) => {
    const bytes = gzipBytesByFile.get(file);
    if (bytes === undefined) {
      throw new Error(`Missing gzip measurement for ${file}`);
    }
    return bytes;
  };

  const startupGzipBytes = [...startupFiles].reduce((total, file) => total + bytesFor(file), 0);
  const iconGzipBytes = [...new Set(iconFiles)].reduce((total, file) => total + bytesFor(file), 0);
  const editorIconGzipBytes = [...new Set(editorIconFiles)].reduce(
    (total, file) => total + bytesFor(file),
    0,
  );
  const graphGzipBytes = [...new Set([...graphEntryFiles, ...graphIconFiles])].reduce(
    (total, file) => total + bytesFor(file),
    0,
  );
  const graphWorkerGzipBytes = bytesFor(graphWorkerFiles[0]);
  const stixIconRegistryGzipBytes = bytesFor(stixIconRegistryFiles[0]);

  const violations = [];
  if (startupGzipBytes > startupLimitBytes) {
    violations.push(`startup ${startupGzipBytes} > ${startupLimitBytes}`);
  }
  if (iconGzipBytes > iconLimitBytes) {
    violations.push(`icon ${iconGzipBytes} > ${iconLimitBytes}`);
  }
  if (editorIconGzipBytes > editorIconLimitBytes) {
    violations.push(`editor icon ${editorIconGzipBytes} > ${editorIconLimitBytes}`);
  }
  if (graphGzipBytes > graphLimitBytes) {
    violations.push(`graph ${graphGzipBytes} > ${graphLimitBytes}`);
  }
  if (graphWorkerGzipBytes > graphWorkerLimitBytes) {
    violations.push(`graph worker ${graphWorkerGzipBytes} > ${graphWorkerLimitBytes}`);
  }
  if (stixIconRegistryGzipBytes > stixIconRegistryLimitBytes) {
    violations.push(
      `STIX icon registry ${stixIconRegistryGzipBytes} > ${stixIconRegistryLimitBytes}`,
    );
  }
  if (violations.length > 0) {
    throw new Error(`Bundle budget exceeded: ${violations.join("; ")}`);
  }

  return {
    startupGzipBytes,
    iconGzipBytes,
    editorIconGzipBytes,
    graphGzipBytes,
    graphWorkerGzipBytes,
    stixIconRegistryGzipBytes,
  };
}

async function main() {
  const projectRoot = resolve(import.meta.dirname, "..");
  const distDirectory = resolve(projectRoot, "dist");
  const manifest = JSON.parse(
    await readFile(resolve(distDirectory, ".vite", "manifest.json"), "utf8"),
  );
  const files = new Set(
    Object.values(manifest)
      .map((chunk) => chunk.file)
      .filter((file) => file?.endsWith(".js")),
  );
  for (const file of await readdir(resolve(distDirectory, "assets"))) {
    if (file.endsWith(".js")) files.add(`assets/${file}`);
  }
  const gzipBytesByFile = new Map();
  for (const file of files) {
    const source = await readFile(resolve(distDirectory, file));
    gzipBytesByFile.set(file, gzipSync(source, { level: 9 }).byteLength);
  }

  const result = verifyBundleBudgets(manifest, gzipBytesByFile);
  process.stdout.write(
    `Bundle budgets: startup ${result.startupGzipBytes}/${STARTUP_GZIP_LIMIT_BYTES} bytes gzip; icons ${result.iconGzipBytes}/${ICON_GZIP_LIMIT_BYTES} bytes gzip; editor icons ${result.editorIconGzipBytes}/${EDITOR_ICON_GZIP_LIMIT_BYTES} bytes gzip; graph ${result.graphGzipBytes}/${GRAPH_GZIP_LIMIT_BYTES} bytes gzip; graph worker ${result.graphWorkerGzipBytes}/${GRAPH_WORKER_GZIP_LIMIT_BYTES} bytes gzip; STIX icon registry ${result.stixIconRegistryGzipBytes}/${STIX_ICON_REGISTRY_GZIP_LIMIT_BYTES} bytes gzip\n`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await main();
}
