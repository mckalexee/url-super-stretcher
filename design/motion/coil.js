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
// - `variant=tangle`, `variant=snake`, or `variant=vortex` picks the phone's variant, which the
//   toolbar also switches. Phone mode is on in a window narrower than 900px, and the variants
//   are described where phone mode starts, below. The default is `tangle`.
// - `scroll=<pixels>` starts a phone's page at that scroll, to try the coil from a page that
//   isn't scrolled to the field. Without it, the page starts at its bottom, where the field is.
//   Play brings the field into view first, as the browser does when the visitor types in it.
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
  return divideLine({ count, fieldCount, rowLength, sizes, offsets, cuts, corners, chunkLength });
}

/**
 * Divides a laid-out line into pieces and chunks, as `coilLayout` describes them. `cuts` holds
 * the characters where a piece must start, and the character that straddles each distance in
 * `corners` starts one too. A chunk also starts at each character in `breaks`, which doesn't
 * start a piece: the phone's tangle uses it so that a gap at a crossing can show when the head
 * reaches it.
 */
export function divideLine({
  count,
  fieldCount,
  rowLength,
  sizes,
  offsets,
  cuts,
  corners,
  chunkLength,
  breaks = null,
}) {
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
      while (
        stop < to &&
        stop - at < chunkLength &&
        sizes[stop] === sizes[at] &&
        !breaks?.has(stop)
      ) {
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
    // The phone's variants keep their text clear of the field's box.
    box,
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

// Measures how far above the baseline the middle of the letters sits, where the phone's text is
// centered on its path, as a share of the font size.
function measureCentralShift() {
  return (letterTop("central") - letterTop(null)) / 100;
}

// The top of some letters at 100px on one baseline, in the overlay.
function letterTop(baseline) {
  const text = document.createElementNS(SVG, "text");
  text.setAttribute("font-size", "100");
  text.setAttribute("y", "500");
  if (baseline !== null) {
    text.setAttribute("dominant-baseline", baseline);
  }
  text.textContent = "Hxg";
  overlay.append(text);
  const top = text.getBBox().y;
  text.remove();
  return top;
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
  return buildCoil(fit, layout);
}

/**
 * Makes the text elements for a laid-out line, whose path is already in `#coil-path`, and
 * returns the coil that `layCoil` describes. On a phone, `extras` can give `haloFor`, the width
 * of the dark outline at a font size, because a 4px outline buries small letters, and `gaps`,
 * the dark cuts that a newer strand of the tangle makes in an older one, keyed by the character
 * where each starts.
 */
function buildCoil(fit, layout, extras = {}) {
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
    if (extras.haloFor !== undefined && !chunk.plain) {
      text.setAttribute("stroke-width", String(extras.haloFor(chunk.size)));
    }
    // A gap goes under the strand that makes it and over everything older.
    for (const gap of extras.gaps?.get(chunk.from) ?? []) {
      const cut = document.createElementNS(SVG, "path");
      cut.setAttribute("class", "coil-gap");
      cut.setAttribute("d", gap.data);
      cut.setAttribute("stroke-width", String(gap.width));
      groups[chunk.piece].append(cut);
    }
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
function stageFinale(coil, pace, phone = null) {
  const { layout, groups } = coil;
  result = makeResult();
  const well = result.querySelector(".long-link");
  well.classList.add("coil-waiting");
  const homeBox = home.getBoundingClientRect();
  home.style.height = `${homeBox.height}px`;
  home.classList.add("coil-leaving");
  home.after(result);
  if (phone === null) {
    // The page is now as tall as the result. Until the motion starts, the frame and the footer
    // stay where the window's edge puts them.
    document.body.classList.add("coil-held");
  } else {
    // The result starts at the top of the page, as a new page would. The home page keeps its
    // place on the screen while it fades, whatever the scroll was.
    window.scrollTo(0, 0);
    phone.home += homeBox.top - home.getBoundingClientRect().top;
    home.style.transform = `translateY(${phone.home}px)`;
  }

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
  // The line that is matched to the coil: the baseline on a desktop, and the middle of the
  // letters on a phone, whose coil text sits centered on its path.
  const anchor = phone === null ? baseline : baseline - centralShift * wellSize;
  // On a phone, the well is below the fold. The camera starts with the top of the well near
  // the top of the screen, so the rows land where they can be seen, and then rises to the top
  // of the page, where the figures are. `lift` is how far the page starts raised.
  const lift = phone === null ? 0 : Math.max(0, well.getBoundingClientRect().top - CAMERA_TOP);

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
    const y = overlayBox.top + here.y - Math.sin(turn) * back - (top - lift + anchor);
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
    flyer.style.transformOrigin = `${plan.pivot}px ${anchor}px`;
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

  if (phone !== null) {
    // The camera rises once the first rows are home. Everything that belongs to the page moves
    // together, the coil that is still waiting with it, so a row's start never parts from its
    // piece of the coil. The page's frame rides with the page, as it will be when the page
    // settles.
    const delay = Math.min(PAN_DELAY_MS * pace, total / 2);
    const pan = { delay, duration: total - delay, easing: PAN_EASING };
    const page = { transform: [`translateY(${-lift}px)`, "translateY(0px)"] };
    animations.push(
      result.animate(page, { ...pan, fill: "backwards" }),
      document.querySelector(".site-header").animate(page, { ...pan, fill: "backwards" }),
      document.body.animate(page, { ...pan, fill: "backwards", pseudoElement: "::before" }),
      overlay.animate(
        {
          transform: [`translateY(${phone.overlay}px)`, `translateY(${phone.overlay + lift}px)`],
        },
        { ...pan, fill: "both" },
      ),
    );
  }

  for (const animation of animations) {
    animation.pause();
  }

  // Starts every animation at the same moment. The page's frame and footer go to their places
  // on the taller page, and the header and the footer come back with the result.
  const start = () => {
    document.body.classList.remove("coil-held", "coil-dim", "coil-pinned");
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
  home.style.transform = "";
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
  clearPhone();
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
  if (coil.phone === undefined) {
    const { laps, size, pitch, fieldPitch } = coil.fit;
    const apart = fieldPitch === pitch ? `${pitch}px` : `${pitch}px and ${fieldPitch}px`;
    summary =
      `${numberFormat.format(coil.count)} of ${numberFormat.format(longLink.length)} characters ` +
      `at ${size}px on ${laps} laps, ${apart} apart.`;
  } else {
    summary =
      `${numberFormat.format(coil.count)} of ${numberFormat.format(longLink.length)} characters, ` +
      `${coil.phone.summary} Fitted in ${coil.phone.cost.toFixed(0)} ms.`;
  }
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
  if (!wide.matches) {
    playPhone();
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

// Phone mode ------------------------------------------------------------------------------------
//
// A phone holds the joke best, because a link of two thousand characters really does run out
// of room on it. Each variant draws its line against the visible screen, the layout viewport,
// whatever the scroll, and keeps its text inside the safe area and the page's gold frame,
// which is pinned to the screen for the length of the run. Text sits centered on its path,
// so a lane's letters are the same distance from the lanes on either side, whichever way up
// they are. The finale is the desktop's, with a camera added: the result stacks on a phone, so
// its well starts below the fold, and the page starts raised so the rows land in view, then
// lowers to its top as the figures finish counting.
//
// - `tangle`: the link leaves the field and wanders the screen as one cord, in long bends that
//   loop and cross, growing smaller as it piles up.
// - `snake`: the link runs back and forth below the field, curling at each edge, and pushes
//   the page up a row at a time when it reaches the bottom, as a terminal does.
// - `vortex`: the page drops so the field sits on the bottom lane, and the link winds inward
//   around the screen, each side smaller than the last, until it's sucked into the middle.

const VARIANTS = ["tangle", "snake", "vortex"];

// The distance from the screen's edge to the middle of the outermost text, in CSS pixels. A
// letter of 16px reaches about 7px either side of its middle, and its outline 2px more, so the
// letters stay clear of the fine gold rule, which ends 16px in on a phone.
const PHONE_INSET = 28;
// The least distance between the field's box and the screen's edge, after the vortex drops the
// page or the snake raises it.
const FIELD_CLEARANCE = 20;
// The camera's start: the well's top edge this far below the top of the screen.
const CAMERA_TOP = 40;
// When the camera starts to rise in the finale, and its curve.
const PAN_DELAY_MS = 450;
const PAN_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
// How long the vortex takes to drop the page.
const DROP_MS = 320;
const DROP_EASING = "cubic-bezier(0.23, 1, 0.32, 1)";
// Font sizes on a phone change in steps of this size, so a chunk can hold many characters.
const SIZE_STEP = 0.5;

// The vortex. Lanes are `VORTEX_PITCH` times their text size apart, corners have a radius of
// `VORTEX_RADIUS` times the size, and the text in the middle is never smaller than
// `VORTEX_LEAST`, where it's texture on purpose.
const VORTEX_PITCH = 1.35;
const VORTEX_RADIUS = 1.2;
const VORTEX_LEAST = 3.5;

// The snake. Rows are `SNAKE_PITCH` times the size apart, which gives the curl at each edge a
// radius of 0.8 times the size, the least at which the letters on its inside stay apart.
const SNAKE_PITCH = 1.6;
const SNAKE_SIZES = [8, 14];

// The tangle. The cord is grown in steps of `TANGLE_STEP` pixels. No bend is tighter than
// `TANGLE_BEND` times the text size. Two strands that aren't crossing stay `TANGLE_SPACING`
// times the size apart, plus the outlines, and a strand crosses another at no less than
// `TANGLE_CROSSING` radians, so it reads as a crossing and not as two strands merging. The
// text starts at the first size of a pair and shrinks to the second, so the cord piles up as
// it runs out of room. Each pair is tried with `TANGLE_SEEDS` seeds before the next, smaller
// pair.
const TANGLE_STEP = 3;
const TANGLE_BEND = 2.5;
const TANGLE_SPACING = 1.45;
const TANGLE_CROSSING = 0.87;
const TANGLE_SIZES = [
  [12, 7.5],
  [11, 6.5],
  [10, 6],
  [9, 5.5],
];
const TANGLE_SEEDS = 5;
const TANGLE_RETREATS = 150;
// A piece of the cord leaves as one straight line, so a piece ends where the cord has turned
// this far, in radians, from the piece's start.
const TANGLE_PIECE_TURN = 0.3;

let variant = VARIANTS.includes(parameters.get("variant")) ? parameters.get("variant") : "tangle";
// Why the phone's coil can't play, after a fit fails, or `null`.
let phoneTrouble = null;
// How far below the baseline the middle of the letters is, as a share of the font size.
let centralShift = 0;

function preventScroll(event) {
  event.preventDefault();
}

// Takes off everything that a phone run puts on the page.
function clearPhone() {
  overlay.classList.remove("coil-phone");
  overlay.style.transform = "";
  overlay.style.height = "";
  document.body.classList.remove("coil-pinned", "coil-phone-run");
  document.removeEventListener("touchmove", preventScroll);
}

// The safe area's insets, which are more than zero on a page that covers a notch.
function safeArea() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(probe);
  const style = window.getComputedStyle(probe);
  const px = (property) => Number.parseFloat(style[property]) || 0;
  const insets = {
    top: px("paddingTop") + PHONE_INSET,
    right: px("paddingRight") + PHONE_INSET,
    bottom: px("paddingBottom") + PHONE_INSET,
    left: px("paddingLeft") + PHONE_INSET,
  };
  probe.remove();
  return insets;
}

// A size rounded down to a step, so neighboring characters share it.
function stepped(size) {
  return Math.max(SIZE_STEP, Math.floor(size / SIZE_STEP) * SIZE_STEP);
}

// A string's 32-bit FNV-1a hash, which seeds the tangle, so a link always gets its own tangle.
function hash(text) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  }
  return value >>> 0;
}

// A small seeded generator of numbers from 0 to 1, mulberry32.
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Describes a line through `turns` as SVG path data, with an arc of `radii[index]` at each turn
 * between the first and the last, which bends the way `sweep` says, as SVG's sweep flag does.
 * Returns the line's `length` and `corners`, the distance along the line to the middle of each
 * arc, as `coilPath` does.
 */
export function roundedPath(turns, radii, sweep) {
  let data = `M${point(turns[0])}`;
  let length = 0;
  let pen = turns[0];
  const corners = [];
  for (let index = 1; index < turns.length - 1; index += 1) {
    const turn = turns[index];
    const before = distance(turns[index - 1], turn);
    const after = distance(turn, turns[index + 1]);
    const arc = Math.min(radii[index - 1], before / 2, after / 2);
    const from = toward(turn, turns[index - 1], arc / before);
    const to = toward(turn, turns[index + 1], arc / after);
    data += `L${point(from)}A${round(arc)} ${round(arc)} 0 0 ${sweep} ${point(to)}`;
    length += distance(pen, from);
    corners.push(length + (Math.PI / 4) * arc);
    length += (Math.PI / 2) * arc;
    pen = to;
  }
  const end = turns[turns.length - 1];
  data += `L${point(end)}`;
  length += distance(pen, end);
  return { data, length, corners };
}

/**
 * Lays out the vortex: a line that starts at the field, which sits on the bottom lane, runs
 * right, and winds inward counterclockwise, so every letter's top faces the middle. Side `j`
 * of the line is set at `fieldSize` times `shrink` to the power `j`, and each lane is as far
 * from the next lane in as their sizes need. The line stops where the next side would be too
 * short to hold its letters. Returns the path, the size of each side, and the distances that
 * divide the sides, which are the corners.
 */
export function vortexPath({ width, start, insets, fieldSize, shrink }) {
  const size = (side) => fieldSize * shrink ** side;
  const gap = (side) => (VORTEX_PITCH * (size(side) + size(side + 4))) / 2;
  let bottom = start.y;
  let right = width - insets.right;
  let top = insets.top;
  let left = insets.left;
  const turns = [[start.x, start.y]];
  const sizes = [];
  for (let side = 0; side < 1000; side += 1) {
    const [x, y] = turns[turns.length - 1];
    const edge = side % 4;
    let next;
    let span;
    if (edge === 0) {
      next = [right, bottom];
      span = right - x;
    } else if (edge === 1) {
      next = [right, top];
      span = y - top;
    } else if (edge === 2) {
      next = [left, top];
      span = x - left;
    } else {
      next = [left, bottom - gap(side - 3)];
      span = next[1] - y;
    }
    // The line also stops at the least size, where the next side's letters would be dust.
    if (span < Math.max(3 * size(side), gap(side)) || size(side) < VORTEX_LEAST) {
      break;
    }
    turns.push(next);
    sizes.push(size(side));
    if (edge === 1) {
      right -= gap(side);
    } else if (edge === 2) {
      top += gap(side);
    } else if (edge === 3) {
      bottom = next[1];
      left += gap(side);
    }
  }
  const radii = sizes.slice(1).map((value) => VORTEX_RADIUS * value);
  return { ...roundedPath(turns, radii, 0), sizes };
}

/**
 * Sets each character's size from the side of the line that it starts on, and returns the
 * sizes, their offsets, and how many characters fit. `limit` stops the count early.
 */
function sideSizes(line, limit) {
  const sizes = [];
  const offsets = [];
  let offset = 0;
  let side = 0;
  while (sizes.length < limit) {
    while (side < line.corners.length && offset >= line.corners[side]) {
      side += 1;
    }
    const size = stepped(line.sizes[side]);
    if (offset + size * advance > line.length + 1e-6) {
      break;
    }
    sizes.push(size);
    offsets.push(offset);
    offset += size * advance;
  }
  offsets.push(offset);
  return { sizes, offsets, count: sizes.length };
}

/**
 * Lays out the snake: rows `pitch` apart that start at the field and run back and forth, each
 * joined to the next by a half circle at the edge. Returns the path, its `lead`, which is the
 * row from the field, the `corners`, which are the middles of the curls, and `rows`, where each
 * row starts and ends along the line, which places the head on the screen.
 */
export function snakePath({ width, start, insets, pitch, rows }) {
  const radius = pitch / 2;
  const right = width - insets.right - radius;
  const left = insets.left + radius;
  let data = `M${point([start.x, start.y])}`;
  let length = 0;
  let x = start.x;
  let y = start.y;
  const corners = [];
  const runs = [];
  for (let row = 0; row < rows; row += 1) {
    const end = row % 2 === 0 ? right : left;
    const from = length;
    length += Math.abs(end - x);
    data += `L${point([end, y])}`;
    runs.push({ y, from, to: length });
    if (row === rows - 1) {
      break;
    }
    data += `A${round(radius)} ${round(radius)} 0 0 ${row % 2 === 0 ? 1 : 0} ${point([end, y + pitch])}`;
    corners.push(length + (Math.PI / 2) * radius);
    length += Math.PI * radius;
    x = end;
    y += pitch;
  }
  return { data, length, lead: runs[0].to, corners, runs, radius };
}

// The height on the screen of the point `offset` along the snake, before the page scrolls.
function snakeHeight(line, offset) {
  const { runs, radius } = line;
  let row = 0;
  while (row < runs.length - 1 && runs[row + 1].from <= offset) {
    row += 1;
  }
  const lane = runs[row];
  if (offset <= lane.to || row === runs.length - 1) {
    return lane.y;
  }
  const share = Math.min(1, (offset - lane.to) / (Math.PI * radius));
  return lane.y + radius * (1 - Math.cos(Math.PI * share));
}

/**
 * Grows the tangle: a cord that starts as the field's text, leaves the field heading right, and
 * then steers itself across the screen until it holds all `characters`. The heading wanders as a
 * sum of slow waves, which gives long sweeping bends and, where a wave holds one way long
 * enough, a loop. Every few steps the cord looks ahead along a range of bends and takes the
 * one that keeps it inside `bounds` and away from strands that it would run alongside, and
 * that heads for open space, stays near the wave, and keeps off the field's text where it can.
 * It may cross a strand at a steep angle, but not near another crossing. The cord only sees
 * strands it laid a few letters ago, so its own trail never blocks it.
 *
 * The cord sizes its letters as it grows. They're `fieldSize` in the field, taper to `first`,
 * and shrink steadily toward `last` by the end of the link. When every bend is ruled out, the
 * cord backs up, takes a different way, and shrinks the rest of the link a little, so it
 * really does get smaller as it runs out of room.
 *
 * Returns the points one step apart with the heading at each, each character's size and
 * offset, and the distance along the cord of each crossing, or `null` when the cord gets boxed
 * in for good.
 */
export function tangleWalk({
  bounds,
  start,
  fieldEnd,
  fieldCount,
  fieldSize,
  characters,
  first,
  last,
  box,
  seed,
}) {
  const step = TANGLE_STEP;
  const sizes = [];
  const offsets = [];
  let squeeze = 1;
  // The end of the characters sized so far.
  const reach = () =>
    sizes.length === 0 ? 0 : offsets[sizes.length - 1] + sizes[sizes.length - 1] * advance;
  // Sizes characters until they reach past `along`, and returns the size of the one there.
  const sizeAt = (along) => {
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
    return sizes[sizes.length - 1];
  };
  // The size of the character at `along`, which is already sized.
  const sizeOf = (along) => {
    let low = 0;
    let high = sizes.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (offsets[middle] <= along) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return sizes[low];
  };
  const random = generator(seed);
  const waves = [0.55, 0.3, 0.2].map((share) => ({
    share,
    length: 90 + random() * 260,
    phase: random() * Math.PI * 2,
  }));
  const xs = [];
  const ys = [];
  const headings = [];
  // Strands that the cord can see, in a grid of cells as wide as the widest spacing.
  const cell = 32;
  const columns = Math.ceil(bounds.width / cell) + 2;
  const grid = new Map();
  // How full each cell is, which steers the cord toward open space.
  const density = new Float32Array(columns * (Math.ceil(bounds.height / cell) + 2));
  const cellOf = (x, y) => (Math.floor(y / cell) + 1) * columns + Math.floor(x / cell) + 1;
  let filed = 0;
  const file = (index) => {
    const key = cellOf(xs[index], ys[index]);
    let list = grid.get(key);
    if (list === undefined) {
      list = [];
      grid.set(key, list);
    }
    list.push(index);
    density[key] += 1;
  };
  // Takes the newest filed point back out. Each cell lists its points in the order they were
  // filed, so that point is the last in its cell.
  const unfile = (index) => {
    const key = cellOf(xs[index], ys[index]);
    grid.get(key).pop();
    density[key] -= 1;
  };
  // Calls `visit` with each strand point within `within` of a point, and stops when it returns
  // true.
  const near = (x, y, within, visit) => {
    const cx = Math.floor(x / cell) + 1;
    const cy = Math.floor(y / cell) + 1;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const list = grid.get((cy + dy) * columns + cx + dx);
        if (list === undefined) {
          continue;
        }
        for (const index of list) {
          const ex = xs[index] - x;
          const ey = ys[index] - y;
          if (ex * ex + ey * ey < within * within && visit(index, Math.hypot(ex, ey))) {
            return true;
          }
        }
      }
    }
    return false;
  };
  const inBox = (x, y, margin) =>
    x > box.left - margin &&
    x < box.right + margin &&
    y > box.top - margin &&
    y < box.bottom + margin;

  const bends = [];
  for (let x = start.x; x <= fieldEnd; x += step) {
    xs.push(x);
    ys.push(start.y);
    headings.push(0);
    bends.push(0);
  }
  const fieldPoints = xs.length;
  const crossings = [];
  const crossPoints = [];
  let x = xs[xs.length - 1];
  let y = start.y;
  let heading = 0;
  let bend = 0;
  let target = 0;
  let exited = false;
  let exitAt = Number.POSITIVE_INFINITY;
  // When every bend is ruled out, the cord backs up and pushes its wander one way for a while,
  // so it takes a different path past the trap. It backs up further each time it's stuck in
  // the same place, and gives up after `TANGLE_RETREATS` in all.
  let retreats = 0;
  let strikes = 0;
  let stuckAt = -1;
  let kick = 0;
  let kickUntil = -1;
  const rewind = (length) => {
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
    while (crossings.length > 0 && crossings[crossings.length - 1].at > end) {
      crossings.pop();
      crossPoints.pop();
    }
    while (sizes.length > 0 && offsets[sizes.length - 1] > end) {
      sizes.pop();
      offsets.pop();
    }
    x = xs[xs.length - 1];
    y = ys[ys.length - 1];
    heading = headings[headings.length - 1];
    bend = bends[bends.length - 1];
    target = bend;
    if (exitAt >= xs.length) {
      exited = false;
      exitAt = Number.POSITIVE_INFINITY;
    }
  };

  // The cost of bending toward `aim` from here, or `Infinity` when that leads somewhere the
  // cord can't go. The cord looks ahead about half a turn at its tightest bend, the least
  // that shows whether it can still turn away from what's ahead. Only the first stretch is a
  // hard limit, where the cord can't avoid what it sees. Beyond it, what the cord would hit
  // only costs, so a strand far ahead steers the cord without ruling a bend out.
  const look = (aim, size, space, most, travelledNow) => {
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
      // The cord leaves the field upward, into the open screen, and not into the strip under
      // the field, where it would be boxed in.
      if (!exited && py > start.y) {
        cost += 3 * weight;
      }
      // The start of the link in the field is the part the visitor reads first, so the cord
      // crosses it, as a woven crossing, only when the rest of the screen is full.
      if (exited && inBox(px, py, 0)) {
        cost += 0.6 * weight;
      }
      let crossing = false;
      const blocked = near(px, py, space, (other) => {
        if (Math.abs(Math.cos(ph - headings[other])) > Math.cos(TANGLE_CROSSING)) {
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
        for (const [cx, cy, at] of crossPoints) {
          // The crossing that the cord is still passing over doesn't count.
          if (at > travelledNow - 2 * space) {
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
      crowd += density[cellOf(px, py)];
    }
    // The cord also leans toward the emptier side of the screen around it, past the end of
    // what it looks at, so it fills the open space before its own strands close it off.
    let far = 0;
    const ahead = 3 * cell;
    for (let ring = 1; ring <= 2; ring += 1) {
      far +=
        density[
          cellOf(
            clamp(px + Math.cos(ph) * ahead * ring, 0, bounds.width),
            clamp(py + Math.sin(ph) * ahead * ring, 0, bounds.height),
          )
        ];
    }
    return cost + (crowd / steps / (cell / step)) * 1.2 + (far / (cell / step)) * 0.25;
  };

  while (sizes.length < characters || (xs.length - 1) * step < reach()) {
    const travelled = (xs.length - 1) * step;
    const size = sizeAt(travelled);
    const most = 1 / (TANGLE_BEND * size);
    const space = TANGLE_SPACING * size + 2 * haloFor(size);
    // The trail that the cord can't see yet: long enough that a bend at the tightest radius
    // has turned away from it before it shows.
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
      if (best === Number.POSITIVE_INFINITY) {
        retreats += 1;
        if (retreats > TANGLE_RETREATS) {
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
    if (!exited && !inBox(x, y, 0)) {
      exited = true;
      exitAt = xs.length - 1;
    }
    // A crossing is where the cord passes over a strand it can see. Its gap is drawn once.
    const here = travelled + step;
    if (crossings.length === 0 || here - crossings[crossings.length - 1].at > space) {
      near(x, y, size * 0.5, (other) => {
        crossings.push({ at: here, size, under: sizeOf(other * step) });
        crossPoints.push([x, y, here]);
        return true;
      });
    }
  }
  return { xs, ys, headings, crossings, step, sizes, offsets, squeeze };
}

/**
 * Fits the variant to the screen as it is now. Returns what `layPhone` needs: the path, the
 * layout, the dark gaps of the tangle, how the page moves, and a summary for the toolbar, or
 * `null` when the link can't fit.
 */
function fitPhone() {
  const began = performance.now();
  const width = root.clientWidth;
  const height = window.innerHeight;
  const insets = safeArea();
  const input = measureField();
  const middle = input.y - centralShift * input.size;
  const fieldSize = input.size;
  const characters = longLink.length;
  const rowLength = measureColumns();
  const rowCuts = (count) => {
    const cuts = new Set([0, count]);
    for (let row = rowLength; row < count; row += rowLength) {
      cuts.add(row);
    }
    return cuts;
  };
  const common = { width, height, rowLength, began };

  if (variant === "vortex") {
    // The page drops until the field's text is on the bottom lane, with its box clear of the
    // frame.
    const floor = height - Math.max(insets.bottom, FIELD_CLEARANCE + input.box.bottom - middle);
    const start = { x: input.x, y: floor };
    const fieldCount = Math.floor(input.run / (fieldSize * advance) + 1e-6);
    const capacity = (shrink) => {
      const line = vortexPath({ width, start, insets, fieldSize, shrink });
      return { line, ...sideSizes(line, Number.POSITIVE_INFINITY) };
    };
    // The least shrink that still holds the link puts the end of the link in the middle. A
    // steep shrink reaches the least size in a few laps and holds less, so the search walks
    // down from no shrink at all to the first rate that holds the link, and then narrows it.
    let high = 1;
    let low = high;
    while (capacity(low).count < characters) {
      high = low;
      low -= 0.002;
      if (low < 0.9) {
        return null;
      }
    }
    for (let pass = 0; pass < 12; pass += 1) {
      const mid = (low + high) / 2;
      if (capacity(mid).count >= characters) {
        low = mid;
      } else {
        high = mid;
      }
    }
    const { line } = capacity(low);
    const { sizes, offsets, count } = sideSizes(line, characters);
    if (sizes[count - 1] < VORTEX_LEAST) {
      return null;
    }
    const cuts = rowCuts(count);
    cuts.add(fieldCount);
    const layout = divideLine({
      count,
      fieldCount,
      rowLength,
      sizes: Float64Array.from(sizes),
      offsets: Float64Array.from(offsets),
      cuts,
      corners: line.corners,
      chunkLength: CHUNK_LENGTH,
    });
    const laps = Math.ceil(line.sizes.length / 4);
    return {
      ...common,
      data: line.data,
      layout,
      drop: floor - middle,
      summary: `${laps} laps from ${fieldSize}px to ${sizes[count - 1]}px.`,
    };
  }

  if (variant === "snake") {
    // The page rises a row at a time until the field's text is on the top lane.
    const topLane = Math.max(insets.top, FIELD_CLEARANCE + middle - input.box.top);
    const scroll = Math.max(0, middle - topLane);
    const bottomLane = height - insets.bottom;
    const start = { x: input.x, y: middle };
    const attempt = (size) => {
      const pitch = SNAKE_PITCH * size;
      const rows = Math.floor((bottomLane + scroll - middle) / pitch) + 1;
      const line = snakePath({ width, start, insets, pitch, rows });
      const zones = coilZones({
        pathLength: line.length,
        lead: line.lead,
        advance,
        fieldRun: input.run,
        fieldSize,
        coilSize: size,
        taperSteps: TAPER_STEPS,
        taperRun: TAPER_RUN,
      });
      return { line, zones, rows };
    };
    let size = Math.min(SNAKE_SIZES[1], fieldSize);
    while (size >= SNAKE_SIZES[0] && attempt(size).zones.capacity < characters) {
      size -= 0.25;
    }
    if (size < SNAKE_SIZES[0]) {
      return null;
    }
    const { line, zones, rows } = attempt(size);
    const layout = coilLayout({
      characters,
      corners: line.corners,
      zones,
      advance,
      fieldSize,
      coilSize: size,
      rowLength,
      chunkLength: CHUNK_LENGTH,
    });
    return {
      ...common,
      data: line.data,
      layout,
      scroll,
      overlayHeight: height + scroll,
      // How far the page has risen when the head is at `offset`.
      rise: (offset) => clamp(snakeHeight(line, offset) - bottomLane, 0, scroll),
      summary: `${rows} rows at ${size}px.`,
    };
  }

  // The tangle. The field's text stops short of the field's end, so the cord has room to bend
  // away from the screen's edge at its tightest radius as it leaves.
  const bounds = {
    left: insets.left,
    top: insets.top,
    right: width - insets.right,
    bottom: height - insets.bottom,
    width,
    height,
  };
  const exitRoom = bounds.right - (TANGLE_BEND + 0.6) * fieldSize - input.x;
  const fieldCount = Math.floor(Math.min(input.run, exitRoom) / (fieldSize * advance) + 1e-6);
  const fieldEnd = input.x + fieldCount * fieldSize * advance;
  const seed = hash(longLink);
  for (const [first, last] of TANGLE_SIZES) {
    for (let attempt = 0; attempt < TANGLE_SEEDS; attempt += 1) {
      const walk = tangleWalk({
        bounds,
        start: { x: input.x, y: middle },
        fieldEnd,
        fieldCount,
        fieldSize,
        characters,
        first,
        last,
        box: input.box,
        seed: seed + attempt * 7919,
      });
      if (walk === null) {
        continue;
      }
      const smallest = walk.sizes[walk.sizes.length - 1];
      return tangleLayout({
        ...common,
        walk,
        sizes: Float64Array.from(walk.sizes),
        offsets: Float64Array.from([...walk.offsets, walk.offsets.at(-1) + smallest * advance]),
        fieldCount,
        rowCuts,
        note: `a cord from ${first}px to ${smallest}px, seed ${attempt + 1}`,
      });
    }
  }
  return null;
}

// Turns a grown tangle into a path, a layout, and the gaps at its crossings.
function tangleLayout({ walk, sizes, offsets, fieldCount, rowCuts, note, ...common }) {
  const { xs, ys, headings, crossings, step } = walk;
  const count = sizes.length;
  const parts = [`M${round(xs[0])} ${round(ys[0])}`];
  for (let index = 1; index < xs.length; index += 1) {
    parts.push(`L${round(xs[index])} ${round(ys[index])}`);
  }
  const headingAt = (offset) => headings[Math.min(headings.length - 1, Math.round(offset / step))];

  // A piece ends where the cord has turned too far from the piece's start to leave as one
  // straight line.
  const cuts = rowCuts(count);
  cuts.add(fieldCount);
  let from = headingAt(offsets[fieldCount]);
  for (let index = fieldCount + 1; index < count; index += 1) {
    const now = headingAt(offsets[index] + (sizes[index] * advance) / 2);
    if (cuts.has(index) || Math.abs(now - from) > TANGLE_PIECE_TURN) {
      cuts.add(index);
      from = now;
    }
  }

  // Each crossing's gap runs along the upper strand, wide enough to cut through the letters
  // and the outline of the strand under it.
  const gaps = new Map();
  const breaks = new Set();
  let character = 0;
  for (const crossing of crossings) {
    const reach = crossing.under * 0.55 + crossing.size * 0.6 + 3;
    const startAt = Math.max(0, crossing.at - reach);
    while (character < count - 1 && offsets[character + 1] <= startAt) {
      character += 1;
    }
    if (character >= count - 1) {
      break;
    }
    const first = Math.floor(startAt / step);
    const last = Math.min(xs.length - 1, Math.ceil((crossing.at + reach) / step));
    let data = `M${round(xs[first])} ${round(ys[first])}`;
    for (let index = first + 1; index <= last; index += 1) {
      data += `L${round(xs[index])} ${round(ys[index])}`;
    }
    const list = gaps.get(character) ?? [];
    list.push({ data, width: round(crossing.size * 1.05 + 3) });
    gaps.set(character, list);
    breaks.add(character);
  }
  const layout = divideLine({
    count,
    fieldCount,
    rowLength: common.rowLength,
    sizes,
    offsets,
    cuts,
    corners: [],
    chunkLength: CHUNK_LENGTH,
    breaks,
  });
  return {
    ...common,
    data: parts.join(""),
    layout,
    gaps,
    summary: `${note}, ${crossings.length} crossings, ${layout.pieces.length} pieces.`,
  };
}

// The width of the dark outline under letters of a size: 4px down to 1.5px, so the outline
// never buries small letters.
function haloFor(size) {
  return round(clamp(size * 0.3, 1.5, 4));
}

/**
 * Fits and lays out the coil for the phone's variant. Returns the coil, as `layCoil` does,
 * with `phone`, the fit, or `null` when the link can't fit.
 */
function layPhone() {
  const fitted = fitPhone();
  if (fitted === null) {
    phoneTrouble = "The link doesn't fit on this screen.";
    return null;
  }
  fitted.cost = performance.now() - fitted.began;
  phoneTrouble = null;
  path.setAttribute("d", fitted.data);
  overlay.classList.add("coil-phone");
  overlay.style.height = fitted.overlayHeight === undefined ? "" : `${fitted.overlayHeight}px`;
  const coil = buildCoil(null, fitted.layout, { haloFor, gaps: fitted.gaps });
  coil.phone = fitted;
  return coil;
}

// The vertical translation in a computed transform, or 0.
function shiftOf(element) {
  const { transform } = window.getComputedStyle(element);
  return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
}

/**
 * Moves the page for a fresh layout: the vortex drops the home page until the field is on the
 * bottom lane, from wherever it is now, and carries the coil's overlay with it, so the field's
 * text in the overlay stays on the field.
 */
function stagePhone(thisRun, coil, pace, instant) {
  for (const animation of thisRun.drop ?? []) {
    animation.cancel();
  }
  thisRun.drop = [];
  thisRun.home = 0;
  const { drop } = coil.phone;
  if (drop === undefined) {
    return;
  }
  thisRun.home = drop;
  if (instant) {
    home.style.transform = `translateY(${drop}px)`;
    return;
  }
  const from = shiftOf(home);
  const timing = { duration: DROP_MS * pace, easing: DROP_EASING, fill: "forwards" };
  thisRun.drop = [
    home.animate({ transform: [`translateY(${from}px)`, `translateY(${drop}px)`] }, timing),
    overlay.animate({ transform: [`translateY(${from - drop}px)`, "translateY(0px)"] }, timing),
  ];
  thisRun.animations.push(...thisRun.drop);
}

// Raises the snake's page and coil for the head at character `n`.
function risePhone(thisRun, coil, n) {
  const { rise } = coil.phone;
  if (rise === undefined) {
    return;
  }
  const lifted = round(rise(coil.layout.offsets[n]));
  if (lifted !== thisRun.lifted) {
    thisRun.lifted = lifted;
    overlay.style.transform = `translateY(${-lifted}px)`;
    home.style.transform = `translateY(${-lifted}px)`;
    thisRun.home = -lifted;
  }
}

// Fixes the page's state before the finale: the drop ends where it was going, and the finale
// learns where the home page and the overlay are.
function settlePhoneStage(thisRun) {
  for (const animation of thisRun.drop ?? []) {
    animation.cancel();
  }
  thisRun.drop = [];
  home.style.transform = `translateY(${thisRun.home}px)`;
  return { home: thisRun.home, overlay: thisRun.lifted === undefined ? 0 : -thisRun.lifted };
}

// Brings the field into view, as the browser does when the visitor types in it.
function showField() {
  const box = field.getBoundingClientRect();
  if (box.top < 0 || box.bottom > window.innerHeight) {
    window.scrollBy(0, box.bottom - window.innerHeight + 24);
  }
}

/** Plays the phone's transition: the variant's coil, a short hold, and the finale. */
function playPhone() {
  const thisRun = { cancelled: false, animations: [], drop: [], home: 0 };
  run = thisRun;
  // The keyboard closes at once. The visitor can't scroll while the link runs, so the address
  // bar can't show or hide and change the screen under it.
  field.blur();
  showField();
  document.addEventListener("touchmove", preventScroll, { passive: false });
  document.body.classList.add("coil-running", "coil-phone-run", "coil-pinned");
  let coil = layPhone();
  if (coil === null) {
    reset();
    return;
  }
  stagePhone(thisRun, coil, slow, false);
  const frames = [];
  window[COIL_FRAMES] = frames;
  window[FINALE_FRAMES] = [];

  // While the head is still in the field, a change in the screen's size, such as a keyboard
  // that resizes the page as it closes, lays the coil out again for the new size. After that,
  // the coil keeps its layout.
  let n = 0;
  thisRun.relayout = () => {
    if (n > coil.layout.fieldCount) {
      return false;
    }
    clearCoil();
    overlay.style.transform = "";
    thisRun.lifted = undefined;
    const fresh = layPhone();
    if (fresh === null) {
      return false;
    }
    coil = fresh;
    stagePhone(thisRun, coil, slow, false);
    coil.write(n);
    return true;
  };

  const duration = COIL_MS * slow;
  const start = performance.now();
  let last = null;
  let dimmed = false;
  let finale = null;
  let setup = null;
  const frame = (now) => {
    if (thisRun.cancelled) {
      return;
    }
    if (last !== null && finale === null) {
      frames.push(now - last);
    }
    last = now;
    const elapsed = Math.max(0, now - start);
    n = Math.round(coil.count * written(Math.min(1, elapsed / duration), RAMP));
    coil.write(n);
    overwrite(n);
    risePhone(thisRun, coil, n);
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
      finale = stageFinale(coil, slow, settlePhoneStage(thisRun));
      const script = performance.now() - before;
      thisRun.animations.push(...finale.animations);
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

// Draws the phone's coil or finale stopped at one moment, for a still image.
function drawPhoneStill() {
  const thisRun = { cancelled: false, animations: [], drop: [], home: 0 };
  showField();
  document.body.classList.add("coil-phone-run", "coil-pinned");
  const coil = layPhone();
  if (coil === null) {
    describe();
    return;
  }
  const n = stillFinale === null ? Math.round(coil.count * written(stillCoil, RAMP)) : coil.count;
  // The vortex's drop takes its first moments, and a still image shows it done.
  stagePhone(thisRun, coil, 1, true);
  coil.write(n);
  overwrite(n);
  risePhone(thisRun, coil, n);
  if (n > coil.layout.fieldCount) {
    dim();
  }
  run = thisRun;
  if (stillFinale !== null) {
    coil.complete();
    coil.edge.remove();
    const finale = stageFinale(coil, 1, settlePhoneStage(thisRun));
    finale.start();
    for (const animation of finale.animations) {
      animation.pause();
      animation.currentTime = stillFinale * finale.total;
    }
    finale.follow(stillFinale * finale.total);
    thisRun.animations.push(...finale.animations);
  }
  report(coil, null);
}

// Draws the coil or the finale stopped at one moment, for a still image.
function drawStill() {
  reset();
  if (!wide.matches) {
    drawPhoneStill();
    return;
  }
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
    return phoneTrouble;
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

// The phone's variant is in the address, so a reload or a shared link keeps it.
const variantChoice = reviewBar.querySelector('[data-review="variant"]');
variantChoice.value = variant;
variantChoice.addEventListener("change", () => {
  variant = variantChoice.value;
  const address = new URL(window.location.href);
  address.searchParams.set("variant", variant);
  window.history.replaceState(null, "", address);
  if (still) {
    drawStill();
  } else {
    reset();
  }
});

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
centralShift = measureCentralShift();
describe();

// A phone's visitor has scrolled to the field to type in it. The lab starts at the bottom of
// the page, where the field is, or at the scroll that `scroll` gives.
if (!wide.matches) {
  const scroll = Number.parseFloat(parameters.get("scroll") ?? "");
  window.scrollTo(0, Number.isNaN(scroll) ? root.scrollHeight : scroll);
}

// The line is laid out for one window size, so a coil on screen doesn't survive a resize,
// except a phone's coil while its head is still in the field.
window.addEventListener("resize", () => {
  if (still) {
    drawStill();
  } else if (run !== null && run.relayout?.() !== true) {
    reset();
  }
  describe();
});

if (still) {
  drawStill();
} else if (parameters.get("play") === "1") {
  window.setTimeout(play, AUTOPLAY_DELAY_MS);
}
