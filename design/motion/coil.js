// Script for the coil prototype in coil.html. It plays one transition in two parts. In the
// coil, the long link replaces the visitor's link in the field one character at a time, runs
// out of the field, and winds around the page until every character is written. In the finale,
// the page changes to the result and the link leaves the coil row by row and flies into the
// well, where it comes to rest as the well's own text. The prototype exists so the motion can
// be judged and tuned before the app takes it, so every value worth tuning is a constant at
// the top.
//
// Query parameters, for review:
//
// - `play=1` plays 600 ms after the page loads.
// - `t=<0..1>` draws the coil stopped at that share of its duration. Use it for a still image.
// - `f=<0..1>` draws the finale stopped at that share of its duration: the coil complete, the
//   result in place, and the rows part of the way to the well. `f=1` is the last frame before
//   the well's own text takes over from the rows.
// - `slow=<number>` multiplies every duration of the transition. `slow=2` plays at half speed.
// - `chrome=0` hides the review toolbar.
//
// Each run records the time between frames, in milliseconds: `window.__coilFrames` for the coil
// while it writes, and `window.__coilFinaleFrames` for the finale from the first frame in which
// something moves. Both start empty on every run. The finale is set up while the finished coil
// holds still, so that cost is in neither list. The toolbar shows it, with the longest time in
// each list.

// The link that the visitor is taken to have submitted.
const VISITOR_LINK = "https://example.com/quarterly-report";

// Durations, in milliseconds.
const COIL_MS = 4200;
// How long the finished coil frames the page before it unwinds. The glow at the head fades in
// this time, because the glow belongs to the writing.
const HOLD_MS = 200;
// The fade of everything that the coil runs over.
const DIM_MS = 300;
// The fade of the result as it replaces the home page.
const ARRIVE_MS = 350;
// The flight of one row from the coil to the well.
const FLIGHT_MS = 300;
// The time between one row's start and the next. With the flight, it sets how many rows are
// under way at once, which is six or seven, of which about four are seen in the air, because
// a row spends the ends of its flight near the coil or near its place. One side of the frame
// holds two or three rows, so more than that in the air come from every side at every angle,
// and this few read as one group sweeping round the frame. The time shrinks only for a link
// with so many rows that the finale would pass `FINALE_MS`.
const STAGGER_MS = 46;
const FINALE_MS = 1600;
// The fade between a piece of the coil and the row that takes its place.
const CROSSFADE_MS = 60;
const AUTOPLAY_DELAY_MS = 600;

// The opacity at which a part of the finale waits for its turn. The browser doesn't paint a
// layer that has no opacity at all until the frame in which it first shows, and painting
// every waiting layer in one frame makes that frame late. At this opacity a layer is painted
// while the finished coil holds still, and it changes no pixel by more than one step in 255.
const UNSEEN = 0.002;

// How steeply the writing speeds up. The speed at the end is e to this power times the speed
// at the start, which is about 90 times. A lower number starts faster and ends slower.
const RAMP = 4.5;

const ARRIVE_EASING = "cubic-bezier(0.23, 1, 0.32, 1)";
const FLIGHT_EASING = "cubic-bezier(0.77, 0, 0.175, 1)";

// The outermost lane's distance from the window's edge, in CSS pixels. It keeps the letters
// clear of the fine gold rule, which ends 19px from the page edge.
const INSET = 34;
const RADIUS = 20;
// The coil is fitted to the window within these limits. The size is the font size of the text
// on the coil, and the pitch between lanes is the size times `PITCH_RATIO`, rounded.
const MIN_LAPS = 2;
const MAX_LAPS = 4;
const MIN_SIZE = 10;
const MAX_SIZE = 15;
const PITCH_RATIO = 1.45;
// The least pitch, as a share of the size, at which the letters of two lanes stay apart. The
// lanes beside the field close up to this when the field's text leaves them little room.
const MIN_PITCH_RATIO = 1.15;
// The least distance between the field's text and the baseline of the nearest lane, so the
// letters of the two never touch: under the baseline of the field's text, and to the left of
// its first letter.
const CLEARANCE_UNDER = 11;
const CLEARANCE_LEFT = 7;

// How many characters one text element holds at most. Only the newest element changes in a
// frame.
const CHUNK_LENGTH = 32;
// The number of characters at the head that take the accent color, as on a result.
const EDGE_LENGTH = 10;
// The steps in size between the field's text and the coil's, and the most characters in a step.
const TAPER_STEPS = 12;
const TAPER_RUN = 3;

// The length of a post, which the result's report counts the link in. The real page takes it
// from the server.
const POST_LENGTH = 280;

// The coil needs the wide layout, where the field and the button share a row.
const WIDE = "(min-width: 900px)";

const SVG = "http://www.w3.org/2000/svg";

// The properties of `window` that hold the frame times of the last run, for whoever measures it.
const COIL_FRAMES = "__coilFrames";
const FINALE_FRAMES = "__coilFinaleFrames";

/**
 * Describes the line that the text follows, as SVG path data. The line starts at `start`, runs
 * right to the side of the page, turns down, and spirals clockwise: down the right side, left
 * along the bottom, up the left side, and right along the top, so the top edge reads left to
 * right. The first lap is the innermost and the last runs at `insets` from the edge, because
 * the run from the field reaches the edge from the inside, and a line that wraps each lap
 * around the one before never meets that run again. Laps are `pitch` apart along the top and
 * the right side, and `fieldPitch` apart along the bottom and the left side, where the start
 * of the field's text leaves less room. Every corner is an arc of `radius`. The result also
 * has the line's `length`, its `lead`, which is the length of the straight run before the
 * first corner, and `corners`, the distance along the line to the middle of each arc. The
 * function takes numbers and touches no document, so it can be tested alone.
 */
export function coilPath({ width, height, start, insets, pitch, fieldPitch, laps, radius }) {
  const turns = [[start.x, start.y]];
  // The height at which the line arrives at the right side: first from the field, and then
  // from the top run of the lap before.
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

  let data = `M${point(turns[0])}`;
  let length = 0;
  let lead = 0;
  let pen = turns[0];
  const corners = [];
  for (let index = 1; index < turns.length - 1; index += 1) {
    const turn = turns[index];
    const before = distance(turns[index - 1], turn);
    const after = distance(turn, turns[index + 1]);
    // A short side gets a tighter corner, so two arcs never overlap.
    const arc = Math.min(radius, before / 2, after / 2);
    const from = toward(turn, turns[index - 1], arc / before);
    const to = toward(turn, turns[index + 1], arc / after);
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
  const end = turns[turns.length - 1];
  data += `L${point(end)}`;
  length += distance(pen, end);
  return { data, length, lead, corners };
}

function distance([ax, ay], [bx, by]) {
  return Math.hypot(bx - ax, by - ay);
}

// The point that is `share` of the way from one point to another.
function toward([ax, ay], [bx, by], share) {
  return [ax + (bx - ax) * share, ay + (by - ay) * share];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// A point as path data.
function point([x, y]) {
  return `${round(x)} ${round(y)}`;
}

/**
 * Divides the line into its three zones of text. The text is at the field's size for the
 * length of `fieldRun`, steps down to the coil's size before the line's first corner, and
 * stays at that size to the end of the line. The result is the number of characters in the
 * field, the sizes of the taper with the number of characters at each, and the `capacity` of
 * the whole line in characters. `advance` is the width of a character as a share of the font
 * size, which is one number for a fixed-width face.
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
}) {
  // The small sum keeps a character that fits exactly from being rounded away.
  const fieldCount = Math.floor(fieldRun / (fieldSize * advance) + 1e-6);
  const fieldLength = fieldCount * fieldSize * advance;
  // The sizes between the field's and the coil's, largest first.
  const taper = [];
  for (let step = 1; step < taperSteps; step += 1) {
    taper.push(fieldSize + ((coilSize - fieldSize) * step) / taperSteps);
  }
  // One character of each size, end to end. The taper has to end before the first corner.
  const onePass = taper.reduce((sum, size) => sum + size * advance, 0);
  const run = Math.max(1, Math.min(taperRun, Math.floor((lead - fieldLength) / onePass)));
  const rest = pathLength - fieldLength - run * onePass;
  const capacity = fieldCount + run * taper.length + Math.floor(rest / (coilSize * advance) + 1e-6);
  return { fieldCount, taper, run, capacity };
}

/**
 * Fits the coil to a window, so the whole link is written on it. Returns the number of laps,
 * the font size, the pitch between lanes, the pitch beside the field, and the insets of the
 * outermost lane, or `null` when the most laps at the smallest size can't hold the link. It
 * chooses the fewest laps that hold the link at the smallest size or larger, and then the
 * largest size at which the link still fits, so the last character lands at the end of the
 * last lap. The pitch follows the size and the length of the line follows the pitch, so the
 * size is found by halving a range. When the largest size holds the link with room to spare,
 * the text ends before the line does.
 * `depth` is how far in from the outermost lane a lane may be at the bottom and on the left,
 * where it passes the start of the field's text. When the lanes don't fit in it at their own
 * pitch, the lanes on those two sides close up, but never to less than `minPitchRatio` times
 * the size, where letters would touch.
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
}) {
  const insets = { top: inset, right: inset, bottom: inset, left: inset };
  for (let laps = minLaps; laps <= maxLaps; laps += 1) {
    // The widest pitch that still puts every lane beside the field within `depth`.
    const widest = Math.floor(depth / (laps - 1));
    const pitches = (size) => {
      const pitch = Math.round(size * pitchRatio);
      return { pitch, fieldPitch: Math.min(pitch, widest) };
    };
    const capacity = (size) => {
      const line = coilPath({ width, height, start, insets, ...pitches(size), laps, radius });
      const zones = coilZones({
        pathLength: line.length,
        lead: line.lead,
        advance,
        fieldRun,
        fieldSize,
        coilSize: size,
        taperSteps,
        taperRun,
      });
      return zones.capacity;
    };
    // The taper runs down from the field's size, so the coil's text is never larger than that.
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
 * Lays the link out on the line. The result has `count`, the number of characters that fit,
 * the `sizes` and `offsets` of each character along the line, and two ways of dividing them.
 * A piece is a run of characters that leaves the coil as one straight line of text: it belongs
 * to one row of the well, which is `rowLength` characters long, lies on one side of every
 * corner, and is in one zone of size. A chunk is one text element: a part of one piece, in one
 * font size, of `chunkLength` characters at most. Sizes differ, so each offset is the total
 * length of the characters before it. `corners` and `zones` come from `coilPath` and
 * `coilZones`.
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
}) {
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
      size = taper[Math.floor((index - fieldCount) / run)];
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
  let reached = 0;
  for (const corner of corners) {
    while (reached < count && (offsets[reached] + offsets[reached + 1]) / 2 < corner) {
      reached += 1;
    }
    if (reached < count) {
      cuts.add(reached);
    }
  }
  const edges = [...cuts].toSorted((a, b) => a - b);

  const pieces = [];
  const chunks = [];
  for (let index = 0; index < edges.length - 1; index += 1) {
    const from = edges[index];
    const to = edges[index + 1];
    pieces.push({ from, to, row: Math.floor(from / rowLength) });
    for (let at = from; at < to;) {
      let stop = at + 1;
      while (stop < to && stop - at < chunkLength && sizes[stop] === sizes[at]) {
        stop += 1;
      }
      chunks.push({
        from: at,
        to: stop,
        size: sizes[at],
        offset: offsets[at],
        plain: at < fieldCount,
        piece: index,
      });
      at = stop;
    }
  }
  return { count, fieldCount, rowLength, sizes, offsets, pieces, chunks };
}

/**
 * How much of the coil is written at time `t`, where both run from 0 to 1. The speed grows
 * exponentially: it multiplies by e to the power `ramp` between the start and the end, so the
 * first characters arrive one at a time and the last arrive by the hundred.
 */
export function written(t, ramp) {
  return Math.expm1(ramp * t) / Math.expm1(ramp);
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// A share from 0 to 1 that a query parameter gives, or `null` when it's absent or not a number.
function shareFrom(value) {
  const number = Number.parseFloat(value ?? "");
  return Number.isNaN(number) ? null : clamp(number, 0, 1);
}

const parameters = new URLSearchParams(window.location.search);
const slowBy = Number(parameters.get("slow"));
const slow = slowBy > 0 ? slowBy : 1;
// The progress at which a still image of the finale or of the coil is drawn, or `null`.
const stillFinale = shareFrom(parameters.get("f"));
const stillCoil = shareFrom(parameters.get("t"));
const still = stillFinale !== null || stillCoil !== null;

const root = document.documentElement;
// A still image shows the page already faded.
root.style.setProperty("--coil-fade", `${still ? 0 : DIM_MS * slow}ms`);

const overlay = document.querySelector(".coil-overlay");
const path = document.querySelector("#coil-path");
const home = document.querySelector("main.home");
const field = home.querySelector(".field-input");
const resultState = document.querySelector("#result-state");
const reviewBar = document.querySelector(".review-bar");
const playButton = reviewBar.querySelector('[data-review="play"]');
const resetButton = reviewBar.querySelector('[data-review="reset"]');
const readout = reviewBar.querySelector('[data-review="readout"]');

// The long link is the one in the saved result, so the coil and the well show the same text.
const longLink = resultState.content.querySelector(".long-link").textContent.trim();

const wide = window.matchMedia(WIDE);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const numberFormat = new Intl.NumberFormat("en-US");

// The run in progress, or `null`. Reset cancels it.
let run = null;
// The result's `main` element while the page shows the result.
let result = null;
// The element that holds the rows in flight, and the one that draws the result's background
// under them, while there is a finale.
let flyers = null;
let backdrop = null;
// The width of a character as a share of the font size, measured once the font has loaded.
let advance = 0;
// What the toolbar says about the last run or the still image.
let summary = "";

window[COIL_FRAMES] = [];
window[FINALE_FRAMES] = [];

/**
 * Finds where the field's text starts: the left edge of its first character and its baseline.
 * A field centers one line of text in its content box, so the baseline comes from the height
 * of a line and the baseline's place in it, which a hidden element in the same font reports.
 */
function measureField() {
  const box = field.getBoundingClientRect();
  const style = window.getComputedStyle(field);
  const px = (property) => Number.parseFloat(style[property]);
  const left = box.left + px("borderLeftWidth") + px("paddingLeft");
  const right = box.right - px("borderRightWidth") - px("paddingRight");
  const top = box.top + px("borderTopWidth") + px("paddingTop");
  const bottom = box.bottom - px("borderBottomWidth") - px("paddingBottom");

  const line = document.createElement("div");
  line.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
  line.style.font = `${style.fontWeight} ${style.fontSize}/normal ${style.fontFamily}`;
  // An empty inline block sits with its bottom edge on the baseline.
  const mark = document.createElement("span");
  mark.style.cssText = "display:inline-block;width:0;height:0";
  line.append("x", mark);
  document.body.append(line);
  const lineBox = line.getBoundingClientRect();
  const ascent = mark.getBoundingClientRect().bottom - lineBox.top;
  line.remove();

  // The browser draws the field's text on a whole device pixel.
  const ratio = window.devicePixelRatio;
  const baseline = top + (bottom - top - lineBox.height) / 2 + ascent;
  return {
    x: left,
    y: Math.round(baseline * ratio) / ratio,
    run: right - left,
    size: px("fontSize"),
  };
}

// Makes a text element that follows the line.
function onPath(className) {
  const text = document.createElementNS(SVG, "text");
  text.setAttribute("class", className);
  const textPath = document.createElementNS(SVG, "textPath");
  textPath.setAttribute("href", "#coil-path");
  text.append(textPath);
  return { text, textPath };
}

// Measures one character of the fixed-width face in the overlay itself, at a large size for
// precision.
function measureAdvance() {
  const probe = document.createElementNS(SVG, "text");
  probe.setAttribute("font-size", "100");
  probe.textContent = "0000000000";
  overlay.append(probe);
  const length = probe.getComputedTextLength();
  probe.remove();
  return length / 1000;
}

// The box of one character of a text node, in the window.
function characterBox(node, index) {
  const range = document.createRange();
  range.setStart(node, index);
  range.setEnd(node, index + 1);
  return range.getBoundingClientRect();
}

// Makes the result's `main` element, with the link alone in the well.
function makeResult() {
  const main = resultState.content.firstElementChild.cloneNode(true);
  main.querySelector(".long-link").textContent = longLink;
  return main;
}

/**
 * Counts the characters in one row of the well, by laying the result out where it will be,
 * unseen, before the coil starts. The coil's text is divided at the rows of the well, so the
 * count has to be known first.
 */
function measureColumns() {
  const probe = makeResult();
  probe.style.cssText = "position:absolute;top:0;left:0;width:100%;visibility:hidden";
  document.body.append(probe);
  const well = probe.querySelector(".long-link");
  const node = well.firstChild;
  const style = window.getComputedStyle(well);
  const width =
    well.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  // The arithmetic gives the answer, and the layout corrects it when the two differ.
  let columns = Math.floor(width / (advance * Number.parseFloat(style.fontSize)));
  const top = characterBox(node, 0).top;
  while (columns > 1 && characterBox(node, columns - 1).top > top + 1) {
    columns -= 1;
  }
  while (columns < longLink.length && characterBox(node, columns).top < top + 1) {
    columns += 1;
  }
  probe.remove();
  return columns;
}

/**
 * Fits the coil to the window as it is now. Returns the window's size, the start of the
 * field's text, and the fit, or `null` when the coil can't hold the link.
 */
function fitWindow() {
  const view = overlay.getBoundingClientRect();
  const start = measureField();
  const fit = fitCoil({
    width: view.width,
    height: view.height,
    start,
    characters: longLink.length,
    advance,
    fieldRun: start.run,
    fieldSize: start.size,
    inset: INSET,
    radius: RADIUS,
    depth: Math.min(
      view.height - INSET - start.y - CLEARANCE_UNDER,
      start.x - INSET - CLEARANCE_LEFT,
    ),
    minLaps: MIN_LAPS,
    maxLaps: MAX_LAPS,
    minSize: MIN_SIZE,
    maxSize: MAX_SIZE,
    pitchRatio: PITCH_RATIO,
    minPitchRatio: MIN_PITCH_RATIO,
    taperSteps: TAPER_STEPS,
    taperRun: TAPER_RUN,
  });
  return fit === null ? null : { view, start, fit };
}

/**
 * Lays the line out for a fitted window, and returns the coil. `write` shows the first `n`
 * characters, and only ever goes forward. It changes the text of the newest chunk and of the
 * edge, and adds every chunk that the head has reached, which is several in one frame near
 * the end. A finished chunk is never touched again, so the browser repaints a small area in
 * each frame. `complete` moves the last characters from the edge into their chunks, so the
 * edge can fade over them.
 */
function layCoil({ view, start, fit }) {
  const line = coilPath({
    width: view.width,
    height: view.height,
    start,
    insets: fit.insets,
    pitch: fit.pitch,
    fieldPitch: fit.fieldPitch,
    laps: fit.laps,
    radius: RADIUS,
  });
  path.setAttribute("d", line.data);
  const zones = coilZones({
    pathLength: line.length,
    lead: line.lead,
    advance,
    fieldRun: start.run,
    fieldSize: start.size,
    coilSize: fit.size,
    taperSteps: TAPER_STEPS,
    taperRun: TAPER_RUN,
  });
  const layout = coilLayout({
    characters: longLink.length,
    corners: line.corners,
    zones,
    advance,
    fieldSize: start.size,
    coilSize: fit.size,
    rowLength: measureColumns(),
    chunkLength: CHUNK_LENGTH,
  });
  const { count, sizes, offsets, chunks } = layout;

  const edge = onPath("coil-edge");
  const edgeRuns = [];
  overlay.append(edge.text);

  // One group for each piece, so a piece can leave the coil as one.
  const groups = [];
  // Adds the next chunk to the overlay, empty, and returns it with its text node, or returns
  // `null` after the last chunk.
  let next = 0;
  const addChunk = () => {
    const chunk = chunks[next];
    next += 1;
    if (chunk === undefined) {
      return null;
    }
    if (groups[chunk.piece] === undefined) {
      groups[chunk.piece] = document.createElementNS(SVG, "g");
      // The edge stays last, so it's drawn over every chunk.
      overlay.insertBefore(groups[chunk.piece], edge.text);
    }
    const { text, textPath } = onPath(chunk.plain ? "coil-chunk" : "coil-chunk coil-halo");
    text.setAttribute("font-size", String(chunk.size));
    textPath.setAttribute("startOffset", String(round(chunk.offset)));
    const node = document.createTextNode("");
    textPath.append(node);
    groups[chunk.piece].append(text);
    return { chunk, node };
  };
  // The chunk that the head is in.
  let head = addChunk();
  const fillTo = (lit) => {
    while (head !== null && lit >= head.chunk.to) {
      head.node.data = longLink.slice(head.chunk.from, head.chunk.to);
      head = addChunk();
    }
    if (head !== null) {
      head.node.data = longLink.slice(head.chunk.from, lit);
    }
  };

  // The edge is one run of text for each font size under it, which is one run everywhere
  // except where the text shrinks.
  const writeEdge = (from, to) => {
    let used = 0;
    for (let index = from; index < to;) {
      const size = sizes[index];
      let stop = index + 1;
      while (stop < to && sizes[stop] === size) {
        stop += 1;
      }
      if (used === edgeRuns.length) {
        const span = document.createElementNS(SVG, "tspan");
        const node = document.createTextNode("");
        span.append(node);
        edge.textPath.append(span);
        edgeRuns.push({ span, node, size: 0 });
      }
      const edgeRun = edgeRuns[used];
      if (edgeRun.size !== size) {
        edgeRun.span.setAttribute("font-size", String(size));
        edgeRun.size = size;
      }
      edgeRun.node.data = longLink.slice(index, stop);
      used += 1;
      index = stop;
    }
    for (let index = used; index < edgeRuns.length; index += 1) {
      edgeRuns[index].node.data = "";
    }
    edge.textPath.setAttribute("startOffset", String(round(offsets[from])));
  };

  let shown = -1;
  const write = (n) => {
    if (n === shown) {
      return;
    }
    shown = n;
    const lit = Math.max(0, n - EDGE_LENGTH);
    fillTo(lit);
    writeEdge(lit, n);
  };
  const complete = () => fillTo(count);

  return { fit, layout, count, groups, edge: edge.text, write, complete };
}

// Blanks the visitor's link in the field up to the head, so the long link overwrites it cell
// for cell. A space is as wide as any other character in the field's face.
let blanked = 0;
function overwrite(n) {
  const cells = Math.min(n, VISITOR_LINK.length);
  if (cells !== blanked) {
    blanked = cells;
    field.value = " ".repeat(cells) + VISITOR_LINK.slice(cells);
  }
}

// Fades everything that the coil runs over, so the link is the brightest thing on the page.
// The home page keeps its own mark, because it stays faded while it leaves, and the header and
// the footer come back with the result.
function dim() {
  document.body.classList.add("coil-dim");
  home.classList.add("coil-dimmed");
}

function clearCoil() {
  for (const child of overlay.querySelectorAll(":scope > g, :scope > text")) {
    child.remove();
  }
}

/**
 * Makes the figures that count with the rows as they land. Returns a function that shows the
 * figures for a link of a given length, and one that puts back the text that the page came
 * with, so the figures end on exactly the server's values.
 */
function countFigures(main) {
  const cells = main.querySelectorAll(".report td");
  const figures = [
    [main.querySelector(".figure dd"), (gained) => `${numberFormat.format(gained.percent)}%`],
    [cells[1], (gained) => `${numberFormat.format(gained.length)} characters`],
    [cells[2], (gained) => numberFormat.format(gained.added)],
    [cells[3], (gained) => numberFormat.format(gained.posts)],
  ];
  const served = figures.map(([element]) => element.textContent);
  // A table sizes its columns to its text, so a counting number would move the words beside
  // it. The column of values keeps the width that the served values give it until the count
  // is over. No value in the count is wider than the served one.
  const column = cells[0];
  column.style.width = `${column.getBoundingClientRect().width}px`;
  let shown = -1;
  const show = (length) => {
    if (length === shown) {
      return;
    }
    shown = length;
    const added = length - VISITOR_LINK.length;
    const gained = {
      length,
      added,
      percent: Math.round((added / VISITOR_LINK.length) * 100),
      posts: Math.ceil(length / POST_LENGTH),
    };
    for (const [element, format] of figures) {
      element.textContent = format(gained);
    }
  };
  const settle = () => {
    for (const [index, [element]] of figures.entries()) {
      element.textContent = served[index];
    }
    column.style.width = "";
  };
  return { show, settle };
}

/**
 * Sets the finale up and leaves it stopped at its first moment, where the page looks as it did
 * when the coil ended. Setting up is the expensive part, so it happens while the finished coil
 * holds still, and the motion starts on a later frame with `start`.
 *
 * The result goes into the page under the home page, which keeps its place and takes no space.
 * Each piece of the coil gets a line of text that sits exactly on its place in the well and
 * starts with a transform that puts it on the coil, at the piece's place, direction, and size.
 * In the finale, the home page fades out, the result fades in as one group, and each line
 * takes its piece's place in a short fade and flies home. Rows leave in reading order, so the
 * coil unwinds from the field outward and the well fills from the top. Only `transform` and
 * `opacity` animate.
 *
 * The lines fly over the result's background and the well, and behind the result's heading,
 * figures, buttons, and table, so they're inside the result, between its layers. An element
 * that fades is one layer, and the lines would fade with it, so the result can't fade as a
 * whole. Its parts fade together instead, and an element of its own draws its background for
 * the length of the finale.
 *
 * Returns the animations, the `total` duration, `start`, `follow`, which keeps the figures and
 * the landed lines in step with a moment in the finale, and `settle`, which hands the link
 * over to the well's own text.
 */
function stageFinale(coil, pace) {
  const { layout, groups } = coil;
  result = makeResult();
  const well = result.querySelector(".long-link");
  well.classList.add("coil-waiting");
  home.style.height = `${home.getBoundingClientRect().height}px`;
  home.classList.add("coil-leaving");
  home.after(result);
  // The page is now as tall as the result. Until the motion starts, the frame and the footer
  // stay where the window's edge puts them.
  document.body.classList.add("coil-held");

  backdrop = document.createElement("div");
  backdrop.className = "coil-backdrop";
  const resultStyle = window.getComputedStyle(result);
  for (const property of [
    "backgroundImage",
    "backgroundPosition",
    "backgroundSize",
    "backgroundRepeat",
  ]) {
    backdrop.style[property] = resultStyle[property];
  }
  result.prepend(backdrop);
  result.classList.add("coil-arriving", "coil-fading");

  flyers = document.createElement("div");
  flyers.className = "coil-flyers";
  const wellStyle = window.getComputedStyle(well);
  const wellSize = Number.parseFloat(wellStyle.fontSize);
  flyers.style.font = `${wellStyle.fontWeight} ${wellStyle.fontSize}/${wellStyle.lineHeight} ${wellStyle.fontFamily}`;
  result.append(flyers);
  const origin = flyers.getBoundingClientRect();
  const overlayBox = overlay.getBoundingClientRect();

  // Where a line's letters and its baseline sit under its own top edge.
  const probe = document.createElement("div");
  probe.className = "coil-flyer";
  const mark = document.createElement("span");
  mark.style.cssText = "display:inline-block;width:0;height:0";
  probe.append("x", mark);
  flyers.append(probe);
  const probeTop = probe.getBoundingClientRect().top;
  const inkTop = characterBox(probe.firstChild, 0).top - probeTop;
  const baseline = mark.getBoundingClientRect().bottom - probeTop;
  probe.remove();

  const rows = Math.ceil(layout.count / layout.rowLength);
  const stagger = Math.min(STAGGER_MS, (FINALE_MS - FLIGHT_MS) / Math.max(1, rows - 1));
  // The time from the first row's start to the last row's start.
  const leaving = (rows - 1) * stagger * pace;
  const total = leaving + FLIGHT_MS * pace;
  const wellNode = well.firstChild;
  const wellAdvance = advance * wellSize;

  const figures = countFigures(result);

  // Everything is measured before anything is made, so the browser lays the page out once
  // for the finale and not once for each line.
  const plans = layout.pieces.map((piece) => {
    // The line starts where its row starts in the well, and spaces put its letters in their
    // columns. The browser then places each letter by the same sum as in the well's own text,
    // so the two are drawn alike to the last pixel.
    const column = piece.from - piece.row * layout.rowLength;
    const place = characterBox(wellNode, piece.from - column);
    const inset = column * wellAdvance;
    const left = place.left + inset;
    const top = place.top - inkTop;

    // The line is straight and the coil isn't, so the line is matched to the coil at the
    // piece's middle character, which is on the straight part of the piece.
    const middle = Math.floor((piece.from + piece.to - 1) / 2);
    const here = path.getPointAtLength(layout.offsets[middle]);
    const there = path.getPointAtLength(layout.offsets[middle + 1]);
    const turn = Math.atan2(there.y - here.y, there.x - here.x);
    const scale = layout.sizes[middle] / wellSize;
    // The line turns and shrinks about the middle of its letters' baseline, so a long line
    // spins in place as it travels and doesn't sweep across the page like a clock's hand.
    const half = ((piece.to - piece.from) * wellAdvance) / 2;
    const back = ((middle - piece.from) * wellAdvance - half) * scale;
    const x = overlayBox.left + here.x - Math.cos(turn) * back - (left + half);
    const y = overlayBox.top + here.y - Math.sin(turn) * back - (top + baseline);
    // A turn of half a circle either way is the same length. The text on the bottom lanes
    // turns through pointing up.
    let degrees = (turn * 180) / Math.PI;
    if (degrees > 179.5) {
      degrees -= 360;
    }
    return {
      text: " ".repeat(column) + longLink.slice(piece.from, piece.to),
      left: place.left - origin.left,
      top: top - origin.top,
      pivot: inset + half,
      from: `translate(${x}px, ${y}px) rotate(${degrees}deg) scale(${scale})`,
      delay: piece.row * stagger * pace,
    };
  });

  // Each line with the moment it lands, in the order that they land.
  const flights = [];
  const animations = [
    home.animate(
      { opacity: [1, 0] },
      { duration: ARRIVE_MS * pace, easing: "ease-out", fill: "forwards" },
    ),
  ];
  // The result's parts fade in with one timing, so they arrive as one group.
  for (const part of [
    backdrop,
    ...result.querySelectorAll(":scope > .result > *, :scope > form"),
  ]) {
    animations.push(
      part.animate(
        { opacity: [UNSEEN, 1] },
        { duration: ARRIVE_MS * pace, easing: ARRIVE_EASING, fill: "backwards" },
      ),
    );
  }
  for (const [index, plan] of plans.entries()) {
    const flyer = document.createElement("div");
    flyer.className = "coil-flyer";
    flyer.textContent = plan.text;
    flyer.style.left = `${plan.left}px`;
    flyer.style.top = `${plan.top}px`;
    flyer.style.transformOrigin = `${plan.pivot}px ${baseline}px`;
    flyers.append(flyer);

    const { delay } = plan;
    const fade = { delay, duration: CROSSFADE_MS * pace };
    flights.push({ flyer, lands: delay + FLIGHT_MS * pace });
    animations.push(
      flyer.animate(
        { transform: [plan.from, "translate(0px, 0px) rotate(0deg) scale(1)"] },
        { delay, duration: FLIGHT_MS * pace, easing: FLIGHT_EASING, fill: "backwards" },
      ),
      flyer.animate({ opacity: [UNSEEN, 1] }, { ...fade, fill: "backwards" }),
      groups[index].animate({ opacity: [1, 0] }, { ...fade, fill: "forwards" }),
    );
  }

  for (const animation of animations) {
    animation.pause();
  }

  // Starts every animation at the same moment. The page's frame and footer go to their places
  // on the taller page, and the header and the footer come back with the result.
  const start = () => {
    document.body.classList.remove("coil-held", "coil-dim");
    const at = document.timeline.currentTime;
    for (const animation of animations) {
      animation.startTime = at;
    }
  };
  let down = 0;
  // Keeps the page in step with the flights at a moment in the finale. A line that has landed
  // drops its outline, which would otherwise cover the edge of the line beside it in the same
  // row. The figures show the middle of two counts, the characters that have left the coil and
  // the characters that have landed. That count starts with the first row's flight, ends as
  // the last row lands, and is slower at both ends, where only one of the two is moving.
  const follow = (elapsed) => {
    // The parts of the result keep their layers only for the length of their fade.
    result.classList.toggle("coil-fading", elapsed < ARRIVE_MS * pace);
    while (down < flights.length && flights[down].lands <= elapsed) {
      flights[down].flyer.classList.add("coil-landed");
      down += 1;
    }
    const span = Math.max(1, leaving);
    const left = clamp(elapsed / span, 0, 1);
    const landed = clamp((elapsed - FLIGHT_MS * pace) / span, 0, 1);
    const length =
      elapsed >= total ? layout.count : Math.round((layout.count * (left + landed)) / 2);
    figures.show(Math.max(VISITOR_LINK.length, length));
  };
  const settle = () => {
    figures.settle();
    well.classList.remove("coil-waiting");
    result.classList.remove("coil-arriving", "coil-fading");
    clearFinale();
    clearCoil();
    home.remove();
    restoreHome();
    // The home page's fade would otherwise hold it at nothing when Reset puts it back.
    for (const animation of animations) {
      animation.cancel();
    }
  };
  return { animations, total, start, follow, settle };
}

// Removes what a finale adds to the page.
function clearFinale() {
  flyers?.remove();
  flyers = null;
  backdrop?.remove();
  backdrop = null;
  document.body.classList.remove("coil-held");
}

// Takes the marks of the transition off the home page.
function restoreHome() {
  home.classList.remove("coil-leaving", "coil-dimmed");
  home.style.height = "";
}

// Changes the page to the result at once, with no motion.
function showResult() {
  result = makeResult();
  home.replaceWith(result);
}

/** Stops any run and puts the page back to the home state, with the visitor's link in the field. */
function reset() {
  if (run !== null) {
    run.cancelled = true;
    for (const animation of run.animations) {
      animation.cancel();
    }
    run = null;
  }
  clearFinale();
  if (result !== null) {
    if (home.isConnected) {
      result.remove();
    } else {
      result.replaceWith(home);
    }
    result = null;
  }
  clearCoil();
  restoreHome();
  document.body.classList.remove("coil-dim", "coil-running");
  blanked = 0;
  field.value = VISITOR_LINK;
  describe();
}

function worst(frames) {
  return frames.length === 0 ? "none" : `${Math.max(...frames).toFixed(1)} ms`;
}

// What the toolbar says about a coil: how it was fitted, and, when it played, what the
// finale's setup cost and the longest frame of each part. The setup is the time that the
// script took and the time until the browser had painted the result of it, which is two
// frames when nothing ran late.
function report(coil, setup) {
  const { laps, size, pitch, fieldPitch } = coil.fit;
  const apart = fieldPitch === pitch ? `${pitch}px` : `${pitch}px and ${fieldPitch}px`;
  summary =
    `${numberFormat.format(coil.count)} of ${numberFormat.format(longLink.length)} characters ` +
    `at ${size}px on ${laps} laps, ${apart} apart.`;
  if (setup !== null) {
    summary +=
      ` Finale setup: ${setup.script.toFixed(1)} ms of script, painted after ` +
      `${setup.painted.toFixed(1)} ms. Worst frame: coil ${worst(window[COIL_FRAMES])}, ` +
      `finale ${worst(window[FINALE_FRAMES])}.`;
  }
  describe();
}

/** Plays the transition from the start: the coil, a short hold, and the finale. */
function play() {
  reset();
  if (advance === 0 || obstacle() !== null) {
    return;
  }
  if (reducedMotion.matches) {
    showResult();
    return;
  }

  const thisRun = { cancelled: false, animations: [] };
  run = thisRun;
  document.body.classList.add("coil-running");
  const coil = layCoil(fitWindow());
  const frames = [];
  window[COIL_FRAMES] = frames;
  window[FINALE_FRAMES] = [];

  const duration = COIL_MS * slow;
  const start = performance.now();
  let last = null;
  let dimmed = false;
  // The finale, once the coil is complete, and what it cost to set up, once the page has
  // painted with it in place.
  let finale = null;
  let setup = null;
  const frame = (now) => {
    if (thisRun.cancelled) {
      return;
    }
    // The frame times are the coil's while it writes. The hold has the finale's setup in it.
    if (last !== null && finale === null) {
      frames.push(now - last);
    }
    last = now;
    // A frame's time can be earlier than the click that started the run.
    const elapsed = Math.max(0, now - start);
    const n = Math.round(coil.count * written(Math.min(1, elapsed / duration), RAMP));
    coil.write(n);
    overwrite(n);
    // The page makes room when the head leaves the field, not before.
    if (!dimmed && n > coil.layout.fieldCount) {
      dimmed = true;
      dim();
    }
    if (finale === null && elapsed >= duration) {
      coil.complete();
      thisRun.animations.push(
        coil.edge.animate({ opacity: [1, 0] }, { duration: HOLD_MS * slow, fill: "forwards" }),
      );
      const before = performance.now();
      finale = stageFinale(coil, slow);
      const script = performance.now() - before;
      thisRun.animations.push(...finale.animations);
      // The browser has painted the setup by the second frame after it.
      requestAnimationFrame(() => {
        requestAnimationFrame((painted) => {
          setup = { script, painted: painted - now };
        });
      });
    }
    if (setup === null || elapsed < duration + HOLD_MS * slow) {
      requestAnimationFrame(frame);
    } else {
      finish(thisRun, coil, finale, setup, now);
    }
  };
  requestAnimationFrame(frame);
}

// Starts the finale's motion in the frame at time `started`, and keeps the figures and the
// frame times in step with it. The first time recorded is that of the first frame in which
// something has moved.
function finish(thisRun, coil, finale, setup, started) {
  finale.start();
  const frames = window[FINALE_FRAMES];
  let before = started;
  const frame = (now) => {
    if (thisRun.cancelled) {
      return;
    }
    frames.push(now - before);
    before = now;
    const elapsed = now - started;
    finale.follow(elapsed);
    if (elapsed < finale.total) {
      requestAnimationFrame(frame);
    } else {
      finale.settle();
      document.body.classList.remove("coil-running");
      run = null;
      report(coil, setup);
    }
  };
  requestAnimationFrame(frame);
}

// Draws the coil or the finale stopped at one moment, for a still image.
function drawStill() {
  reset();
  if (obstacle() !== null) {
    return;
  }
  const coil = layCoil(fitWindow());
  const n = stillFinale === null ? Math.round(coil.count * written(stillCoil, RAMP)) : coil.count;
  coil.write(n);
  overwrite(n);
  if (n > coil.layout.fieldCount) {
    dim();
  }
  if (stillFinale !== null) {
    coil.complete();
    coil.edge.remove();
    const finale = stageFinale(coil, 1);
    finale.start();
    for (const animation of finale.animations) {
      animation.pause();
      animation.currentTime = stillFinale * finale.total;
    }
    finale.follow(stillFinale * finale.total);
    // Reset cancels these.
    run = { cancelled: false, animations: finale.animations };
  }
  report(coil, null);
}

// Says why the coil can't play in this window, or returns `null` when it can. The line runs
// around the window, so it needs the wide layout, a home page that fits without a scroll,
// which puts the page's frame at the window's edge and the field over the bottom lanes, and
// room on the line for the whole link.
function obstacle() {
  if (!wide.matches) {
    return "The coil plays in a window 900px wide or wider.";
  }
  if (result !== null) {
    return null;
  }
  if (root.scrollHeight > root.clientHeight) {
    return "The coil plays when the page fits in the window. Make the window taller.";
  }
  if (advance > 0 && fitWindow() === null) {
    return "The coil can't hold the whole link in this window. Make the window larger.";
  }
  return null;
}

// Says in the toolbar why the coil can't play, when it can't, and what the last run did
// otherwise.
function describe() {
  const reason = obstacle();
  playButton.disabled = reason !== null;
  if (reason !== null) {
    readout.textContent = reason;
  } else if (reducedMotion.matches && !still) {
    readout.textContent = "Reduced motion is on, so Play changes the page without the coil.";
  } else {
    readout.textContent = summary;
  }
}

reviewBar.hidden = parameters.get("chrome") === "0";
field.value = VISITOR_LINK;
describe();

playButton.addEventListener("click", () => play());
resetButton.addEventListener("click", reset);
// The page's own button plays too. Neither form is sent anywhere.
document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (home.contains(event.target) && result === null) {
    play();
  }
});

// The coil's text and the field's text are in the same face, and nothing can be measured
// until it loads.
const fieldStyle = window.getComputedStyle(field);
await document.fonts.load(
  `${fieldStyle.fontWeight} ${fieldStyle.fontSize} ${fieldStyle.fontFamily}`,
);
await document.fonts.ready;
advance = measureAdvance();
describe();

// The line is laid out for one window size, so a coil on screen doesn't survive a resize.
window.addEventListener("resize", () => {
  if (still) {
    drawStill();
  } else if (run !== null) {
    reset();
  }
  describe();
});

if (still) {
  drawStill();
} else if (parameters.get("play") === "1") {
  window.setTimeout(play, AUTOPLAY_DELAY_MS);
}
