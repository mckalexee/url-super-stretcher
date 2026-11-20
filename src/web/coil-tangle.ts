// The geometry of the tangle, the coil's form for a window where the frame coil can't play, such
// as a phone. The long link leaves the field as one cord that loops and crosses itself across the
// screen and gets smaller as it piles up. The cord is grown by a seeded, steered walk, so each link
// gets its own tangle, and this module turns numbers into that walk, the path that the text
// follows, the dark gaps at its crossings, and the division of the link into pieces and text
// elements. It touches no document, so the tests run it alone, and `coil.ts` does the drawing.
//
// Growing the cord takes tens of milliseconds on a fast phone and several hundred on a slow one,
// so the walk is a generator that yields after each decision. The caller runs it in short slices
// between frames and the page never stalls.
import { type CoilLayout, divideLine, type Insets, type Point } from "#web/coil-geometry.ts";

// The cord is grown in steps of `STEP` pixels. No bend is tighter than `BEND` times the text
// size. Two strands that aren't crossing stay `SPACING` times the size apart, plus their outlines,
// and a strand crosses another at no less than `CROSSING` radians, about 50 degrees, so it reads
// as a crossing and not as two strands merging. The text starts at the first size of a pair and
// shrinks to the second, so the cord piles up as it runs out of room. Each pair is tried with
// `SEEDS` seeds before the next, smaller pair.
const STEP = 3;
const BEND = 2.5;
const SPACING = 1.45;
const CROSSING = 0.87;
const SIZES: readonly (readonly [number, number])[] = [
  [12, 7.5],
  [11, 6.5],
  [10, 6],
  [9, 5.5],
];
const SEEDS = 5;
// How many times the cord may back up out of a trap before the seed counts as failed.
const RETREATS = 150;
// A seed after a failed one is the link's seed plus a multiple of this prime, so each attempt
// gets a different walk.
const SEED_STRIDE = 7919;
// A piece of the cord leaves as one straight line, so a piece ends where the cord has turned this
// far, in radians, from the piece's start.
const PIECE_TURN = 0.3;
// Font sizes change in steps of this size, so a chunk can hold many characters.
const SIZE_STEP = 0.5;
// The field's text stops this many text sizes short of the screen's edge, less the tightest
// bend, so the cord has room to bend away from the edge as it leaves.
const EXIT_ROOM = 0.6;

/** The rectangle that the cord stays inside, in the window's CSS pixels, with the window's size. */
export interface TangleBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** A rectangle in the window, such as the field's box. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where the cord passes over a strand that it laid earlier. */
export interface TangleCrossing {
  /** The distance along the cord to the crossing. */
  at: number;
  /** The text size of the strand on top, which is the newer one. */
  size: number;
  /** The text size of the strand underneath. */
  under: number;
}

/** A grown cord, as `tangleWalk()` returns it. */
export interface TangleWalk {
  /** The points of the cord, `step` pixels apart, with the heading at each, in radians. */
  xs: number[];
  ys: number[];
  headings: number[];
  step: number;
  crossings: TangleCrossing[];
  /** Each character's size and its distance along the cord. */
  sizes: number[];
  offsets: number[];
}

/** One dark cut that a newer strand makes in an older one where it crosses, as SVG path data. */
export interface TangleGap {
  data: string;
  width: number;
}

/** A tangle fitted to a screen, as `fitTangle()` returns it. */
export interface TangleFit {
  walk: TangleWalk;
  /** The path that the text follows, as SVG path data. */
  data: string;
  layout: CoilLayout;
  /** The gaps at the crossings, keyed by the character where the strand on top reaches them. */
  gaps: Map<number, TangleGap[]>;
  /** The size pair and the seed that worked, counted from zero, for whoever measures the fit. */
  pair: number;
  attempt: number;
}

/** The field's part of a tangle, as `planTangle()` works it out. */
export interface TanglePlan {
  bounds: TangleBounds;
  /** Where the field's text starts, on the middle of its letters. */
  start: Point;
  /** The number of characters in the field, and where the last one ends. */
  fieldCount: number;
  fieldEnd: number;
}

// The value at an index, for the arrays here, whose every index read is inside them. The fallback
// only satisfies the type checker.
function at(list: ArrayLike<number>, index: number): number {
  return list[index] ?? 0;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A string's 32-bit FNV-1a hash, which seeds the tangle, so a link always gets its own tangle. */
export function hashSeed(text: string): number {
  let value = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01_00_01_93);
  }
  return value >>> 0;
}

// A small seeded generator of numbers from 0 to 1, mulberry32.
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// A size rounded down to a step, so neighboring characters share it.
function stepped(size: number): number {
  return Math.max(SIZE_STEP, Math.floor(size / SIZE_STEP) * SIZE_STEP);
}

/**
 * The width of the dark outline under letters of a size: from 4px down to 1.5px, so the outline
 * never buries small letters.
 */
export function haloFor(size: number): number {
  return round(clamp(size * 0.3, 1.5, 4));
}

/** The least radius that the cord may bend at, for text of a size. */
export function tightestBend(size: number): number {
  return BEND * size;
}

/**
 * Works out the field's part of a tangle on a screen of `width` by `height`. The cord stays
 * `insets` from the screen's edges. `start` is where the field's text starts, on the middle of its
 * letters, `fieldRun` is the width of the field's text box, and `advance` is the width of a
 * character as a share of the font size. The field's text stops short of the field's end when the
 * cord would otherwise have no room to bend away from the screen's edge as it leaves.
 */
export function planTangle({
  width,
  height,
  insets,
  start,
  fieldRun,
  fieldSize,
  advance,
}: {
  width: number;
  height: number;
  insets: Insets;
  start: Point;
  fieldRun: number;
  fieldSize: number;
  advance: number;
}): TanglePlan {
  const bounds = {
    left: insets.left,
    top: insets.top,
    right: width - insets.right,
    bottom: height - insets.bottom,
    width,
    height,
  };
  const exitRoom = bounds.right - (BEND + EXIT_ROOM) * fieldSize - start.x;
  const fieldCount = Math.max(
    0,
    Math.floor(Math.min(fieldRun, exitRoom) / (fieldSize * advance) + 1e-6),
  );
  return { bounds, start, fieldCount, fieldEnd: start.x + fieldCount * fieldSize * advance };
}

/**
 * Grows the tangle: a cord that starts as the field's text, leaves the field heading right, and
 * then steers itself across the screen until it holds all `characters`. The heading wanders as a
 * sum of slow waves, which gives long sweeping bends and, where a wave holds one way long enough,
 * a loop. Every few steps the cord looks ahead along a range of bends and takes the one that
 * keeps it inside `bounds` and away from strands that it would run alongside, and that heads for
 * open space, stays near the wave, and keeps off the field's `box` where it can. It may cross a
 * strand at a steep angle, but not near another crossing. The cord only sees strands that it laid
 * a few letters ago, so its own trail never blocks it.
 *
 * The cord sizes its letters as it grows. They're `fieldSize` in the field, taper to `first`, and
 * shrink steadily toward `last` by the end of the link. When every bend is ruled out, the cord
 * backs up, takes a different way, and shrinks the rest of the link a little, so it really does
 * get smaller as it runs out of room.
 *
 * The generator yields after each decision, so a caller can spread the work over many frames.
 * It returns the walk, or `null` when the cord gets boxed in for good.
 */
export function* tangleWalk({
  plan,
  fieldSize,
  characters,
  first,
  last,
  box,
  seed,
  advance,
}: {
  plan: TanglePlan;
  fieldSize: number;
  characters: number;
  first: number;
  last: number;
  box: Box;
  seed: number;
  advance: number;
}): Generator<undefined, TangleWalk | null> {
  const { bounds, start, fieldEnd, fieldCount } = plan;
  const step = STEP;
  const sizes: number[] = [];
  const offsets: number[] = [];
  let squeeze = 1;
  // The end of the characters sized so far.
  const reach = () =>
    sizes.length === 0 ? 0 : at(offsets, sizes.length - 1) + at(sizes, sizes.length - 1) * advance;
  // Sizes characters until they reach past `along`, and returns the size of the one there.
  const sizeAt = (along: number) => {
    while (sizes.length < characters && reach() <= along) {
      const index = sizes.length;
      let size = fieldSize;
      if (index >= fieldCount) {
        const share = (index - fieldCount) / Math.max(1, characters - fieldCount);
        const settled = first * (last / first) ** share * squeeze;
        const taper = Math.min(1, (index - fieldCount + 1) / 8);
        size = Math.max(SIZE_STEP * 8, stepped(fieldSize + (settled - fieldSize) * taper));
      }
      offsets.push(reach());
      sizes.push(size);
    }
    return at(sizes, sizes.length - 1);
  };
  // The size of the character at `along`, which is already sized.
  const sizeOf = (along: number) => {
    let low = 0;
    let high = sizes.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (at(offsets, middle) <= along) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return at(sizes, low);
  };
  const random = generator(seed);
  const waves = [0.55, 0.3, 0.2].map((share) => ({
    share,
    length: 90 + random() * 260,
    phase: random() * Math.PI * 2,
  }));
  const xs: number[] = [];
  const ys: number[] = [];
  const headings: number[] = [];
  const bends: number[] = [];
  // Strands that the cord can see, in a grid of cells as wide as the widest spacing.
  const cell = 32;
  const columns = Math.ceil(bounds.width / cell) + 2;
  const grid = new Map<number, number[]>();
  // How full each cell is, which steers the cord toward open space.
  const density = new Float32Array(columns * (Math.ceil(bounds.height / cell) + 2));
  const cellOf = (x: number, y: number) =>
    (Math.floor(y / cell) + 1) * columns + Math.floor(x / cell) + 1;
  let filed = 0;
  const file = (index: number) => {
    const key = cellOf(at(xs, index), at(ys, index));
    let list = grid.get(key);
    if (list === undefined) {
      list = [];
      grid.set(key, list);
    }
    list.push(index);
    density[key] = at(density, key) + 1;
  };
  // Takes the newest filed point back out. Each cell lists its points in the order they were
  // filed, so that point is the last in its cell.
  const unfile = (index: number) => {
    const key = cellOf(at(xs, index), at(ys, index));
    grid.get(key)?.pop();
    density[key] = at(density, key) - 1;
  };
  // Calls `visit` with each strand point within `within` of a point, and stops when it returns
  // true.
  const near = (x: number, y: number, within: number, visit: (index: number) => boolean) => {
    const cx = Math.floor(x / cell) + 1;
    const cy = Math.floor(y / cell) + 1;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const list = grid.get((cy + dy) * columns + cx + dx);
        if (list === undefined) {
          continue;
        }
        for (const index of list) {
          const ex = at(xs, index) - x;
          const ey = at(ys, index) - y;
          if (ex * ex + ey * ey < within * within && visit(index)) {
            return true;
          }
        }
      }
    }
    return false;
  };
  const inBox = (x: number, y: number) =>
    x > box.left && x < box.right && y > box.top && y < box.bottom;

  for (let x = start.x; x <= fieldEnd; x += step) {
    xs.push(x);
    ys.push(start.y);
    headings.push(0);
    bends.push(0);
  }
  const fieldPoints = xs.length;
  const crossings: TangleCrossing[] = [];
  const crossPoints: [number, number, number][] = [];
  let x = at(xs, xs.length - 1);
  let y = start.y;
  let heading = 0;
  let bend = 0;
  let target = 0;
  let exited = false;
  let exitAt = Number.POSITIVE_INFINITY;
  // When every bend is ruled out, the cord backs up and pushes its wander one way for a while, so
  // it takes a different path past the trap. It backs up further each time it's stuck in the same
  // place, and gives up after `RETREATS` in all.
  let retreats = 0;
  let strikes = 0;
  let stuckAt = -1;
  let kick = 0;
  let kickUntil = -1;
  const rewind = (length: number) => {
    for (; filed > 0 && filed > length - 1; filed -= 1) {
      unfile(filed - 1);
    }
    while (xs.length > length) {
      xs.pop();
      ys.pop();
      headings.pop();
      bends.pop();
    }
    const end = (xs.length - 1) * step;
    for (let crossing = crossings.at(-1); crossing !== undefined && crossing.at > end;) {
      crossings.pop();
      crossPoints.pop();
      crossing = crossings.at(-1);
    }
    while (sizes.length > 0 && at(offsets, sizes.length - 1) > end) {
      sizes.pop();
      offsets.pop();
    }
    x = at(xs, xs.length - 1);
    y = at(ys, ys.length - 1);
    heading = at(headings, headings.length - 1);
    bend = at(bends, bends.length - 1);
    target = bend;
    if (exitAt >= xs.length) {
      exited = false;
      exitAt = Number.POSITIVE_INFINITY;
    }
  };

  // The cost of bending toward `aim` from here, or `Infinity` when that leads somewhere the cord
  // can't go. The cord looks ahead about half a turn at its tightest bend, the least that shows
  // whether it can still turn away from what's ahead. Only the first stretch is a hard limit,
  // where the cord can't avoid what it sees. Beyond it, what the cord would hit only costs, so a
  // strand far ahead steers the cord without ruling a bend out.
  const look = (aim: number, size: number, space: number, most: number, travelledNow: number) => {
    const pace = 6;
    const ramp = (most * 0.3 * pace) / step;
    const radius = 1 / most;
    const margin = 1.6 * radius;
    let px = x;
    let py = y;
    let ph = heading;
    let pk = bend;
    let cost = 0;
    let crowd = 0;
    const steps = Math.ceil((Math.PI * radius + 30) / pace);
    const firm = Math.ceil(Math.max(30, 2 * size) / pace);
    for (let index = 1; index <= steps; index += 1) {
      const hard = index <= firm;
      const weight = 1 - (0.6 * index) / steps;
      pk += clamp(aim - pk, -ramp, ramp);
      ph += pk * pace;
      px += Math.cos(ph) * pace;
      py += Math.sin(ph) * pace;
      const room = Math.min(
        px - bounds.left,
        bounds.right - px,
        py - bounds.top,
        bounds.bottom - py,
      );
      if (room < 0) {
        if (hard) {
          return Number.POSITIVE_INFINITY;
        }
        cost += 8 * weight;
      } else if (room < margin) {
        cost += ((margin - room) / margin) ** 2 * 1.5 * weight;
      }
      // The cord leaves the field upward, into the open screen, and not into the strip under the
      // field, where it would be boxed in.
      if (!exited && py > start.y) {
        cost += 3 * weight;
      }
      // The start of the link in the field is the part the visitor reads first, so the cord
      // crosses it, as a woven crossing, only when the rest of the screen is full.
      if (exited && inBox(px, py)) {
        cost += 0.6 * weight;
      }
      let crossing = false;
      const blocked = near(px, py, space, (other) => {
        if (Math.abs(Math.cos(ph - at(headings, other))) > Math.cos(CROSSING)) {
          return true;
        }
        crossing = true;
        return false;
      });
      if (blocked) {
        if (hard) {
          return Number.POSITIVE_INFINITY;
        }
        cost += 6 * weight;
      }
      if (crossing) {
        cost += 0.06;
        for (const [cx, cy, crossedAt] of crossPoints) {
          // The crossing that the cord is still passing over doesn't count.
          if (crossedAt > travelledNow - 2 * space) {
            continue;
          }
          if (Math.hypot(cx - px, cy - py) < space * 1.1) {
            if (hard) {
              return Number.POSITIVE_INFINITY;
            }
            cost += 4 * weight;
            break;
          }
        }
      }
      crowd += at(density, cellOf(px, py));
    }
    // The cord also leans toward the emptier side of the screen around it, past the end of what
    // it looks at, so it fills the open space before its own strands close it off.
    let far = 0;
    const ahead = 3 * cell;
    for (let ring = 1; ring <= 2; ring += 1) {
      far += at(
        density,
        cellOf(
          clamp(px + Math.cos(ph) * ahead * ring, 0, bounds.width),
          clamp(py + Math.sin(ph) * ahead * ring, 0, bounds.height),
        ),
      );
    }
    return cost + (crowd / steps / (cell / step)) * 1.2 + (far / (cell / step)) * 0.25;
  };

  while (sizes.length < characters || (xs.length - 1) * step < reach()) {
    const travelled = (xs.length - 1) * step;
    const size = sizeAt(travelled);
    const most = 1 / tightestBend(size);
    const space = SPACING * size + 2 * haloFor(size);
    // The trail that the cord can't see yet: long enough that a bend at the tightest radius has
    // turned away from it before it shows.
    const behind = Math.ceil((3 * space) / step);
    for (; filed > 0 && filed > xs.length - behind; filed -= 1) {
      unfile(filed - 1);
    }
    while (filed < xs.length - behind) {
      file(filed);
      filed += 1;
    }
    if ((xs.length - 1) % 4 === 0) {
      let wave = 0;
      for (const { share, length, phase } of waves) {
        wave += share * Math.sin((travelled / length) * Math.PI * 2 + phase);
      }
      const push = xs.length < kickUntil ? kick : 0;
      const wander = most * 0.85 * clamp(wave * 1.4 + push, -1, 1);
      let best = Number.POSITIVE_INFINITY;
      for (let option = 0; option <= 10; option += 1) {
        const aim = most * (option / 5 - 1);
        const cost =
          look(aim, size, space, most, travelled) + (0.7 * Math.abs(aim - wander)) / most;
        if (cost < best) {
          best = cost;
          target = aim;
        }
      }
      yield;
      if (best === Number.POSITIVE_INFINITY) {
        retreats += 1;
        if (retreats > RETREATS) {
          return null;
        }
        strikes = Math.abs(xs.length - stuckAt) < 80 ? strikes + 1 : 1;
        stuckAt = Math.max(stuckAt, xs.length);
        rewind(Math.max(fieldPoints, xs.length - 12 * strikes - 8));
        squeeze = Math.max(0.6, squeeze * 0.985);
        kick = (random() < 0.5 ? -1 : 1) * (0.7 + 0.5 * random());
        kickUntil = xs.length + 30 + 10 * strikes;
        continue;
      }
    }
    const ramp = most * 0.3;
    bend = clamp(bend + clamp(target - bend, -ramp, ramp), -most, most);
    heading += bend * step;
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
    xs.push(x);
    ys.push(y);
    headings.push(heading);
    bends.push(bend);
    if (!exited && !inBox(x, y)) {
      exited = true;
      exitAt = xs.length - 1;
    }
    // A crossing is where the cord passes over a strand it can see. Its gap is drawn once.
    const here = travelled + step;
    const previous = crossings.at(-1);
    if (previous === undefined || here - previous.at > space) {
      near(x, y, size * 0.5, (other) => {
        crossings.push({ at: here, size, under: sizeOf(other * step) });
        crossPoints.push([x, y, here]);
        return true;
      });
    }
  }
  return { xs, ys, headings, step, crossings, sizes, offsets };
}

/**
 * The point on a grown cord at the distance `along`, between the two points of the walk on either
 * side of it. The finale reads the cord here, and not from the drawn path, because a path of
 * thousands of segments is slow to measure.
 */
export function tanglePoint(walk: TangleWalk, along: number): Point {
  const { xs, ys, step } = walk;
  const last = xs.length - 1;
  const place = clamp(along / step, 0, last);
  const index = Math.min(last - 1, Math.floor(place));
  if (index < 0) {
    return { x: at(xs, 0), y: at(ys, 0) };
  }
  const share = place - index;
  return {
    x: at(xs, index) + (at(xs, index + 1) - at(xs, index)) * share,
    y: at(ys, index) + (at(ys, index + 1) - at(ys, index)) * share,
  };
}

// The characters where a row of the result's box starts, with the ends of the link.
function rowCuts(count: number, rowLength: number): Set<number> {
  const cuts = new Set([0, count]);
  for (let row = rowLength; row < count; row += rowLength) {
    cuts.add(row);
  }
  return cuts;
}

/**
 * The field's part of a tangle alone: the straight path under the field's text and its layout,
 * which the coil types on while the rest of the tangle is still being grown. Its pieces and chunks
 * match the start of the whole tangle's, so the field's text doesn't change when the whole tangle
 * takes over.
 */
export function fieldLine({
  plan,
  fieldSize,
  advance,
  rowLength,
  chunkLength,
}: {
  plan: TanglePlan;
  fieldSize: number;
  advance: number;
  rowLength: number;
  chunkLength: number;
}): { data: string; layout: CoilLayout } {
  const { start, fieldCount, fieldEnd } = plan;
  const sizes = new Float64Array(fieldCount).fill(fieldSize);
  // Summed one character at a time, as the walk sums them, so the two agree to the last bit.
  const offsets = new Float64Array(fieldCount + 1);
  for (let index = 1; index <= fieldCount; index += 1) {
    offsets[index] = at(offsets, index - 1) + fieldSize * advance;
  }
  const layout = divideLine({
    count: fieldCount,
    fieldCount,
    rowLength,
    sizes,
    offsets,
    cuts: rowCuts(fieldCount, rowLength),
    corners: [],
    chunkLength,
  });
  const data = `M${round(start.x)} ${round(start.y)}L${round(fieldEnd)} ${round(start.y)}`;
  return { data, layout };
}

/**
 * Turns a grown cord into the path that the text follows, the layout of the link on it, and the
 * gaps at its crossings. A piece ends at each row of the result's box, at the end of the field,
 * and where the cord has turned too far from the piece's start to leave as one straight line.
 * Each gap runs along the strand on top, wide enough to cut through the letters and the outline of
 * the strand under it.
 */
export function tangleLayout({
  walk,
  fieldCount,
  advance,
  rowLength,
  chunkLength,
}: {
  walk: TangleWalk;
  fieldCount: number;
  advance: number;
  rowLength: number;
  chunkLength: number;
}): { data: string; layout: CoilLayout; gaps: Map<number, TangleGap[]> } {
  const { xs, ys, headings, crossings, step } = walk;
  const count = walk.sizes.length;
  const sizes = Float64Array.from(walk.sizes);
  const offsets = Float64Array.from([
    ...walk.offsets,
    at(walk.offsets, count - 1) + at(walk.sizes, count - 1) * advance,
  ]);
  const parts = [`M${round(at(xs, 0))} ${round(at(ys, 0))}`];
  for (let index = 1; index < xs.length; index += 1) {
    parts.push(`L${round(at(xs, index))} ${round(at(ys, index))}`);
  }
  const headingAt = (offset: number) =>
    at(headings, Math.min(headings.length - 1, Math.round(offset / step)));

  const cuts = rowCuts(count, rowLength);
  cuts.add(fieldCount);
  let from = headingAt(at(offsets, fieldCount));
  for (let index = fieldCount + 1; index < count; index += 1) {
    const now = headingAt(at(offsets, index) + (at(sizes, index) * advance) / 2);
    if (cuts.has(index) || Math.abs(now - from) > PIECE_TURN) {
      cuts.add(index);
      from = now;
    }
  }

  const gaps = new Map<number, TangleGap[]>();
  const breaks = new Set<number>();
  let character = 0;
  for (const crossing of crossings) {
    const reach = crossing.under * 0.55 + crossing.size * 0.6 + 3;
    const startAt = Math.max(0, crossing.at - reach);
    while (character < count - 1 && at(offsets, character + 1) <= startAt) {
      character += 1;
    }
    if (character >= count - 1) {
      break;
    }
    const first = Math.floor(startAt / step);
    const last = Math.min(xs.length - 1, Math.ceil((crossing.at + reach) / step));
    let data = `M${round(at(xs, first))} ${round(at(ys, first))}`;
    for (let index = first + 1; index <= last; index += 1) {
      data += `L${round(at(xs, index))} ${round(at(ys, index))}`;
    }
    const list = gaps.get(character) ?? [];
    list.push({ data, width: round(crossing.size * 1.05 + 3) });
    gaps.set(character, list);
    breaks.add(character);
  }
  const layout = divideLine({
    count,
    fieldCount,
    rowLength,
    sizes,
    offsets,
    cuts,
    corners: [],
    chunkLength,
    breaks,
  });
  return { data: parts.join(""), layout, gaps };
}

/** Grows one cord, as `tangleWalk()` does. The tests replace it to make a seed fail. */
export type TangleWalker = typeof tangleWalk;

/**
 * Fits a tangle to a planned screen, so the whole link is written on it. It tries each pair of
 * sizes, largest first, with several seeds that start from the link's own, `seed`, and lays out
 * the first cord that holds every character. The generator yields while it works, as
 * `tangleWalk()` does, and returns the fit, or `null` when no cord holds the link.
 */
export function* fitTangle({
  plan,
  fieldSize,
  characters,
  box,
  seed,
  advance,
  rowLength,
  chunkLength,
  walker = tangleWalk,
}: {
  plan: TanglePlan;
  fieldSize: number;
  characters: number;
  box: Box;
  seed: number;
  advance: number;
  rowLength: number;
  chunkLength: number;
  walker?: TangleWalker;
}): Generator<undefined, TangleFit | null> {
  for (const [pair, [first, last]] of SIZES.entries()) {
    for (let attempt = 0; attempt < SEEDS; attempt += 1) {
      const walk = yield* walker({
        plan,
        fieldSize,
        characters,
        first,
        last,
        box,
        seed: (seed + attempt * SEED_STRIDE) >>> 0,
        advance,
      });
      if (walk === null) {
        continue;
      }
      // Turning thousands of points into path data is a slice of work of its own.
      yield;
      const laid = tangleLayout({
        walk,
        fieldCount: plan.fieldCount,
        advance,
        rowLength,
        chunkLength,
      });
      return { walk, ...laid, pair, attempt };
    }
  }
  return null;
}
