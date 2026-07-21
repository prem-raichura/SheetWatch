import { defineConfig } from "vitest/config";

// Only run the TypeScript source tests. Without this, vitest's default glob
// also picks up the compiled CommonJS copies under dist/ (dist/**/*.test.js),
// which fail on `require("vitest")` and produce false failures.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
