import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "json-summary", "html"],
      // Fails the run (and CI) if coverage drops below these.
      thresholds: {
        statements: 95,
        branches: 80,
        functions: 95,
        lines: 95,
      },
    },
  },
});
