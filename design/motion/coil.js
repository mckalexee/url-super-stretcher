// Script for the coil prototype in coil.html. It plays one transition: the long link replaces
// the visitor's link in the field one character at a time, runs out of the field, and coils
// around the page edge until it runs out of room. Then the page changes to the result, where
// the rest of the link is typed into the well. The prototype exists so the motion can be judged
// and tuned before the app takes it, so every value worth tuning is a constant at the top.
//
// Query parameters, for review:
//
// - `play=1` plays 600 ms after the page loads.
// - `t=<0..1>` draws the coil stopped at that share of its duration, with no hand-off. Use it
//   for a still image.
// - `slow=<number>` multiplies every duration of the transition. `slow=5` plays at one fifth of
//   the speed.
// - `handoff=field` morphs the field into the well, and is the default. `handoff=coil` morphs
//   the whole coil into the well.
// - `spiral=out` runs the first lap one lane in from the page frame and the second lap around
//   it, against the frame, and is the default. `spiral=in` runs the first lap against the frame
//   and the second inside it. An inward coil has to cross the run that leaves the field, so its
//   second lap is drawn over that run near the button.
// - `chrome=0` hides the review toolbar.
//
// Each run records the time between frames, in milliseconds: `window.__coilFrames` for the coil
// and `window.__coilHandoffFrames` for the typing in the well. Both start empty on every run.
// The toolbar shows the longest time in the first of them.

// The link that the visitor is taken to have submitted.
const VISITOR_LINK = "https://example.com/quarterly-report";

// Durations, in milliseconds.
const COIL_MS = 1800;
const HOLD_MS = 120;
const HANDOFF_MS = 350;
const WELL_MS = 600;
const FADE_MS = 200;
const AUTOPLAY_DELAY_MS = 600;

// The share of the coil's speed that is constant. The rest is cubic, so the visitor's link is
// overwritten slowly enough to watch and the coil then accelerates.
const LINEAR_SHARE = 0.15;

// The coil's lanes, in CSS pixels. The first inset keeps the letters clear of the fine gold
// rule, which ends 19px from the page edge, and the last lane ends short of the content, which
// starts 64px from the edge.
const INSET = 34;
const PITCH = 20;
const LAPS = 2;
const RADIUS = 20;
// The run from the field reaches the page edge from the inside. An outward coil wraps each lap
// around the one before and never meets that run again. An inward coil has to cross it.
const OUTWARD = true;

// The size of the text on the coil, which is the size of the long link in the well.
const COIL_SIZE = 13;
// How many characters one text element holds. Only the newest element changes in a frame.
const CHUNK_LENGTH = 32;
// The number of characters at the head that take the accent color, as on a result.
const EDGE_LENGTH = 10;
// The steps in size between the field's text and the coil's, and the most characters in a step.
const TAPER_STEPS = 12;
const TAPER_RUN = 3;

// The coil needs the wide layout, where the field and the button share a row.
const WIDE = "(min-width: 900px)";

const SVG = "http://www.w3.org/2000/svg";

// The properties of `window` that hold the frame times of the last run, for whoever measures it.
const COIL_FRAMES = "__coilFrames";
const HANDOFF_FRAMES = "__coilHandoffFrames";

/**
 * Describes the line that the text follows, as SVG path data. The line starts at `start`, runs
 * right to the side of the page, turns down, and spirals clockwise: down the right side, left
 * along the bottom, up the left side, and right along the top, so the top edge reads left to
 * right. Each lap is `pitch` further from the page edge than the one before, or nearer to it
 * when `outward` is true, and every corner is an arc of `radius`. The result also has the
 * line's `length` and its `lead`, which is the length of the straight run before the first
 * corner. The function takes numbers and touches no document, so it can be tested alone.
 */
export function coilPath({ width, height, start, insets, pitch, laps, radius, outward = false }) {
  const corners = [[start.x, start.y]];
  // The height at which the line arrives at the right side: first from the field, and then
  // from the top run of the lap before.
  let entry = start.y;
  for (let lap = 0; lap < laps; lap += 1) {
    const depth = pitch * (outward ? laps - 1 - lap : lap);
    const right = width - insets.right - depth;
    const bottom = height - insets.bottom - depth;
    const left = insets.left + depth;
    const top = insets.top + depth;
    corners.push([right, entry], [right, bottom], [left, bottom], [left, top]);
    entry = top;
  }
  // The last top run stops where one more lap would turn down. An outward coil has no lane
  // left, so it stops over its own right side.
  corners.push([width - insets.right - (outward ? 0 : pitch * laps), entry]);

  let data = `M${point(corners[0])}`;
  let length = 0;
  let lead = 0;
  let pen = corners[0];
  for (let index = 1; index < corners.length - 1; index += 1) {
    const corner = corners[index];
    const before = distance(corners[index - 1], corner);
    const after = distance(corner, corners[index + 1]);
    // A short side gets a tighter corner, so two arcs never overlap.
    const arc = Math.min(radius, before / 2, after / 2);
    const from = toward(corner, corners[index - 1], arc / before);
    const to = toward(corner, corners[index + 1], arc / after);
    // Every turn of a clockwise spiral is a quarter circle to the right.
    data += `L${point(from)}A${round(arc)} ${round(arc)} 0 0 1 ${point(to)}`;
    length += distance(pen, from) + (Math.PI / 2) * arc;
    if (index === 1) {
      lead = distance(pen, from);
    }
    pen = to;
  }
  const end = corners[corners.length - 1];
  data += `L${point(end)}`;
  length += distance(pen, end);
  return { data, length, lead };
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
 * Splits the text on the line into chunks, each of one size. A chunk is `from` and `to`, which
 * are positions in the link, the font `size`, the `offset` along the line at which it starts,
 * and `plain` for a chunk inside the field. The text is at the field's size for the length of
 * `fieldRun`, steps down to the coil's size before the line's first corner, and stays at that
 * size until the line or the link ends. Sizes differ, so each offset is the total length of
 * the chunks before it. `advance` is the width of a character as a share of the font size,
 * which is one number for a fixed-width face.
 */
export function coilChunks({
  characters,
  pathLength,
  lead,
  advance,
  fieldRun,
  fieldSize,
  coilSize,
  chunkLength,
  taperSteps,
  taperRun,
}) {
  const chunks = [];
  let from = 0;
  let offset = 0;
  // Adds a chunk of up to `wanted` characters, and says whether the line and the link had room
  // for all of them. The small sum keeps a character that fits exactly from being rounded away.
  const add = (wanted, size, plain) => {
    const room = Math.floor((pathLength - offset) / (size * advance) + 1e-6);
    const length = Math.min(wanted, characters - from, room);
    if (length > 0) {
      chunks.push({ from, to: from + length, size, offset, plain });
      from += length;
      offset += length * size * advance;
    }
    return length === wanted;
  };

  let more = true;
  let inField = Math.floor(fieldRun / (fieldSize * advance) + 1e-6);
  while (more && inField > 0) {
    const length = Math.min(chunkLength, inField);
    more = add(length, fieldSize, true);
    inField -= length;
  }

  // The sizes between the field's and the coil's, largest first.
  const sizes = [];
  for (let step = 1; step < taperSteps; step += 1) {
    sizes.push(fieldSize + ((coilSize - fieldSize) * step) / taperSteps);
  }
  // One character of each size, end to end. The taper has to end before the first corner.
  const onePass = sizes.reduce((sum, size) => sum + size * advance, 0);
  const run = Math.max(1, Math.min(taperRun, Math.floor((lead - offset) / onePass)));
  for (const size of sizes) {
    more = more && add(run, size, false);
  }

  while (more) {
    more = add(chunkLength, coilSize, false);
  }
  return { chunks, count: from };
}

/**
 * How much of the coil is written at time `t`, where both run from 0 to 1. A constant speed
 * mixed with a cubic one.
 */
export function written(t) {
  return LINEAR_SHARE * t + (1 - LINEAR_SHARE) * t ** 3;
}

// The typing in the well starts near the speed at which the coil ended and slows as it lands.
function landed(t) {
  return 1.5 * t - 0.5 * t * t;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

const parameters = new URLSearchParams(window.location.search);
const slowBy = Number(parameters.get("slow"));
const slow = slowBy > 0 ? slowBy : 1;
const stillAt = Number.parseFloat(parameters.get("t") ?? "");
// The progress at which a still image is drawn, or `null` when the page plays.
const still = Number.isNaN(stillAt) ? null : clamp(stillAt, 0, 1);
const outward = parameters.has("spiral") ? parameters.get("spiral") !== "in" : OUTWARD;

const root = document.documentElement;
root.dataset.handoff = parameters.get("handoff") === "coil" ? "coil" : "field";
// A still image shows the header, the footer, and the button already faded.
root.style.setProperty("--coil-fade", `${still === null ? FADE_MS * slow : 0}ms`);
root.style.setProperty("--coil-handoff", `${HANDOFF_MS * slow}ms`);

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
// The width of a character as a share of the font size, measured once the font has loaded.
let advance = 0;
// What the toolbar says about the last run or the still image.
let summary = "";

window[COIL_FRAMES] = [];
window[HANDOFF_FRAMES] = [];

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

/**
 * Lays the line out for the window as it is now, and returns the coil: `count`, the number of
 * characters that fit, and `write`, which shows the first `n` of them. `write` only ever goes
 * forward. It changes the text of the newest chunk and of the edge, and adds a chunk when the
 * head reaches it. A finished chunk is never touched again, so the browser repaints a small
 * area in each frame.
 */
function layCoil() {
  const view = overlay.getBoundingClientRect();
  const start = measureField();
  const line = coilPath({
    width: view.width,
    height: view.height,
    start,
    insets: { top: INSET, right: INSET, bottom: INSET, left: INSET },
    pitch: PITCH,
    laps: LAPS,
    radius: RADIUS,
    outward,
  });
  path.setAttribute("d", line.data);
  const { chunks, count } = coilChunks({
    characters: longLink.length,
    pathLength: line.length,
    lead: line.lead,
    advance,
    fieldRun: start.run,
    fieldSize: start.size,
    coilSize: COIL_SIZE,
    chunkLength: CHUNK_LENGTH,
    taperSteps: TAPER_STEPS,
    taperRun: TAPER_RUN,
  });

  // The size and the place of each character, for the edge, which crosses chunks.
  const sizes = new Float64Array(count);
  const offsets = new Float64Array(count + 1);
  for (const chunk of chunks) {
    for (let index = chunk.from; index <= chunk.to; index += 1) {
      offsets[index] = chunk.offset + (index - chunk.from) * chunk.size * advance;
      if (index < chunk.to) {
        sizes[index] = chunk.size;
      }
    }
  }

  const edge = onPath("coil-edge");
  const edgeRuns = [];
  overlay.append(edge.text);

  // Adds the next chunk to the overlay, empty, and returns it with its text node, or returns
  // `null` after the last chunk.
  let next = 0;
  const addChunk = () => {
    const chunk = chunks[next];
    next += 1;
    if (chunk === undefined) {
      return null;
    }
    const { text, textPath } = onPath(chunk.plain ? "coil-chunk" : "coil-chunk coil-halo");
    text.setAttribute("font-size", String(chunk.size));
    textPath.setAttribute("startOffset", String(round(chunk.offset)));
    const node = document.createTextNode("");
    textPath.append(node);
    // The edge stays last, so it's drawn over every chunk.
    overlay.insertBefore(text, edge.text);
    return { chunk, node };
  };
  // The chunk that the head is in.
  let head = addChunk();

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
    while (head !== null && lit >= head.chunk.to) {
      head.node.data = longLink.slice(head.chunk.from, head.chunk.to);
      head = addChunk();
    }
    if (head !== null) {
      head.node.data = longLink.slice(head.chunk.from, lit);
    }
    writeEdge(lit, n);
  };

  return { count, write };
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

function clearCoil() {
  for (const text of overlay.querySelectorAll("text")) {
    text.remove();
  }
}

/**
 * Changes the page to the result, with the first `reached` characters of the link typed in the
 * well. Returns a function that types the link up to a given character. The whole link is in
 * the well from the start, so the well never changes size.
 */
function showResult(reached) {
  result = resultState.content.firstElementChild.cloneNode(true);
  home.replaceWith(result);
  clearCoil();
  overlay.style.display = "none";
  document.body.classList.remove("coiling");
  window.scrollTo(0, 0);

  const well = result.querySelector(".long-link");
  const typed = document.createTextNode("");
  const edge = document.createElement("span");
  edge.className = "long-link-edge";
  const untyped = document.createElement("span");
  untyped.className = "well-untyped";
  well.replaceChildren(typed, edge, untyped);
  const type = (n) => {
    if (n >= longLink.length) {
      // At rest, the well holds the link alone, as the real result does.
      well.textContent = longLink;
      return;
    }
    const lit = Math.max(0, n - EDGE_LENGTH);
    typed.data = longLink.slice(0, lit);
    edge.textContent = longLink.slice(lit, n);
    untyped.textContent = longLink.slice(n);
  };
  type(reached);
  return type;
}

/** Stops any run and puts the page back to the home state, with the visitor's link in the field. */
function reset() {
  if (run !== null) {
    run.cancelled = true;
    run.transition?.skipTransition();
    run = null;
  }
  if (result !== null) {
    result.replaceWith(home);
    result = null;
  }
  clearCoil();
  overlay.style.display = "";
  document.body.classList.remove("coiling");
  blanked = 0;
  field.value = VISITOR_LINK;
}

function report(characters, frames) {
  const worst = frames.length === 0 ? "none" : `${Math.max(...frames).toFixed(1)} ms`;
  summary =
    `${numberFormat.format(characters)} of ${numberFormat.format(longLink.length)} ` +
    `characters on the coil. Worst frame of the coil: ${worst}.`;
  describe();
}

/** Plays the transition from the start: the coil, a short hold, and the hand-off. */
function play() {
  reset();
  if (advance === 0 || obstacle() !== null) {
    return;
  }
  if (reducedMotion.matches) {
    showResult(longLink.length);
    return;
  }

  const thisRun = { cancelled: false, transition: null };
  run = thisRun;
  const coil = layCoil();
  const frames = [];
  window[COIL_FRAMES] = frames;
  window[HANDOFF_FRAMES] = [];
  document.body.classList.add("coiling");

  const duration = COIL_MS * slow;
  const start = performance.now();
  let last = null;
  let reported = false;
  const frame = (now) => {
    if (thisRun.cancelled) {
      return;
    }
    if (last !== null) {
      frames.push(now - last);
    }
    last = now;
    // A frame's time can be earlier than the click that started the run.
    const elapsed = Math.max(0, now - start);
    const n = Math.round(coil.count * written(Math.min(1, elapsed / duration)));
    coil.write(n);
    overwrite(n);
    if (elapsed >= duration && !reported) {
      reported = true;
      report(coil.count, frames);
    }
    if (elapsed < duration + HOLD_MS * slow) {
      requestAnimationFrame(frame);
    } else {
      handOff(thisRun, coil.count);
    }
  };
  requestAnimationFrame(frame);
}

// Changes the page to the result inside a view transition, where the browser has one, and then
// types the rest of the link into the well.
function handOff(thisRun, reached) {
  let type = null;
  const swap = () => {
    type = showResult(reached);
  };
  const finish = () => {
    if (thisRun.cancelled) {
      return;
    }
    const frames = window[HANDOFF_FRAMES];
    const duration = WELL_MS * slow;
    const start = performance.now();
    let last = null;
    const frame = (now) => {
      if (thisRun.cancelled) {
        return;
      }
      if (last !== null) {
        frames.push(now - last);
      }
      last = now;
      const t = clamp((now - start) / duration, 0, 1);
      type(reached + Math.round((longLink.length - reached) * landed(t)));
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        run = null;
      }
    };
    requestAnimationFrame(frame);
  };

  if (typeof document.startViewTransition !== "function") {
    swap();
    finish();
    return;
  }
  thisRun.transition = document.startViewTransition(swap);
  // The typing starts with the morph, so the link keeps moving through the hand-off. The
  // promise rejects when the browser skips the transition, and the page has changed all the
  // same, so the typing starts then too.
  thisRun.transition.ready.then(finish, finish);
}

// Draws the coil stopped at one moment, for a still image.
function drawStill() {
  reset();
  if (obstacle() !== null) {
    return;
  }
  const coil = layCoil();
  const n = Math.round(coil.count * written(still));
  document.body.classList.add("coiling");
  coil.write(n);
  overwrite(n);
  summary =
    `Still: ${numberFormat.format(n)} of ${numberFormat.format(coil.count)} ` +
    `characters on the coil.`;
}

// Says why the coil can't play in this window, or returns `null` when it can. The line runs
// around the window, so it needs the wide layout and a home page that fits without a scroll,
// which puts the page's frame at the window's edge and the field over the bottom lanes.
function obstacle() {
  if (!wide.matches) {
    return "The coil plays in a window 900px wide or wider.";
  }
  if (result === null && root.scrollHeight > root.clientHeight) {
    return "The coil plays when the page fits in the window. Make the window taller.";
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
  } else if (reducedMotion.matches && still === null) {
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
  if (home.contains(event.target)) {
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
// The line is laid out for one window size, so a coil on screen doesn't survive a resize.
window.addEventListener("resize", () => {
  if (still !== null) {
    drawStill();
  } else if (run !== null && result === null) {
    reset();
  }
  describe();
});

if (still !== null) {
  drawStill();
  describe();
} else if (parameters.get("play") === "1") {
  window.setTimeout(play, AUTOPLAY_DELAY_MS);
}
