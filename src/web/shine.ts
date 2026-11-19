// The shine on the gold. There is one imaginary band of light across the window, and every gold
// element shows only the slice of it that's on that element, so the page reads as one polished
// surface under one light and not as a set of separate twinkles. A moving mouse or pen carries the
// band, and every so often the band crosses the window by itself, which is all that a touch screen
// gets. The stylesheet paints the band and parks it out of sight. This module moves it: each gold
// element gets one paused animation of a whole crossing, and one frame loop sets the time of all
// of them from the band's position, so the slices can't drift apart. The loop runs only while the
// band moves, and nothing stays in an inline style. The module finds the gold by selector, so the
// markup carries nothing for it. A browser that lacks a piece it needs gets the still gold.
import { watchMotion } from "#web/motion.ts";

// The numbers that set the timing. They're tuned by eye. The numbers that set the look, which are
// the band's lean, width, and brightness, are custom properties in the stylesheet's section for
// the shine, because the stylesheet paints with them. `readLook()` reads the ones that the
// geometry needs, so there's one copy of each.

// How long the band waits before its first crossing, in milliseconds, counted from the moment
// that motion is allowed. The same wait follows a return to a tab that was hidden.
const FIRST_SWEEP_MS = 1200;
// The shortest and the longest wait between two crossings, in milliseconds, counted from the end
// of one crossing to the start of the next. Each wait is a random time between them, so the light
// never falls into a rhythm.
const SWEEP_GAP_SHORTEST_MS = 8000;
const SWEEP_GAP_LONGEST_MS = 12_000;
// How long the band takes to cross the whole window by itself, in milliseconds. It's slow at both
// edges and fastest in the middle, as a sine wave is.
const SWEEP_MS = 1400;
// The shortest time that the band takes to glide to an edge of the window, in milliseconds. A
// glide over part of the window takes its share of `SWEEP_MS`, and a glide over a few pixels
// would otherwise be a jump.
const SHORTEST_GLIDE_MS = 500;
// The share of the distance to the pointer that the band covers in one frame at 60 frames a
// second. A smaller value trails further behind the pointer, which reads as a heavier light. At
// 1, the band is stuck to the pointer.
const FOLLOW_EASE = 0.1;

// The number of straight steps that the band takes along a surface in one crossing. On the gold
// bar, the true path curves. With 24 steps, the strip strays from it by at most 1.6 pixels in a
// window 1440 pixels wide, and by at most 2.8 pixels in one 2560 pixels wide.
const SURFACE_STEPS = 24;
// Where a strip of light waits while the band isn't on its surface, as a multiple of the
// surface's length. It's far enough past the end that no part of a stretched strip shows.
const PAST_THE_END = 3;
// The most that a strip is widened. Near the point where the gold bar vanishes, the true factor
// has no limit.
const WIDEST_STRETCH = 8;

// The band counts as having reached the pointer when it's this close, in CSS pixels. The frame
// loop stops then.
const SETTLED_PX = 0.25;
// The length of a frame at 60 frames a second, in milliseconds, which is the frame that
// `FOLLOW_EASE` is defined for.
const FRAME_MS = 1000 / 60;
// The longest step that one frame adds to the band's clock, so a stall doesn't show as a jump.
const LONGEST_STEP_MS = 100;
// The length of every element's animation, in milliseconds. Nothing ever plays one: the loop
// sets its time to the band's share of a crossing, so the number only needs to be the same for
// all of them.
const CLOCK_MS = 1000;

// The gold. Foil text is every element that the stylesheet's foil rule covers, except the link
// page's hostname, which turns the foil off. The finish name is foil only while its finish is
// chosen, which takes `:has()` to tell.
const FOIL_SELECTOR = "h1:not(.destination), h2, .site-name, .figure dd";
const CHOSEN_FINISH_SELECTOR = ".flavor:has(input:checked) .flavor-name";
const BUTTON_SELECTOR = ".button-solid:not([disabled])";
const BAR_SELECTOR = ".rig .bar";

const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

/** A rectangle in CSS pixels, measured from the top left corner of the window. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * One crossing of the window by the band. A position of the band is the horizontal distance from
 * the window's left edge to the point where the band's centerline meets the window's top edge.
 */
export interface Travel {
  from: number;
  to: number;
}

/**
 * The band's travel across a window of the given size. `lean` is the band's angle from vertical,
 * in radians, with the top of the band ahead of the bottom. `reach` is half the band's width,
 * measured along the horizontal. The band starts with all of it left of the window, and it ends
 * with all of it right of the window.
 */
export function sweepTravel(width: number, height: number, lean: number, reach: number): Travel {
  return { from: -reach, to: width + height * Math.tan(lean) + reach };
}

/**
 * The horizontal distance from the window's left edge to the band's centerline, at a distance of
 * `y` under the window's top edge, for a band at the given position.
 */
export function bandCenter(position: number, y: number, lean: number): number {
  return position - y * Math.tan(lean);
}

/**
 * The position that puts the band's centerline through a point of the window, which is where a
 * pointer at that point wants the band.
 */
export function pointerPosition(x: number, y: number, lean: number): number {
  return x + y * Math.tan(lean);
}

/** A position held inside a crossing: no further left than its start or right than its end. */
export function clampToTravel(position: number, travel: Travel): number {
  return Math.min(Math.max(position, travel.from), travel.to);
}

/**
 * The end of a crossing that's nearer to a position: its start or its end. The band leaves the
 * window by that end, and it comes back by the end that's nearer to the pointer.
 */
export function nearerEnd(position: number, travel: Travel): number {
  return position - travel.from < travel.to - position ? travel.from : travel.to;
}

/** A position as a share of a crossing, from 0 at its start to 1 at its end. */
export function travelProgress(position: number, travel: Travel): number {
  return (clampToTravel(position, travel) - travel.from) / (travel.to - travel.from);
}

/**
 * Where a band at the given position crosses foil text: the distance from the element's top left
 * corner to the band's centerline, measured across the band. That's the length that the
 * stylesheet's gradient for the band counts from, so the result is a value for `--shine-x`.
 * It's negative while the band is still to the left of the corner.
 */
export function foilOffset(position: number, box: Box, lean: number): number {
  return (bandCenter(position, box.top, lean) - box.left) * Math.cos(lean);
}

/** A point of the window in homogeneous coordinates: its place is `x / w` and `y / w`. */
export type Projected = readonly [x: number, y: number, w: number];

/**
 * A flat gold surface as the window shows it, which can be in perspective. `origin` is where the
 * middle of the surface's left edge lands in the window. `across` is what one CSS pixel along the
 * surface adds to that, and `down` is what one CSS pixel down the surface adds.
 */
export interface Surface {
  origin: Projected;
  across: Projected;
  down: Projected;
}

/**
 * The slice of the band on a surface, as the changes to make to an upright strip of light that's
 * as wide as the band and centered on the middle of the surface's left edge. `offset` is how far
 * to move the strip along the surface, in the surface's own pixels. `stretch` is the factor to
 * widen it by, and `skew` is the angle to lean it by before the stretch, in radians. With all
 * three, the strip looks in the window like the band that crosses the page.
 */
export interface Slice {
  offset: number;
  stretch: number;
  skew: number;
}

/** The surface of an element that the window shows flat, where it is. `box` is its box. */
export function flatSurface(box: Box): Surface {
  return { origin: [box.left, box.top + box.height / 2, 1], across: [1, 0, 0], down: [0, 1, 0] };
}

/**
 * The slice of a band at the given position on a surface. Returns undefined when the band doesn't
 * cross the line along the middle of the surface, which happens past the point where a surface
 * in perspective vanishes.
 */
export function sliceOf(position: number, surface: Surface, lean: number): Slice | undefined {
  const tan = Math.tan(lean);
  const [originX, originY, originW] = surface.origin;
  const [acrossX, acrossY, acrossW] = surface.across;
  const [downX, downY, downW] = surface.down;
  // The band's centerline is every point with `x + y * tan` equal to the position. The point of
  // the surface's middle line at a distance of `offset` lands at
  // `(origin + offset * across) / w`, and that makes the equation linear in `offset`.
  const closing = acrossX + acrossY * tan - position * acrossW;
  if (!(closing > 0)) {
    return undefined;
  }
  const offset = (position * originW - originX - originY * tan) / closing;
  const w = originW + offset * acrossW;
  if (!(w > 0)) {
    return undefined;
  }
  const x = (originX + offset * acrossX) / w;
  const y = (originY + offset * acrossY) / w;
  // How fast the distance across the band grows with a step along the surface, and with a step
  // down it. The first sets the strip's width and the second sets its lean.
  const cos = Math.cos(lean);
  const sin = Math.sin(lean);
  const perStepAlong = ((acrossX - x * acrossW) * cos + (acrossY - y * acrossW) * sin) / w;
  const perStepDown = ((downX - x * downW) * cos + (downY - y * downW) * sin) / w;
  if (!(perStepAlong > 0)) {
    return undefined;
  }
  return { offset, stretch: 1 / perStepAlong, skew: Math.atan(-perStepDown) };
}

/**
 * The slices of the band on a surface at evenly spaced positions of one crossing, from its start
 * to its end: `steps` of them and one more. They're the keyframes of the surface's strip of
 * light. An animation moves between keyframes in straight lines, and on a surface in perspective
 * the true path curves, so more steps follow it more closely. `length` is the surface's length in
 * its own pixels. A strip never goes more than three lengths from the surface's left edge, on
 * either side, and it's never widened by more than eight times. Where the band has no slice, the
 * strip waits three lengths away: before the surface until the band's first slice, and past it
 * after that, in the shape it last had.
 */
export function slicesOf(
  travel: Travel,
  surface: Surface,
  lean: number,
  length: number,
  steps: number,
): Slice[] {
  const past = length * PAST_THE_END;
  let last: Slice = { offset: -past, stretch: 1, skew: 0 };
  let met = false;
  return Array.from({ length: steps + 1 }, (_, step) => {
    const position = travel.from + ((travel.to - travel.from) * step) / steps;
    const slice = sliceOf(position, surface, lean);
    if (slice === undefined) {
      last = { ...last, offset: met ? past : -past };
    } else {
      met = true;
      last = {
        offset: Math.min(Math.max(slice.offset, -past), past),
        stretch: Math.min(slice.stretch, WIDEST_STRETCH),
        skew: slice.skew,
      };
    }
    return last;
  });
}

/**
 * A slice as the transform that gives it to a strip of light. A browser applies the last function
 * first, so the strip leans, then widens, then moves. In any other order, the stretch would also
 * scale the distance moved, or the lean would no longer be the angle that `sliceOf()` worked out.
 */
export function sliceTransform(slice: Slice): string {
  const degrees = (slice.skew * 180) / Math.PI;
  return `translateX(${slice.offset.toFixed(2)}px) scaleX(${slice.stretch.toFixed(4)}) skewX(${degrees.toFixed(3)}deg)`;
}

/**
 * Whether any part of a box is inside a window of the given size. A box with no area is never on
 * screen, which is how an element that isn't displayed reports itself.
 */
export function isOnScreen(box: Box, width: number, height: number): boolean {
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.left < width &&
    box.left + box.width > 0 &&
    box.top < height &&
    box.top + box.height > 0
  );
}

/**
 * Moves a value toward a target, and returns the new value. `factor` is the share of the
 * remaining distance that one frame of 60 a second covers, and `elapsed` is the time since the
 * last step, in milliseconds. Two steps of 8 milliseconds end where one step of 16 does, so the
 * motion looks the same at every frame rate.
 */
export function easeToward(
  current: number,
  target: number,
  factor: number,
  elapsed: number,
): number {
  return target + (current - target) * (1 - factor) ** (elapsed / FRAME_MS);
}

/**
 * One frame of the band on its way to the pointer: its new position, given the position that the
 * pointer wants and the time since the last frame in milliseconds. The band covers the share of
 * the distance that `FOLLOW_EASE` sets. Within `SETTLED_PX`, it takes the wanted position exactly
 * and reports that it has settled, which is when the frame loop stops.
 */
export function followStep(
  position: number,
  target: number,
  elapsed: number,
): { position: number; settled: boolean } {
  const next = easeToward(position, target, FOLLOW_EASE, elapsed);
  return Math.abs(target - next) < SETTLED_PX
    ? { position: target, settled: true }
    : { position: next, settled: false };
}

/**
 * How long the band takes to glide over a distance by itself, in milliseconds: `SWEEP_MS` for a
 * whole crossing, the same share of that for a part of one, and never under `SHORTEST_GLIDE_MS`.
 */
export function glideDuration(distance: number, travel: Travel): number {
  const share = Math.abs(distance) / (travel.to - travel.from);
  return Math.max(SHORTEST_GLIDE_MS, SWEEP_MS * share);
}

/**
 * Where a gliding band is after a share of its glide's time, from 0 to 1. It starts and ends
 * slowly and is fastest halfway, as a sine wave is.
 */
export function glidePosition(from: number, to: number, share: number): number {
  const eased = (1 - Math.cos(Math.PI * Math.min(Math.max(share, 0), 1))) / 2;
  return from + (to - from) * eased;
}

// The wait before the next crossing, in milliseconds.
function sweepGap(): number {
  return SWEEP_GAP_SHORTEST_MS + Math.random() * (SWEEP_GAP_LONGEST_MS - SWEEP_GAP_SHORTEST_MS);
}

// The stylesheet's numbers that the geometry needs: the band's lean in radians, and half the
// band's width in CSS pixels.
interface Look {
  lean: number;
  band: number;
}

// Reads the look from the stylesheet. The properties are set only while the motion switch is on.
// Returns undefined when either of them is missing or isn't a number, which leaves the gold still.
function readLook(): Look | undefined {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => Number.parseFloat(style.getPropertyValue(name));
  const look = { lean: (read("--shine-lean") * Math.PI) / 180, band: read("--shine-band") };
  return Object.values(look).every(Number.isFinite) ? look : undefined;
}

// Whether the browser has every piece that the shine needs. Without registered custom
// properties, the band on foil text would jump and not glide. Without the `pseudoElement`
// option, an animation meant for a button's strip of light would move the button itself. Without
// `overflow: clip`, the strip would show outside the button. `DOMMatrix` works out where the gold
// bar lies in the window.
function canShine(): boolean {
  return (
    typeof Animation === "function" &&
    typeof KeyframeEffect === "function" &&
    "pseudoElement" in KeyframeEffect.prototype &&
    typeof CSSPropertyRule === "function" &&
    typeof MutationObserver === "function" &&
    typeof DOMMatrix === "function" &&
    CSS.supports("overflow", "clip")
  );
}

// Throws for a selector that the browser can't parse, as `querySelectorAll()` does.
function findAll(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)];
}

// The box that a button's strip of light is positioned in, which is the box inside its border.
function insideBorder(element: HTMLElement, box: Box): Box {
  return {
    left: box.left + element.clientLeft,
    top: box.top + element.clientTop,
    width: element.clientWidth,
    height: element.clientHeight,
  };
}

// The surface of a gold bar as the window shows it. The bar lies in a rig that the stylesheet
// turns in three dimensions, inside a stage that sets the perspective, and this composes the same
// transforms that the browser does. The browser measures the point that the perspective looks
// from, and the point that the rig turns about, from the outer edge of each element's border. It
// positions each element's children from the inner edge. Returns undefined when the bar isn't in
// that arrangement.
function barSurface(bar: HTMLElement): Surface | undefined {
  const rig = bar.offsetParent;
  const stage = rig instanceof HTMLElement ? rig.offsetParent : null;
  if (!(rig instanceof HTMLElement) || !(stage instanceof HTMLElement)) {
    return undefined;
  }
  const rigStyle = getComputedStyle(rig);
  const stageStyle = getComputedStyle(stage);
  const [turnX = 0, turnY = 0] = rigStyle.transformOrigin.split(" ").map(Number.parseFloat);
  const [eyeX = 0, eyeY = 0] = stageStyle.perspectiveOrigin.split(" ").map(Number.parseFloat);
  const depth = Number.parseFloat(stageStyle.perspective);
  const perspective = new DOMMatrix();
  // A stage with no perspective has `none` here, and the matrix stays as it is.
  if (depth > 0) {
    perspective.m34 = -1 / depth;
  }
  const stageBox = stage.getBoundingClientRect();
  const matrix = new DOMMatrix()
    .translateSelf(stageBox.left + eyeX, stageBox.top + eyeY)
    .multiplySelf(perspective)
    .translateSelf(
      stage.clientLeft + rig.offsetLeft + turnX - eyeX,
      stage.clientTop + rig.offsetTop + turnY - eyeY,
    )
    .multiplySelf(new DOMMatrix(rigStyle.transform))
    .translateSelf(
      rig.clientLeft + bar.offsetLeft + bar.clientLeft - turnX,
      rig.clientTop + bar.offsetTop + bar.clientTop + bar.clientHeight / 2 - turnY,
    );
  const land = (x: number, y: number, w: number): Projected => {
    const point = matrix.transformPoint(new DOMPoint(x, y, 0, w));
    return [point.x, point.y, point.w];
  };
  const surface = { origin: land(0, 0, 1), across: land(1, 0, 0), down: land(0, 1, 0) };
  return Object.values(surface).flat().every(Number.isFinite) ? surface : undefined;
}

// What moves the band now. `hold` is nothing: the band is parked off the window, or it's held
// where a resting pointer left it. `follow` is the pointer. `glide` is the band by itself, to the
// far end of the window for a timed crossing, or to the nearer end after the pointer has left.
// A glide's leg is set in its first frame, when the band's position is known.
type Drive =
  | { kind: "hold" }
  | { kind: "follow" }
  | {
      kind: "glide";
      toward: "far" | "nearer";
      leg?: { from: number; to: number; startedAt: number; duration: number };
    };

const HOLD: Drive = { kind: "hold" };
const FOLLOW: Drive = { kind: "follow" };

// Runs the shine. `startShine()` wraps this, so that nothing it throws reaches the caller.
function runShine(): () => void {
  if (!canShine()) {
    return () => {};
  }

  // A browser without `:has()` rejects the whole selector, so the finish name is left out there.
  const foilSelector = CSS.supports("selector(:has(*))")
    ? `${FOIL_SELECTOR}, ${CHOSEN_FINISH_SELECTOR}`
    : FOIL_SELECTOR;
  const finePointer = window.matchMedia(FINE_POINTER_QUERY);

  let failed = false;
  let allowed = false;
  let stopWatching: (() => void) | undefined;

  // The band is live while it's on the window or on its way across: every gold element on
  // screen then has an animation, paused at the band's position. A band that isn't live is
  // parked off the window, and no animation exists.
  let live = false;
  let position = 0;
  let drive = HOLD;
  // The crossing and the lean that the animations were last built for.
  let scene: { travel: Travel; lean: number } | undefined;
  const animations = new Map<HTMLElement, Animation>();
  // Whether the gold may have moved in the window, or changed, since the animations were built.
  let stale = false;

  const pointer = { x: 0, y: 0 };
  let pointerWatched = false;
  let frameRequest = 0;
  let lastFrame: number | undefined;
  let sweepTimer = 0;

  // Any failure ends the shine for this page, and the gold stays as the stylesheet draws it. A
  // failure while this runs is ignored, so stopping can't start over.
  function fail() {
    if (failed) {
      return;
    }
    failed = true;
    allowed = false;
    try {
      rest();
    } catch {
      // Nothing to do: whatever `rest()` couldn't stop is all that's left.
    }
    stopWatching?.();
    stopWatching = undefined;
  }

  // Wraps a callback that the browser calls, so that a failure in it ends the shine and doesn't
  // reach the console.
  function guarded<Arguments extends unknown[]>(callback: (...values: Arguments) => void) {
    return (...values: Arguments) => {
      try {
        callback(...values);
      } catch {
        fail();
      }
    };
  }

  function stopLoop() {
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    lastFrame = undefined;
  }

  function wake() {
    if (frameRequest === 0) {
      frameRequest = requestAnimationFrame(frame);
    }
  }

  function clearSweep() {
    window.clearTimeout(sweepTimer);
    sweepTimer = 0;
  }

  function scheduleSweep(delay: number) {
    clearSweep();
    sweepTimer = window.setTimeout(cross, delay);
  }

  // Takes the band off the page: with no animation, every element is back as the stylesheet
  // draws it at rest.
  function park() {
    for (const animation of animations.values()) {
      animation.cancel();
    }
    animations.clear();
    live = false;
    drive = HOLD;
    lastFrame = undefined;
  }

  // Measures the gold and gives every gold element on screen an animation of one whole crossing,
  // from the place where the element is now. An element that already has an animation keeps it
  // and gets new keyframes, so a rebuild during a scroll doesn't make the browser set up each
  // animation again. Returns false when the stylesheet has no look to read.
  function build(): boolean {
    stale = false;
    const look = readLook();
    if (look === undefined) {
      return false;
    }
    const { lean, band } = look;
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const travel = sweepTravel(width, height, lean, band / Math.cos(lean));

    // Every position is read before the first write, so the page is laid out once.
    const plans = new Map<HTMLElement, { keyframes: Keyframe[]; pseudoElement: string | null }>();
    for (const element of findAll(foilSelector)) {
      const box = element.getBoundingClientRect();
      if (isOnScreen(box, width, height)) {
        const keyframes = [
          { "--shine-x": `${foilOffset(travel.from, box, lean)}px` },
          { "--shine-x": `${foilOffset(travel.to, box, lean)}px` },
        ];
        plans.set(element, { keyframes, pseudoElement: null });
      }
    }
    // A button and the gold bar show the band on a strip of light. The strip's keyframes come
    // from where the surface is in the window, so the bar, which is drawn in perspective and
    // runs off the page, shows the same band as the flat gold around it. Both copies of the bar
    // get the same keyframes, so the sharp one and the soft one stay in register.
    const surfaces = new Map<HTMLElement, Surface>();
    for (const element of findAll(BUTTON_SELECTOR)) {
      const box = element.getBoundingClientRect();
      if (isOnScreen(box, width, height)) {
        surfaces.set(element, flatSurface(insideBorder(element, box)));
      }
    }
    for (const element of findAll(BAR_SELECTOR)) {
      if (isOnScreen(element.getBoundingClientRect(), width, height)) {
        const surface = barSurface(element);
        if (surface !== undefined) {
          surfaces.set(element, surface);
        }
      }
    }
    for (const [element, surface] of surfaces) {
      const slices = slicesOf(travel, surface, lean, element.clientWidth, SURFACE_STEPS);
      const keyframes = slices.map((slice) => ({ transform: sliceTransform(slice) }));
      plans.set(element, { keyframes, pseudoElement: "::after" });
    }

    for (const [element, animation] of animations) {
      if (!plans.has(element)) {
        animation.cancel();
        animations.delete(element);
      }
    }
    for (const [element, { keyframes, pseudoElement }] of plans) {
      const effect = animations.get(element)?.effect;
      if (effect instanceof KeyframeEffect) {
        effect.setKeyframes(keyframes);
      } else {
        // The fill keeps each end of the crossing in effect at time 0 and at the full time.
        const timing = { duration: CLOCK_MS, fill: "both" as const, pseudoElement };
        animations.set(element, new Animation(new KeyframeEffect(element, keyframes, timing)));
      }
    }
    scene = { travel, lean };
    return true;
  }

  // Moves the band by one frame. Every element's animation gets the same time, which is what
  // makes the highlights slices of one band. The page is measured only in a frame that follows a
  // change to it.
  const frame = guarded((now: number) => {
    frameRequest = 0;
    const elapsed = lastFrame === undefined ? FRAME_MS : Math.min(now - lastFrame, LONGEST_STEP_MS);
    lastFrame = now;

    const starting = !live;
    if (starting && drive.kind === "hold") {
      // The pointer came and went, or the band was parked, before this frame.
      lastFrame = undefined;
      return;
    }
    if ((starting || stale) && !build()) {
      park();
      return;
    }
    if (scene === undefined) {
      park();
      return;
    }
    const { travel, lean } = scene;
    const wanted = clampToTravel(pointerPosition(pointer.x, pointer.y, lean), travel);
    if (starting) {
      // A band that's off the window is nowhere in particular. For the pointer, it comes in by
      // the end that's nearer to the pointer. A timed crossing starts from the left.
      position = drive.kind === "follow" ? nearerEnd(wanted, travel) : travel.from;
      live = true;
    }
    position = clampToTravel(position, travel);

    if (drive.kind === "follow") {
      const step = followStep(position, wanted, elapsed);
      position = step.position;
      if (step.settled) {
        drive = HOLD;
      }
    } else if (drive.kind === "glide") {
      if (drive.leg === undefined) {
        const to = drive.toward === "far" ? travel.to : nearerEnd(position, travel);
        const duration = glideDuration(to - position, travel);
        drive.leg = { from: position, to, startedAt: now, duration };
        if (drive.toward === "far") {
          // The length of this crossing is known only now, so the timer that `cross()` set is
          // replaced by one that counts the wait from the crossing's end.
          scheduleSweep(duration + sweepGap());
        }
      }
      const { from, to, startedAt, duration } = drive.leg;
      const share = Math.min(1, (now - startedAt) / duration);
      position = glidePosition(from, to, share);
      if (share === 1) {
        // The glide ends off the window, so the band is done until something starts it again.
        park();
        return;
      }
    }

    const time = travelProgress(position, travel) * CLOCK_MS;
    for (const animation of animations.values()) {
      animation.currentTime = time;
    }
    if (drive.kind === "hold") {
      // The band is held where it is, and the paused animations keep it there with no frames.
      lastFrame = undefined;
    } else {
      frameRequest = requestAnimationFrame(frame);
    }
  });

  // The timer for a crossing has run out. A pointer that's moving keeps the band, and the timer
  // starts again. Otherwise the band glides to the far end: from the left edge when it was
  // parked, and from where it is when a resting pointer holds it. The crossing's first frame
  // sets the timer for the wait after it. The timer set here is for a frame that never comes,
  // so the schedule goes on even then.
  const cross = guarded(() => {
    sweepTimer = 0;
    if (!allowed || document.hidden) {
      return;
    }
    if (drive.kind !== "hold") {
      scheduleSweep(sweepGap());
      return;
    }
    drive = { kind: "glide", toward: "far" };
    wake();
    scheduleSweep(SWEEP_MS + sweepGap());
  });

  const onPointerMove = guarded((event: PointerEvent) => {
    // A finger has no position between touches, so only a mouse or a pen carries the band.
    if (event.pointerType === "touch") {
      return;
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    // The band goes on from wherever it is, so a move during a glide takes it over with no jump.
    drive = FOLLOW;
    wake();
  });

  // The pointer has left the window, so the band glides off by the nearer end. A glide that's
  // already under way goes on as it is.
  const onPointerLeave = guarded(() => {
    if (drive.kind === "glide") {
      return;
    }
    if (!live) {
      drive = HOLD;
      return;
    }
    drive = { kind: "glide", toward: "nearer" };
    wake();
  });

  // The page has scrolled, changed size, or changed its content, so the gold may be somewhere
  // else under a band that's fixed to the window. A live band gets one frame, which measures the
  // gold again and keeps the band where it is. A parked band needs nothing until it next starts.
  const onPageChange = guarded(() => {
    stale = true;
    if (live) {
      wake();
    }
  });

  const onVisibilityChange = guarded(() => {
    if (document.hidden) {
      clearSweep();
      stopLoop();
      park();
    } else if (allowed) {
      scheduleSweep(FIRST_SWEEP_MS);
    }
  });

  const watchPointer = guarded(() => {
    const watch = allowed && finePointer.matches;
    if (watch === pointerWatched) {
      return;
    }
    pointerWatched = watch;
    if (watch) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onPointerLeave);
    } else {
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
    }
  });

  // Client-side navigation and a new result change which elements are gold, and so does a button
  // that turns disabled. A choice of finish changes no markup, so it has its own listener.
  const observer = new MutationObserver(onPageChange);

  function resume() {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    document.addEventListener("change", onPageChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("scroll", onPageChange, { passive: true });
    window.addEventListener("resize", onPageChange);
    finePointer.addEventListener("change", watchPointer);
    watchPointer();
    scheduleSweep(FIRST_SWEEP_MS);
  }

  // Stops everything and leaves no animation, timer, frame, listener, or observer behind.
  function rest() {
    clearSweep();
    stopLoop();
    park();
    observer.disconnect();
    document.removeEventListener("change", onPageChange);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("scroll", onPageChange);
    window.removeEventListener("resize", onPageChange);
    finePointer.removeEventListener("change", watchPointer);
    watchPointer();
  }

  stopWatching = watchMotion(
    guarded((answer: boolean) => {
      if (failed) {
        return;
      }
      allowed = answer;
      if (answer) {
        resume();
      } else {
        rest();
      }
    }),
  );
  // The switch reports its first answer before it returns the function that ends the reports,
  // so a failure in that first report couldn't end them.
  if (failed) {
    stopWatching();
    stopWatching = undefined;
  }

  return () => {
    stopWatching?.();
    stopWatching = undefined;
    allowed = false;
    rest();
  };
}

/**
 * Starts the shine for the whole document, and returns a function that stops it and removes
 * everything that it added. Call it once, in the browser, after hydration. Nothing moves until
 * the motion switch allows it, and everything stops when the switch turns off. While motion is
 * allowed, a timer for the next crossing is always pending, and the listeners and the observer
 * that tell the band about the pointer and about changes to the page stay in place. Animations
 * exist only while the band is on the window: paused ones hold it where a resting pointer left
 * it, and the band's return off the window cancels them. Frames are requested only while the
 * band moves, or once after a change to the page while it's on the window. This
 * never throws, and neither does the function that it returns: a browser that can't run the
 * shine keeps the still gold.
 */
export function startShine(): () => void {
  let stop: (() => void) | undefined;
  try {
    stop = runShine();
  } catch {
    // Nothing to do: the gold stays as the stylesheet draws it.
  }
  return () => {
    try {
      stop?.();
    } catch {
      // Nothing to do: the page is leaving, and a failed cleanup leaves only still gold.
    }
  };
}
