// Tests for the pure functions behind the shine on the gold: how far the band of light travels,
// where it crosses foil text and a gold surface, how it follows the pointer, and how it glides by
// itself. The animations, the timers, and the listeners have no test here, because the test
// runtime has no DOM.
import { describe, expect, it } from "vitest";

import {
  bandCenter,
  clampToTravel,
  easeToward,
  flatSurface,
  foilOffset,
  followStep,
  glideDuration,
  glidePosition,
  isOnScreen,
  nearerEnd,
  pointerPosition,
  sliceOf,
  slicesOf,
  sliceTransform,
  sweepTravel,
  travelProgress,
} from "#web/shine.ts";
import type { Box, Surface } from "#web/shine.ts";

const LEAN = (20 * Math.PI) / 180;
const TAN = Math.tan(LEAN);

/**
 * A surface that's turned away from the viewer about a vertical axis through its left edge, the
 * way the gold bar is: its left edge is at `left` and `top`, `turn` is the angle in radians, and
 * the viewer is `depth` pixels in front of the point `eyeX`, `eyeY` of the window.
 */
function turnedSurface(
  left: number,
  top: number,
  turn: number,
  depth: number,
  eyeX: number,
  eyeY: number,
): Surface {
  const away = Math.sin(turn) / depth;
  return {
    origin: [left, top, 1],
    across: [Math.cos(turn) + eyeX * away, eyeY * away, away],
    down: [0, 1, 0],
  };
}

/** Where a point of a surface lands in the window: `x` pixels along it and `y` pixels down it. */
function land(surface: Surface, x: number, y: number): { x: number; y: number } {
  const at = (index: 0 | 1 | 2) =>
    surface.origin[index] + x * surface.across[index] + y * surface.down[index];
  return { x: at(0) / at(2), y: at(1) / at(2) };
}

/** The distance from a point of the window to the centerline of a band, measured across it. */
function acrossBand(point: { x: number; y: number }, position: number): number {
  return (point.x + point.y * TAN - position) * Math.cos(LEAN);
}

describe("sweepTravel", () => {
  it("starts with the whole band left of the window", () => {
    const { from } = sweepTravel(1440, 900, LEAN, 50);

    // The top of the band leads, so the top of the window is where it's furthest right.
    expect(bandCenter(from, 0, LEAN) + 50).toBeCloseTo(0, 10);
    expect(bandCenter(from, 900, LEAN) + 50).toBeLessThan(0);
  });

  it("ends with the whole band right of the window", () => {
    const { to } = sweepTravel(1440, 900, LEAN, 50);

    // The bottom of the band trails, so the bottom of the window is where it's furthest left.
    expect(bandCenter(to, 900, LEAN) - 50).toBeCloseTo(1440, 10);
    expect(bandCenter(to, 0, LEAN) - 50).toBeGreaterThan(1440);
  });

  it("travels the window's width in a band that stands upright", () => {
    expect(sweepTravel(390, 844, 0, 30)).toEqual({ from: -30, to: 420 });
  });
});

describe("foilOffset", () => {
  const box: Box = { left: 64, top: 104, width: 620, height: 147 };

  it("is 0 when the centerline passes through the element's top left corner", () => {
    const position = box.left + box.top * TAN;

    expect(foilOffset(position, box, LEAN)).toBeCloseTo(0, 10);
  });

  it("is negative while the band is still to the left of the element", () => {
    expect(foilOffset(0, box, LEAN)).toBeLessThan(0);
  });

  it("measures across the band, not along the horizontal", () => {
    const position = box.left + box.top * TAN;

    expect(foilOffset(position + 100, box, LEAN)).toBeCloseTo(100 * Math.cos(LEAN), 10);
  });

  it("gives two elements on one line of the band the same offset", () => {
    // The second element is lower, and further left by the lean, so the same centerline passes
    // through the top left corner of both.
    const lower: Box = { left: box.left - 300 * TAN, top: box.top + 300, width: 200, height: 40 };

    expect(foilOffset(700, lower, LEAN)).toBeCloseTo(foilOffset(700, box, LEAN), 10);
  });

  it("lights an element further right later", () => {
    const right: Box = { ...box, left: box.left + 400 };

    expect(foilOffset(700, right, LEAN)).toBeLessThan(foilOffset(700, box, LEAN));
  });
});

describe("sliceOf", () => {
  const button: Box = { left: 1128, top: 786, width: 246, height: 64 };

  it("puts the strip on the band's centerline at half the height of a flat surface", () => {
    const slice = sliceOf(1500, flatSurface(button), LEAN);

    expect(slice?.offset).toBeCloseTo(bandCenter(1500, 786 + 32, LEAN) - 1128, 10);
  });

  it("leans and widens the strip on a flat surface to the band's own lean and width", () => {
    const slice = sliceOf(1500, flatSurface(button), LEAN);

    // The strip is as wide as the band is across, and a leaning band is wider along the
    // horizontal. The lean comes before the stretch, so it's a smaller angle than the band's.
    expect(slice?.stretch).toBeCloseTo(1 / Math.cos(LEAN), 10);
    expect(Math.tan(slice?.skew ?? 0) * (slice?.stretch ?? 0)).toBeCloseTo(-TAN, 10);
  });

  it("keeps the same lean and width all the way across a flat surface", () => {
    const early = sliceOf(1200, flatSurface(button), LEAN);
    const late = sliceOf(1700, flatSurface(button), LEAN);

    expect(late?.stretch).toBeCloseTo(early?.stretch ?? 0, 10);
    expect(late?.skew).toBeCloseTo(early?.skew ?? 0, 10);
    expect((late?.offset ?? 0) - (early?.offset ?? 0)).toBeCloseTo(500, 10);
  });

  describe("on a surface in perspective", () => {
    const bar = turnedSurface(-300, 600, (56 * Math.PI) / 180, 1300, 1065, 140);

    it("puts the strip where the band's centerline crosses the surface's middle line", () => {
      for (const position of [0, 400, 800, 1100]) {
        const slice = sliceOf(position, bar, LEAN);

        expect(slice).toBeDefined();
        expect(acrossBand(land(bar, slice?.offset ?? 0, 0), position)).toBeCloseTo(0, 8);
      }
    });

    it("moves the strip further for each step as the surface recedes", () => {
      const offsets = [200, 400, 600, 800].map((position) => sliceOf(position, bar, LEAN)?.offset);
      const steps = offsets.slice(1).map((offset, index) => (offset ?? 0) - (offsets[index] ?? 0));

      expect(steps[1]).toBeGreaterThan(steps[0] ?? 0);
      expect(steps[2]).toBeGreaterThan(steps[1] ?? 0);
    });

    it("leans the strip so that its middle stays on the band's centerline", () => {
      const position = 500;
      const slice = sliceOf(position, bar, LEAN);
      const { offset = 0, stretch = 0, skew = 0 } = slice ?? {};
      // One pixel up and one pixel down the strip's own middle line, after the lean and the
      // stretch.
      for (const y of [-1, 1]) {
        const point = land(bar, offset + stretch * y * Math.tan(skew), y);

        expect(acrossBand(point, position)).toBeCloseTo(0, 3);
      }
    });

    it("widens the strip so that the band is as wide in the window as on the page", () => {
      const position = 500;
      const slice = sliceOf(position, bar, LEAN);
      const { offset = 0, stretch = 0 } = slice ?? {};
      // A point that starts one pixel right of the strip's middle ends one pixel across the band.
      const point = land(bar, offset + stretch, 0);

      expect(acrossBand(point, position)).toBeCloseTo(1, 2);
      // The surface is turned away, so that takes more than one of its own pixels.
      expect(stretch).toBeGreaterThan(1.5);
    });

    it("has no slice for a band past the point where the surface vanishes", () => {
      // The middle line of this surface runs toward a point about 1,900 pixels from the left.
      expect(sliceOf(1500, bar, LEAN)).toBeDefined();
      expect(sliceOf(2600, bar, LEAN)).toBeUndefined();
    });
  });
});

describe("slicesOf", () => {
  const travel = sweepTravel(1440, 900, LEAN, 50);

  it("returns one slice for each step and one more", () => {
    const box: Box = { left: 64, top: 570, width: 170, height: 64 };

    expect(slicesOf(travel, flatSurface(box), LEAN, 170, 24)).toHaveLength(25);
  });

  it("starts and ends with the strip off a surface that's inside the window", () => {
    const box: Box = { left: 64, top: 570, width: 170, height: 64 };
    const slices = slicesOf(travel, flatSurface(box), LEAN, 170, 24);

    // Half the stretched strip is about 53 pixels, and the lean adds about 12 at this height.
    expect(slices[0]?.offset).toBeLessThan(-65);
    expect(slices.at(-1)?.offset).toBeGreaterThan(170 + 65);
  });

  it("moves the strip by the same distance in each step across a flat surface", () => {
    const box: Box = { left: 700, top: 400, width: 600, height: 64 };
    const slices = slicesOf(travel, flatSurface(box), LEAN, 600, 8);
    const step = (travel.to - travel.from) / 8;

    expect((slices[1]?.offset ?? 0) - (slices[0]?.offset ?? 0)).toBeCloseTo(step, 8);
    expect((slices[2]?.offset ?? 0) - (slices[1]?.offset ?? 0)).toBeCloseTo(step, 8);
  });

  it("parks the strip three lengths along once the band has gone that far", () => {
    const box: Box = { left: 64, top: 570, width: 170, height: 64 };
    const slices = slicesOf(travel, flatSurface(box), LEAN, 170, 24);

    expect(slices.at(-1)?.offset).toBe(510);
    expect(Math.max(...slices.map((slice) => slice.offset))).toBe(510);
  });

  it("parks the strip, and keeps its last shape, where a surface in perspective has no slice", () => {
    const bar = turnedSurface(-300, 600, (56 * Math.PI) / 180, 1300, 1065, 140);
    const far = { from: 0, to: 2600 };
    const slices = slicesOf(far, bar, LEAN, 2100, 26);
    const last = slices.at(-1);

    expect(last?.offset).toBe(6300);
    expect(Number.isFinite(last?.stretch)).toBe(true);
    expect(Number.isFinite(last?.skew)).toBe(true);
  });

  it("waits before a surface, and never sweeps back, until the band first has a slice", () => {
    // This surface is turned toward the viewer, so the band has no slice on it until it passes
    // the point on the left where the surface's middle line vanishes.
    const near = turnedSurface(1600, 600, (-56 * Math.PI) / 180, 1300, 300, 140);
    const slices = slicesOf({ from: -1500, to: 2000 }, near, LEAN, 2100, 35);
    const offsets = slices.map((slice) => slice.offset);

    expect(sliceOf(-1500, near, LEAN)).toBeUndefined();
    expect(offsets[0]).toBe(-6300);
    for (const [index, offset] of offsets.slice(1).entries()) {
      expect(offset).toBeGreaterThanOrEqual(offsets[index] ?? 0);
    }
  });

  it("never widens the strip by more than eight times", () => {
    const bar = turnedSurface(-300, 600, (56 * Math.PI) / 180, 1300, 1065, 140);
    const slices = slicesOf({ from: 0, to: 2600 }, bar, LEAN, 1_000_000, 260);

    expect(Math.max(...slices.map((slice) => slice.stretch))).toBe(8);
  });
});

describe("isOnScreen", () => {
  it("is true for a box that's partly inside the window", () => {
    expect(isOnScreen({ left: -300, top: 500, width: 1200, height: 150 }, 1440, 900)).toBe(true);
    expect(isOnScreen({ left: 1400, top: 880, width: 200, height: 60 }, 1440, 900)).toBe(true);
  });

  it("is false for a box past any side of the window", () => {
    expect(isOnScreen({ left: 64, top: 950, width: 400, height: 60 }, 1440, 900)).toBe(false);
    expect(isOnScreen({ left: 64, top: -80, width: 400, height: 60 }, 1440, 900)).toBe(false);
    expect(isOnScreen({ left: 1440, top: 100, width: 400, height: 60 }, 1440, 900)).toBe(false);
    expect(isOnScreen({ left: -400, top: 100, width: 400, height: 60 }, 1440, 900)).toBe(false);
  });

  it("is false for the empty box of an element that isn't displayed", () => {
    expect(isOnScreen({ left: 0, top: 0, width: 0, height: 0 }, 1440, 900)).toBe(false);
  });
});

describe("easeToward", () => {
  const FRAME = 1000 / 60;

  it("covers the factor's share of the distance in one frame at 60 frames a second", () => {
    expect(easeToward(0, 100, 0.18, FRAME)).toBeCloseTo(18, 10);
    expect(easeToward(100, 0, 0.18, FRAME)).toBeCloseTo(82, 10);
  });

  it("ends in the same place whatever the frame rate", () => {
    const once = easeToward(0, 100, 0.18, FRAME);
    const twice = easeToward(easeToward(0, 100, 0.18, FRAME / 2), 100, 0.18, FRAME / 2);

    expect(twice).toBeCloseTo(once, 10);
  });

  it("stays put when no time has passed, and when it's already there", () => {
    expect(easeToward(40, 100, 0.18, 0)).toBe(40);
    expect(easeToward(100, 100, 0.18, FRAME)).toBe(100);
  });

  it("never passes the target", () => {
    expect(easeToward(0, 100, 0.18, 10_000)).toBeLessThanOrEqual(100);
  });
});

describe("sliceTransform", () => {
  it("moves, then widens, then leans, so the browser applies them in the reverse order", () => {
    const transform = sliceTransform({ offset: 120.5, stretch: 1.5, skew: -Math.PI / 6 });

    expect(transform).toBe("translateX(120.50px) scaleX(1.5000) skewX(-30.000deg)");
  });
});

describe("pointerPosition", () => {
  it("puts the band's centerline through the pointer", () => {
    for (const [x, y] of [
      [0, 0],
      [700, 450],
      [1439, 899],
    ] as const) {
      expect(bandCenter(pointerPosition(x, y, LEAN), y, LEAN)).toBeCloseTo(x, 10);
    }
  });

  it("gives every point on one centerline the same position", () => {
    expect(pointerPosition(700 - 300 * TAN, 750, LEAN)).toBeCloseTo(
      pointerPosition(700, 450, LEAN),
      10,
    );
  });
});

describe("crossing positions", () => {
  const travel = { from: -50, to: 1800 };

  it("holds a position inside the crossing", () => {
    expect(clampToTravel(-400, travel)).toBe(-50);
    expect(clampToTravel(900, travel)).toBe(900);
    expect(clampToTravel(2400, travel)).toBe(1800);
  });

  it("finds the end that's nearer to a position", () => {
    expect(nearerEnd(300, travel)).toBe(-50);
    expect(nearerEnd(1500, travel)).toBe(1800);
    expect(nearerEnd(-400, travel)).toBe(-50);
  });

  it("gives a position's share of the crossing, held between 0 and 1", () => {
    expect(travelProgress(-50, travel)).toBe(0);
    expect(travelProgress(875, travel)).toBe(0.5);
    expect(travelProgress(1800, travel)).toBe(1);
    expect(travelProgress(-400, travel)).toBe(0);
    expect(travelProgress(2400, travel)).toBe(1);
  });
});

describe("followStep", () => {
  const FRAME = 1000 / 60;

  it("closes part of the distance to the pointer and goes on", () => {
    const step = followStep(0, 500, FRAME);

    expect(step.position).toBeGreaterThan(0);
    expect(step.position).toBeLessThan(500);
    expect(step.settled).toBe(false);
  });

  it("closes the same distance at every frame rate", () => {
    const once = followStep(0, 500, FRAME).position;
    const twice = followStep(followStep(0, 500, FRAME / 2).position, 500, FRAME / 2).position;

    expect(twice).toBeCloseTo(once, 10);
  });

  it("lands exactly on the pointer and settles once it's close", () => {
    expect(followStep(499.9, 500, FRAME)).toEqual({ position: 500, settled: true });
    expect(followStep(500, 500, FRAME)).toEqual({ position: 500, settled: true });
  });

  it("settles within two seconds from across a wide window, so the frame loop stops", () => {
    let step = { position: -100, settled: false };
    let frames = 0;
    while (!step.settled && frames < 1000) {
      step = followStep(step.position, 2600, FRAME);
      frames += 1;
    }

    expect(step.settled).toBe(true);
    expect(frames * FRAME).toBeLessThan(2000);
  });
});

describe("glideDuration", () => {
  const travel = { from: -50, to: 1950 };

  it("takes the same time for a distance in either direction", () => {
    expect(glideDuration(-1000, travel)).toBe(glideDuration(1000, travel));
  });

  it("takes twice as long for twice the distance", () => {
    expect(glideDuration(2000, travel)).toBeCloseTo(glideDuration(1000, travel) * 2, 10);
  });

  it("never turns a short glide into a jump", () => {
    expect(glideDuration(0, travel)).toBeGreaterThan(0);
    expect(glideDuration(2, travel)).toBe(glideDuration(0, travel));
  });
});

describe("glidePosition", () => {
  it("starts at the start, ends at the end, and is halfway at half the time", () => {
    expect(glidePosition(100, 900, 0)).toBe(100);
    expect(glidePosition(100, 900, 0.5)).toBeCloseTo(500, 10);
    expect(glidePosition(100, 900, 1)).toBe(900);
  });

  it("moves slowly at both ends and fastest in the middle", () => {
    const early = glidePosition(0, 1000, 0.1) - glidePosition(0, 1000, 0);
    const middle = glidePosition(0, 1000, 0.55) - glidePosition(0, 1000, 0.45);
    const late = glidePosition(0, 1000, 1) - glidePosition(0, 1000, 0.9);

    expect(middle).toBeGreaterThan(early * 4);
    expect(late).toBeCloseTo(early, 10);
  });

  it("stays at an end for a share outside 0 to 1", () => {
    expect(glidePosition(100, 900, -0.5)).toBe(100);
    expect(glidePosition(100, 900, 1.5)).toBe(900);
  });

  it("glides backward as well as forward", () => {
    expect(glidePosition(900, -50, 0.5)).toBeCloseTo(425, 10);
  });
});
