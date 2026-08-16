import { describe, it, expect } from "vitest";
import { gapRanges, linearScale, niceCeil, pathFor } from "./scale";

const H = 100;

describe("niceCeil", () => {
  it("rounds up to a 1/2/5 step", () => {
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(1.4)).toBe(2);
    expect(niceCeil(23)).toBe(50);
    expect(niceCeil(4300)).toBe(5000);
  });

  it("never returns below the value it was given", () => {
    for (const v of [1, 3, 9, 11, 99, 101, 999]) expect(niceCeil(v)).toBeGreaterThanOrEqual(v);
  });

  it("survives zero and nonsense", () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(-5)).toBe(1);
    expect(niceCeil(NaN)).toBe(1);
  });
});

describe("linearScale", () => {
  it("is zero-based, so noise isn't exaggerated", () => {
    expect(linearScale([3, 4, 5], H).min).toBe(0);
  });

  // The original KpiStrip sparkline min-max stretched, so a flat series had
  // span 0 and every point pinned to the bottom — "perfectly stable" rendered
  // as "collapsed to zero".
  it("does not collapse a flat series", () => {
    const scale = linearScale([5, 5, 5], H);
    const y = scale.y(5);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(H);
  });

  it("handles an all-null series without NaN", () => {
    const scale = linearScale([null, null], H);
    expect(Number.isFinite(scale.y(0))).toBe(true);
    expect(scale.ticks.every(Number.isFinite)).toBe(true);
  });

  it("puts the largest value at the top of the plot", () => {
    const scale = linearScale([0, 50, 100], H);
    expect(scale.y(scale.max)).toBe(0);
    expect(scale.y(scale.min)).toBe(H);
  });

  it("clamps out-of-range values instead of drawing outside the plot", () => {
    const scale = linearScale([1, 2], H);
    expect(scale.y(9_999)).toBe(0);
    expect(scale.y(-9_999)).toBe(H);
  });
});

describe("pathFor", () => {
  const x = (i: number) => i * 10;
  const y = (v: number) => H - v;

  it("breaks the line at a gap rather than bridging it", () => {
    // Bridging would draw a worker outage as a smooth trend.
    const runs = pathFor([1, 2, null, 4, 5], x, y);
    expect(runs).toHaveLength(2);
    expect(runs[0].startsWith("M")).toBe(true);
    expect(runs[1].startsWith("M")).toBe(true);
  });

  it("emits no NaN or Infinity — one would blank the whole path", () => {
    const runs = pathFor([1, NaN as unknown as number, 3, 4], x, y);
    for (const run of runs) {
      expect(run).not.toContain("NaN");
      expect(run).not.toContain("Infinity");
    }
  });

  it("drops runs too short to draw", () => {
    expect(pathFor([null, 5, null], x, y)).toEqual([]);
    expect(pathFor([], x, y)).toEqual([]);
  });
});

describe("gapRanges", () => {
  it("finds contiguous unobserved stretches", () => {
    expect(gapRanges([1, 1, 0, 0, 1, 0])).toEqual([
      [2, 3],
      [5, 5],
    ]);
  });

  it("returns nothing when coverage is complete", () => {
    expect(gapRanges([2, 2, 2])).toEqual([]);
  });
});
