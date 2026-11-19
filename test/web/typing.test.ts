// Tests for the pace of typed text: where the curve starts and ends, that it never runs
// backward, and that it starts slow and ends fast.
import { describe, expect, it } from "vitest";

import { typedShare } from "#web/typing.ts";

describe("typedShare", () => {
  it("types nothing at the start and everything at the end", () => {
    expect(typedShare(0)).toBe(0);
    expect(typedShare(1)).toBe(1);
  });

  it("counts a time outside the animation as its nearest end", () => {
    expect(typedShare(-0.5)).toBe(0);
    expect(typedShare(1.5)).toBe(1);
    expect(typedShare(Number.NaN)).toBe(0);
  });

  it("follows the exponential curve with a ramp of 4.5", () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(typedShare(t)).toBeCloseTo((Math.exp(4.5 * t) - 1) / (Math.exp(4.5) - 1), 12);
    }
  });

  it("never runs backward", () => {
    let last = 0;
    for (let step = 0; step <= 1000; step += 1) {
      const share = typedShare(step / 1000);
      expect(share).toBeGreaterThanOrEqual(last);
      last = share;
    }
  });

  it("types little in its first half and most in its last fifth", () => {
    expect(typedShare(0.5)).toBeLessThan(0.1);
    expect(1 - typedShare(0.8)).toBeGreaterThan(0.5);
  });
});
