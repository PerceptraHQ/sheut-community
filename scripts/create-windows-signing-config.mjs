import { writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

const azureEndpoint = /^https:\/\/[a-z0-9-]+\.codesigning\.azure\.net\/?$/u;
const azureName = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/u;

export function buildWindowsSigningConfig({ endpoint, account, profile }) {
  if (!azureEndpoint.test(endpoint) || !azureName.test(account) || !azureName.test(profile)) {
    throw new Error("Azure Artifact Signing configuration is missing or invalid");
  }
  return {
    bundle: {
      windows: {
        signCommand: `artifact-signing-cli -e ${endpoint.replace(/\/$/u, "")} -a ${account} -c ${profile} -d Sheut %1`,
      },
    },
  };
}

async function main() {
  const config = buildWindowsSigningConfig({
    endpoint: process.env.AZURE_ARTIFACT_SIGNING_ENDPOINT ?? "",
    account: process.env.AZURE_ARTIFACT_SIGNING_ACCOUNT ?? "",
    profile: process.env.AZURE_ARTIFACT_SIGNING_PROFILE ?? "",
  });
  const destination = new URL("../src-tauri/tauri.windows.signing.conf.json", import.meta.url);
  await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log("Created the Windows release signing configuration.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
