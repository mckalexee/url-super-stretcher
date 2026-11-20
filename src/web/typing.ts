// The pace of text that appears one character at a time. It starts slow, so the first characters
// can be read as they arrive, and speeds up, so a long link doesn't keep the visitor waiting. It
// lives apart from any component, so every animation that types text shares one curve.

// How steeply the pace rises. At 4.5, the last moment runs about 90 times faster than the first.
const RAMP = 4.5;

/**
 * The share of the text that's typed at `t`, the share of the animation's time that has passed.
 * Both run from 0 to 1. The curve is exponential, `(e^(kt) - 1) / (e^k - 1)`, so the speed grows
 * by the same factor in each equal slice of time. A `t` outside the range counts as its nearest
 * end, so a late or early frame never types less than nothing or more than everything.
 */
export function typedShare(t: number): number {
  if (!(t > 0)) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  return Math.expm1(RAMP * t) / Math.expm1(RAMP);
}
