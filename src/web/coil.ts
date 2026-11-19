// The coil: the transition that plays after a stretch from the home page. The long link types
// over the visitor's link in the field, runs out of the field, and spirals clockwise around the
// inside of the page's gold frame until every character is written. Then, in the finale, the
// result takes the home page's place and each row of the link flies from the coil into the
// result's well, where it comes to rest as the well's own text. This module does the drawing
// and the timing with the Web Animations API and `requestAnimationFrame`, and keeps no state in
// React, because a frame that changes one text element holds the full frame rate and a render
// wouldn't. `coil-geometry.ts` holds the arithmetic, and the home route decides when to call
// this and mounts the result for the finale.
import { coilLayout, coilPath, coilZones, fitCoil, type CoilFit } from "#web/coil-geometry.ts";
import type { CoilLayout, Point } from "#web/coil-geometry.ts";
import { watchMotion } from "#web/motion.ts";
import { typedShare } from "#web/typing.ts";

// Durations, in milliseconds. The coil writes on the curve of `typedShare()`.
const COIL_MS = 4200;
// How long the finished coil frames the page before it unwinds. The glow at the head fades in
// this time, because the glow belongs to the writing.
const HOLD_MS = 200;
// The fade of everything that the coil runs over is `--coil-fade` in the stylesheet, 300 ms.
// The fade of the result as it replaces the home page.
const ARRIVE_MS = 350;
// The flight of one row from the coil to the well.
const FLIGHT_MS = 300;
// The time between one row's start and the next. With the flight, it puts six or seven rows
// under way at once, of which about four are seen in the air, so they read as one group
// sweeping round the frame. The time shrinks only for a link with so many rows that the finale
// would pass `FINALE_MS`.
const STAGGER_MS = 46;
const FINALE_MS = 1600;
// The fade between a piece of the coil and the row that takes its place.
const CROSSFADE_MS = 60;
// The longest the finished coil waits for the page to mount the result. A page that takes
// longer has gone wrong, and the visitor gets the result at rest.
const MOUNT_WAIT_MS = 1000;

// The opacity at which a part of the finale waits for its turn. The browser doesn't paint a
// layer that has no opacity at all until the frame in which it first shows, and painting every
// waiting layer in one frame makes that frame late. At this opacity a layer is painted while the
// finished coil holds still, and it changes no pixel by more than one step in 255.
const UNSEEN = 0.002;

const ARRIVE_EASING = "cubic-bezier(0.23, 1, 0.32, 1)";
const FLIGHT_EASING = "cubic-bezier(0.77, 0, 0.175, 1)";

// The outermost lane's distance from the window's edge, in CSS pixels. It keeps the letters clear
// of the fine gold rule, which ends 19px from the page edge.
const INSET = 34;
const RADIUS = 20;
// The coil is fitted to the window within these limits. The size is the font size of the text on
// the coil, and the pitch between lanes is the size times `PITCH_RATIO`, rounded.
const MIN_LAPS = 2;
const MAX_LAPS = 4;
const MIN_SIZE = 10;
const MAX_SIZE = 15;
const PITCH_RATIO = 1.45;
// The least pitch, as a share of the size, at which the letters of two lanes stay apart. The
// lanes beside the field close up to this when the field's text leaves them little room.
const MIN_PITCH_RATIO = 1.15;
// The least distance between the field's text and the baseline of the nearest lane, so the
// letters of the two never touch: under the baseline of the field's text, and to the left of its
// first letter.
const CLEARANCE_UNDER = 11;
const CLEARANCE_LEFT = 7;

// How many characters one text element holds at most. Only the newest element changes in a frame.
const CHUNK_LENGTH = 32;
// The number of characters at the head that take the accent color, as on a typed result.
const EDGE_LENGTH = 10;
// The steps in size between the field's text and the coil's, and the most characters in a step.
const TAPER_STEPS = 12;
const TAPER_RUN = 3;

// The coil needs the wide layout, where the field and the button share a row.
const WIDE = "(min-width: 900px)";
// The overwrite in the field takes one character for one cell of the fixed-width face, which
// holds only for printable ASCII. A link with anything else types in the result's well instead.
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
// How long the live region stays empty before it gets its word. A screen reader announces a
// change to a live region, and not the text that the region has when it appears.
const ANNOUNCE_DELAY_MS = 150;

const SVG = "http://www.w3.org/2000/svg";
const PATH_ID = "coil-path";

/** What the coil needs from the page, and what it tells the page. */
export interface CoilOptions {
  /** The home page's `main` element, which holds the form. */
  home: HTMLElement;
  /** The field that holds the visitor's link. */
  field: HTMLInputElement;
  /** The long link, exactly as the result's well shows it. */
  longLink: string;
  /** The length of the visitor's link, as the server counts it. The figures count up from it. */
  originalLength: number;
  /**
   * The text of the result's four counted figures for a link of a given length: the increase,
   * the new length, the characters added, and the posts, as the result formats them.
   */
  figures: (length: number) => readonly [string, string, string, string];
  /**
   * The word that screen readers announce while the coil plays, which is the word that the
   * button shows while a stretch is pending.
   */
  announcement: string;
  /**
   * Called when the coil is complete. The page then mounts the result after the home page, and
   * calls `land()` with it before the browser paints.
   */
  onComplete: () => void;
  /**
   * Called when the result is at rest and the coil has left nothing behind. The page removes the
   * home page synchronously, before the browser paints.
   */
  onLanded: () => void;
  /**
   * Called when the coil stops early: on a pause, a hidden tab, a resize, a key or pointer press
   * that skips it, or a failure. Every trace of the coil is gone, and the page shows the result
   * at rest synchronously.
   */
  onDropped: () => void;
}

/** A coil that's playing. */
export interface CoilRun {
  /**
   * Sets the finale up on the result's `main` element, which the page has mounted after the home
   * page. Call it before the browser paints. Returns false, with every trace of the coil gone,
   * when the finale can't play, and the page then shows the result at rest itself.
   */
  land: (result: HTMLElement) => boolean;
  /** Stops the coil and removes every trace of it, and calls nothing back. */
  cancel: () => void;
}

// Whether the browser has everything that the coil uses. A browser that lacks any of it gets the
// result without the coil.
function supported(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    typeof requestAnimationFrame === "function" &&
    typeof Element.prototype.animate === "function" &&
    typeof document.timeline !== "undefined" &&
    typeof document.createRange === "function" &&
    typeof document.fonts?.check === "function" &&
    typeof SVGPathElement !== "undefined" &&
    typeof SVGPathElement.prototype.getPointAtLength === "function" &&
    typeof SVGTextContentElement !== "undefined" &&
    typeof SVGTextContentElement.prototype.getComputedTextLength === "function" &&
    "inert" in HTMLElement.prototype &&
    typeof Array.prototype.toSorted === "function"
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// Whether a node is text. The Workers types give the global `Text` another meaning, so the check
// goes by the node's type.
function isText(node: Node | null): node is CharacterData {
  return node !== null && node.nodeType === Node.TEXT_NODE;
}

// The box of one character of a text node, in the window.
function characterBox(node: CharacterData, index: number): DOMRect {
  const range = document.createRange();
  range.setStart(node, index);
  range.setEnd(node, index + 1);
  return range.getBoundingClientRect();
}

// An empty inline block sits with its bottom edge on the baseline, so it marks where the
// baseline is.
function baselineMark(): HTMLSpanElement {
  const mark = document.createElement("span");
  mark.style.cssText = "display:inline-block;width:0;height:0";
  return mark;
}

function pixels(value: string): number {
  return Number.parseFloat(value);
}

/**
 * Finds where the field's text starts: the left edge of its first character and its baseline. A
 * field centers one line of text in its content box, so the baseline comes from the height of a
 * line and the baseline's place in it, which a hidden element in the same font reports.
 */
function measureField(field: HTMLInputElement): Point & { run: number; size: number } {
  const box = field.getBoundingClientRect();
  const style = window.getComputedStyle(field);
  const left = box.left + pixels(style.borderLeftWidth) + pixels(style.paddingLeft);
  const right = box.right - pixels(style.borderRightWidth) - pixels(style.paddingRight);
  const top = box.top + pixels(style.borderTopWidth) + pixels(style.paddingTop);
  const bottom = box.bottom - pixels(style.borderBottomWidth) - pixels(style.paddingBottom);

  const line = document.createElement("div");
  line.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
  line.style.font = `${style.fontWeight} ${style.fontSize}/normal ${style.fontFamily}`;
  const mark = baselineMark();
  line.textContent = "x";
  line.appendChild(mark);
  document.body.appendChild(line);
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
    size: pixels(style.fontSize),
  };
}

// Measures one character of the fixed-width face in the overlay itself, at a large size for
// precision.
function measureAdvance(overlay: SVGSVGElement): number {
  const probe = document.createElementNS(SVG, "text");
  probe.setAttribute("font-size", "100");
  probe.textContent = "0000000000";
  overlay.appendChild(probe);
  const length = probe.getComputedTextLength();
  probe.remove();
  return length / 1000;
}

/**
 * Counts the characters in one row of a well that holds the long link as one text node. The
 * arithmetic gives the answer, and the layout corrects it when the two differ.
 */
function countColumns(well: HTMLElement, advance: number, length: number): number {
  const node = well.firstChild;
  if (!isText(node) || node.data.length !== length) {
    throw new Error("The well doesn't hold the long link as one text node.");
  }
  const style = window.getComputedStyle(well);
  const width =
    well.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  let columns = Math.floor(width / (advance * Number.parseFloat(style.fontSize)));
  columns = clamp(columns, 1, length);
  const top = characterBox(node, 0).top;
  while (columns > 1 && characterBox(node, columns - 1).top > top + 1) {
    columns -= 1;
  }
  while (columns < length && characterBox(node, columns).top < top + 1) {
    columns += 1;
  }
  return columns;
}

/**
 * Counts the characters in one row of the result's well before the result exists, by laying out
 * a bare copy of the result where it will be, unseen. The coil's text is divided at the rows of
 * the well, so the count has to be known before the coil starts. The well's width depends only on
 * the page's grid, so the copy needs no more than the result's frame and the well.
 */
function measureRowLength(longLink: string, advance: number): number {
  const probe = document.createElement("main");
  probe.style.cssText = "position:absolute;top:0;left:0;width:100%;visibility:hidden";
  const section = document.createElement("section");
  section.className = "result";
  const well = document.createElement("p");
  well.className = "long-link";
  well.textContent = longLink;
  section.appendChild(document.createElement("div"));
  section.appendChild(well);
  probe.appendChild(section);
  document.body.appendChild(probe);
  try {
    return countColumns(well, advance, longLink.length);
  } finally {
    probe.remove();
  }
}

// Makes a text element that follows the line.
function onPath(className: string): { text: SVGTextElement; textPath: SVGTextPathElement } {
  const text = document.createElementNS(SVG, "text");
  text.setAttribute("class", className);
  const textPath = document.createElementNS(SVG, "textPath");
  textPath.setAttribute("href", `#${PATH_ID}`);
  text.appendChild(textPath);
  return { text, textPath };
}

interface Coil {
  layout: CoilLayout;
  count: number;
  groups: SVGGElement[];
  edge: SVGTextElement;
  write: (n: number) => void;
  complete: () => void;
}

/**
 * Lays the line out for a fitted window, and returns the coil. `write` shows the first `n`
 * characters, and only ever goes forward. It changes the text of the newest chunk and of the edge,
 * and adds every chunk that the head has reached, which is several in one frame near the end. A
 * finished chunk is never touched again, so the browser repaints a small area in each frame.
 * `complete` moves the last characters from the edge into their chunks, so the edge can fade over
 * them.
 */
function layCoil({
  overlay,
  path,
  longLink,
  view,
  start,
  fit,
  advance,
  rowLength,
}: {
  overlay: SVGSVGElement;
  path: SVGPathElement;
  longLink: string;
  view: DOMRect;
  start: ReturnType<typeof measureField>;
  fit: CoilFit;
  advance: number;
  rowLength: number;
}): Coil {
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
    rowLength,
    chunkLength: CHUNK_LENGTH,
  });
  const { count, sizes, offsets, chunks } = layout;
  const sizeAt = (index: number) => sizes[index] ?? fit.size;

  const edge = onPath("coil-edge");
  const edgeRuns: {
    span: SVGTSpanElement;
    node: ReturnType<Document["createTextNode"]>;
    size: number;
  }[] = [];
  overlay.appendChild(edge.text);

  // One group for each piece, so a piece can leave the coil as one.
  const groups: SVGGElement[] = [];
  // Adds the next chunk to the overlay, empty, and returns it with its text node, or returns
  // `null` after the last chunk.
  let next = 0;
  const addChunk = () => {
    const chunk = chunks[next];
    next += 1;
    if (chunk === undefined) {
      return null;
    }
    let group = groups[chunk.piece];
    if (group === undefined) {
      group = document.createElementNS(SVG, "g");
      groups[chunk.piece] = group;
      // The edge stays last, so it's drawn over every chunk.
      overlay.insertBefore(group, edge.text);
    }
    const { text, textPath } = onPath(chunk.plain ? "coil-chunk" : "coil-chunk coil-halo");
    text.setAttribute("font-size", String(chunk.size));
    textPath.setAttribute("startOffset", String(round(chunk.offset)));
    const node = document.createTextNode("");
    textPath.appendChild(node);
    group.appendChild(text);
    return { chunk, node };
  };
  // The chunk that the head is in.
  let head = addChunk();
  const fillTo = (lit: number) => {
    while (head !== null && lit >= head.chunk.to) {
      head.node.data = longLink.slice(head.chunk.from, head.chunk.to);
      head = addChunk();
    }
    if (head !== null) {
      head.node.data = longLink.slice(head.chunk.from, lit);
    }
  };

  // The edge is one run of text for each font size under it, which is one run everywhere except
  // where the text shrinks.
  const writeEdge = (from: number, to: number) => {
    let used = 0;
    for (let index = from; index < to;) {
      const size = sizeAt(index);
      let stop = index + 1;
      while (stop < to && sizeAt(stop) === size) {
        stop += 1;
      }
      let edgeRun = edgeRuns[used];
      if (edgeRun === undefined) {
        const span = document.createElementNS(SVG, "tspan");
        const node = document.createTextNode("");
        span.appendChild(node);
        edge.textPath.appendChild(span);
        edgeRun = { span, node, size: 0 };
        edgeRuns.push(edgeRun);
      }
      if (edgeRun.size !== size) {
        edgeRun.span.setAttribute("font-size", String(size));
        edgeRun.size = size;
      }
      edgeRun.node.data = longLink.slice(index, stop);
      used += 1;
      index = stop;
    }
    for (const unused of edgeRuns.slice(used)) {
      unused.node.data = "";
    }
    edge.textPath.setAttribute("startOffset", String(round(offsets[from] ?? 0)));
  };

  let shown = -1;
  const write = (n: number) => {
    if (n === shown) {
      return;
    }
    shown = n;
    const lit = Math.max(0, n - EDGE_LENGTH);
    fillTo(lit);
    writeEdge(lit, n);
  };
  const complete = () => fillTo(count);

  return { layout, count, groups, edge: edge.text, write, complete };
}

/**
 * Makes the figures count with the rows as they land. The figures are text that React rendered,
 * so the count changes the data of React's own text nodes and never replaces a node, and `settle`
 * puts back the data that React wrote, so the figures end on exactly the server's values.
 */
function countFigures(result: HTMLElement, format: CoilOptions["figures"]) {
  const cells = result.querySelectorAll<HTMLElement>(".report td");
  const elements = [result.querySelector<HTMLElement>(".figure dd"), cells[1], cells[2], cells[3]];
  const figures = elements.map((element) => {
    const nodes = element === null || element === undefined ? [] : [...element.childNodes];
    const texts = nodes.filter((node) => isText(node));
    if (texts.length === 0 || texts.length !== nodes.length) {
      throw new Error("A figure isn't plain text.");
    }
    return { texts, served: texts.map((node) => node.data) };
  });
  // A table sizes its columns to its text, so a counting number would move the words beside it.
  // The column of values keeps the width that the served values give it until the count is
  // over. No value in the count is wider than the served one.
  const column = cells[0];
  if (column === undefined) {
    throw new Error("The report has no values.");
  }
  const styled = column.hasAttribute("style");
  column.style.width = `${column.getBoundingClientRect().width}px`;
  let shown = -1;
  const show = (length: number) => {
    if (length === shown) {
      return;
    }
    shown = length;
    for (const [index, value] of format(length).entries()) {
      const figure = figures[index];
      if (figure !== undefined) {
        for (const [at, node] of figure.texts.entries()) {
          node.data = at === 0 ? value : "";
        }
      }
    }
  };
  const settle = () => {
    for (const { texts, served } of figures) {
      for (const [at, node] of texts.entries()) {
        node.data = served[at] ?? "";
      }
    }
    column.style.width = "";
    if (!styled) {
      column.removeAttribute("style");
    }
  };
  return { show, settle };
}

/**
 * Starts the coil, or returns `null`, with nothing changed, when it can't play here: in a hidden
 * tab, in a window narrower than the wide layout, on a home page taller than the window, with a
 * visitor's link that has characters outside printable ASCII, with a long link that doesn't fit
 * on the coil, before the fixed-width face has loaded, in a browser that lacks an API that the
 * coil uses, or on any failure. The page then shows the result without the coil. Call it before
 * the browser paints the page that has the new result, so the first frame shows the home page as
 * the visitor left it.
 *
 * Any key or pointer press while the coil plays skips it, and the page shows the result at rest.
 */
export function startCoil(options: CoilOptions): CoilRun | null {
  const { home, field, longLink } = options;
  // A hidden tab paints no frames and sends no `visibilitychange` until the visitor comes back,
  // so a coil started there would play in full on their return.
  if (document.hidden || !supported() || !window.matchMedia(WIDE).matches) {
    return null;
  }
  if (!PRINTABLE_ASCII.test(field.value)) {
    return null;
  }
  const root = document.documentElement;
  if (root.scrollHeight > root.clientHeight) {
    return null;
  }
  // The coil's text and the field's text are in the same face, and nothing can be measured
  // until it loads.
  const fieldStyle = window.getComputedStyle(field);
  if (
    !document.fonts.check(
      `${fieldStyle.fontWeight} ${fieldStyle.fontSize} ${fieldStyle.fontFamily}`,
    )
  ) {
    return null;
  }

  const overlay = document.createElementNS(SVG, "svg");
  overlay.setAttribute("class", "coil-overlay");
  overlay.setAttribute("aria-hidden", "true");
  const defs = document.createElementNS(SVG, "defs");
  const path = document.createElementNS(SVG, "path");
  path.id = PATH_ID;
  defs.appendChild(path);
  overlay.appendChild(defs);

  // Everything that the run adds to the page, so that one function can take all of it away.
  const animations: Animation[] = [];
  let frameRequest = 0;
  let stopWatching: (() => void) | null = null;
  let finale: ReturnType<typeof stageFinale> | null = null;
  let over = false;
  const visitorLink = field.value;
  const homeStyled = home.hasAttribute("style");
  // The coil hides the page from assistive technology, so a live region outside the inert home
  // page says what's happening. It's added only once the coil is sure to play.
  const status = document.createElement("div");
  status.className = "coil-status";
  status.setAttribute("role", "status");
  let announceTimer: ReturnType<typeof setTimeout> | null = null;

  const onVisibilityChange = () => {
    if (document.hidden) {
      drop();
    }
  };
  const onResize = () => drop();
  // Any press skips the coil, and the result appears at rest under the pointer and the focus in
  // the same event, so the press mustn't also act on the result. The default action of a pointer
  // press would move the focus off the result's heading. The pointer is captured by the body
  // until it's released, so the browser sends the press's click to the body, not to a button or
  // a link of the result that's now under the pointer.
  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    try {
      document.body.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that's no longer pressed can't be captured, and it sends no click either.
    }
    drop();
  };
  // The default action of a key would act on the focus, which is about to be the result's
  // heading. A key with a modifier is left alone, because it's a shortcut of the browser.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
    }
    drop();
  };

  // Removes every trace of the run. The result's own text goes back first, while its element is
  // still in the page.
  function clear() {
    over = true;
    if (frameRequest !== 0) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (announceTimer !== null) {
      clearTimeout(announceTimer);
      announceTimer = null;
    }
    status.remove();
    stopWatching?.();
    stopWatching = null;
    finale?.clear();
    finale = null;
    for (const animation of animations) {
      animation.cancel();
    }
    animations.length = 0;
    overlay.remove();
    document.body.classList.remove("coil-running", "coil-dim", "coil-held");
    home.classList.remove("coil-dimmed", "coil-leaving");
    home.style.height = "";
    if (!homeStyled) {
      home.removeAttribute("style");
    }
    field.value = visitorLink;
  }

  // Stops the run early and has the page show the result at rest.
  function drop() {
    if (over) {
      return;
    }
    clear();
    options.onDropped();
  }

  let coil: Coil;
  try {
    document.body.appendChild(overlay);
    const advance = measureAdvance(overlay);
    const view = overlay.getBoundingClientRect();
    const start = measureField(field);
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
    if (fit === null || !(advance > 0)) {
      clear();
      return null;
    }
    const rowLength = measureRowLength(longLink, advance);
    coil = layCoil({ overlay, path, longLink, view, start, fit, advance, rowLength });
    if (coil.count < longLink.length) {
      clear();
      return null;
    }
    // Everything that fades has its compositor layer from the start of the run, so the browser
    // doesn't make and paint six layers in the frame where the fade starts.
    document.body.classList.add("coil-running");
    window.addEventListener("resize", onResize);
    // In the capture phase, so the coil sees a press before anything on the page acts on it.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    // The first answer comes at once, while the page is still deciding, and the page then
    // shows the result itself.
    let starting = true;
    let allowedAtStart = true;
    stopWatching = watchMotion((allowed) => {
      if (allowed) {
        return;
      }
      if (starting) {
        allowedAtStart = false;
      } else {
        drop();
      }
    });
    starting = false;
    if (!allowedAtStart) {
      clear();
      return null;
    }
    document.body.appendChild(status);
    announceTimer = setTimeout(() => {
      announceTimer = null;
      status.textContent = options.announcement;
    }, ANNOUNCE_DELAY_MS);
  } catch {
    clear();
    return null;
  }

  const { layout } = coil;
  // Blanks the visitor's link in the field up to the head, so the long link overwrites it cell
  // for cell. A space is as wide as any other character in the field's face.
  let blanked = 0;
  const overwrite = (n: number) => {
    const cells = Math.min(n, visitorLink.length);
    if (cells !== blanked) {
      blanked = cells;
      field.value = " ".repeat(cells) + visitorLink.slice(cells);
    }
  };

  // The run's moments, in the time of `requestAnimationFrame`. The first frame sets the start,
  // because a frame's time can be earlier than the moment that the run began.
  let startedAt: number | null = null;
  let dimmed = false;
  let completedAt: number | null = null;
  // Frames painted since the finale was set up. The browser has painted the setup by the second.
  let stagedFrames = -1;
  let finaleStartedAt: number | null = null;

  const frame = (now: number) => {
    frameRequest = 0;
    if (over) {
      return;
    }
    try {
      startedAt ??= now;
      const elapsed = now - startedAt;
      if (finale !== null && finaleStartedAt !== null) {
        const since = now - finaleStartedAt;
        finale.follow(since);
        if (since >= finale.total) {
          finish();
          return;
        }
      } else {
        const n = Math.round(coil.count * typedShare(elapsed / COIL_MS));
        coil.write(n);
        overwrite(n);
        // The page makes room when the head leaves the field, not before.
        if (!dimmed && n > layout.fieldCount) {
          dimmed = true;
          document.body.classList.add("coil-dim");
          home.classList.add("coil-dimmed");
        }
        if (completedAt === null && elapsed >= COIL_MS) {
          completedAt = now;
          coil.complete();
          animations.push(
            coil.edge.animate({ opacity: [1, 0] }, { duration: HOLD_MS, fill: "forwards" }),
          );
          options.onComplete();
        }
        if (finale !== null) {
          stagedFrames += 1;
          if (stagedFrames >= 2 && elapsed >= COIL_MS + HOLD_MS) {
            finale.start();
            finaleStartedAt = now;
          }
        } else if (completedAt !== null && now - completedAt > MOUNT_WAIT_MS) {
          drop();
          return;
        }
      }
      frameRequest = requestAnimationFrame(frame);
    } catch {
      drop();
    }
  };

  // Hands the link over to the well's own text and lets the page take the home page away.
  function finish() {
    if (over) {
      return;
    }
    finale?.settle();
    clear();
    options.onLanded();
  }

  frameRequest = requestAnimationFrame(frame);

  return {
    land(result) {
      if (over || finale !== null || completedAt === null) {
        return false;
      }
      try {
        finale = stageFinale({ coil, result, home, overlay, path, longLink, options, animations });
        stagedFrames = 0;
        return true;
      } catch {
        clear();
        return false;
      }
    },
    cancel() {
      if (!over) {
        clear();
      }
    },
  };
}

/**
 * Sets the finale up and leaves it stopped at its first moment, where the page looks as it did
 * when the coil ended. Setting up is the expensive part, so it happens while the finished coil
 * holds still, and the motion starts on a later frame with `start`.
 *
 * The page has put the result after the home page, which now keeps its place and takes no space.
 * Each piece of the coil gets a line of text that sits exactly on its place in the well and starts
 * with a transform that puts it on the coil, at the piece's place, direction, and size. In the
 * finale, the home page fades out, the result fades in as one group, and each line takes its
 * piece's place in a short fade and flies home. Rows leave in reading order, so the coil unwinds
 * from the field outward and the well fills from the top. Only `transform` and `opacity` animate.
 *
 * The lines fly over the result's background and the well, and behind the result's heading,
 * figures, buttons, and table, so they're inside the result, between its layers. An element that
 * fades is one layer, and the lines would fade with it, so the result can't fade as a whole. Its
 * parts fade together instead, and an element of its own draws its background for the length of
 * the finale.
 *
 * Returns the `total` duration, `start`, `follow`, which keeps the figures and the landed lines in
 * step with a moment in the finale, `settle`, which hands the link over to the well's own text,
 * and `clear`, which takes away everything that the finale added.
 */
function stageFinale({
  coil,
  result,
  home,
  overlay,
  path,
  longLink,
  options,
  animations,
}: {
  coil: Coil;
  result: HTMLElement;
  home: HTMLElement;
  overlay: SVGSVGElement;
  path: SVGPathElement;
  longLink: string;
  options: CoilOptions;
  animations: Animation[];
}) {
  const { layout, groups } = coil;
  const added: HTMLElement[] = [];
  let well: HTMLElement | null = null;
  let figures: ReturnType<typeof countFigures> | null = null;
  const clear = () => {
    figures?.settle();
    figures = null;
    for (const element of added) {
      element.remove();
    }
    added.length = 0;
    well?.classList.remove("coil-waiting");
    result.classList.remove("coil-arriving", "coil-fading");
    document.body.classList.remove("coil-held");
  };

  try {
    well = result.querySelector<HTMLElement>(".long-link");
    if (well === null) {
      throw new Error("The result has no well.");
    }
    const homeHeight = home.getBoundingClientRect().height;
    home.style.height = `${homeHeight}px`;
    home.classList.add("coil-leaving");
    // The page is now as tall as the result. Until the motion starts, the frame and the footer
    // stay where the window's edge puts them.
    document.body.classList.add("coil-held");

    const wellStyle = window.getComputedStyle(well);
    const wellSize = Number.parseFloat(wellStyle.fontSize);
    const advance = measureAdvance(overlay);
    // The coil was cut at the rows of a copy of the well. The real well has to agree.
    if (countColumns(well, advance, longLink.length) !== layout.rowLength) {
      throw new Error("The well's rows differ from the coil's.");
    }
    well.classList.add("coil-waiting");

    const backdrop = document.createElement("div");
    backdrop.className = "coil-backdrop";
    const resultStyle = window.getComputedStyle(result);
    backdrop.style.backgroundImage = resultStyle.backgroundImage;
    backdrop.style.backgroundPosition = resultStyle.backgroundPosition;
    backdrop.style.backgroundSize = resultStyle.backgroundSize;
    backdrop.style.backgroundRepeat = resultStyle.backgroundRepeat;
    result.insertBefore(backdrop, result.firstChild);
    added.push(backdrop);
    result.classList.add("coil-arriving", "coil-fading");

    const flyers = document.createElement("div");
    flyers.className = "coil-flyers";
    flyers.setAttribute("aria-hidden", "true");
    flyers.style.font = `${wellStyle.fontWeight} ${wellStyle.fontSize}/${wellStyle.lineHeight} ${wellStyle.fontFamily}`;
    result.appendChild(flyers);
    added.push(flyers);
    const origin = flyers.getBoundingClientRect();
    const overlayBox = overlay.getBoundingClientRect();

    // Where a line's letters and its baseline sit under its own top edge.
    const probe = document.createElement("div");
    probe.className = "coil-flyer";
    const mark = baselineMark();
    probe.textContent = "x";
    probe.appendChild(mark);
    flyers.appendChild(probe);
    const probeTop = probe.getBoundingClientRect().top;
    const probeText = probe.firstChild;
    if (!isText(probeText)) {
      throw new Error("The probe has no text.");
    }
    const inkTop = characterBox(probeText, 0).top - probeTop;
    const baseline = mark.getBoundingClientRect().bottom - probeTop;
    probe.remove();

    const rows = Math.ceil(layout.count / layout.rowLength);
    const stagger = Math.min(STAGGER_MS, (FINALE_MS - FLIGHT_MS) / Math.max(1, rows - 1));
    // The time from the first row's start to the last row's start.
    const leaving = (rows - 1) * stagger;
    const total = leaving + FLIGHT_MS;
    const wellNode = well.firstChild;
    if (!isText(wellNode)) {
      throw new Error("The well has no text.");
    }
    const wellAdvance = advance * wellSize;

    figures = countFigures(result, options.figures);

    // Everything is measured before anything is made, so the browser lays the page out once for
    // the finale and not once for each line.
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
      const here = path.getPointAtLength(layout.offsets[middle] ?? 0);
      const there = path.getPointAtLength(layout.offsets[middle + 1] ?? 0);
      const turn = Math.atan2(there.y - here.y, there.x - here.x);
      const scale = (layout.sizes[middle] ?? wellSize) / wellSize;
      // The line turns and shrinks about the middle of its letters' baseline, so a long line
      // spins in place as it travels and doesn't sweep across the page like a clock's hand.
      const half = ((piece.to - piece.from) * wellAdvance) / 2;
      const back = ((middle - piece.from) * wellAdvance - half) * scale;
      const x = overlayBox.left + here.x - Math.cos(turn) * back - (left + half);
      const y = overlayBox.top + here.y - Math.sin(turn) * back - (top + baseline);
      // A turn of half a circle either way is the same length. The text on the bottom lanes turns
      // through pointing up.
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
        delay: piece.row * stagger,
      };
    });

    // Each line with the moment it lands, in the order that they land.
    const flights: { flyer: HTMLElement; lands: number }[] = [];
    const finaleAnimations = [
      home.animate(
        { opacity: [1, 0] },
        { duration: ARRIVE_MS, easing: "ease-out", fill: "forwards" },
      ),
    ];
    // The result's parts fade in with one timing, so they arrive as one group.
    for (const part of [
      backdrop,
      ...result.querySelectorAll(":scope > .result > *, :scope > form"),
    ]) {
      finaleAnimations.push(
        part.animate(
          { opacity: [UNSEEN, 1] },
          { duration: ARRIVE_MS, easing: ARRIVE_EASING, fill: "backwards" },
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
      flyers.appendChild(flyer);

      const { delay } = plan;
      const fade = { delay, duration: CROSSFADE_MS };
      flights.push({ flyer, lands: delay + FLIGHT_MS });
      finaleAnimations.push(
        flyer.animate(
          { transform: [plan.from, "translate(0px, 0px) rotate(0deg) scale(1)"] },
          { delay, duration: FLIGHT_MS, easing: FLIGHT_EASING, fill: "backwards" },
        ),
        flyer.animate({ opacity: [UNSEEN, 1] }, { ...fade, fill: "backwards" }),
      );
      const group = groups[index];
      if (group !== undefined) {
        finaleAnimations.push(group.animate({ opacity: [1, 0] }, { ...fade, fill: "forwards" }));
      }
    }
    for (const animation of finaleAnimations) {
      animation.pause();
      animations.push(animation);
    }

    // Starts every animation at the same moment. The page's frame and footer go to their places
    // on the taller page, and the header and the footer come back with the result.
    const start = () => {
      document.body.classList.remove("coil-held", "coil-dim");
      const at = document.timeline.currentTime;
      for (const animation of finaleAnimations) {
        animation.startTime = at;
      }
    };
    let down = 0;
    // Keeps the page in step with the flights at a moment in the finale. A line that has landed
    // drops its outline, which would otherwise cover the edge of the line beside it in the same
    // row. The figures show the middle of two counts, the characters that have left the coil and
    // the characters that have landed. That count starts with the first row's flight, ends as the
    // last row lands, and is slower at both ends, where only one of the two is moving.
    const follow = (elapsed: number) => {
      // The parts of the result keep their layers only for the length of their fade.
      result.classList.toggle("coil-fading", elapsed < ARRIVE_MS);
      for (let flight = flights[down]; flight !== undefined && flight.lands <= elapsed;) {
        flight.flyer.classList.add("coil-landed");
        down += 1;
        flight = flights[down];
      }
      const span = Math.max(1, leaving);
      const left = clamp(elapsed / span, 0, 1);
      const landed = clamp((elapsed - FLIGHT_MS) / span, 0, 1);
      const length =
        elapsed >= total ? layout.count : Math.round((layout.count * (left + landed)) / 2);
      figures?.show(Math.max(options.originalLength, length));
    };
    return { total, start, follow, settle: clear, clear };
  } catch (error) {
    clear();
    throw error;
  }
}
