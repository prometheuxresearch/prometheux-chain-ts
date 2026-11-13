import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    platform: "node",
    target: "node22",
    dts: true,
    sourcemap: true,
    clean: true,
  },
  {
    // Same code for browsers, with file-system access swapped for stubs, so
    // bundlers never see a `node:` import. Served through the "browser" export
    // condition; it shares the type declarations of the Node build.
    entry: { browser: "src/index.ts" },
    format: ["esm"],
    platform: "browser",
    target: "es2022",
    dts: false,
    sourcemap: true,
    clean: false,
    alias: {
      "./platform.ts": fileURLToPath(new URL("src/core/platform.browser.ts", import.meta.url)),
    },
  },
]);
