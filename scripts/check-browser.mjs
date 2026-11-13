// Checks that the built package works in a browser: a browser bundler resolves
// it through the "browser" export condition without meeting a `node:` import,
// and the bundle runs where only browser globals exist (no process, no require).
// Run after `npm run build`. Exits 1 on the first failure.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

// Install the package the way an app would see it: node_modules/@pmtx/chain.
const app = await mkdtemp(join(tmpdir(), "pmtx-browser-"));
await mkdir(join(app, "node_modules", "@pmtx"), { recursive: true });
await symlink(root, join(app, "node_modules", "@pmtx", "chain"), "dir");

const entry = `
  import { Prometheux, PrometheuxError } from "@pmtx/chain";
  globalThis.run = async (fetch) => {
    const px = new Prometheux({ token: "t", baseUrl: "https://api.example.test/jarvispy/o/u", fetch });
    const result = await px.vadalog.evaluate('a(1). @output("a").');
    const upload = await import("@pmtx/chain").then((m) => m.fileFromPath("x.csv")).catch((e) => e);
    return { result, uploadError: upload instanceof PrometheuxError ? upload.message : String(upload) };
  };
`;

try {
  const out = await build({
    stdin: { contents: entry, resolveDir: app, loader: "js" },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    logLevel: "silent",
  }).catch((error) => {
    throw new Error(`a browser bundler cannot bundle the package:\n${error.message}`);
  });
  const code = out.outputFiles[0].text;
  const nodeImport = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']node:[^"']+["']/.exec(code);
  assert.equal(nodeImport, null, `the browser bundle imports ${nodeImport?.[0]}`);

  // Only what a browser provides; process, require and Buffer are absent.
  const browser = vm.createContext({
    ...Object.fromEntries(
      [
        "URL",
        "URLSearchParams",
        "Headers",
        "Request",
        "Response",
        "FormData",
        "Blob",
        "File",
        "AbortController",
        "AbortSignal",
        "TextDecoder",
        "TextDecoderStream",
        "TextEncoder",
        "ReadableStream",
        "WebSocket",
        "crypto",
        "setTimeout",
        "clearTimeout",
        "console",
        "DOMException",
        "Promise",
        "Error",
        "TypeError",
      ].map((name) => [name, globalThis[name]]),
    ),
  });
  vm.runInContext(code, browser);

  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init.headers) });
    const body = { status: "success", data: { resultSet: { a: [[1]] } } };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
  const { result, uploadError } = await browser.run(fetch);

  // The bundle runs in its own realm, so compare its values through JSON.
  assert.equal(JSON.stringify(result.resultSet.a), "[[1]]", "evaluate did not return the result");
  assert.equal(requests[0].url, "https://api.example.test/jarvispy/o/u/api/v1/vadalog/evaluate");
  assert.equal(requests[0].headers.get("authorization"), "Bearer t");
  assert.equal(requests[0].headers.get("user-agent"), null, "the browser build sets a User-Agent");
  assert.match(
    uploadError,
    /only works in Node\.js/,
    "fileFromPath did not explain it is Node-only",
  );

  console.log("PASS the package bundles for the browser and runs with browser globals only");
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  await rm(app, { recursive: true, force: true });
}
