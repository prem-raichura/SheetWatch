import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const OPS_DIR = __dirname;

// The ops page is its own bundle for a reason: it is opened when something is
// already broken, so it must load instantly. One import from components/ would
// pull in motion (~85 KB); one from providers/ would pull the whole app graph.
describe("ops chart bundle", () => {
  it("imports nothing but React and local files", () => {
    const files = fs.readdirSync(OPS_DIR).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(OPS_DIR, file), "utf8");
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = match[1];
        const local = spec.startsWith(".") && !spec.includes("components/") && !spec.includes("providers/");
        if (!local && spec !== "react") offenders.push(`${file} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
