import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDITABLE_LIMIT_MS = 500;
const RUNS = 5;
const previewPort = await availablePort();
const debuggingPort = await availablePort();
const chromeData = await mkdtemp(join(tmpdir(), "sheut-chrome-"));
const chromeBinary = await findChrome();
const preview = spawn(
  "corepack",
  ["pnpm", "exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(previewPort)],
  { cwd: new URL("../", import.meta.url), stdio: ["ignore", "pipe", "pipe"] },
);
const chrome = spawn(
  chromeBinary,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${chromeData}`,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

const processErrors = [];
for (const [label, child] of [
  ["preview", preview],
  ["chrome", chrome],
]) {
  child.stderr.on("data", (data) => {
    const message = String(data).trim();
    if (message) {
      processErrors.push(`${label}: ${message}`);
      if (processErrors.length > 10) processErrors.shift();
    }
  });
}

let client;
try {
  await waitForUrl(`http://127.0.0.1:${previewPort}`);
  await waitForUrl(`http://127.0.0.1:${debuggingPort}/json/version`);
  const target = await fetch(
    `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${previewPort}`)}`,
    { method: "PUT" },
  ).then((response) => response.json());
  client = await connectCdp(target.webSocketDebuggerUrl);
  const browserErrors = [];
  client.on("Runtime.exceptionThrown", (event) =>
    browserErrors.push(event.exceptionDetails?.text ?? "Uncaught browser exception"),
  );
  client.on("Log.entryAdded", (event) => {
    if (event.entry?.level === "error") browserErrors.push(event.entry.text);
  });

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: tauriMockSource() });

  const measurements = [];
  for (let run = 0; run < RUNS; run += 1) {
    await client.send("Page.navigate", { url: `http://127.0.0.1:${previewPort}/?run=${run}` });
    await waitForExpression(client, `document.querySelector('h1')?.textContent === 'Open project'`);
    await evaluate(
      client,
      `Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === 'Unlock project')?.click()`,
    );
    await waitForExpression(
      client,
      `Array.from(document.querySelectorAll('button')).some((button) => button.getAttribute('aria-label') === 'Documents' && !button.disabled)`,
    );
    await waitForExpression(
      client,
      `performance.getEntriesByType('resource').some((entry) => entry.name.includes('DocumentEditor-'))`,
      5_000,
    );
    await evaluate(
      client,
      `Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === 'Documents')?.click()`,
    );
    await waitForExpression(
      client,
      `Array.from(document.querySelectorAll('button')).some((button) => button.textContent.includes('Reference investigation'))`,
    );
    const startedAt = await evaluate(client, "performance.now()");
    await evaluate(
      client,
      `Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Reference investigation'))?.click()`,
    );
    await waitForExpression(
      client,
      `document.querySelector('.ProseMirror[contenteditable="true"]') !== null`,
    );
    const readyAt = await evaluate(client, "performance.now()");
    measurements.push(readyAt - startedAt);
  }

  const toolbarContract = await evaluate(
    client,
    `(() => {
      const toolbar = document.querySelector('[role="toolbar"][aria-label="Document formatting"]');
      const buttons = Array.from(toolbar?.querySelectorAll('button') ?? []);
      return {
        present: toolbar !== null,
        tabStops: buttons.filter((button) => button.tabIndex === 0).length,
        pressedHeading: toolbar?.querySelector('[aria-label="Heading 1"]')?.getAttribute('data-pressed') === '',
        toggleGroups: toolbar?.querySelectorAll('[data-orientation="horizontal"] [data-pressed]').length ?? 0,
      };
    })()`,
  );
  if (
    !toolbarContract?.present ||
    toolbarContract.tabStops !== 1 ||
    !toolbarContract.pressedHeading ||
    toolbarContract.toggleGroups < 1
  ) {
    throw new Error(`Base UI toolbar contract failed: ${JSON.stringify(toolbarContract)}`);
  }
  await evaluate(
    client,
    `document.querySelector('[role="toolbar"] button[aria-label="Paragraph"]')?.focus()`,
  );
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
    nativeVirtualKeyCode: 124,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
    nativeVirtualKeyCode: 124,
  });
  const focusedToolbarControl = await evaluate(
    client,
    `document.activeElement?.getAttribute('aria-label')`,
  );
  if (focusedToolbarControl !== "Heading 1") {
    throw new Error(`Toolbar ArrowRight focused ${JSON.stringify(focusedToolbarControl)}`);
  }

  const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
  await writeFile("/private/tmp/sheut-editor-latency.png", Buffer.from(screenshot.data, "base64"));
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 960,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitForExpression(
    client,
    `document.querySelector('.editor-image-attachment img')?.naturalWidth === 4096`,
  );
  const imageLayout = await evaluate(
    client,
    `(() => {
      const figure = document.querySelector('.editor-image-attachment');
      const image = figure?.querySelector('img');
      if (!figure || !image) return null;
      const editor = document.querySelector('.ProseMirror');
      const toolbar = document.querySelector('[role="toolbar"][aria-label="Document formatting"]');
      return {
        figureContained: figure.scrollWidth <= figure.clientWidth,
        imageContained: image.getBoundingClientRect().width <= figure.getBoundingClientRect().width,
        pageContained: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        figureClientWidth: figure.clientWidth,
        figureScrollWidth: figure.scrollWidth,
        figureWidth: figure.getBoundingClientRect().width,
        imageWidth: image.getBoundingClientRect().width,
        editorClientWidth: editor?.clientWidth,
        editorScrollWidth: editor?.scrollWidth,
        toolbarContained: toolbar?.scrollWidth <= toolbar?.clientWidth,
        toolbarClientWidth: toolbar?.clientWidth,
        toolbarScrollWidth: toolbar?.scrollWidth,
        toolbarChildren: toolbar
          ? Array.from(toolbar.children).map((child) => ({
              label: child.getAttribute('aria-label'),
              left: child.getBoundingClientRect().left,
              right: child.getBoundingClientRect().right,
              width: child.getBoundingClientRect().width,
            }))
          : [],
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
      };
    })()`,
  );
  if (
    !imageLayout?.figureContained ||
    !imageLayout.imageContained ||
    !imageLayout.toolbarContained ||
    !imageLayout.pageContained
  ) {
    throw new Error(
      `Wide image escaped the editor at the 960 px desktop minimum: ${JSON.stringify(imageLayout)}`,
    );
  }
  await evaluate(client, `document.querySelector('.editor-image-attachment')?.scrollIntoView()`);
  const imageScreenshot = await client.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "/private/tmp/sheut-editor-image-layout.png",
    Buffer.from(imageScreenshot.data, "base64"),
  );
  if (browserErrors.length > 0) {
    throw new Error(`Browser errors: ${browserErrors.join("; ")}`);
  }
  const sorted = [...measurements].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  const maximum = sorted.at(-1);
  if (maximum > EDITABLE_LIMIT_MS) {
    throw new Error(
      `Editor editable latency ${maximum.toFixed(1)} ms exceeds ${EDITABLE_LIMIT_MS} ms`,
    );
  }
  console.log(
    `Editor editable latency: median ${median.toFixed(1)} ms; max ${maximum.toFixed(1)} ms; ${RUNS} production-bundle runs; limit ${EDITABLE_LIMIT_MS} ms`,
  );
} catch (error) {
  const processContext = processErrors.length > 0 ? `\n${processErrors.join("\n")}` : "";
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${message}${processContext}`, { cause: error });
} finally {
  client?.close();
  chrome.kill("SIGTERM");
  preview.kill("SIGTERM");
  await Promise.all([waitForExit(chrome), waitForExit(preview)]);
  await rm(chromeData, { recursive: true, force: true });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!address || typeof address === "string") throw new Error("Could not allocate a local port");
  return address.port;
}

async function findChrome() {
  const candidates = [
    process.env.SHEUT_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known browser location.
    }
  }
  throw new Error("Chrome was not found; set SHEUT_CHROME_BIN to measure editor latency");
}

async function waitForUrl(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local process is still starting.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForExpression(clientValue, expression, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(clientValue, expression)) return;
    await delay(10);
  }
  throw new Error(`Timed out waiting for browser condition: ${expression}`);
}

async function evaluate(clientValue, expression) {
  const result = await clientValue.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForExit(child) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    delay(5_000),
  ]);
}

function tauriMockSource() {
  return `(() => {
    const projectId = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
    const documentId = "e7c44850-9f67-4d26-b7e3-0d4ee82339ef";
    const document = {
      schema_version: 1,
      id: documentId,
      kind: "investigation",
      revision: 1,
      root: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Reference investigation" }] },
          ...Array.from({ length: 40 }, (_, index) => ({
            type: "paragraph",
            content: [{ type: "text", text: "Bounded reference evidence paragraph " + (index + 1) }],
          })),
          {
            type: "imageAttachment",
            attrs: {
              attachmentId: "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
              alt: "Wide evidence image",
              title: null,
            },
          },
        ],
      },
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      convertFileSrc: (value) => value,
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command) => {
        if (command === "list_projects") return [{ id: projectId, name: "Reference project", locked: true, unlockMethod: "device", defaultTlpMarking: "amber" }];
        if (command === "unlock_project") return { id: projectId, name: "Reference project", locked: false, unlockMethod: "device", defaultTlpMarking: "amber" };
        if (command === "list_documents") return [document];
        if (command === "load_document") return document;
        if (command === "load_document_image") {
          const canvas = window.document.createElement("canvas");
          canvas.width = 4096;
          canvas.height = 256;
          const context = canvas.getContext("2d");
          context.fillStyle = "#001845";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "#4ba3fb";
          context.fillRect(0, 96, canvas.width, 64);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          if (!blob) throw { code: "invalid_attachment" };
          return blob.arrayBuffer();
        }
        if (command === "list_project_backups") return [];
        throw { code: "storage_unavailable" };
      },
    };
  })();`;
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result ?? {});
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {});
  });

  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      const methodListeners = listeners.get(method) ?? [];
      methodListeners.push(listener);
      listeners.set(method, methodListeners);
    },
    close() {
      socket.close();
    },
  };
}
