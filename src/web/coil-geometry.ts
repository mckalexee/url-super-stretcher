// The geometry of the coil, the transition in which a new long link runs out of the home page's
// field and winds around the inside of the page's frame. This module turns numbers into numbers:
// the line that the text follows, how many characters fit on it, the size that fits a link to a
// window, and how the link divides into pieces and text elements. It touches no document, so the
// tests run it alone, and `coil.ts` does the drawing.

/** A point in the window, in CSS pixels. */
export interface Point {
  x: number;
  y: number;
}

/** The distance of the outermost lane from each edge of the window, in CSS pixels. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The line that the text follows, as `coilPath()` describes it. */
export interface CoilPath {
  data: string;
  length: number;
  lead: number;
  corners: number[];
}

/** The three zones of text on the line, as `coilZones()` divides them. */
export interface CoilZones {
  fieldCount: number;
  taper: number[];
  run: number;
  capacity: number;
}

/** A coil fitted to a window, as `fitCoil()` chooses it. */
export interface CoilFit {
  laps: number;
  size: number;
  pitch: number;
  fieldPitch: number;
  insets: Insets;
}

/** A run of characters that leaves the coil as one straight line of text. */
export interface CoilPiece {
  from: number;
  to: number;
  row: number;
}

/** One text element on the coil: part of one piece, in one font size. */
export interface CoilChunk {
  from: number;
  to: number;
  size: number;
  offset: number;
  plain: boolean;
  piece: number;
}

/** The link laid out on the line, as `coilLayout()` lays it. */
export interface CoilLayout {
  count: number;
  fieldCount: number;
  rowLength: number;
  sizes: Float64Array;
  offsets: Float64Array;
  pieces: CoilPiece[];
  chunks: CoilChunk[];
}

type Pair = readonly [number, number];

function distance([ax, ay]: Pair, [bx, by]: Pair): number {
  return Math.hypot(bx - ax, by - ay);
}

// The point that is `share` of the way from one point to another.
function toward([ax, ay]: Pair, [bx, by]: Pair, share: number): Pair {
  return [ax + (bx - ax) * share, ay + (by - ay) * share];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// A point as path data.
function point([x, y]: Pair): string {
  return `${round(x)} ${round(y)}`;
}

/**
 * Describes the line that the text follows, as SVG path data. The line starts at `start`, runs
 * right to the side of the page, turns down, and spirals clockwise: down the right side, left
 * along the bottom, up the left side, and right along the top, so the top edge reads left to
 * right. The first lap is the innermost and the last runs at `insets` from the edge, because the
 * run from the field reaches the edge from the inside, and a line that wraps each lap around the
 * one before never meets that run again. Laps are `pitch` apart along the top and the right side,
 * and `fieldPitch` apart along the bottom and the left side, where the start of the field's text
 * leaves less room. Every corner is an arc of `radius`, or tighter on a short side. The result
 * also has the line's `length`, its `lead`, which is the length of the straight run before the
 * first corner, and `corners`, the distance along the line to the middle of each arc.
 */
export function coilPath({
  width,
  height,
  start,
  insets,
  pitch,
  fieldPitch,
  laps,
  radius,
}: {
  width: number;
  height: number;
  start: Point;
  insets: Insets;
  pitch: number;
  fieldPitch: number;
  laps: number;
  radius: number;
}): CoilPath {
  const turns: Pair[] = [[start.x, start.y]];
  // The height at which the line arrives at the right side: first from the field, and then from
  // the top run of the lap before.
  let entry = start.y;
  for (let lap = 0; lap < laps; lap += 1) {
    const lanesIn = laps - 1 - lap;
    const right = width - insets.right - pitch * lanesIn;
    const bottom = height - insets.bottom - fieldPitch * lanesIn;
    const left = insets.left + fieldPitch * lanesIn;
    const top = insets.top + pitch * lanesIn;
    turns.push([right, entry], [right, bottom], [left, bottom], [left, top]);
    entry = top;
  }
  // The last top run stops over its own right side.
  turns.push([width - insets.right, entry]);

  // Every index below is inside the list, and the fallback only satisfies the type checker.
  const turnAt = (index: number): Pair => turns[index] ?? [start.x, start.y];
  const first = turnAt(0);
  let data = `M${point(first)}`;
  let length = 0;
  let lead = 0;
  let pen = first;
  const corners: number[] = [];
  for (let index = 1; index < turns.length - 1; index += 1) {
    const previous = turnAt(index - 1);
    const turn = turnAt(index);
    const next = turnAt(index + 1);
    const before = distance(previous, turn);
    const after = distance(turn, next);
    // A short side gets a tighter corner, so two arcs never overlap.
    const arc = Math.min(radius, before / 2, after / 2);
    const from = toward(turn, previous, arc / before);
    const to = toward(turn, next, arc / after);
    // Every turn of a clockwise spiral is a quarter circle to the right.
    data += `L${point(from)}A${round(arc)} ${round(arc)} 0 0 1 ${point(to)}`;
    length += distance(pen, from);
    if (index === 1) {
      lead = length;
    }
    corners.push(length + (Math.PI / 4) * arc);
    length += (Math.PI / 2) * arc;
    pen = to;
  }
  const end = turnAt(turns.length - 1);
  data += `L${point(end)}`;
  length += distance(pen, end);
  return { data, length, lead, corners };
}

/**
 * Divides the line into its three zones of text. The text is at the field's size for the length
 * of `fieldRun`, steps down to the coil's size before the line's first corner, and stays at that
 * size to the end of the line. The result is the number of characters in the field, the sizes of
 * the taper, the number of characters at each size of the taper, and the `capacity` of the whole
 * line in characters. When one character of each size of the taper doesn't fit between the field
 * and the first corner, the run and the capacity are zero. `advance` is the width of a character
 * as a share of the font size, which is one number for a fixed-width face.
 */
export function coilZones({
  pathLength,
  lead,
  advance,
  fieldRun,
  fieldSize,
  coilSize,
  taperSteps,
  taperRun,
}: {
  pathLength: number;
  lead: number;
  advance: number;
  fieldRun: number;
  fieldSize: number;
  coilSize: number;
  taperSteps: number;
  taperRun: number;
}): CoilZones {
  // The small sum keeps a character that fits exactly from being rounded away.
  const fieldCount = Math.floor(fieldRun / (fieldSize * advance) + 1e-6);
  const fieldLength = fieldCount * fieldSize * advance;
  // The sizes between the field's and the coil's, largest first.
  const taper: number[] = [];
  for (let step = 1; step < taperSteps; step += 1) {
    taper.push(fieldSize + ((coilSize - fieldSize) * step) / taperSteps);
  }
  // One character of each size, end to end. The taper has to end before the first corner.
  const onePass = taper.reduce((sum, size) => sum + size * advance, 0);
  const run = Math.min(taperRun, Math.floor((lead - fieldLength) / onePass));
  // Text that jumped from the field's size to the coil's would read as a mistake, so a line
  // without room for one pass of the taper holds nothing, and `fitCoil()` gives up on it.
  if (!(run >= 1)) {
    return { fieldCount, taper, run: 0, capacity: 0 };
  }
  const rest = pathLength - fieldLength - run * onePass;
  const capacity = fieldCount + run * taper.length + Math.floor(rest / (coilSize * advance) + 1e-6);
  return { fieldCount, taper, run, capacity };
}

/**
 * Fits the coil to a window, so the whole link is written on it. Returns the number of laps, the
 * font size, the pitch between lanes, the pitch beside the field, and the insets of the outermost
 * lane, or `null` when the most laps at the smallest size can't hold the link, which includes a
 * line with no room for the taper before its first corner. It chooses the fewest laps that hold
 * the link at the smallest size or larger, and then the largest size at which the link still
 * fits, so the last character lands near the end of the last lap. The pitch follows the size and
 * the length of the line follows the pitch, so the size is found by halving a range. When the
 * largest size holds the link with room to spare, the text ends before the line does. The text is
 * never larger than the field's, because the taper runs down from it.
 *
 * `depth` is how far in from the outermost lane a lane may be at the bottom and on the left,
 * where it passes the start of the field's text. When the lanes don't fit in it at their own
 * pitch, the lanes on those two sides close up, but never to less than `minPitchRatio` times the
 * size, where letters would touch.
 */
export function fitCoil({
  width,
  height,
  start,
  characters,
  advance,
  fieldRun,
  fieldSize,
  inset,
  radius,
  depth,
  minLaps,
  maxLaps,
  minSize,
  maxSize,
  pitchRatio,
  minPitchRatio,
  taperSteps,
  taperRun,
}: {
  width: number;
  height: number;
  start: Point;
  characters: number;
  advance: number;
  fieldRun: number;
  fieldSize: number;
  inset: number;
  radius: number;
  depth: number;
  minLaps: number;
  maxLaps: number;
  minSize: number;
  maxSize: number;
  pitchRatio: number;
  minPitchRatio: number;
  taperSteps: number;
  taperRun: number;
}): CoilFit | null {
  const insets = { top: inset, right: inset, bottom: inset, left: inset };
  for (let laps = minLaps; laps <= maxLaps; laps += 1) {
    // The widest pitch that still puts every lane beside the field within `depth`.
    const widest = Math.floor(depth / (laps - 1));
    const pitches = (size: number) => {
      const pitch = Math.round(size * pitchRatio);
      return { pitch, fieldPitch: Math.min(pitch, widest) };
    };
    const capacity = (size: number) => {
      const line = coilPath({ width, height, start, insets, ...pitches(size), laps, radius });
      return coilZones({
        pathLength: line.length,
        lead: line.lead,
        advance,
        fieldRun,
        fieldSize,
        coilSize: size,
        taperSteps,
        taperRun,
      }).capacity;
    };
    const cap = Math.min(maxSize, fieldSize, widest / minPitchRatio);
    if (cap >= minSize && capacity(minSize) >= characters) {
      let low = minSize;
      let high = cap;
      if (capacity(high) >= characters) {
        low = high;
      }
      for (let pass = 0; pass < 24 && high - low > 0.001; pass += 1) {
        const middle = (low + high) / 2;
        if (capacity(middle) >= characters) {
          low = middle;
        } else {
          high = middle;
        }
      }
      // Rounding down can only add room.
      const size = Math.max(minSize, Math.floor(low * 100) / 100);
      return { laps, size, ...pitches(size), insets };
    }
  }
  return null;
}

/**
 * Lays the link out on the line. The result has `count`, the number of characters that fit, the
 * `sizes` and `offsets` of each character along the line, and two ways of dividing them. A piece
 * is a run of characters that leaves the coil as one straight line of text: it belongs to one row
 * of the well, which is `rowLength` characters long, lies on one side of every corner, and is in
 * one zone of size. A chunk is one text element: a part of one piece, in one font size, of
 * `chunkLength` characters at most. Sizes differ, so each offset is the total length of the
 * characters before it. `corners` and `zones` come from `coilPath()` and `coilZones()`.
 */
export function coilLayout({
  characters,
  corners,
  zones,
  advance,
  fieldSize,
  coilSize,
  rowLength,
  chunkLength,
}: {
  characters: number;
  corners: readonly number[];
  zones: CoilZones;
  advance: number;
  fieldSize: number;
  coilSize: number;
  rowLength: number;
  chunkLength: number;
}): CoilLayout {
  const { fieldCount, taper, run } = zones;
  const taperEnd = fieldCount + run * taper.length;
  const count = Math.min(characters, zones.capacity);
  const sizes = new Float64Array(count);
  const offsets = new Float64Array(count + 1);
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    let size = coilSize;
    if (index < fieldCount) {
      size = fieldSize;
    } else if (index < taperEnd) {
      size = taper[Math.floor((index - fieldCount) / run)] ?? coilSize;
    }
    sizes[index] = size;
    offsets[index] = offset;
    offset += size * advance;
  }
  offsets[count] = offset;

  // Where one piece ends and the next starts: at each row of the well, at each change of zone,
  // through the taper, and at the character that straddles the middle of each corner.
  const cuts = new Set([0, count]);
  for (let row = rowLength; row < count; row += rowLength) {
    cuts.add(row);
  }
  for (const zone of [fieldCount, taperEnd]) {
    if (zone < count) {
      cuts.add(zone);
    }
  }
  // A piece leaves at one size, so the taper is cut into pieces of three sizes each, which is
  // near enough to one size that nothing jumps.
  for (let cut = fieldCount + run * 3; cut < Math.min(taperEnd, count); cut += run * 3) {
    cuts.add(cut);
  }
  const at = (index: number) => offsets[index] ?? 0;
  let reached = 0;
  for (const corner of corners) {
    while (reached < count && (at(reached) + at(reached + 1)) / 2 < corner) {
      reached += 1;
    }
    if (reached < count) {
      cuts.add(reached);
    }
  }
  const edges = [...cuts].toSorted((a, b) => a - b);

  const pieces: CoilPiece[] = [];
  const chunks: CoilChunk[] = [];
  for (let index = 0; index < edges.length - 1; index += 1) {
    const from = edges[index] ?? 0;
    const to = edges[index + 1] ?? 0;
    pieces.push({ from, to, row: Math.floor(from / rowLength) });
    for (let first = from; first < to;) {
      let stop = first + 1;
      while (stop < to && stop - first < chunkLength && sizes[stop] === sizes[first]) {
        stop += 1;
      }
      chunks.push({
        from: first,
        to: stop,
        size: sizes[first] ?? coilSize,
        offset: at(first),
        plain: first < fieldCount,
        piece: index,
      });
      first = stop;
    }
  }
  return { count, fieldCount, rowLength, sizes, offsets, pieces, chunks };
}
