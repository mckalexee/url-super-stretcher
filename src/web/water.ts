// The water over the marble. It draws the marble picture on a canvas through a slow, drifting
// height field, so the gold veins sway as if they lay under water, and glints travel along them.
// It refracts the existing picture and draws no marble of its own: with no displacement, the
// canvas shows what the stylesheet's background under it shows, so the canvas can appear without
// a visible change. It exists apart from the React component so that the page pays for WebGL only
// when motion is allowed, and so that every failure leaves the still marble in place.
import { reducedMotionRequested, watchMotion } from "#web/motion.ts";

// The numbers that set the look. They're tuned by eye.

// The length of the broadest wave, in CSS pixels. The other waves are fixed shares of it. A
// smaller value puts more waves in view and makes the water look busier.
const WAVE_LENGTH = 560;
// How long the broadest wave takes to pass a point, in seconds. A larger value is slower water.
const WAVE_PERIOD = 10;
// How far the noise bends the wave fronts, as a share of `WAVE_LENGTH`. At 0, the waves are
// straight lines and read as a regular pattern.
const WAVE_BEND = 0.45;
// The size of one cell of the bending noise, as a share of `WAVE_LENGTH`.
const BEND_SCALE = 0.9;
// How fast the bending noise drifts, in cells per second, so the bends never repeat in place.
const BEND_DRIFT = 0.02;
// How far the steepest water moves a point of the marble, in CSS pixels. Most of the picture
// moves less than half as far.
const DISPLACEMENT = 8;
// How far a glint takes a vein toward `GLINT_COLOR`, from 0 to 1.
const GLINT_STRENGTH = 0.55;
// How narrow a glint is. A larger value lights only the water that faces the light squarely.
const GLINT_TIGHTNESS = 5;
// How much of the steepest possible slope counts as facing the light squarely. The waves seldom
// line up to reach 1, so a value under 1 lets ordinary water glint.
const GLINT_REACH = 0.6;
// The direction that the light comes from, in degrees clockwise from the right of the page.
// 235 is the upper left.
const LIGHT_ANGLE = 235;
// The site's `--bright`, as red, green, and blue from 0 to 1.
const GLINT_COLOR = [1, 0.953, 0.682] as const;
// The brightness at which the marble starts to count as a vein, and the brightness of a full
// vein. Only a vein catches the light, so the black between the veins stays black.
const VEIN_FLOOR = 0.14;
const VEIN_FULL = 0.5;

// Each wave of the height field: the direction it travels, in degrees, its length and its period
// as shares of the broadest wave's, and its share of the slope. Shorter waves are slower and
// weaker, which is how open water behaves, and no two travel the same way.
const WAVES = [
  { angle: 18, length: 1, period: 1, weight: 1 },
  { angle: 101, length: 0.73, period: 0.81, weight: 0.7 },
  { angle: 233, length: 0.52, period: 0.67, weight: 0.45 },
  { angle: 322, length: 0.37, period: 0.55, weight: 0.28 },
] as const;

// The displacement takes this long to reach full strength after the first frame, and this long
// to return to none after a pause, in milliseconds.
const RISE_MS = 1500;
const FALL_MS = 400;
// Slow water doesn't need more frames than this, and half the frames is half the work.
const FRAMES_PER_SECOND = 30;
// A frame counts as due this many milliseconds early. The browser's frames don't arrive at exact
// intervals, and a frame that came a moment early would otherwise wait for the one after it.
const FRAME_SLACK_MS = 3;
// The longest step that one frame adds to the clock, so a stall doesn't show as a jump.
const LONGEST_STEP_MS = 100;
// A new size must hold for this long before the marble is drawn again at that size. Drawing it
// runs the picture's turbulence filters again, and a window that's being dragged changes size
// many times.
const RESIZE_SETTLE_MS = 200;
// The pixel ratio is never above this, however dense the screen is.
const HIGHEST_PIXEL_RATIO = 2;
// The most pixels the canvas may hold, which bounds the work of a frame on a large screen. It's
// set so that the stage in a 1440 by 900 window gets two pixels for each CSS pixel. With fewer,
// the browser stretches the canvas, and the marble's fine contour bands blur beside the
// stylesheet's own marble.
const MOST_BACKING_PIXELS = 4_500_000;
// The longest side of the marble texture, in pixels, on a GPU that allows it. It lets the texture
// match that same canvas pixel for pixel.
const LONGEST_TEXTURE_SIDE = 4096;
// A GPU that can't keep up gets a smaller canvas. The pace is judged over this many drawn frames,
// so one slow frame decides nothing.
const PACE_WINDOW_FRAMES = 30;
// The average time between drawn frames, in milliseconds, that counts as not keeping up. The
// target is about 33, and this is far enough over it that an ordinary stutter doesn't count.
const SLOW_FRAME_MS = 50;
// What a step down multiplies the pixel ratio by, which about halves the number of pixels.
const QUALITY_STEP = 0.7;
// A step down never takes the pixel ratio under this, because the veins blur more with each
// step, and past this point the water costs the picture more than it adds.
const LOWEST_PIXEL_RATIO = 0.75;
// The frames after a start, a resume, a change of size, or a step down that the pace doesn't
// count, because the first frames of a run pay for work that the later ones don't.
const WARM_UP_FRAMES = 5;
// How far past the canvas edge the texture reaches, in CSS pixels, so that a displaced lookup at
// the edge finds marble. It's a multiple of four, which keeps the texture's pixels on the
// canvas's pixels at the common pixel ratios.
const TEXTURE_MARGIN = Math.ceil((DISPLACEMENT + 1) / 4) * 4;
// How long the first setup may wait for the browser to be idle, in milliseconds, and how long it
// waits in a browser that can't say when it's idle.
const IDLE_TIMEOUT_MS = 2000;
const IDLE_FALLBACK_MS = 200;

// The quality factor that a slow device has stepped down to. It's kept here, and not in each
// mount, so the next page in the same visit starts at the lower resolution and doesn't sit
// through another window of slow frames first. Module state is safe for this because only
// `mountWater()` reads or writes it, and that runs only in the browser. The server evaluates
// this module too, and there the value never leaves 1.
let sharedQuality = 1;

const MARBLE_WIDTH = 1600;
const MARBLE_HEIGHT = 1100;
// The page's black, which is what shows beside the marble where the page is wider than it.
const PAGE_BLACK = "#0b0907";

/**
 * How the stylesheet fits the marble to the element under the canvas. `cover` is
 * `center / cover`, and `top` is `top center / 1600px auto no-repeat`.
 */
export type MarbleFit = "cover" | "top";

/**
 * Where the marble lies under a canvas, in CSS pixels: the size of one unit of the picture, and
 * the position of the picture's top left corner from the canvas's.
 */
export interface MarblePlacement {
  scale: number;
  left: number;
  top: number;
}

/**
 * The part of the marble that a texture holds, in units of the picture, and the texture's size in
 * pixels. The part can reach past the picture's sides, where the texture holds the page's black.
 */
export interface TexturePlan {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
}

/**
 * Places the marble under a canvas of the given size in CSS pixels, the way the stylesheet's
 * background places it under an element of that size.
 */
export function placeMarble(fit: MarbleFit, width: number, height: number): MarblePlacement {
  if (fit === "top") {
    return { scale: 1, left: (width - MARBLE_WIDTH) / 2, top: 0 };
  }
  const scale = Math.max(width / MARBLE_WIDTH, height / MARBLE_HEIGHT);
  return {
    scale,
    left: (width - MARBLE_WIDTH * scale) / 2,
    top: (height - MARBLE_HEIGHT * scale) / 2,
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
 * The record that decides when a device can't keep up: the quality factor so far, from 1 down,
 * and the count and the total time, in milliseconds, of the drawn frames in the current window.
 */
export interface Pace {
  quality: number;
  frames: number;
  elapsed: number;
}

/**
 * Adds one drawn frame to the pace, given the time since the frame before it in milliseconds, and
 * returns the new pace. When a window of 30 frames averages over 50 milliseconds a frame, the
 * quality drops to 0.7 of what it was, and a new window starts. The quality never rises again, so
 * the picture doesn't change back and forth, and it stops at the factor that takes a pixel ratio
 * of 2 to 0.75. A single long gap counts as 100 milliseconds at most, so one stall can't fill a
 * window on its own.
 */
export function paceAfterFrame(pace: Pace, gap: number): Pace {
  const frames = pace.frames + 1;
  const elapsed = pace.elapsed + Math.min(gap, LONGEST_STEP_MS);
  if (frames < PACE_WINDOW_FRAMES) {
    return { quality: pace.quality, frames, elapsed };
  }
  const slow = elapsed / frames > SLOW_FRAME_MS;
  const lowest = LOWEST_PIXEL_RATIO / HIGHEST_PIXEL_RATIO;
  return {
    quality: slow ? Math.max(pace.quality * QUALITY_STEP, lowest) : pace.quality,
    frames: 0,
    elapsed: 0,
  };
}

/**
 * Plans the texture for a canvas of the given size in CSS pixels: the part of the marble that the
 * canvas shows, and a margin around it, at the given pixel ratio. The margin stops at a side of
 * the picture that the stylesheet never shows past, which is every side under `cover` and the top
 * and the bottom under `top`. Under `top`, a canvas wider than the picture shows the page's black
 * beside it, and the texture takes only a margin's width of that black on each side, however
 * wide the canvas is. The longer side of the texture is capped at `longestSide` pixels, and the
 * shorter side shrinks with it.
 */
export function planTexture(
  fit: MarbleFit,
  width: number,
  height: number,
  ratio: number,
  margin: number,
  longestSide: number,
): TexturePlan {
  const { scale, left, top } = placeMarble(fit, width, height);
  // The part in CSS pixels from the canvas's top left corner.
  // The texture holds no more than a margin of what's beside the picture. Under `top`, that's
  // black, which the texture's edge repeats as far as the canvas goes, so a very wide page
  // spends none of the texture's pixels on it.
  let x0 = Math.max(-margin, left - margin);
  let x1 = Math.min(width + margin, left + MARBLE_WIDTH * scale + margin);
  const y0 = Math.max(-margin, top);
  const y1 = Math.min(height + margin, top + MARBLE_HEIGHT * scale);
  if (fit === "cover") {
    x0 = Math.max(x0, left);
    x1 = Math.min(x1, left + MARBLE_WIDTH * scale);
  }
  const pixelWidth = (x1 - x0) * ratio;
  const pixelHeight = (y1 - y0) * ratio;
  const shrink = Math.min(1, longestSide / Math.max(pixelWidth, pixelHeight));
  return {
    x: (x0 - left) / scale,
    y: (y0 - top) / scale,
    width: (x1 - x0) / scale,
    height: (y1 - y0) / scale,
    pixelWidth: Math.max(1, Math.round(pixelWidth * shrink)),
    pixelHeight: Math.max(1, Math.round(pixelHeight * shrink)),
  };
}

function samePlan(a: TexturePlan, b: TexturePlan): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.pixelWidth === b.pixelWidth &&
    a.pixelHeight === b.pixelHeight
  );
}

// Slow at both ends, so the water neither starts nor stops with a jerk.
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

// A number as a GLSL float literal, which needs a decimal point or an exponent.
function glsl(value: number): string {
  const text = value.toPrecision(7);
  return text.includes(".") || text.includes("e") ? text : `${text}.0`;
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

// The slope of the height field is the sum of one cosine for each wave. The field's height is
// never needed, so the shader works out the slope directly and skips finite differences.
const WAVE_TERMS = WAVES.map((wave, index) => {
  const direction = `vec2(${glsl(Math.cos(radians(wave.angle)))}, ${glsl(Math.sin(radians(wave.angle)))})`;
  const frequency = glsl((2 * Math.PI) / (WAVE_LENGTH * wave.length));
  const component = "xyzw".charAt(index);
  return `  slope += ${direction} * (${glsl(wave.weight)} * cos(dot(bent, ${direction}) * ${frequency} - uPhase.${component}));`;
}).join("\n");
const WEIGHT_SUM = WAVES.reduce((sum, wave) => sum + wave.weight, 0);

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uMarble;
// The height of the canvas in its own pixels, and the size of one of those pixels in CSS pixels.
uniform float uHeight;
uniform vec2 uCssPerPixel;
// Takes a position in CSS pixels to a position in the texture: a scale, then an offset.
uniform vec4 uToTexture;
uniform vec4 uPhase;
uniform float uDrift;
uniform float uStrength;

out vec4 color;

// An integer hash, which gives the same noise on every GPU. A hash built on sin() doesn't. It
// needs all 32 bits, and a fragment shader's integers are only sure of 16 unless it asks for
// highp, as this one does. With 16, the hash collapses and the wave fronts come out straight.
float hash(ivec2 cell) {
  uint h = uint(cell.x) * 0x9E3779B1u ^ uint(cell.y) * 0x85EBCA77u;
  h ^= h >> 15;
  h *= 0x2C1B3C6Du;
  h ^= h >> 12;
  return float(h >> 8) * (1.0 / 16777216.0);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(cell);
  return mix(
    mix(hash(c), hash(c + ivec2(1, 0)), u.x),
    mix(hash(c + ivec2(0, 1)), hash(c + ivec2(1, 1)), u.x),
    u.y
  );
}

void main() {
  // The position in CSS pixels from the canvas's top left corner, so the water looks the same at
  // every pixel ratio.
  vec2 p = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) * uCssPerPixel;

  // Two lookups of drifting noise bend the plane that the waves cross, so their fronts curve.
  vec2 n = p * ${glsl(1 / (WAVE_LENGTH * BEND_SCALE))};
  vec2 bend = vec2(
    noise(n + vec2(uDrift, 3.7)),
    noise(n + vec2(17.3, -uDrift))
  ) - 0.5;
  vec2 bent = p + bend * ${glsl(2 * WAVE_BEND * WAVE_LENGTH)};

  vec2 slope = vec2(0.0);
${WAVE_TERMS}
  slope *= ${glsl(1 / WEIGHT_SUM)};

  // Refraction: the water shows the marble that lies a little way down its slope.
  vec2 at = (p + slope * (${glsl(DISPLACEMENT)} * uStrength)) * uToTexture.xy + uToTexture.zw;
  vec3 marble = texture(uMarble, at).rgb;

  // A glint where the water faces the light, on the veins only.
  float facing = dot(slope, vec2(${glsl(Math.cos(radians(LIGHT_ANGLE)))}, ${glsl(Math.sin(radians(LIGHT_ANGLE)))}));
  float glint = pow(clamp(facing * ${glsl(1 / GLINT_REACH)}, 0.0, 1.0), ${glsl(GLINT_TIGHTNESS)});
  float vein = smoothstep(${glsl(VEIN_FLOOR)}, ${glsl(VEIN_FULL)}, dot(marble, vec3(0.2126, 0.7152, 0.0722)));
  vec3 lit = mix(marble, vec3(${GLINT_COLOR.map(glsl).join(", ")}), glint * vein * ${glsl(GLINT_STRENGTH)} * uStrength);

  color = vec4(lit, 1.0);
}
`;

interface Program {
  program: WebGLProgram;
  texture: WebGLTexture;
  height: WebGLUniformLocation | null;
  cssPerPixel: WebGLUniformLocation | null;
  toTexture: WebGLUniformLocation | null;
  phase: WebGLUniformLocation | null;
  drift: WebGLUniformLocation | null;
  strength: WebGLUniformLocation | null;
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
  const texture = gl.createTexture();
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
    gl.deleteTexture(texture);
    return null;
  }
  gl.useProgram(program);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // No mipmaps: the texture is drawn at the size it's shown.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return {
    program,
    texture,
    height: gl.getUniformLocation(program, "uHeight"),
    cssPerPixel: gl.getUniformLocation(program, "uCssPerPixel"),
    toTexture: gl.getUniformLocation(program, "uToTexture"),
    phase: gl.getUniformLocation(program, "uPhase"),
    drift: gl.getUniformLocation(program, "uDrift"),
    strength: gl.getUniformLocation(program, "uStrength"),
  };
}

// Draws the planned part of the marble on a scratch canvas, at the size the page shows it, and
// uploads that. The picture is an SVG, so drawing it at its shown size keeps the veins as sharp
// as the stylesheet's background. Throws when the browser can't draw or can't upload.
function uploadMarble(gl: WebGL2RenderingContext, image: HTMLImageElement, plan: TexturePlan) {
  const scratch = document.createElement("canvas");
  scratch.width = plan.pixelWidth;
  scratch.height = plan.pixelHeight;
  const context = scratch.getContext("2d");
  if (context === null) {
    throw new Error("No 2D context for the marble texture.");
  }
  // Where the plan reaches past the picture, the page shows its black, and so does the texture.
  // Clamping at the texture's edge then repeats black there and not the picture's last pixels.
  context.fillStyle = PAGE_BLACK;
  context.fillRect(0, 0, plan.pixelWidth, plan.pixelHeight);
  const scaleX = plan.pixelWidth / plan.width;
  const scaleY = plan.pixelHeight / plan.height;
  context.setTransform(scaleX, 0, 0, scaleY, -plan.x * scaleX, -plan.y * scaleY);
  context.drawImage(image, 0, 0, MARBLE_WIDTH, MARBLE_HEIGHT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
  // Frees the scratch canvas's memory now and not at the next garbage collection.
  scratch.width = 0;
  scratch.height = 0;
}

/**
 * Runs the water on a canvas that lies over the marble, and returns a function that stops it and
 * frees what it holds. Nothing happens until motion is first allowed, so a visitor with a still
 * page never creates a WebGL context. The canvas gets a `data-ready` attribute once it has drawn a
 * frame, and loses it when the context is lost, so the stylesheet shows the canvas only while it
 * has a picture. A browser that can't run the water leaves the canvas empty, and this never
 * throws. `fit` says how the stylesheet fits the marble to the element under the canvas. The
 * function that stops the water gives up the WebGL context of a canvas that has left the
 * document, and keeps the context of one that's still there, so the same canvas can be mounted
 * again.
 */
export function mountWater(
  canvas: HTMLCanvasElement,
  options: { imageUrl: string; fit: MarbleFit },
): () => void {
  const { imageUrl, fit } = options;
  const frameGap = 1000 / FRAMES_PER_SECOND - FRAME_SLACK_MS;

  let disposed = false;
  let allowed = false;
  let onscreen = false;
  let width = 0;
  let height = 0;
  let sizeChangedAt = 0;

  let cancelStart: (() => void) | undefined;
  let observers: { resize: ResizeObserver; intersection: IntersectionObserver } | undefined;
  let gl: WebGL2RenderingContext | null = null;
  let built: Program | null = null;
  let image: HTMLImageElement | undefined;
  let imageLoaded = false;
  // The plan of the texture that the GPU holds now, which can lag behind the canvas's size.
  let plan: TexturePlan | undefined;

  let frameRequest = 0;
  let lastFrame: number | undefined;
  // The water's clock, in seconds. It advances only in a drawn frame.
  let clock = 0;
  // The strength of the displacement before easing, from 0 to 1.
  let level = 0;
  // A frame is owed even when nothing moves: the first one, and one after each change of size.
  let owed = true;
  let stale = false;
  // Whether the canvas carries `data-ready`.
  let shown = false;
  // The longest texture side that this GPU and `LONGEST_TEXTURE_SIDE` both allow.
  let longestSide = LONGEST_TEXTURE_SIDE;
  let pace: Pace = { quality: sharedQuality, frames: 0, elapsed: 0 };
  let warmUp = WARM_UP_FRAMES;

  const visible = () => onscreen && !document.hidden && width > 0 && height > 0;
  const drawable = () => built !== null && imageLoaded && visible();
  const moving = () => allowed || level > 0;

  function stopLoop() {
    if (frameRequest !== 0) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
    // The next frame starts a new run of the clock, so the time the loop was stopped for doesn't
    // count.
    lastFrame = undefined;
    if (!allowed) {
      rest();
    }
  }

  // Makes the next frame the still picture. A pause eases the water to rest only while the loop
  // runs. With the loop stopped, there's nobody to see the ease, and leaving it for later would
  // move the water after the visitor paused it, when the canvas next comes on screen.
  function rest() {
    if (level > 0) {
      level = 0;
      owed = true;
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
    observers?.resize.disconnect();
    observers?.intersection.disconnect();
    document.removeEventListener("visibilitychange", update);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    if (image !== undefined) {
      image.removeEventListener("load", onImageLoad);
      image.removeEventListener("error", fail);
    }
    hide();
    if (gl !== null) {
      if (built !== null) {
        gl.deleteProgram(built.program);
        gl.deleteTexture(built.texture);
      }
      if (!keepContext) {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    }
    built = null;
    gl = null;
  }

  // Any failure ends the water for this canvas, and the still marble under it keeps showing.
  function fail() {
    dispose(false);
  }

  function onImageLoad() {
    imageLoaded = true;
    update();
  }

  function onContextLost(event: Event) {
    // Without this, the browser never restores the context.
    event.preventDefault();
    stopLoop();
    hide();
    // The lost context's objects are gone with it.
    built = null;
    plan = undefined;
    // A restored context starts from the still picture, as the first one did.
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
      return;
    }
    // A texture larger than the GPU allows doesn't upload, and the canvas would show nothing.
    const deviceLimit: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    longestSide =
      typeof deviceLimit === "number"
        ? Math.min(LONGEST_TEXTURE_SIDE, deviceLimit)
        : LONGEST_TEXTURE_SIDE;
  }

  // Creates the context and starts the download of the marble. It runs once, when the canvas is
  // first on screen with motion allowed.
  function setUp() {
    gl = canvas.getContext("webgl2", {
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (gl === null) {
      fail();
      return;
    }
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    build();
    if (disposed) {
      return;
    }
    image = new Image();
    image.addEventListener("load", onImageLoad);
    image.addEventListener("error", fail);
    image.src = imageUrl;
  }

  function draw(now: number, seconds: number) {
    if (gl === null || built === null || image === undefined) {
      return;
    }
    const ratio = backingRatio(width, height, window.devicePixelRatio, sharedQuality);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    // A change to the canvas's own size clears it, so it happens here, where a draw follows in
    // the same frame, and never in the resize observer.
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      warmUp = WARM_UP_FRAMES;
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);

    // The texture follows the canvas's size, but only once the size has settled. Until then the
    // old texture is drawn at the new place, which is right wherever the old texture reaches.
    // The texture is planned at full quality, so a step down doesn't draw the marble again: a
    // texture that's sharper than the canvas costs nothing more to sample.
    const fullRatio = backingRatio(width, height, window.devicePixelRatio);
    const wanted = planTexture(fit, width, height, fullRatio, TEXTURE_MARGIN, longestSide);
    if (plan === undefined || !samePlan(plan, wanted)) {
      if (plan === undefined || now - sizeChangedAt >= RESIZE_SETTLE_MS) {
        uploadMarble(gl, image, wanted);
        plan = wanted;
        warmUp = WARM_UP_FRAMES;
      }
    }
    stale = !samePlan(plan, wanted);

    clock += seconds;
    const step = allowed ? (seconds * 1000) / RISE_MS : (-seconds * 1000) / FALL_MS;
    level = Math.min(1, Math.max(0, level + step));

    const placement = placeMarble(fit, width, height);
    const scaleX = 1 / (placement.scale * plan.width);
    const scaleY = 1 / (placement.scale * plan.height);
    gl.uniform1f(built.height, pixelHeight);
    gl.uniform2f(built.cssPerPixel, width / pixelWidth, height / pixelHeight);
    gl.uniform4f(
      built.toTexture,
      scaleX,
      scaleY,
      (-placement.left / placement.scale - plan.x) / plan.width,
      (-placement.top / placement.scale - plan.y) / plan.height,
    );
    // Each phase is wrapped to one turn here, in double precision, so the waves stay smooth
    // however long the page stays open.
    const phase = (wave: (typeof WAVES)[number]) =>
      ((clock / (WAVE_PERIOD * wave.period)) % 1) * 2 * Math.PI;
    gl.uniform4f(built.phase, phase(WAVES[0]), phase(WAVES[1]), phase(WAVES[2]), phase(WAVES[3]));
    gl.uniform1f(built.drift, clock * BEND_DRIFT);
    gl.uniform1f(built.strength, ease(level));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now: number) {
    frameRequest = 0;
    if (!drawable()) {
      stopLoop();
      return;
    }
    const sinceLast = lastFrame === undefined ? undefined : now - lastFrame;
    if (sinceLast !== undefined && sinceLast < frameGap) {
      frameRequest = requestAnimationFrame(frame);
      return;
    }
    lastFrame = now;
    // The pace counts only the gaps between the frames of one run, so the time that the loop was
    // stopped for never reads as a slow frame.
    if (sinceLast === undefined) {
      pace = { quality: sharedQuality, frames: 0, elapsed: 0 };
      warmUp = WARM_UP_FRAMES;
    } else if (warmUp > 0) {
      warmUp -= 1;
    } else {
      pace = paceAfterFrame(pace, sinceLast);
      sharedQuality = pace.quality;
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
    if (moving() || stale) {
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
    if (frameRequest === 0 && (moving() || owed || stale)) {
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
        sizeChangedAt = performance.now();
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
    // A pause eases the water to rest while the loop runs. A system that asks for reduced motion
    // gets the still picture in the next frame, and so does a pause while the loop is stopped.
    if (!answer && (reducedMotionRequested() || frameRequest === 0)) {
      rest();
    }
    update();
  });

  // A canvas that has left the document is done with, so its context goes at once and doesn't
  // wait for garbage collection. A visitor who moves between pages would otherwise pile up live
  // contexts.
  return () => dispose(canvas.isConnected);
}
