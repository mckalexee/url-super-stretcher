// The light on the marble. It draws caustics on a canvas: the net of bright lines that sunlight
// makes on the floor of a pool, in the site's gold on its black. The net is the marble's gold
// veins set in motion, so the canvas covers the still marble that the stylesheet paints and
// draws nothing of that picture. The shader has a model of the water in two parts. Trains of
// waves cross the surface, and they sway the light under them and gather it under their crests.
// The light is two nets of cell walls, bright where the two agree. Every clock reaches the shader
// already wrapped, so the picture is as sharp after a day as after a second. This module exists
// apart from the React component so that the page pays for WebGL only when motion is allowed, and
// so that every failure leaves the still marble in place.
import { reducedMotionRequested, subscribeToMotion, watchMotion } from "#web/motion.ts";

// The three numbers that the look was approved at. They're tuned by eye.

// How fast everything moves, beside the pace of a sunlit pool. At a quarter of it, the net
// drifts and reshapes slowly enough to sit behind a heading.
const SPEED = 0.25;
// The size of the net and of the waves, beside their sizes in the tables that follow.
const SCALE = 0.85;
// The brightness of the light. Under 1, fewer lines reach full gold and fewer knots flare.
const STRENGTH = 0.65;

// The trains of waves on the water's surface. Each has the direction it travels in degrees
// clockwise from the right of the page, its length in CSS pixels, the seconds it takes to pass a
// point, and the steepness of its faces. No two travel the same way, and a shorter wave is
// slower and less steep, which is how open water behaves.
const WAVES = [
  { angle: 24, length: 560, period: 7.3, slope: 1 },
  { angle: 118, length: 365, period: 5.9, slope: 0.85 },
  { angle: 251, length: 228, period: 4.7, slope: 0.7 },
  { angle: 333, length: 141, period: 3.7, slope: 0.5 },
  { angle: 67, length: 88, period: 2.9, slope: 0.34 },
  { angle: 196, length: 57, period: 2.3, slope: 0.22 },
] as const;

// The noise that bends the wave fronts, so they curve and never read as straight stripes.
const BEND = {
  // The size of one cell of the bending noise, in CSS pixels.
  cell: 420,
  // How far the noise moves a wave front, in CSS pixels. Much more than a fifth of the cell
  // folds the fronts over themselves.
  reach: 90,
  // The seconds that the two clocks of the noise take for one turn. Each corner of the noise
  // turns at a small whole multiple of both, so the noise wraps exactly and still never
  // repeats in a time that anyone would notice.
  periodA: 37,
  periodB: 53,
} as const;

// The net of light.
const NET = {
  // The size of one cell of the main net, in CSS pixels.
  cell: 132,
  // How far a wave's slope swings the net, in CSS pixels for a slope of 1. This is the motion
  // that reads as water: a line swings one way and back as each wave passes over it.
  swing: 14,
  // The length of the shortest wave that swings the net by its whole slope, in CSS pixels. A
  // shorter wave swings it by a share of its slope, as its length is to this. Short waves
  // change the swing over a short distance, and that folds the net over itself.
  fullSwing: 200,
  // How far each point that shapes the net strays from the middle of its grid square, as a
  // share of the square. The cells breathe as the points move. Under about 0.3, the cells are
  // so alike that the grid shows. Above 0.4, a point's cell can reach past the squares that the
  // shader searches for its walls.
  orbit: 0.36,
  // The seconds that the two clocks of the points take for one turn. Each point circles at a
  // small whole multiple of each, in its own direction.
  orbitPeriodA: 17,
  orbitPeriodB: 23,
  // How much taller than wide the cells are drawn, so the net runs along the waves' crests.
  stretch: 0.8,
  // How far slow noise bends the net's plane, in cells, and the size of that noise in cells. It
  // makes the lines curve like ripples, where straight lines would read as polygons.
  warp: 0.4,
  warpCell: 2.5,
  // A bend the size of one cell, which curves each line along its own length.
  curl: 0.18,
  curlCell: 1.15,
  // A finer, quicker bend on top of the others, which gives the lines their shimmer.
  shimmer: 0.05,
  shimmerCell: 0.5,
  // How far a bend may stretch the plane before a line is thinned to make up for it, as a share
  // of the plane's size at rest. Under this, the stretch is left alone, because it gives the
  // lines their uneven widths.
  stretchLimit: 0.55,
  // The second net: how many of its cells fit across one cell of the main net, the angle
  // between the two, in degrees, and how bright its lines are beside the main net's. Light is
  // bright only where the two nets agree, which breaks the main net into filaments of uneven
  // brightness.
  secondRatio: 1.73,
  secondAngle: 37,
  secondGain: 0.45,
  // How fast each net drifts, in CSS pixels a second, as x and y. The two drift apart, so the
  // places where they agree travel.
  driftA: [5, 2.5],
  driftB: [-3.5, 6],
  // How far from a line of one net the other net still counts as agreeing, in cells.
  agree: 0.4,
  // The share of a line's light that survives where the other net doesn't agree at all, for
  // the main net and for the second. The second net keeps less, so it shows as fine structure
  // beside the main net's lines and leaves the middles of the large cells dark.
  floor: 0.45,
  secondFloor: 0.22,
  // Half the width of a line's bright core where the light is strongest, in cells.
  core: 0.011,
  // The width of the soft halo around a core, in cells, and how bright it is beside the core.
  halo: 0.09,
  haloGain: 0.1,
  // How far a bright line of the main net throws a glow on the floor beside it, in cells.
  glow: 0.2,
  // How much wider a line is where the light isn't gathered, and how much of its brightness
  // it keeps there. A dim line is soft, because a thin dim line reads as a crack.
  spread: 1.7,
  dim: 0.6,
  // The strength of the light at which a line starts to show a sharp core, and the strength at
  // which the core is whole.
  sharpFrom: 0.25,
  sharpTo: 0.9,
  // How far a line opens into a pair of lines, in cells, where the light folds, and how bright
  // the light between the pair is.
  split: 0.028,
  fill: 0.15,
  // How close three cells must come, in cells, for the place to count as a knot. A knot flares.
  knot: 0.16,
  // How much the surface's curvature gathers the light. Where a wave's crest passes, the lines
  // under it brighten and sharpen, and under a trough they fade.
  focus: 0.75,
} as const;

// The colors, as red, green, and blue from 0 to 1: the site's `--black`, the brown of the
// marble's clouding, and its `--deep`, `--gold`, and `--bright`.
const BLACK = [0.043, 0.035, 0.027] as const;
const BROWN = [0.3, 0.21, 0.07] as const;
const DEEP = [0.431, 0.29, 0.024] as const;
const GOLD = [0.886, 0.725, 0.231] as const;
const BRIGHT = [1, 0.953, 0.682] as const;
// How strongly the brown shows on the floor beside a bright line.
const FLOOR_GLOW = 0.2;
// The share of the light that the darkest of the large, slow patches of floor keeps.
const DARKEST_PATCH = 0.35;

// A canvas narrower than this many CSS pixels draws everything smaller, in proportion, down to
// this share of the full size. The stage on a phone is a short strip, and at the full size it
// would hold too few cells of the net to read as one.
const NARROW_WIDTH = 720;
const NARROW_SCALE = 0.7;

// The water takes this long to reach its speed after it starts, and this long to come to rest
// after a pause, in milliseconds, so it neither starts nor stops with a jerk.
const RISE_MS = 600;
const FALL_MS = 400;
// The frames drawn in a second: the rate that the look was approved at, and the rate that a
// device that can't hold it steps down to.
const FULL_RATE = 60;
const HALF_RATE = 30;
// A frame counts as due this many milliseconds early. The browser's frames don't arrive at exact
// intervals, and a frame that came a moment early would otherwise wait for the one after it. The
// slack is small enough that two frames of a display of 144 frames a second, 13.9 ms, don't count
// as one frame at 60, so the water draws at an even cadence on displays from 50 to 240 frames a
// second. At 60, displays of 60, 120, and 240 draw 60 a second, a display of 50 draws every
// frame, 75 and 90 draw every second frame, for 37.5 and 45, and 144 draws every third, for 48.
const FRAME_SLACK_MS = 1.5;
// The longest step that one frame adds to the clock, so a stall doesn't show as a jump.
const LONGEST_STEP_MS = 100;
// The pixel ratio is never above this, however dense the screen is.
const HIGHEST_PIXEL_RATIO = 2;
// The most pixels the canvas may hold, which bounds the work of a frame on a large screen. It's
// set so that the stage in a 1440 by 900 window gets two pixels for each CSS pixel.
const MOST_BACKING_PIXELS = 4_500_000;
// The average time between drawn frames, in milliseconds, that counts as not keeping up at each
// rate. A late frame waits for the display's next frame, so the gaps come in whole frames of the
// display, never shorter than the frame limiter allows, and a device that's too slow settles on
// one of them. Each threshold lies between those gaps for displays of 60, 75, 90, 120, and 144
// frames a second, so a steady device never sits on it. At 60, the gaps under it are 16.7, 20.8,
// 22.2, 25, 26.7, and 27.8, and the first over it is 33.3. At 30, the gaps under it are 33.3,
// 34.7, 40, 41.7, and 44.4, and the first over it is 48.6.
// On a display of 60 frames a second, each is passed when about three frames in four are late,
// which is far enough from the target that an ordinary stutter doesn't count.
const SLOW_FULL_RATE_MS = 29;
const SLOW_HALF_RATE_MS = 46;
// What a step down in resolution multiplies the pixel ratio by, which about halves the number
// of pixels.
const QUALITY_STEP = 0.7;
// A step down never takes the pixel ratio under this, because the lines blur more with each
// step, and past this point the water costs the picture more than it adds.
const LOWEST_PIXEL_RATIO = 0.75;
// How long after a start, a resume, or a change of the canvas's size the pace doesn't count
// frames, in milliseconds, because the first frames of a run pay for work that the later ones
// don't. A step down in quality changes the size, so it starts a warm-up. The step down to 30
// frames a second doesn't, because it leaves the work of each frame as it was.
const WARM_UP_MS = 250;
// How long the first setup may wait for the browser to be idle, in milliseconds, and how long it
// waits in a browser that can't say when it's idle.
const IDLE_TIMEOUT_MS = 2000;
const IDLE_FALLBACK_MS = 200;

/**
 * The record that decides when a device can't keep up: the frames a second that it aims for, the
 * quality factor so far, from 1 down, and the count and the total time, in milliseconds, of the
 * drawn frames in the current window.
 */
export interface Pace {
  rate: typeof FULL_RATE | typeof HALF_RATE;
  quality: number;
  frames: number;
  elapsed: number;
}

// The pace that a slow device has stepped down to. It's kept here, and not in each mount, so the
// next page in the same visit starts at the lower rate or resolution and doesn't sit through
// another window of slow frames first. Module state is safe for this because only `mountWater()`
// reads or writes it, and that runs only in the browser. The server evaluates this module too,
// and there the value never changes. It only ever goes down, through `lowerSharedPace()`, so a
// canvas that keeps up can't step the next page back up after another canvas stepped it down.
let sharedPace: Pace = { rate: FULL_RATE, quality: 1, frames: 0, elapsed: 0 };

// Takes the shared pace down to the given pace's rate and quality, wherever either is lower.
function lowerSharedPace(pace: Pace): void {
  sharedPace = {
    rate: pace.rate === HALF_RATE || sharedPace.rate === HALF_RATE ? HALF_RATE : FULL_RATE,
    quality: Math.min(pace.quality, sharedPace.quality),
    frames: 0,
    elapsed: 0,
  };
}

/**
 * The number of canvas pixels to one CSS pixel, for a canvas of the given size in CSS pixels. It's
 * the device's ratio, capped at 2, and lower where the canvas would otherwise hold more than about
 * four and a half million pixels. `quality` is the factor from `paceAfterFrame()`, which lowers
 * the ratio further on a device that can't keep up, but never under 0.75 unless the ratio was
 * already under that.
 */
export function backingRatio(
  width: number,
  height: number,
  devicePixelRatio: number,
  quality = 1,
): number {
  let ratio = Math.min(devicePixelRatio, HIGHEST_PIXEL_RATIO);
  const area = width * height;
  if (area * ratio * ratio > MOST_BACKING_PIXELS) {
    ratio = Math.sqrt(MOST_BACKING_PIXELS / area);
  }
  return Math.max(ratio * quality, Math.min(ratio, LOWEST_PIXEL_RATIO));
}

/**
 * Adds one drawn frame to the pace, given the time since the frame before it in milliseconds, and
 * returns the new pace. A window is one second of frames at the pace's rate: 60 frames, or 30.
 * When a window at 60 frames a second averages over 29 milliseconds a frame, the rate drops to
 * 30, and the resolution stays. When a window at 30 averages over 46 milliseconds, the quality
 * drops to 0.7 of what it was. The rate goes first because slow water loses less to a lower
 * frame rate than to a softer picture. Each step starts a new window. Neither the rate nor the
 * quality rises again, so the picture doesn't change back and forth, and the quality stops at
 * the factor that takes a pixel ratio of 2 to 0.75. A single long gap counts as 100 milliseconds
 * at most, so one stall can't fill a window on its own.
 */
export function paceAfterFrame(pace: Pace, gap: number): Pace {
  const frames = pace.frames + 1;
  const elapsed = pace.elapsed + Math.min(gap, LONGEST_STEP_MS);
  if (frames < pace.rate) {
    return { rate: pace.rate, quality: pace.quality, frames, elapsed };
  }
  const average = elapsed / frames;
  if (pace.rate === FULL_RATE) {
    const rate = average > SLOW_FULL_RATE_MS ? HALF_RATE : FULL_RATE;
    return { rate, quality: pace.quality, frames: 0, elapsed: 0 };
  }
  const lowest = LOWEST_PIXEL_RATIO / HIGHEST_PIXEL_RATIO;
  return {
    rate: HALF_RATE,
    quality:
      average > SLOW_HALF_RATE_MS ? Math.max(pace.quality * QUALITY_STEP, lowest) : pace.quality,
    frames: 0,
    elapsed: 0,
  };
}

/**
 * The size of the pattern for a canvas of the given width in CSS pixels, as a factor on the sizes
 * in this module's tables. It's the approved scale for a canvas 720 pixels wide or wider. A
 * narrower canvas gets a smaller pattern, in proportion to its width, down to 0.7 of that. The
 * factor depends on the width alone, so the pattern is the same size at every pixel ratio, and
 * the same size on every page whose canvas is 720 CSS pixels wide or wider.
 */
export function patternScale(width: number): number {
  return SCALE * Math.min(1, Math.max(NARROW_SCALE, width / NARROW_WIDTH));
}

/**
 * Whether a frame that the browser offers is due, given the frames a second that the pace aims
 * for and the milliseconds since the last drawn frame. The first frame of a run, with no last
 * frame, is always due. Any other frame is due from 1.5 milliseconds before a whole interval of
 * the rate has passed, so a frame that arrives a moment early still draws.
 */
export function frameDue(rate: Pace["rate"], sinceLast: number | undefined): boolean {
  return sinceLast === undefined || sinceLast >= 1000 / rate - FRAME_SLACK_MS;
}

// Slow at both ends, so the water neither starts nor stops with a jerk.
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * A clock's place in its turn, from 0 up to 1, given the clock and the length of one turn in the
 * same unit. The division happens here, in double precision, so the shader never sees a large
 * number.
 */
export function turn(clock: number, period: number): number {
  const turns = clock / period;
  return turns - Math.floor(turns);
}

// A number as a GLSL float literal, which needs a decimal point or an exponent.
function glsl(value: number): string {
  const text = value.toPrecision(7);
  return text.includes(".") || text.includes("e") ? text : `${text}.0`;
}

function vec3(values: readonly [number, number, number]): string {
  return `vec3(${values.map(glsl).join(", ")})`;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// One triangle that covers the whole canvas, made from the vertex number alone, so the program
// needs no buffer.
const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

// What scales the curvature of the surface to about -1 to 1. A wave's true curvature is its
// slope over its length, which leaves nearly all of it to the shortest waves, and the light
// would then gather in spots the size of those waves and nowhere else. Each wave counts by the
// square root of that here, so the long waves gather the light in broad, slow bands, and the
// short ones add a finer play of light on top.
const CURVE_UNIT =
  1.5 * Math.sqrt(WAVES.reduce((sum, wave) => sum + (wave.slope * wave.slope) / wave.length, 0));

// Each wave adds a sine to the height of the surface. The shader needs how far the surface sways
// the light and how much it gathers it, which are the slope and the curvature of that height,
// and both come straight from the sine, so nothing is measured by finite differences.
const WAVE_TERMS = WAVES.map((wave, index) => {
  const x = glsl(Math.cos(radians(wave.angle)));
  const y = glsl(Math.sin(radians(wave.angle)));
  const frequency = glsl((2 * Math.PI) / wave.length);
  const sway = glsl(wave.slope * Math.min(1, wave.length / NET.fullSwing));
  const curve = glsl((wave.slope * Math.sqrt(1 / wave.length)) / CURVE_UNIT);
  return `  {
    float angle = dot(at, vec2(${x}, ${y})) * (${frequency} / uScale) - uWavePhase[${index}];
    sway += vec2(${x}, ${y}) * (${sway} * cos(angle));
    curve -= ${curve} * sin(angle);
  }`;
}).join("\n");

// The turn that takes the main net's plane to the second net's, as the four numbers of a matrix.
const SECOND_TURN = [
  Math.cos(radians(NET.secondAngle)),
  Math.sin(radians(NET.secondAngle)),
  -Math.sin(radians(NET.secondAngle)),
  Math.cos(radians(NET.secondAngle)),
]
  .map(glsl)
  .join(", ");

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

// The height of the canvas in its own pixels, and the size of one of those pixels in CSS pixels.
uniform float uPixelHeight;
uniform vec2 uCssPerPixel;
// The size of the pattern, as a factor on every length.
uniform float uScale;
// Fractions of a turn: two for the bending noise and two for the points of the nets.
uniform vec4 uTurn;
uniform float uWavePhase[${WAVES.length}];
// How far each net has drifted, in its own cells: the whole part and the fraction.
uniform ivec4 uDriftCell;
uniform vec4 uDriftFract;

out vec4 color;

// An integer hash, which gives the same noise on every GPU. A hash built on sin() doesn't. It
// needs all 32 bits, and a fragment shader's integers are only sure of 16 unless it asks for
// highp, as this one does. With 16, the hash collapses and the nets come out as grids.
uint hash(ivec3 cell) {
  uint h = uint(cell.x) * 0x9E3779B1u;
  h ^= h >> 15;
  h = (h ^ uint(cell.y)) * 0x85EBCA77u;
  h ^= h >> 13;
  h = (h ^ uint(cell.z)) * 0xC2B2AE3Du;
  h ^= h >> 16;
  h *= 0x2C1B3C6Du;
  h ^= h >> 15;
  return h;
}

// A whole number from -2 to 2 that is never 0, from two bits of a hash. It multiplies a clock,
// so every multiple keeps the clock's exact wrap.
float multiple(uint bits) {
  float size = float(1u + (bits & 1u));
  return (bits & 2u) == 0u ? size : -size;
}

// A cheap stand-in for the sine of a number of turns: two parabolas, joined smoothly, with a
// sine's period and its range. The shader moves tens of circling points for every pixel, and
// none of them needs a true circle.
vec2 swing(vec2 turns) {
  vec2 x = fract(turns) * 2.0 - 1.0;
  return 4.0 * x * (1.0 - abs(x));
}

// A vector at one corner of the noise, about one long, which turns at its own rate and in its
// own direction as the two clocks run.
vec2 spinner(ivec2 corner, int salt, vec2 turn) {
  uint h = hash(ivec3(corner, salt));
  float angle = float(h >> 8) * (1.0 / 16777216.0)
    + multiple(h) * turn.x + multiple(h >> 2) * turn.y;
  return swing(vec2(angle + 0.25, angle));
}

// Noise that churns in place: a field of vectors, smooth in space, in which every corner of the
// grid turns a full circle again and again. It moves like a slow current and never slides.
vec2 churn(vec2 p, int salt, vec2 turn) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(cell);
  return mix(
    mix(spinner(c, salt, turn), spinner(c + ivec2(1, 0), salt, turn), u.x),
    mix(spinner(c + ivec2(0, 1), salt, turn), spinner(c + ivec2(1, 1), salt, turn), u.x),
    u.y
  );
}

// The surface of the water at a point, from the trains of waves: how far it sways the light on
// the floor, and its curvature, each scaled to about -1 to 1. The sway is the slope with less of
// the short waves in it. It also gives the bending noise at the point, from -1 to 1 each way,
// for whatever else needs a slow, broad noise.
void surface(vec2 p, out vec2 bend, out vec2 sway, out float curve) {
  bend = churn(p / (${glsl(BEND.cell)} * uScale), 3, uTurn.xy);
  vec2 at = p + bend * (${glsl(BEND.reach)} * uScale);
  sway = vec2(0.0);
  curve = 0.0;
${WAVE_TERMS}
}

// A point of a net, as an offset from a grid square's corner: it circles the middle of the square
// at its own rate and in its own direction.
vec2 point(ivec2 square, int salt, vec2 turn) {
  uint h = hash(ivec3(square, salt));
  vec2 start = vec2(float(h & 0xFFFFu), float(h >> 16)) * (1.0 / 65536.0);
  vec2 around = start + vec2(multiple(h >> 5) * turn.x, multiple(h >> 9) * turn.y);
  return 0.5 + ${glsl(NET.orbit)} * swing(around);
}

// One net: the walls between the cells of the points. The answer holds the distance to the
// nearest wall, the distance to the nearest point, and how much farther away the third nearest
// point is, which is near zero at a knot where three cells meet. Distances are in cells. Each of
// the three is the same on both sides of a wall, so a line drawn from them has no seam down its
// middle.
vec3 net(vec2 q, ivec2 drift, int salt, vec2 turn) {
  vec2 square = floor(q);
  vec2 f = q - square;
  ivec2 base = ivec2(square) + drift;
  // First, the point that owns this place: the nearest of the nine around it.
  float nearest = 9.0;
  ivec2 owner = ivec2(0);
  vec2 mine = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 side = ivec2(x, y);
      vec2 to = vec2(side) + point(base + side, salt, turn) - f;
      float d = dot(to, to);
      if (d < nearest) {
        nearest = d;
        owner = side;
        mine = to;
      }
    }
  }
  // Then the walls of that point's cell. The wall between two points is the line that's as far
  // from one as from the other, and the nearest of those lines is the cell's edge. The search
  // is around the owner's square and not this one, so every pixel of a cell searches the same
  // squares, and the answer has no seams where the search would otherwise change. This is the
  // true distance to the edge, so a line keeps its width along its length. The search reaches
  // two squares out, less the four corners, because a point can share a wall with one that's a
  // knight's move away, and a search of the nine squares would leave that wall undrawn.
  float wall = 9.0;
  float second = 9.0;
  float third = 9.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      if ((x == 0 && y == 0) || abs(x * y) == 4) {
        continue;
      }
      ivec2 side = owner + ivec2(x, y);
      vec2 to = vec2(side) + point(base + side, salt, turn) - f;
      vec2 across = to - mine;
      wall = min(wall, dot(0.5 * (mine + to), across) * inversesqrt(max(dot(across, across), 1e-8)));
      float d = dot(to, to);
      if (d < second) {
        third = second;
        second = d;
      } else if (d < third) {
        third = d;
      }
    }
  }
  return vec3(wall, sqrt(nearest), sqrt(third) - sqrt(nearest));
}

// The light of one net at a point, given how near the other net's lines are and the share of
// its light that it keeps where they're far. Where the two nets agree and the surface gathers
// the light, a line has a sharp, bright core, and it's brightest and widest where its wall is
// far from the points that shape it and where walls meet. Where they don't, the light is spread
// thin, and only a soft, dim line remains. Where the split is above zero, a sharp line opens
// into a pair of lines with light between them, which is what a fold of light does before it
// closes again. The answer holds the light of the line with its halo, the flare of a knot, and
// the glow that a bright line throws on the floor beside it.
vec3 filament(vec3 n, float other, float least, float focus, float pixel, float split) {
  float agree = mix(least, 1.0, exp(-other * ${glsl(1 / NET.agree)}));
  float open = smoothstep(0.18, 0.62, n.y);
  float knot = exp(-n.z * ${glsl(1 / NET.knot)});
  float gain = (0.45 + 0.55 * open) * agree * focus;
  float sharp = smoothstep(${glsl(NET.sharpFrom)}, ${glsl(NET.sharpTo)}, gain);
  // Light that isn't gathered spreads wider. The line narrows before it brightens, so a line
  // that's lit along a short stretch doesn't swell into a blob there. A core is never thinner
  // than a pixel, so a faint line fades and doesn't break into dots.
  float tight = smoothstep(${glsl(NET.sharpFrom * 0.6)}, ${glsl(NET.sharpFrom * 1.8)}, gain);
  float width = ${glsl(NET.core)} * (0.6 + 0.9 * gain + knot * sharp) * mix(${glsl(NET.spread)}, 1.0, tight);
  width = max(width, 0.75 * pixel);
  // A pair never opens wider than the cell beside it has room for.
  float gap = min(split * sharp, 0.25 * n.y);
  float across = (n.x - gap) / width;
  float core = 1.0 / (1.0 + across * across);
  core *= sqrt(core);
  // The gap is 0 wherever the pair stays closed, and smoothstep() with equal edges is undefined,
  // so the upper edge never reaches 0.
  float between = ${glsl(NET.fill)} * (1.0 - smoothstep(0.0, max(gap, 1e-6), n.x)) * smoothstep(0.0, 2.0 * width, gap);
  float halo = ${glsl(NET.haloGain)} * exp(-max(n.x - gap, 0.0) * ${glsl(1 / NET.halo)});
  float amount = gain * mix(${glsl(NET.dim)}, 1.0, sharp);
  return vec3(
    amount * (core + between + halo),
    amount * sharp * knot * core,
    gain * sharp * exp(-n.x * ${glsl(1 / NET.glow)})
  );
}

// The light on the floor at a point in CSS pixels, under a surface with the given sway and
// curvature: x is the light of the lines, y is the flare of the knots, and z is the glow that a
// bright line throws on the floor beside it.
vec3 light(vec2 p, vec2 sway, float curve) {
  float cell = ${glsl(NET.cell)} * uScale;
  vec2 q = (p + sway * (${glsl(NET.swing)} * uScale)) / cell;
  q.y *= ${glsl(NET.stretch)};
  // Each bend is taken at the place that the bend before it left, and none is steep enough to
  // fold the plane alone, so the plane never folds over itself.
  vec2 warp = churn(q * ${glsl(1 / NET.warpCell)}, 5, uTurn.xy);
  q += warp * ${glsl(NET.warp)};
  q += churn(q * ${glsl(1 / NET.curlCell)}, 9, uTurn.yx) * ${glsl(NET.curl)};
  q += churn(q * ${glsl(1 / NET.shimmerCell)}, 7, uTurn.zw) * ${glsl(NET.shimmer)};
  vec2 qb = mat2(${SECOND_TURN}) * q * ${glsl(NET.secondRatio)};
  qb += churn(qb * ${glsl(1 / NET.curlCell)}, 21, uTurn.xy) * ${glsl(NET.curl)};
  vec3 a = net(q + uDriftFract.xy, uDriftCell.xy, 11, uTurn.zw);
  vec3 b = net(qb + uDriftFract.zw, uDriftCell.zw, 13, uTurn.wz);
  // A crest gathers the light and a trough spreads it.
  float focus = clamp(1.0 + ${glsl(NET.focus)} * curve, 0.6, 1.7);
  // How the bends have left the plane at this pixel. A bend can squeeze the plane, and a line
  // must stay a pixel wide there, so the first number is the size of one of the canvas's
  // pixels in cells. A bend can also stretch the plane, and where it stretches it far, a line
  // would swell into a blob. The second number is how far the plane is stretched along its most
  // stretched direction, beside the plane at rest, and past a limit the distance to a wall
  // grows by as much, which keeps the line a line.
  vec2 across = dFdx(q);
  vec2 down = dFdy(q);
  float pixel = max(length(across), length(down));
  float spread = dot(across, across) + dot(down, down);
  float area = across.x * down.y - across.y * down.x;
  float least = sqrt(max(0.5 * (spread - sqrt(max(spread * spread - 4.0 * area * area, 0.0))), 0.0));
  float thin = clamp(${glsl(NET.stretchLimit)} * uCssPerPixel.x / (cell * max(least, 1e-6)), 1.0, 12.0);
  a.x *= thin;
  b.x *= thin;
  // Where the folds open, and how far. Over more than half the floor they stay closed. The
  // noise that bends the plane decides where, which saves a noise of its own.
  float split = ${glsl(NET.split)} * smoothstep(0.05, 0.6, warp.y);
  vec3 la = filament(a, b.x * ${glsl(1 / NET.secondRatio)}, ${glsl(NET.floor)}, focus, pixel, split);
  vec3 lb = filament(b, a.x * ${glsl(NET.secondRatio)}, ${glsl(NET.secondFloor)}, focus, pixel * ${glsl(NET.secondRatio)}, split * ${glsl(NET.secondRatio * 0.6)});
  return vec3(la.xy + ${glsl(NET.secondGain)} * lb.xy, la.z);
}

void main() {
  // The position in CSS pixels from the canvas's top left corner, so the pattern is the same
  // size at every pixel ratio.
  vec2 p = vec2(gl_FragCoord.x, uPixelHeight - gl_FragCoord.y) * uCssPerPixel;
  vec2 bend;
  vec2 sway;
  float curve;
  surface(p, bend, sway, curve);
  vec3 lit = light(p, sway, curve);

  // Large patches of brighter and darker floor, which churn slowly. They follow the noise that
  // bends the waves.
  float shallow = mix(${glsl(DARKEST_PATCH)}, 1.0, smoothstep(-0.6, 0.5, bend.y)) * ${glsl(STRENGTH)};
  float line = lit.x * shallow;
  float flare = lit.y * shallow;
  float glow = lit.z * shallow;

  // The floor is the page's black, with a little brown where a bright line lights it. A line's
  // halo is deep gold, its core is gold, and only a knot reaches the highlight, so nothing is
  // ever brighter than the gold of the page's own content.
  vec3 c = ${vec3(BLACK)} + ${vec3(BROWN)} * (glow * ${glsl(FLOOR_GLOW)});
  c = mix(c, ${vec3(DEEP)}, smoothstep(0.02, 0.45, line) * 0.8);
  c = mix(c, ${vec3(GOLD)}, smoothstep(0.3, 1.3, line));
  c = mix(c, ${vec3(BRIGHT)}, smoothstep(0.6, 1.6, flare));

  // A step of under one part in 255, different in every pixel and the same in every frame. It
  // breaks up the bands that a dark, slow gradient would otherwise show, and it never flickers.
  uint h = hash(ivec3(gl_FragCoord.xy, 17));
  c += (float(h >> 8) * (1.0 / 16777216.0) - 0.5) * (1.0 / 255.0);
  color = vec4(c, 1.0);
}
`;

interface Program {
  program: WebGLProgram;
  pixelHeight: WebGLUniformLocation | null;
  cssPerPixel: WebGLUniformLocation | null;
  scale: WebGLUniformLocation | null;
  turn: WebGLUniformLocation | null;
  wavePhase: WebGLUniformLocation | null;
  driftCell: WebGLUniformLocation | null;
  driftFract: WebGLUniformLocation | null;
}

// Returns null when a shader doesn't compile, the program doesn't link, or the context is lost.
function buildProgram(gl: WebGL2RenderingContext): Program | null {
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  if (vertex === null || fragment === null) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  gl.shaderSource(vertex, VERTEX_SHADER);
  gl.compileShader(vertex);
  gl.shaderSource(fragment, FRAGMENT_SHADER);
  gl.compileShader(fragment);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // A linked program keeps what it needs of its shaders.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  // A program links only if both of its shaders compiled, so this one answer covers all three.
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);
  return {
    program,
    pixelHeight: gl.getUniformLocation(program, "uPixelHeight"),
    cssPerPixel: gl.getUniformLocation(program, "uCssPerPixel"),
    scale: gl.getUniformLocation(program, "uScale"),
    turn: gl.getUniformLocation(program, "uTurn"),
    wavePhase: gl.getUniformLocation(program, "uWavePhase"),
    driftCell: gl.getUniformLocation(program, "uDriftCell"),
    driftFract: gl.getUniformLocation(program, "uDriftFract"),
  };
}

/**
 * A net's drift along one axis after `clock` seconds at `speed` CSS pixels a second, in cells of
 * `cell` CSS pixels: the whole part, which shifts which cell is which, and the fraction, from 0 up
 * to 1, which the shader adds to the position. The split happens here, in double precision, so
 * the shader never sees a large number. The whole part wraps to a signed 32-bit integer, which is
 * what a shader's integer holds. The wrap is exact: the shader's hash works modulo 2 to the 32nd,
 * so a wrapped cell gets the same point as the cell it stands for, and the net never jumps, even
 * when a negative speed takes the whole part below zero.
 */
export function drift(
  clock: number,
  speed: number,
  cell: number,
): { whole: number; fraction: number } {
  const cells = (clock * speed) / cell;
  const whole = Math.floor(cells);
  return { whole: whole | 0, fraction: cells - whole };
}

/**
 * Runs the light on a canvas that lies over the marble, and returns a function that stops it and
 * frees what it holds. Nothing happens until motion is first allowed, so a visitor with a still
 * page never creates a WebGL context. The canvas gets a `data-ready` attribute once it has drawn a
 * frame, and loses it when the context is lost, so the stylesheet shows the canvas only while it
 * has a picture. A pause holds the frame that the canvas shows. A system that asks for reduced
 * motion takes the attribute away, which brings the still marble back. A browser that can't run
 * the shader leaves the canvas empty, and this never throws. The function that stops the light
 * gives up the WebGL context of a canvas that has left the document, and keeps the context of one
 * that's still there, so the same canvas can be mounted again.
 */
export function mountWater(canvas: HTMLCanvasElement): () => void {
  let disposed = false;
  let allowed = false;
  let onscreen = false;
  let width = 0;
  let height = 0;

  let cancelStart: (() => void) | undefined;
  let observers: { resize: ResizeObserver; intersection: IntersectionObserver } | undefined;
  let gl: WebGL2RenderingContext | null = null;
  let built: Program | null = null;

  let frameRequest = 0;
  let lastFrame: number | undefined;
  // The water's clock, in seconds. It advances only in a drawn frame.
  let clock = 0;
  // How much of its speed the water has, before easing, from 0 to 1.
  let level = 0;
  // A frame is owed even when nothing moves: the first one, and one after each change of size.
  let owed = true;
  // Whether the canvas carries `data-ready`.
  let shown = false;
  let pace: Pace = { ...sharedPace, frames: 0, elapsed: 0 };
  // The pace counts no frame before this time.
  let warmUntil = 0;

  const visible = () => onscreen && !document.hidden && width > 0 && height > 0;
  // A system that asks for reduced motion gets no frame at all, not even an owed one, because
  // the still marble is its picture.
  const drawable = () => built !== null && visible() && !reducedMotionRequested();
  const moving = () => allowed || level > 0;

  function stopLoop() {
    if (frameRequest !== 0) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
    // The next frame starts a new run of the clock, so the time the loop was stopped for doesn't
    // count.
    lastFrame = undefined;
    // A pause eases the water to rest only while the loop runs. With the loop stopped, there's
    // nobody to see the ease, and leaving it for later would move the water after the visitor
    // paused it, when the canvas next comes on screen.
    if (!allowed) {
      level = 0;
    }
  }

  function hide() {
    shown = false;
    delete canvas.dataset.ready;
  }

  // Frees everything. `keepContext` leaves the WebGL context alive for a canvas that stays in the
  // document, because a canvas has one context for its whole life, and a lost one would be all
  // that the next mount on the same canvas could get.
  function dispose(keepContext: boolean) {
    if (disposed) {
      return;
    }
    disposed = true;
    stopLoop();
    cancelStart?.();
    stopWatching();
    stopFollowing();
    observers?.resize.disconnect();
    observers?.intersection.disconnect();
    document.removeEventListener("visibilitychange", update);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    hide();
    if (gl !== null) {
      if (built !== null) {
        gl.deleteProgram(built.program);
      }
      if (!keepContext) {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    }
    built = null;
    gl = null;
  }

  // Any failure ends the light for this canvas, and the still marble under it keeps showing.
  function fail() {
    dispose(false);
  }

  function onContextLost(event: Event) {
    // Without this, the browser never restores the context.
    event.preventDefault();
    stopLoop();
    hide();
    // The lost context's objects are gone with it.
    built = null;
    // A restored context starts the water from rest, as the first one did.
    level = 0;
  }

  function onContextRestored() {
    owed = true;
    build();
    update();
  }

  function build() {
    if (gl === null) {
      return;
    }
    built = buildProgram(gl);
    // A lost context can't build anything, and it isn't a failure: its restoration builds again.
    if (built === null && !gl.isContextLost()) {
      fail();
    }
  }

  // Creates the context. It runs once, when the canvas is first on screen with motion allowed.
  function setUp() {
    gl = canvas.getContext("webgl2", {
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      // A browser without a usable GPU would run the shader on the CPU, where a frame takes far
      // longer than the pace can step down to. It gets no context, and the still marble stays.
      failIfMajorPerformanceCaveat: true,
    });
    if (gl === null) {
      fail();
      return;
    }
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    build();
  }

  function draw(now: number, seconds: number) {
    if (gl === null || built === null) {
      return;
    }
    const ratio = backingRatio(width, height, window.devicePixelRatio, pace.quality);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    // A change to the canvas's own size clears it, so it happens here, where a draw follows in
    // the same frame, and never in the resize observer.
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      warmUntil = now + WARM_UP_MS;
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);

    const step = allowed ? (seconds * 1000) / RISE_MS : (-seconds * 1000) / FALL_MS;
    level = Math.min(1, Math.max(0, level + step));
    clock += seconds * SPEED * ease(level);

    const scale = patternScale(width);
    const cell = NET.cell * scale;
    const driftAX = drift(clock, NET.driftA[0], cell);
    const driftAY = drift(clock, NET.driftA[1], cell);
    const driftBX = drift(clock, NET.driftB[0] * NET.secondRatio, cell);
    const driftBY = drift(clock, NET.driftB[1] * NET.secondRatio, cell);
    gl.uniform1f(built.pixelHeight, pixelHeight);
    gl.uniform2f(built.cssPerPixel, width / pixelWidth, height / pixelHeight);
    gl.uniform1f(built.scale, scale);
    gl.uniform4f(
      built.turn,
      turn(clock, BEND.periodA),
      turn(clock, BEND.periodB),
      turn(clock, NET.orbitPeriodA),
      turn(clock, NET.orbitPeriodB),
    );
    // Each phase is wrapped to one turn, so the waves stay smooth however long the page stays
    // open.
    gl.uniform1fv(
      built.wavePhase,
      WAVES.map((wave) => turn(clock, wave.period) * 2 * Math.PI),
    );
    gl.uniform4i(built.driftCell, driftAX.whole, driftAY.whole, driftBX.whole, driftBY.whole);
    gl.uniform4f(
      built.driftFract,
      driftAX.fraction,
      driftAY.fraction,
      driftBX.fraction,
      driftBY.fraction,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now: number) {
    frameRequest = 0;
    if (!drawable()) {
      stopLoop();
      return;
    }
    const sinceLast = lastFrame === undefined ? undefined : now - lastFrame;
    if (!frameDue(pace.rate, sinceLast)) {
      frameRequest = requestAnimationFrame(frame);
      return;
    }
    lastFrame = now;
    // The pace counts only the gaps between the frames of one run, so the time that the loop was
    // stopped for never reads as a slow frame.
    if (sinceLast === undefined) {
      pace = { ...sharedPace, frames: 0, elapsed: 0 };
      warmUntil = now + WARM_UP_MS;
    } else if (now >= warmUntil) {
      pace = paceAfterFrame(pace, sinceLast);
      lowerSharedPace(pace);
    }
    try {
      draw(now, Math.min(sinceLast ?? 0, LONGEST_STEP_MS) / 1000);
    } catch {
      fail();
      return;
    }
    owed = false;
    if (!shown) {
      shown = true;
      canvas.dataset.ready = "";
    }
    if (moving()) {
      frameRequest = requestAnimationFrame(frame);
    } else {
      lastFrame = undefined;
    }
  }

  // Starts whatever the current state calls for, and stops the loop when the canvas can't be
  // seen. Every event that changes the state ends here.
  function update() {
    if (disposed) {
      return;
    }
    // The motion switch reports a change of its answer only, and a system can start to ask for
    // reduced motion while a pause already holds the answer at no. The subscription at the end
    // of `mountWater()` runs this on every change to the store, which catches that case at once.
    if (shown && reducedMotionRequested()) {
      hide();
    }
    if (observers === undefined) {
      if (allowed && cancelStart === undefined) {
        scheduleStart();
      }
      return;
    }
    if (gl === null) {
      if (!allowed || !visible()) {
        return;
      }
      setUp();
    }
    if (!drawable()) {
      stopLoop();
      return;
    }
    if (frameRequest === 0 && (moving() || owed)) {
      frameRequest = requestAnimationFrame(frame);
    }
  }

  // Watches the canvas's size and whether it's on screen. A canvas that the stylesheet doesn't
  // display is never on screen, so it never creates a context.
  function start() {
    cancelStart = undefined;
    if (disposed || !allowed) {
      return;
    }
    observers = {
      resize: new ResizeObserver((entries) => {
        const box = entries.at(-1)?.contentRect;
        if (box === undefined || (box.width === width && box.height === height)) {
          return;
        }
        width = box.width;
        height = box.height;
        owed = true;
        update();
      }),
      intersection: new IntersectionObserver((entries) => {
        onscreen = entries.at(-1)?.isIntersecting ?? false;
        update();
      }),
    };
    observers.resize.observe(canvas);
    observers.intersection.observe(canvas);
    document.addEventListener("visibilitychange", update);
  }

  // The first setup waits for the browser to be idle, so it doesn't compete with hydration.
  function scheduleStart() {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
      cancelStart = () => window.cancelIdleCallback(handle);
    } else {
      const handle = setTimeout(start, IDLE_FALLBACK_MS);
      cancelStart = () => clearTimeout(handle);
    }
  }

  const stopWatching = watchMotion((answer) => {
    allowed = answer;
    // A pause eases the water to rest while the loop runs, and the canvas keeps the frame that it
    // came to rest on. A system that asks for reduced motion gets the still marble back at once.
    if (!answer && reducedMotionRequested()) {
      hide();
    }
    update();
  });
  // `watchMotion()` stays quiet when the answer stays the same, such as when the system starts to
  // ask for reduced motion during a pause, so `update()` also hears every change to the store.
  // It subscribes after `watchMotion()`, and the store calls its listeners in that order, so
  // `allowed` already holds the new answer when `update()` runs.
  const stopFollowing = subscribeToMotion(update);

  // A canvas that has left the document is done with, so its context goes at once and doesn't
  // wait for garbage collection. A visitor who moves between pages would otherwise pile up live
  // contexts.
  return () => dispose(canvas.isConnected);
}
