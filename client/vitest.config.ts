import { defineConfig } from "vitest/config";

// Pure-logic tests only — chart scaling maths and bundle invariants. No jsdom,
// no testing-library: nothing here renders a component.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
