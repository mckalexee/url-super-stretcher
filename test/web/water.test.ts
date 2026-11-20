// Tests for the arithmetic behind the light on the marble: how many pixels the canvas gets, when
// a slow device gets fewer frames and then fewer pixels, how large the pattern is drawn, which of
// the display's frames draw, and how the clocks wrap. The drawing itself has no test, because the
// test runtime has no DOM and no WebGL.
import { describe, expect, it } from "vitest";

import { backingRatio, drift, frameDue, paceAfterFrame, patternScale, turn } from "#web/water.ts";
import type { Pace } from "#web/water.ts";

/**
 * Offers every frame of a display with the given frames a second to `frameDue()` for two seconds,
 * and returns the gaps between the frames that draw, in display frames.
 */
function drawnGaps(rate: Pace["rate"], display: number): number[] {
  const gaps: number[] = [];
  let last: number | undefined;
  for (let index = 0; index < display * 2; index += 1) {
    const now = (index * 1000) / display;
    const sinceLast = last === undefined ? undefined : now - last;
    if (frameDue(rate, sinceLast)) {
      if (sinceLast !== undefined) {
        gaps.push(Math.round((sinceLast * display) / 1000));
      }
      last = now;
    }
  }
  return gaps;
}

/** Feeds the same gap, in milliseconds, to the pace for a number of frames. */
function run(pace: Pace, gap: number, frames: number): Pace {
  let next = pace;
  for (let frame = 0; frame < frames; frame += 1) {
    next = paceAfterFrame(next, gap);
  }
  return next;
}

const FRESH: Pace = { rate: 60, quality: 1, frames: 0, elapsed: 0 };
const HALVED: Pace = { rate: 30, quality: 1, frames: 0, elapsed: 0 };

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
  it("keeps 60 frames a second and the quality while the frames arrive on time", () => {
    expect(run(FRESH, 16.7, 600)).toEqual({ rate: 60, quality: 1, frames: 0, elapsed: 0 });
  });

  it("decides nothing before a window of 60 frames is full", () => {
    expect(run(FRESH, 90, 59)).toEqual({ rate: 60, quality: 1, frames: 59, elapsed: 59 * 90 });
  });

  it("steps down to 30 frames a second when a window averages over 29 ms", () => {
    expect(run(FRESH, 33.3, 60)).toEqual({ rate: 30, quality: 1, frames: 0, elapsed: 0 });
  });

  it("keeps the resolution at the step down to 30 frames a second", () => {
    // However slow the frames are, the first step costs frames and not pixels.
    expect(run(FRESH, 100, 60).quality).toBe(1);
  });

  it("keeps 60 frames a second for the steady gaps that a faster display allows", () => {
    // A display of 120 frames a second can hold 25 ms, and one of 144 can hold 27.8 ms.
    expect(run(FRESH, 25, 60).rate).toBe(60);
    expect(run(FRESH, 27.8, 60).rate).toBe(60);
  });

  it("keeps 60 frames a second through an ordinary stutter", () => {
    // A quarter of the frames arrive one display frame late.
    const stutter = run(run(FRESH, 16.7, 45), 33.3, 15);

    expect(stutter).toEqual({ rate: 60, quality: 1, frames: 0, elapsed: 0 });
  });

  it("fills a window of 30 frames at 30 frames a second", () => {
    expect(run(HALVED, 90, 29)).toEqual({ rate: 30, quality: 1, frames: 29, elapsed: 29 * 90 });
    expect(run(HALVED, 33.4, 300)).toEqual(HALVED);
  });

  it("steps the quality down when a window at 30 frames a second averages over 46 ms", () => {
    expect(run(HALVED, 50, 30)).toEqual({ rate: 30, quality: 0.7, frames: 0, elapsed: 0 });
  });

  it("keeps the quality for the steady gaps under 46 ms", () => {
    // A display of 120 frames a second can hold 41.7 ms, and one of 90 can hold 44.4 ms.
    expect(run(HALVED, 41.7, 30).quality).toBe(1);
    expect(run(HALVED, 44.4, 30).quality).toBe(1);
  });

  it("takes two windows to reach the first step down in quality", () => {
    const slow = run(FRESH, 60, 60);

    expect(slow).toEqual({ rate: 30, quality: 1, frames: 0, elapsed: 0 });
    expect(run(slow, 60, 30)).toEqual({ rate: 30, quality: 0.7, frames: 0, elapsed: 0 });
  });

  it("counts one long stall as 100 ms, which can't fill a window alone", () => {
    const stalled = paceAfterFrame(FRESH, 5000);

    expect(stalled.elapsed).toBe(100);
    expect(run(stalled, 16.7, 59).rate).toBe(60);
  });

  it("never steps back up", () => {
    const halved = run(FRESH, 40, 60);
    const soft = run(halved, 60, 30);

    expect(run(halved, 8, 300).rate).toBe(30);
    expect(run(soft, 8, 300)).toEqual({ rate: 30, quality: 0.7, frames: 0, elapsed: 0 });
  });

  it("stops at the quality that takes a ratio of 2 to 0.75", () => {
    expect(run(HALVED, 80, 30 * 10).quality).toBe(0.375);
  });
});

describe("patternScale", () => {
  it("is the approved scale on a canvas 720 pixels wide or wider", () => {
    expect(patternScale(720)).toBe(0.85);
    expect(patternScale(1440)).toBe(0.85);
    expect(patternScale(3840)).toBe(0.85);
  });

  it("shrinks with a narrower canvas", () => {
    expect(patternScale(600)).toBeCloseTo((0.85 * 600) / 720, 10);
  });

  it("never shrinks under 0.7 of the approved scale", () => {
    expect(patternScale(390)).toBeCloseTo(0.85 * 0.7, 10);
    expect(patternScale(0)).toBeCloseTo(0.85 * 0.7, 10);
  });
});

describe("frameDue", () => {
  it("draws the first frame of a run", () => {
    expect(frameDue(60, undefined)).toBe(true);
    expect(frameDue(30, undefined)).toBe(true);
  });

  it("draws a frame that arrives a moment early", () => {
    expect(frameDue(60, 15.5)).toBe(true);
    expect(frameDue(30, 32)).toBe(true);
  });

  it("skips a frame that arrives well before the interval", () => {
    expect(frameDue(60, 13.9)).toBe(false);
    expect(frameDue(30, 27.8)).toBe(false);
  });

  it.each([
    [60, 1],
    [75, 2],
    [90, 2],
    [120, 2],
    [144, 3],
  ])("draws at an even cadence at 60 frames a second on a display of %i", (display, every) => {
    const gaps = drawnGaps(60, display);

    expect(gaps.length).toBeGreaterThan(0);
    expect(new Set(gaps)).toEqual(new Set([every]));
  });

  it.each([
    [60, 2],
    [75, 3],
    [90, 3],
    [120, 4],
    [144, 5],
  ])("draws at an even cadence at 30 frames a second on a display of %i", (display, every) => {
    const gaps = drawnGaps(30, display);

    expect(gaps.length).toBeGreaterThan(0);
    expect(new Set(gaps)).toEqual(new Set([every]));
  });
});

describe("drift", () => {
  it("splits the drift into whole cells and a fraction", () => {
    expect(drift(10, 5, 20)).toEqual({ whole: 2, fraction: 0.5 });
  });

  it("starts at no drift", () => {
    expect(drift(0, 5, 20)).toEqual({ whole: 0, fraction: 0 });
    expect(drift(0, -3.5, 20)).toEqual({ whole: 0, fraction: 0 });
  });

  it("crosses zero with a negative speed without a jump", () => {
    const before = drift(0, -3.5, 100);
    const after = drift(1, -3.5, 100);

    expect(after.whole).toBe(-1);
    expect(after.fraction).toBeCloseTo(0.965, 10);
    // The position that the shader sees moves by the drift of one second and no more.
    expect(after.whole + after.fraction - (before.whole + before.fraction)).toBeCloseTo(-0.035, 10);
  });

  it("keeps the fraction from 0 up to 1 at any negative drift", () => {
    for (const clock of [0.3, 7, 123.4, 99_999.9]) {
      const { fraction } = drift(clock, -3.5, 112.2);

      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThan(1);
    }
  });

  it("wraps the whole part to a signed 32-bit integer", () => {
    expect(drift(2 ** 32 + 3.5, 1, 1)).toEqual({ whole: 3, fraction: 0.5 });
    expect(drift(2 ** 31 + 0.25, 1, 1)).toEqual({ whole: -(2 ** 31), fraction: 0.25 });
    expect(drift(-(2 ** 32) - 0.5, 1, 1)).toEqual({ whole: -1, fraction: 0.5 });
  });
});

describe("turn", () => {
  it("is the share of the turn that the clock has run", () => {
    expect(turn(0, 37)).toBe(0);
    expect(turn(18.5, 37)).toBe(0.5);
    expect(turn(37, 37)).toBe(0);
  });

  it("wraps a clock of many turns", () => {
    expect(turn(37 * 100_000 + 9.25, 37)).toBeCloseTo(0.25, 6);
  });

  it("stays from 0 up to 1", () => {
    for (const clock of [0.1, 16.9, 52.99, 86_400.5]) {
      const share = turn(clock, 17);

      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThan(1);
    }
  });
});
