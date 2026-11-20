// Script for the caustics lab in water.html. It draws moving light on the canvas in the home
// page's stage, in one of two looks, so the look can be chosen and tuned by eye before the app
// takes it. In "caustics", the gold veins are the light itself: the net of bright lines that
// sunlight makes on the floor of a pool, on black. In "surface", the marble picture is the floor
// of the pool, and the same light plays over it under a rippling surface that refracts it.
// Both looks share one model of the water: trains of waves that bend the light, and a net of
// light that the waves swing. Every value worth tuning is in a named object at the top.
//
// Query parameters, for review. The toolbar writes them to the address as you change a control,
// so the address always describes what you see.
//
// - `look=caustics|surface` chooses the look. The default is `caustics`.
// - `preset=chosen|pool|ocean` loads a preset's speed, scale, and strength. Only `caustics` has
//   presets, and `chosen` is its default.
// - `speed=<number>` multiplies the rate of every motion. 1 is the natural rate.
// - `scale=<number>` multiplies the size of the net and of the waves. 1 is the natural size.
// - `strength=<number>` multiplies the brightness of the light, and in `surface` the refraction
//   and the glints too.
// - `fps=30|60` caps the frames drawn in a second. The default is 60.
// - `chrome=0` hides the review toolbar.
// - `time=<seconds>` draws one frozen frame, the one that a page at this speed shows that many
//   seconds after it loads. Use it for a still image.
//
// For tests, `window.waterLab` holds two functions. `stats()` returns what the readout shows, with
// the count of frames drawn. `bench(frames)` draws that many frames back to back, waits for the
// GPU to finish each, and returns the milliseconds that one frame took.

// The numbers that set the look. They're tuned by eye.

// The trains of waves on the water's surface, which both looks share. Each has the direction it
// travels in degrees clockwise from the right of the page, its length in CSS pixels, the seconds
// it takes to pass a point, and the steepness of its faces. No two travel the same way, and a
// shorter wave is slower and less steep, which is how open water behaves. The short waves give
// the surface its ripple, and the long ones its swell.
const WAVES = [
  { angle: 24, length: 560, period: 7.3, slope: 1 },
  { angle: 118, length: 365, period: 5.9, slope: 0.85 },
  { angle: 251, length: 228, period: 4.7, slope: 0.7 },
  { angle: 333, length: 141, period: 3.7, slope: 0.5 },
  { angle: 67, length: 88, period: 2.9, slope: 0.34 },
  { angle: 196, length: 57, period: 2.3, slope: 0.22 },
];

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
};

// The net of light, which both looks share.
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
  // How far slow noise bends the net's plane, in cells, and the size of that noise in cells. It
  // makes the lines curve like ripples, where straight lines would read as polygons.
  warp: 0.4,
  warpCell: 2.5,
  // A finer, quicker bend on top of the slow one, which gives the lines their shimmer.
  shimmer: 0.05,
  shimmerCell: 0.5,
  // A bend the size of one cell, which curves each line along its own length.
  curl: 0.18,
  curlCell: 1.15,
  // How far a bend may stretch the plane before a line is thinned to make up for it, as a share
  // of the plane's size at rest. Under this, the stretch is left alone, because it gives the
  // lines their uneven widths.
  stretchLimit: 0.55,
  // How much taller than wide the cells are drawn, so the net runs along the waves' crests.
  stretch: 0.8,
  // How far a line opens into a pair of lines, in cells, where the light folds, and how bright
  // the light between the pair is.
  split: 0.028,
  fill: 0.15,
  // How bright the second net's lines are beside the main net's.
  secondGain: 0.45,
  // The second net: how many of its cells fit across one cell of the main net, and the angle
  // between the two, in degrees. Light is bright only where the two nets agree, which breaks
  // the main net into filaments of uneven brightness.
  secondRatio: 1.73,
  secondAngle: 37,
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
  // Half the width of a line's bright core where the light is strongest, in cells, and the
  // width of the soft halo around it.
  core: 0.011,
  halo: 0.09,
  // How bright the halo is beside the core.
  haloGain: 0.1,
  // How far a bright line of the main net throws a glow on the floor beside it, in cells.
  glow: 0.2,
  // How much wider a line is where the light isn't gathered, and how much of its brightness
  // it keeps there. A dim line is soft, because a thin dim line reads as a crack.
  spread: 1.7,
  dim: 0.6,
  // The strength of the light at which a line starts to show a sharp core, and the strength at
  // which the core is whole. Under the first, a line is only its halo.
  sharpFrom: 0.25,
  sharpTo: 0.9,
  // How close three cells must come, in cells, for the place to count as a knot. A knot flares.
  knot: 0.16,
  // How much the surface's curvature gathers the light. Where a wave's crest passes, the lines
  // under it brighten and sharpen, and under a trough they fade.
  focus: 0.75,
};

// Look 1: the veins are the light. The net is drawn on the page's black.
const CAUSTICS = {
  defaults: { speed: 0.25, scale: 0.85, strength: 0.65 },
  ranges: {
    speed: { min: 0, max: 3, step: 0.05 },
    scale: { min: 0.4, max: 3, step: 0.05 },
    strength: { min: 0, max: 2, step: 0.05 },
  },
  presets: {
    // The values that the site uses: a slow, fine, quiet net.
    chosen: { speed: 0.25, scale: 0.85, strength: 0.65 },
    // A sunlit pool floor: a tight, crisp, quick net.
    pool: { speed: 1, scale: 1, strength: 1 },
    // Light on deep sand: a large, soft, slow net.
    ocean: { speed: 0.6, scale: 1.5, strength: 0.9 },
  },
  // The page's black, a brown for the depth of the floor, and the three golds of the light, as
  // red, green, and blue from 0 to 1: `--black`, the marble's clouding, `--deep`, `--gold`, and
  // `--bright`.
  black: [0.043, 0.035, 0.027],
  brown: [0.3, 0.21, 0.07],
  deep: [0.431, 0.29, 0.024],
  gold: [0.886, 0.725, 0.231],
  bright: [1, 0.953, 0.682],
  // How strongly the brown shows on the floor beside a bright line.
  floorDepth: 0.2,
  // The share of the light that the darkest of the large, slow patches of floor keeps.
  patchFloor: 0.35,
};

// Look 2: the marble is the floor, under water that you can see.
const SURFACE = {
  defaults: { speed: 1, scale: 1, strength: 1 },
  ranges: {
    speed: { min: 0, max: 3, step: 0.05 },
    scale: { min: 0.4, max: 3, step: 0.05 },
    strength: { min: 0, max: 2, step: 0.05 },
  },
  presets: {},
  // How far a slope of 1 moves the marble under it, in CSS pixels.
  refraction: 9,
  // The marble's brightness where no light gathers, and how much the gathered light adds.
  ambient: 0.55,
  light: 0.9,
  // How much the glow beside a bright line adds to the marble under it.
  glow: 0.5,
  // The color that a line of light shows on the black between the veins, as red, green, and
  // blue. It's a dim gold, because black marble gives little of the light back.
  floorLight: [0.15, 0.11, 0.032],
  // The direction that the light comes from, in degrees clockwise from the right of the page,
  // and its height above the page, in degrees. 235 is the upper left.
  lightAngle: 235,
  lightHeight: 62,
  // How narrow a glint is. A larger value lights only the water that faces the light squarely.
  glintTightness: 420,
  // How bright a glint is.
  glint: 0.9,
  // How bright the sheen on a wave's face is, and how narrow.
  sheen: 0.05,
  sheenTightness: 40,
  // How much a slope of 1 tilts the surface for the light.
  tilt: 0.12,
  // The facets that glint: the size of the square that holds one, in CSS pixels, how far a
  // facet leans beside the waves' slopes, and the radius of a glint, in CSS pixels.
  facetCell: 9,
  facet: 1.6,
  glintSize: 1.3,
  // How much a trough darkens the marble under it, which gives the water a body.
  body: 0.1,
};

// A canvas narrower than this many CSS pixels draws everything smaller, in proportion, down to
// this share of the natural size. The stage on a phone is a short strip, and at the natural
// size it would hold too few cells of the net to read as one.
const NARROW_WIDTH = 720;
const NARROW_SCALE = 0.7;
// The pixel ratio is never above this, however dense the screen is.
const HIGHEST_PIXEL_RATIO = 2;
// The most pixels the canvas may hold, which bounds the work of a frame on a large screen. The
// stage in a 1440 by 900 window fits at two pixels for each CSS pixel.
const MOST_BACKING_PIXELS = 4_500_000;
// A frame counts as due this many milliseconds early. The browser's frames don't arrive at exact
// intervals, and a frame that came a moment early would otherwise wait for the one after it.
const FRAME_SLACK_MS = 3;
// The longest step that one frame adds to the clock, so a stall doesn't show as a jump.
const LONGEST_STEP_MS = 100;
// The readout describes the frames of this many milliseconds, and updates this often.
const STATS_WINDOW_MS = 4000;
const READOUT_EVERY_MS = 500;
// A new size must hold for this long before the marble is drawn again at that size, because
// drawing it runs the picture's turbulence filters.
const RESIZE_SETTLE_MS = 200;
// The address is rewritten when the controls have been still for this long.
const ADDRESS_SETTLE_MS = 250;
// The longest side of the marble texture, in pixels, on a GPU that allows it.
const LONGEST_TEXTURE_SIDE = 4096;
// The whole part of a clock wraps here, which keeps it inside what a shader's integer holds.
const TICK_WRAP = 1 << 20;

const LOOKS = { caustics: CAUSTICS, surface: SURFACE };
const MARBLE_URL = new URL("../../src/web/marble.svg", import.meta.url).href;
const MARBLE_WIDTH = 1600;
const MARBLE_HEIGHT = 1100;

// A number as a GLSL float literal, which needs a decimal point or an exponent.
function glsl(value) {
  const text = value.toPrecision(7);
  return text.includes(".") || text.includes("e") ? text : `${text}.0`;
}

function vec3(values) {
  return `vec3(${values.map(glsl).join(", ")})`;
}

function radians(degrees) {
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

// What scales the curvature to about -1 to 1. A wave's true curvature is its slope over its
// length, which leaves nearly all of it to the shortest waves, and the light would then gather in
// spots the size of those waves and nowhere else. Each wave counts by the square root of that
// here, so the long waves gather the light in broad, slow bands, and the short ones add a
// finer play of light on top.
const CURVE_UNIT =
  1.5 * Math.sqrt(WAVES.reduce((sum, wave) => sum + (wave.slope * wave.slope) / wave.length, 0));

// Each wave adds a sine to the height of the surface. The shader needs the slope and the
// curvature of that height, and both come straight from the sine, so nothing is measured by
// finite differences. A wave's steepness is fixed, so a shorter wave is lower.
const WAVE_TERMS = WAVES.map((wave, index) => {
  const x = glsl(Math.cos(radians(wave.angle)));
  const y = glsl(Math.sin(radians(wave.angle)));
  const frequency = glsl((2 * Math.PI) / wave.length);
  return `  {
    vec2 along = vec2(${x}, ${y});
    float k = ${frequency} / uScale;
    float angle = dot(at, along) * k - uWavePhase[${index}];
    float steep = ${glsl(wave.slope)} * cos(angle);
    slope += along * steep;
    sway += along * (steep * ${glsl(Math.min(1, wave.length / NET.fullSwing))});
    curve -= ${glsl((wave.slope * Math.sqrt(1 / wave.length)) / CURVE_UNIT)} * sin(angle);
    swell += ${glsl(wave.slope * wave.length)} * sin(angle);
  }`;
}).join("\n");
// The highest that the waves can be together, which scales the swell to about one.
const SWELL_SUM = WAVES.reduce((sum, wave) => sum + wave.slope * wave.length, 0);

// What every look's fragment shader starts with: the uniforms, the noise, the surface, and the
// net of light.
const SHARED = `#version 300 es
precision highp float;
precision highp int;

// The height of the canvas in its own pixels, and the size of one of those pixels in CSS pixels.
uniform float uPixelHeight;
uniform vec2 uCssPerPixel;
// The size of the canvas in CSS pixels.
uniform vec2 uSize;
uniform float uScale;
uniform float uStrength;
// Every clock arrives already wrapped, so the picture is as sharp after a day as after a second.
// These are fractions of a turn: two for the bending noise and two for the points of the net.
uniform vec4 uTurn;
uniform float uWavePhase[${WAVES.length}];
// How far each net has drifted, in its own cells: the whole part and the fraction.
uniform ivec4 uDriftCell;
uniform vec4 uDriftFract;

out vec4 color;

const float TAU = 6.283185307;

// An integer hash, which gives the same noise on every GPU. A hash built on sin() doesn't. It
// needs all 32 bits, and a fragment shader's integers are only sure of 16 unless it asks for
// highp, as this one does.
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

// A whole number from -2 to 2 that is never 0, from two bits of a hash. It multiplies a
// clock, so every multiple keeps the clock's exact wrap.
float multiple(uint bits) {
  float size = float(1u + (bits & 1u));
  return (bits & 2u) == 0u ? size : -size;
}

// A cheap stand-in for the sine of a number of turns: two parabolas, joined smoothly, with a
// sine's period and its range. The shader draws tens of circling points for every pixel, and
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

// The surface of the water at a point, from the trains of waves: its slope, how far it sways
// the light on the floor, its curvature, and the height of its swell, each scaled to about -1 to
// 1. The sway is the slope with less of the short waves in it. It also gives the bending noise
// at the point, from -1 to 1 each way, for whatever else needs a slow, broad noise.
void surface(
  vec2 p, out vec2 bend, out vec2 slope, out vec2 sway, out float curve, out float swell
) {
  bend = churn(p / (${glsl(BEND.cell)} * uScale), 3, uTurn.xy);
  vec2 at = p + bend * (${glsl(BEND.reach)} * uScale);
  slope = vec2(0.0);
  sway = vec2(0.0);
  curve = 0.0;
  swell = 0.0;
${WAVE_TERMS}
  swell *= ${glsl(1 / SWELL_SUM)};
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
  float between = ${glsl(NET.fill)} * (1.0 - smoothstep(0.0, gap, n.x)) * smoothstep(0.0, 2.0 * width, gap);
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
  vec2 warp = churn(q * ${glsl(1 / NET.warpCell)}, 5, uTurn.xy);
  q += warp * ${glsl(NET.warp)};
  q += churn(q * ${glsl(1 / NET.curlCell)}, 9, uTurn.yx) * ${glsl(NET.curl)};
  q += churn(q * ${glsl(1 / NET.shimmerCell)}, 7, uTurn.zw) * ${glsl(NET.shimmer)};
  vec2 qb = mat2(${glsl(Math.cos(radians(NET.secondAngle)))}, ${glsl(Math.sin(radians(NET.secondAngle)))}, ${glsl(-Math.sin(radians(NET.secondAngle)))}, ${glsl(Math.cos(radians(NET.secondAngle)))}) * q * ${glsl(NET.secondRatio)};
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
  float stretched = ${glsl(NET.stretchLimit)} * uCssPerPixel.x / (cell * max(least, 1e-6));
  float thin = clamp(stretched, 1.0, 12.0);
  a.x *= thin;
  b.x *= thin;
  // Where the folds open, and how far. Over more than half the floor they stay closed. The
  // noise that bends the plane decides where, which saves a noise of its own.
  float split = ${glsl(NET.split)} * smoothstep(0.05, 0.6, warp.y);
  vec3 la = filament(a, b.x * ${glsl(1 / NET.secondRatio)}, ${glsl(NET.floor)}, focus, pixel, split);
  vec3 lb = filament(b, a.x * ${glsl(NET.secondRatio)}, ${glsl(NET.secondFloor)}, focus, pixel * ${glsl(NET.secondRatio)}, split * ${glsl(NET.secondRatio * 0.6)});
  return vec3(la.xy + ${glsl(NET.secondGain)} * lb.xy, la.z);
}

// The position in CSS pixels from the canvas's top left corner, so a look is the same at every
// pixel ratio.
vec2 position() {
  return vec2(gl_FragCoord.x, uPixelHeight - gl_FragCoord.y) * uCssPerPixel;
}

// A step of under one part in 255, different in every pixel and the same in every frame. It
// breaks up the bands that a dark, slow gradient would otherwise show, and it never flickers.
vec3 dither(vec3 c) {
  uint h = hash(ivec3(gl_FragCoord.xy, 17));
  return c + (float(h >> 8) * (1.0 / 16777216.0) - 0.5) * (1.0 / 255.0);
}
`;

const FRAGMENT_SHADERS = {
  caustics: `${SHARED}
void main() {
  vec2 p = position();
  vec2 bend;
  vec2 slope;
  vec2 sway;
  float curve;
  float swell;
  surface(p, bend, slope, sway, curve, swell);
  vec3 lit = light(p, sway, curve);

  // Large patches of brighter and darker floor, which churn slowly. They follow the noise that
  // bends the waves.
  float shallow = mix(${glsl(CAUSTICS.patchFloor)}, 1.0, smoothstep(-0.6, 0.5, bend.y)) * uStrength;
  float line = lit.x * shallow;
  float flare = lit.y * shallow;
  float glow = lit.z * shallow;

  // The floor is the page's black, with a little brown where a bright line lights it. A line's
  // halo is deep gold, its core is gold, and only a knot reaches the highlight.
  vec3 c = ${vec3(CAUSTICS.black)} + ${vec3(CAUSTICS.brown)} * (glow * ${glsl(CAUSTICS.floorDepth)});
  c = mix(c, ${vec3(CAUSTICS.deep)}, smoothstep(0.02, 0.45, line) * 0.8);
  c = mix(c, ${vec3(CAUSTICS.gold)}, smoothstep(0.3, 1.3, line));
  c = mix(c, ${vec3(CAUSTICS.bright)}, smoothstep(0.6, 1.6, flare));
  color = vec4(dither(c), 1.0);
}
`,
  surface: `${SHARED}
uniform sampler2D uMarble;

void main() {
  vec2 p = position();
  vec2 bend;
  vec2 slope;
  vec2 sway;
  float curve;
  float swell;
  surface(p, bend, slope, sway, curve, swell);

  // Refraction: the water shows the marble that lies a little way down its slope. The texture
  // mirrors at its edges, so a lookup past an edge still finds marble.
  vec3 marble = texture(uMarble, (p + slope * (${glsl(SURFACE.refraction)} * uStrength)) / uSize).rgb;

  // The light on the floor. The marble is dimmer than it is dry, and the light brings it back:
  // a vein brightens as a line passes over it. On the black between the veins, a line shows
  // faintly, as a gold of its own.
  vec3 lit = light(p, sway, curve);
  float line = lit.x * uStrength;
  float lift = mix(1.0, ${glsl(SURFACE.ambient)} + ${glsl(SURFACE.glow)} * lit.z + ${glsl(SURFACE.light)} * min(line, 1.6), min(uStrength, 1.0));
  vec3 c = marble * lift + ${vec3(SURFACE.floorLight)} * line;
  // A trough holds more water over the floor, which darkens it.
  c *= 1.0 + ${glsl(SURFACE.body)} * swell * uStrength;

  // The surface itself. It's covered in facets too small to bend the light, one to a square of
  // a fine grid, each at its own place in the square and leaning its own way. A facet that
  // faces the light squarely glints, so the glints come and go as the waves tilt the facets,
  // and they crowd on the faces that lean toward the light. A faint sheen lies on those faces
  // too, which shows the shape of the waves.
  vec3 toLight = ${vec3([
    Math.cos(radians(SURFACE.lightAngle)) * Math.cos(radians(SURFACE.lightHeight)),
    Math.sin(radians(SURFACE.lightAngle)) * Math.cos(radians(SURFACE.lightHeight)),
    Math.sin(radians(SURFACE.lightHeight)),
  ])};
  vec3 halfway = normalize(toLight + vec3(0.0, 0.0, 1.0));
  vec2 g = p * ${glsl(1 / SURFACE.facetCell)};
  vec2 square = floor(g);
  uint h = hash(ivec3(ivec2(square), 31));
  vec2 chance = vec2(float(h & 0xFFFFu), float(h >> 16)) * (1.0 / 65536.0);
  float lean = TAU * fract(chance.x * 7.0 + chance.y * 3.0);
  vec2 leaning = ${glsl(SURFACE.facet)} * sqrt(fract(chance.x * 13.0 + chance.y * 5.0)) * vec2(cos(lean), sin(lean));
  vec2 off = (g - square - 0.3 - 0.4 * chance) * ${glsl(SURFACE.facetCell / SURFACE.glintSize)};
  vec3 facet = normalize(vec3(-(slope + leaning) * ${glsl(SURFACE.tilt)}, 1.0));
  vec3 face = normalize(vec3(-slope * ${glsl(SURFACE.tilt)}, 1.0));
  float glint = pow(max(dot(facet, halfway), 0.0), ${glsl(SURFACE.glintTightness)}) * exp(-dot(off, off)) * ${glsl(SURFACE.glint)};
  float sheen = pow(max(dot(face, halfway), 0.0), ${glsl(SURFACE.sheenTightness)}) * ${glsl(SURFACE.sheen)};
  c += ${vec3(CAUSTICS.gold)} * (sheen * uStrength);
  c = mix(c, ${vec3(CAUSTICS.bright)}, min(glint * uStrength, 1.0));
  // Nothing is brighter than the site's highlight, so a lit vein never burns out to white.
  c = min(c, ${vec3(CAUSTICS.bright)});
  color = vec4(dither(c), 1.0);
}
`,
};

const UNIFORMS = [
  "uPixelHeight",
  "uCssPerPixel",
  "uSize",
  "uScale",
  "uStrength",
  "uTurn",
  "uWavePhase",
  "uDriftCell",
  "uDriftFract",
  "uMarble",
];

// The state that the controls and the query parameters share.
function readState() {
  const query = new URLSearchParams(window.location.search);
  const look = query.get("look") === "surface" ? "surface" : "caustics";
  const presets = LOOKS[look].presets;
  const named = query.get("preset");
  const preset = named !== null && Object.hasOwn(presets, named) ? presets[named] : undefined;
  const state = {
    look,
    ...LOOKS[look].defaults,
    ...preset,
    fps: query.get("fps") === "30" ? 30 : 60,
    chrome: query.get("chrome") !== "0",
    time: undefined,
  };
  for (const name of ["speed", "scale", "strength"]) {
    const value = Number.parseFloat(query.get(name) ?? "");
    const range = LOOKS[look].ranges[name];
    if (Number.isFinite(value)) {
      state[name] = Math.min(range.max, Math.max(range.min, value));
    }
  }
  const time = Number.parseFloat(query.get("time") ?? "");
  if (Number.isFinite(time)) {
    state.time = time;
  }
  return state;
}

// The name of the preset whose values the sliders hold, if there is one.
function presetOf(state) {
  const presets = LOOKS[state.look].presets;
  return Object.keys(presets).find((name) =>
    ["speed", "scale", "strength"].every((key) => presets[name][key] === state[key]),
  );
}

// Writes the state to the address, so the address can be shared as it is.
function writeState(state) {
  const query = new URLSearchParams();
  query.set("look", state.look);
  const preset = presetOf(state);
  if (preset === undefined) {
    for (const name of ["speed", "scale", "strength"]) {
      query.set(name, String(state[name]));
    }
  } else {
    query.set("preset", preset);
  }
  if (state.fps === 30) {
    query.set("fps", "30");
  }
  if (!state.chrome) {
    query.set("chrome", "0");
  }
  if (state.time !== undefined) {
    query.set("time", String(state.time));
  }
  window.history.replaceState(null, "", `?${query.toString()}`);
}

// The number of canvas pixels to one CSS pixel, for a canvas of the given size in CSS pixels.
function backingRatio(width, height) {
  const ratio = Math.min(window.devicePixelRatio, HIGHEST_PIXEL_RATIO);
  const area = width * height;
  return area * ratio * ratio > MOST_BACKING_PIXELS ? Math.sqrt(MOST_BACKING_PIXELS / area) : ratio;
}

// A clock's place in its turn, from 0 to 1. The division happens here, in double precision, so
// the shader never sees a large number.
function turn(clock, period) {
  const turns = clock / period;
  return turns - Math.floor(turns);
}

function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

function start() {
  const canvas = document.querySelector(".marble-water > canvas");
  const bar = document.querySelector(".review-bar");
  const readout = bar.querySelector('[data-review="readout"]');
  const errorBox = bar.querySelector('[data-review="error"]');
  const state = readState();
  const frozen = state.time !== undefined;

  let gl = null;
  // The programs built so far, by look. A look's program is built when the look is first chosen.
  const programs = new Map();
  let width = 0;
  let height = 0;
  let onscreen = false;
  let request = 0;
  let lastFrame;
  // The animation's clock, in seconds. The speed scales each step, so a change of speed changes
  // the rate from here on and doesn't jump.
  let clock = 0;
  // A frame is owed even when nothing moves: the first one, and one after each change.
  let owed = true;
  let failed = false;
  // The time between drawn frames, with the time each was drawn.
  let gaps = [];
  let readoutAt = -Infinity;
  // How many frames the loop has drawn, for tests.
  let framesDrawn = 0;

  // The marble picture, for the look that needs it, and the size that its texture was drawn for.
  let image;
  let imageLoaded = false;
  let texture = null;
  let textureFor = "";
  let sizeChangedAt = 0;

  function report(message) {
    failed = true;
    errorBox.textContent = message;
    errorBox.hidden = false;
    // The toolbar may be hidden, and a still image shows nothing, so the console gets it too.
    // oxlint-disable-next-line no-console
    console.error(message);
    delete canvas.dataset.ready;
  }

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }

  // Builds the program of a look, or reports why it can't.
  function build(look) {
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADERS[look]);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
      // A lost context can't build anything, and it isn't a failure: its restoration builds
      // again.
      if (!gl.isContextLost()) {
        report(
          [
            `The "${look}" shader didn't build.`,
            gl.getShaderInfoLog(vertex),
            gl.getShaderInfoLog(fragment),
            gl.getProgramInfoLog(program),
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      return undefined;
    }
    // A linked program keeps what it needs of its shaders.
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    const built = { program };
    for (const name of UNIFORMS) {
      built[name] = gl.getUniformLocation(program, name);
    }
    return built;
  }

  function programFor(look) {
    if (!programs.has(look)) {
      const built = build(look);
      if (built === undefined) {
        return undefined;
      }
      programs.set(look, built);
    }
    return programs.get(look);
  }

  // Draws the marble on a scratch canvas, as large as the canvas and placed as the stylesheet's
  // `center / cover` places it, and uploads that. The picture is an SVG, so drawing it at its
  // shown size keeps the veins sharp.
  function uploadMarble(pixelWidth, pixelHeight) {
    const limit = Math.min(LONGEST_TEXTURE_SIDE, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const shrink = Math.min(1, limit / Math.max(pixelWidth, pixelHeight));
    const scratch = document.createElement("canvas");
    scratch.width = Math.max(1, Math.round(pixelWidth * shrink));
    scratch.height = Math.max(1, Math.round(pixelHeight * shrink));
    const context = scratch.getContext("2d");
    const cover = Math.max(scratch.width / MARBLE_WIDTH, scratch.height / MARBLE_HEIGHT);
    context.drawImage(
      image,
      (scratch.width - MARBLE_WIDTH * cover) / 2,
      (scratch.height - MARBLE_HEIGHT * cover) / 2,
      MARBLE_WIDTH * cover,
      MARBLE_HEIGHT * cover,
    );
    if (texture === null) {
      texture = gl.createTexture();
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
    // Frees the scratch canvas's memory now and not at the next garbage collection.
    scratch.width = 0;
    scratch.height = 0;
  }

  // Sets every uniform from the clocks and draws one frame.
  function draw(now) {
    const ratio = backingRatio(width, height);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    // A change to the canvas's own size clears it, so it happens here, where a draw follows in
    // the same frame, and never in the resize observer.
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const built = programFor(state.look);
    if (built === undefined) {
      return false;
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.useProgram(built.program);

    if (state.look === "surface") {
      // The texture follows the canvas's size, but only once the size has settled. Until then
      // the old texture is stretched to the new size.
      const wanted = `${pixelWidth}x${pixelHeight}`;
      if (textureFor === "" || (textureFor !== wanted && now - sizeChangedAt >= RESIZE_SETTLE_MS)) {
        uploadMarble(pixelWidth, pixelHeight);
        textureFor = wanted;
      }
      if (textureFor !== wanted) {
        owed = true;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(built.uMarble, 0);
    }

    gl.uniform1f(built.uPixelHeight, pixelHeight);
    gl.uniform2f(built.uCssPerPixel, width / pixelWidth, height / pixelHeight);
    gl.uniform2f(built.uSize, width, height);
    const scale = state.scale * Math.min(1, Math.max(NARROW_SCALE, width / NARROW_WIDTH));
    gl.uniform1f(built.uScale, scale);
    gl.uniform1f(built.uStrength, state.strength);
    gl.uniform4f(
      built.uTurn,
      turn(clock, BEND.periodA),
      turn(clock, BEND.periodB),
      turn(clock, NET.orbitPeriodA),
      turn(clock, NET.orbitPeriodB),
    );
    // Each phase is wrapped to one turn here, in double precision, so the waves stay smooth
    // however long the page stays open.
    gl.uniform1fv(
      built.uWavePhase,
      WAVES.map((wave) => turn(clock, wave.period) * 2 * Math.PI),
    );
    // The drift of each net, in that net's cells, split into a whole part that shifts which
    // cell is which and a fraction that the shader adds to the position.
    const cell = NET.cell * scale;
    const drifts = [
      (clock * NET.driftA[0]) / cell,
      (clock * NET.driftA[1]) / cell,
      (clock * NET.driftB[0] * NET.secondRatio) / cell,
      (clock * NET.driftB[1] * NET.secondRatio) / cell,
    ];
    const whole = drifts.map((drift) => Math.floor(drift));
    gl.uniform4i(
      built.uDriftCell,
      ...whole.map((part) => ((part % TICK_WRAP) + TICK_WRAP) % TICK_WRAP),
    );
    gl.uniform4f(built.uDriftFract, ...drifts.map((drift, index) => drift - whole[index]));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  function visible() {
    return onscreen && !document.hidden && width > 0 && height > 0;
  }

  function drawable() {
    return (
      !failed &&
      gl !== null &&
      !gl.isContextLost() &&
      visible() &&
      (state.look !== "surface" || imageLoaded)
    );
  }

  function showReadout(now) {
    readoutAt = now;
    gaps = gaps.filter((gap) => now - gap.at <= STATS_WINDOW_MS);
    const stats = currentStats();
    readout.textContent = frozen
      ? `${stats.backing}\nOne frame, frozen at ${state.time} s`
      : `${stats.backing}\n${stats.fps.toFixed(1)} frames a second\nGap: median ${stats.median.toFixed(1)} ms, worst ${stats.worst.toFixed(1)} ms`;
  }

  function currentStats() {
    const times = gaps.map((gap) => gap.ms);
    const total = times.reduce((sum, ms) => sum + ms, 0);
    return {
      backing: `${canvas.width} × ${canvas.height} px, ratio ${(canvas.width / Math.max(width, 1)).toFixed(2)}`,
      fps: total > 0 ? (times.length * 1000) / total : 0,
      median: median(times),
      worst: times.length === 0 ? 0 : Math.max(...times),
      frames: framesDrawn,
    };
  }

  function frame(now) {
    request = 0;
    if (!drawable()) {
      lastFrame = undefined;
      return;
    }
    const sinceLast = lastFrame === undefined ? undefined : now - lastFrame;
    if (!owed && sinceLast !== undefined && sinceLast < 1000 / state.fps - FRAME_SLACK_MS) {
      request = requestAnimationFrame(frame);
      return;
    }
    // The readout counts only the gaps between the frames of one run, so the time that the
    // loop was stopped for never reads as a slow frame.
    if (sinceLast !== undefined) {
      gaps.push({ at: now, ms: sinceLast });
    }
    lastFrame = now;
    if (frozen) {
      clock = state.time * state.speed;
    } else {
      clock += (Math.min(sinceLast ?? 0, LONGEST_STEP_MS) / 1000) * state.speed;
    }
    owed = false;
    if (!draw(now)) {
      return;
    }
    canvas.dataset.ready = "";
    framesDrawn += 1;
    if (now - readoutAt >= READOUT_EVERY_MS) {
      showReadout(now);
    }
    if (!frozen || owed) {
      request = requestAnimationFrame(frame);
    } else {
      lastFrame = undefined;
    }
  }

  // Starts the loop if the current state calls for a frame. Every event that changes the state
  // ends here.
  function update() {
    if (!drawable()) {
      if (request !== 0) {
        cancelAnimationFrame(request);
        request = 0;
      }
      // The next frame starts a new run of the clock, so the time the loop was stopped for
      // doesn't count.
      lastFrame = undefined;
      return;
    }
    if (request === 0 && (!frozen || owed)) {
      request = requestAnimationFrame(frame);
    }
  }

  function redraw() {
    owed = true;
    update();
  }

  // Loads the marble the first time a look needs it.
  function needMarble() {
    if (state.look !== "surface" || image !== undefined) {
      return;
    }
    image = new Image();
    image.addEventListener("load", () => {
      imageLoaded = true;
      redraw();
    });
    image.addEventListener("error", () => {
      report("The marble picture didn't load.");
    });
    image.src = MARBLE_URL;
  }

  // The toolbar.

  const sliders = new Map(
    [...bar.querySelectorAll("[data-slider]")].map((input) => [input.dataset.slider, input]),
  );
  const fpsBox = bar.querySelector('[data-review="fps60"]');
  const presetRow = bar.querySelector('[data-review="presets"]');

  // Makes every control show the state.
  function showState() {
    const look = LOOKS[state.look];
    for (const button of bar.querySelectorAll("[data-look]")) {
      button.setAttribute("aria-pressed", String(button.dataset.look === state.look));
    }
    presetRow.hidden = Object.keys(look.presets).length === 0;
    const preset = presetOf(state);
    for (const button of bar.querySelectorAll("[data-preset]")) {
      button.setAttribute("aria-pressed", String(button.dataset.preset === preset));
    }
    for (const [name, input] of sliders) {
      const range = look.ranges[name];
      input.min = String(range.min);
      input.max = String(range.max);
      input.step = String(range.step);
      input.value = String(state[name]);
      input.nextElementSibling.textContent = state[name].toFixed(2);
    }
    fpsBox.checked = state.fps === 60;
    writeSoon();
  }

  function changed() {
    showState();
    needMarble();
    redraw();
  }

  // A slider sends many changes a second, and a browser limits how often a page may rewrite its
  // address, so the address waits for the changes to stop.
  let addressTimer = 0;
  function writeSoon() {
    clearTimeout(addressTimer);
    addressTimer = setTimeout(() => writeState(state), ADDRESS_SETTLE_MS);
  }

  bar.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button === null) {
      return;
    }
    if (button.dataset.look !== undefined && button.dataset.look !== state.look) {
      state.look = button.dataset.look;
      Object.assign(state, LOOKS[state.look].defaults);
      // An earlier look's failure doesn't stop this one from being tried.
      failed = false;
      errorBox.hidden = true;
    } else if (button.dataset.preset !== undefined) {
      Object.assign(state, LOOKS[state.look].presets[button.dataset.preset]);
    } else if (button.dataset.review === "reset") {
      Object.assign(state, LOOKS[state.look].defaults);
    }
    changed();
  });

  bar.addEventListener("input", (event) => {
    const input = event.target;
    if (input.dataset.slider !== undefined) {
      state[input.dataset.slider] = Number.parseFloat(input.value);
    } else if (input === fpsBox) {
      state.fps = input.checked ? 60 : 30;
      gaps = [];
    }
    changed();
  });

  // The canvas and its context.

  gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  bar.hidden = !state.chrome;
  showState();
  if (gl === null) {
    report("This browser has no WebGL2, so there's nothing to draw.");
    return;
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    // Without this, the browser never restores the context.
    event.preventDefault();
    delete canvas.dataset.ready;
    // The lost context's objects are gone with it.
    programs.clear();
    texture = null;
    textureFor = "";
    update();
  });
  canvas.addEventListener("webglcontextrestored", redraw);

  new ResizeObserver((entries) => {
    const box = entries.at(-1).contentRect;
    if (box.width === width && box.height === height) {
      return;
    }
    width = box.width;
    height = box.height;
    sizeChangedAt = performance.now();
    redraw();
  }).observe(canvas);
  new IntersectionObserver((entries) => {
    onscreen = entries.at(-1).isIntersecting;
    update();
  }).observe(canvas);
  document.addEventListener("visibilitychange", update);

  needMarble();
  update();

  window.waterLab = {
    stats() {
      return currentStats();
    },
    // Draws frames back to back and reads one pixel after each, which waits for the GPU to
    // finish it. Without the read, a GPU that defers its work shades only the last frame. The
    // time is the GPU's cost of a frame, free of the display's frame rate.
    bench(frames = 60) {
      if (!drawable()) {
        return 0;
      }
      const pixel = new Uint8Array(4);
      draw(performance.now());
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const before = performance.now();
      for (let index = 0; index < frames; index += 1) {
        clock += 1 / 60;
        draw(performance.now());
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      }
      const each = (performance.now() - before) / frames;
      redraw();
      return each;
    },
  };
}

start();
