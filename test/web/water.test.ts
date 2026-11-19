// Tests for the arithmetic behind the water over the marble: where the marble lies under a canvas
// for each way that the stylesheet fits it, how many pixels the canvas gets, when a slow device
// gets fewer, and which part of the marble its texture holds. The drawing itself has no test,
// because the test runtime has no DOM and no WebGL.
import { describe, expect, it } from "vitest";

import { backingRatio, paceAfterFrame, placeMarble, planTexture } from "#web/water.ts";
import type { Pace } from "#web/water.ts";

/** Feeds the same gap, in milliseconds, to the pace for a number of frames. */
function run(pace: Pace, gap: number, frames: number): Pace {
  let next = pace;
  for (let frame = 0; frame < frames; frame += 1) {
    next = paceAfterFrame(next, gap);
  }
  return next;
}

const FRESH: Pace = { quality: 1, frames: 0, elapsed: 0 };

describe("placeMarble", () => {
  it("covers a wide canvas by its width and centers the overflow", () => {
    const placement = placeMarble("cover", 1440, 704);

    // The marble is 1600 by 1100, so at this scale it's 1440 by 990.
    expect(placement.scale).toBeCloseTo(0.9, 10);
    expect(placement.left).toBeCloseTo(0, 10);
    expect(placement.top).toBeCloseTo(-143, 10);
  });

  it("covers a tall canvas by its height and centers the overflow", () => {
    const placement = placeMarble("cover", 390, 844);

    expect(placement.scale).toBeCloseTo(844 / 1100, 10);
    expect(placement.left).toBeCloseTo((390 - (1600 * 844) / 1100) / 2, 10);
    expect(placement.top).toBeCloseTo(0, 10);
  });

  it("keeps the natural size at the top of a canvas narrower than the marble", () => {
    expect(placeMarble("top", 1440, 520)).toEqual({ scale: 1, left: -80, top: 0 });
  });

  it("centers the marble in a canvas wider than it", () => {
    expect(placeMarble("top", 1920, 520)).toEqual({ scale: 1, left: 160, top: 0 });
  });
});

describe("backingRatio", () => {
  it("is the device's ratio for a small canvas", () => {
    expect(backingRatio(800, 600, 1)).toBe(1);
    expect(backingRatio(390, 310, 1.5)).toBe(1.5);
  });

  it("is never above 2", () => {
    expect(backingRatio(390, 310, 3)).toBe(2);
  });

  it("gives the stage of a 1440 by 900 window two pixels for each CSS pixel", () => {
    expect(backingRatio(1440, 704, 2)).toBe(2);
    expect(backingRatio(1440, 520, 2)).toBe(2);
  });

  it("drops to keep a large canvas at four and a half million pixels", () => {
    const ratio = backingRatio(2560, 1244, 2);

    expect(ratio).toBeLessThan(2);
    expect(2560 * 1244 * ratio * ratio).toBeCloseTo(4_500_000, 3);
  });

  it("drops under 1 for a canvas that's too large at the device's own ratio", () => {
    const ratio = backingRatio(3840, 1964, 1);

    expect(ratio).toBeLessThan(1);
    expect(3840 * 1964 * ratio * ratio).toBeCloseTo(4_500_000, 3);
  });

  it("scales by the quality of a slow device", () => {
    expect(backingRatio(1440, 704, 2, 0.7)).toBeCloseTo(1.4, 10);
  });

  it("never lets the quality take the ratio under 0.75", () => {
    expect(backingRatio(1440, 704, 2, 0.1)).toBe(0.75);
    expect(backingRatio(800, 600, 1, 0.7)).toBe(0.75);
  });

  it("keeps a ratio that the pixel cap already put under 0.75", () => {
    const capped = backingRatio(5120, 2684, 1);

    expect(capped).toBeLessThan(0.75);
    expect(backingRatio(5120, 2684, 1, 0.7)).toBe(capped);
  });
});

describe("paceAfterFrame", () => {
  it("keeps the quality while the frames arrive on time", () => {
    expect(run(FRESH, 33.4, 300).quality).toBe(1);
  });

  it("decides nothing before a window of 30 frames is full", () => {
    expect(run(FRESH, 90, 29)).toEqual({ quality: 1, frames: 29, elapsed: 29 * 90 });
  });

  it("steps down once and starts a new window when a window averages over 50 ms", () => {
    expect(run(FRESH, 60, 30)).toEqual({ quality: 0.7, frames: 0, elapsed: 0 });
  });

  it("doesn't step down for an average between the target and 50 ms", () => {
    expect(run(FRESH, 45, 30)).toEqual({ quality: 1, frames: 0, elapsed: 0 });
  });

  it("counts one long stall as 100 ms, which can't fill a window alone", () => {
    const stalled = paceAfterFrame(FRESH, 5000);

    expect(stalled.elapsed).toBe(100);
    expect(run(stalled, 33.4, 29).quality).toBe(1);
  });

  it("never steps back up", () => {
    const slow = run(FRESH, 60, 30);

    expect(run(slow, 16, 300).quality).toBe(0.7);
  });

  it("stops at the quality that takes a ratio of 2 to 0.75", () => {
    expect(run(FRESH, 80, 30 * 10).quality).toBe(0.375);
  });
});

describe("planTexture", () => {
  it("stops at the sides of the marble that a covered canvas ends on", () => {
    const plan = planTexture("cover", 1440, 704, 1, 12, 4096);

    // The marble is exactly as wide as the canvas, so there's no margin to the left or right.
    expect(plan.x).toBeCloseTo(0, 10);
    expect(plan.width).toBeCloseTo(1600, 10);
    // Above and below, the marble runs on, and the margin of 12 CSS pixels fits.
    expect(plan.y).toBeCloseTo((143 - 12) / 0.9, 10);
    expect(plan.height).toBeCloseTo((704 + 24) / 0.9, 10);
    expect([plan.pixelWidth, plan.pixelHeight]).toEqual([1440, 728]);
  });

  it("holds one texture pixel for each canvas pixel", () => {
    const plan = planTexture("top", 390, 520, 2, 12, 4096);

    expect([plan.pixelWidth, plan.pixelHeight]).toEqual([(390 + 24) * 2, (520 + 12) * 2]);
  });

  it("never reaches above the top of the marble", () => {
    const plan = planTexture("top", 1440, 520, 1, 12, 4096);

    expect(plan).toEqual({
      x: 68,
      y: 0,
      width: 1464,
      height: 532,
      pixelWidth: 1464,
      pixelHeight: 532,
    });
  });

  it("takes only a margin of the black beside the marble under a canvas wider than it", () => {
    const plan = planTexture("top", 1920, 520, 1, 12, 4096);

    // The canvas shows 160 CSS pixels of black on each side, and the texture holds 12 of them.
    expect(plan.x).toBe(-12);
    expect(plan.x + plan.width).toBe(1600 + 12);
    expect(plan.pixelWidth).toBe(1624);
  });

  it("keeps the marble at full sharpness on a very wide page", () => {
    const plan = planTexture("top", 2200, 520, 2, 12, 4096);

    // The whole canvas would need 4448 pixels, which the cap would shrink. The marble and its
    // margins need 3248.
    expect([plan.pixelWidth, plan.pixelHeight]).toEqual([1624 * 2, 532 * 2]);
  });

  it("holds the same part for a canvas that's only a little wider than the marble", () => {
    const plan = planTexture("top", 1610, 520, 1, 12, 4096);

    // The canvas shows 5 CSS pixels of black on each side. The texture's 12 reach past the
    // canvas by 7, which is inside the margin that every texture has.
    expect(plan.x).toBe(-12);
    expect(plan.width).toBe(1624);
  });

  it("matches the stage of a 1440 by 900 window pixel for pixel at a ratio of 2", () => {
    const plan = planTexture("cover", 1440, 704, 2, 12, 4096);

    expect([plan.pixelWidth, plan.pixelHeight]).toEqual([2880, 1456]);
  });

  it("caps the longer side at what the GPU allows and keeps the shape", () => {
    const plan = planTexture("top", 1440, 520, 2, 12, 2048);

    expect(plan.pixelWidth).toBe(2048);
    expect(plan.pixelHeight).toBe(Math.round((532 * 2 * 2048) / (1464 * 2)));
    expect(plan.width).toBe(1464);
  });
});
