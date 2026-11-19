// The switch that says whether the page may move. Motion is allowed only after the page's script
// has taken over, while the visitor's system doesn't ask for reduced motion, and while the visitor
// hasn't paused it. One store holds the answer, so React components, plain browser modules, and
// the stylesheet all agree. The stylesheet reads it as `data-motion="on"` on the document element.
// Motion is opt-in because a visitor without JavaScript has no control that pauses it, so that
// visitor gets a still page.
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "motion";
const PAUSED_VALUE = "off";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Every value stays false until the store starts, and it starts only in the browser. The server
// shares a module's state between requests, so nothing here changes there.
let started = false;
let paused = false;
let reducedMotion = false;
const listeners = new Set<() => void>();

// Storage throws in some private windows. A choice that can't be read counts as no choice.
function readPaused(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === PAUSED_VALUE;
  } catch {
    return false;
  }
}

// A choice that can't be saved still applies until the visitor leaves the page, because the
// store holds it.
function writePaused(value: boolean): void {
  try {
    if (value) {
      window.localStorage.setItem(STORAGE_KEY, PAUSED_VALUE);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Nothing to do: the choice lasts for this page only.
  }
}

// The stylesheet animates only under this attribute. Removing it, instead of setting another
// value, leaves the document exactly as the server rendered it.
function markDocument(): void {
  const root = document.documentElement;
  if (motionAllowed()) {
    root.dataset.motion = "on";
  } else {
    delete root.dataset.motion;
  }
}

// The document is marked first and every listener is called, even when one of them throws, so one
// broken listener can't leave the stylesheet or the other listeners with an old answer. The first
// error is thrown again afterward, so the bug that caused it stays visible.
function publish(): void {
  markDocument();
  const errors: unknown[] = [];
  // The set itself, not a copy, so a listener that an earlier one removes in this round isn't
  // called after its subscription ends.
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw errors[0];
  }
}

// Starts the store once, in the browser, and does nothing on the server, where a started store
// would answer for every later request. The store counts as started only after the setup is
// done. The media query listener stays for the life of the page, because the document shell
// subscribes on every page and never leaves.
function start(): void {
  if (started || typeof window === "undefined") {
    return;
  }
  paused = readPaused();
  try {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    reducedMotion = query.matches;
    query.addEventListener("change", (event) => {
      reducedMotion = event.matches;
      publish();
    });
  } catch {
    // A browser that can't answer the query, or can't report a change to it, gives no way to
    // know what the visitor asked for. The still page is the safe answer.
    reducedMotion = true;
  }
  started = true;
}

/**
 * Whether the page may move right now. The answer is false until something has subscribed to the
 * store, because the first subscription starts it, and it's always false on the server. A module
 * that isn't a React component follows the switch with `watchMotion()` instead, which can't read
 * the answer too early.
 */
export function motionAllowed(): boolean {
  return started && !reducedMotion && !paused;
}

/**
 * Calls the listener each time the answer of `motionAllowed()` might have changed, and returns a
 * function that stops the calls. The first subscription starts the store. The listener isn't
 * called for the answer at the time of the subscription, which suits `useSyncExternalStore` and
 * nothing else: a module that isn't a React component uses `watchMotion()`. On the server, it
 * does nothing.
 */
export function subscribeToMotion(listener: () => void): () => void {
  start();
  if (!started) {
    return () => {};
  }
  listeners.add(listener);
  // React resets the attributes of the document element when the document shell remounts, which
  // happens when a navigation swaps a page for the error page. Each new subscriber marks the
  // document again, so the attribute survives that.
  markDocument();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The way a browser module that isn't a React component follows the switch. It starts the store,
 * calls the listener once right away with the current answer, and calls it again each time the
 * answer changes, with the new answer. It returns a function that stops the calls. Call it in the
 * browser only, and after hydration: from an effect, or from code that an effect starts.
 */
export function watchMotion(listener: (allowed: boolean) => void): () => void {
  let last: boolean | undefined;
  const report = () => {
    const allowed = motionAllowed();
    // A change to one condition often leaves the answer as it was, such as a pause under reduced
    // motion, and the listener hears only about a new answer.
    if (allowed !== last) {
      last = allowed;
      listener(allowed);
    }
  };
  const stop = subscribeToMotion(report);
  try {
    report();
  } catch (error) {
    // A listener that fails on its first call never gets the function that stops the calls, so
    // the subscription ends here.
    stop();
    throw error;
  }
  return stop;
}

/**
 * Pauses or resumes motion for this visitor. The choice applies at once, and it's saved in the
 * browser's storage, so it holds on every page and on the next visit. On the server, it does
 * nothing.
 */
export function setMotionPaused(value: boolean): void {
  // Starting first keeps the stored choice from replacing this one later.
  start();
  if (!started) {
    return;
  }
  paused = value;
  writePaused(value);
  publish();
}

/**
 * Whether the visitor's system asks for reduced motion right now, for a browser module that isn't
 * a React component. Like `motionAllowed()`, the answer is false until something has subscribed
 * to the store, and it's always false on the server. A `watchMotion()` listener runs only after
 * the store has started, so it can read this to tell a system setting from a pause.
 */
export function reducedMotionRequested(): boolean {
  return reducedMotion;
}

const pausedSnapshot = () => paused;
const serverSnapshot = () => false;

/**
 * Whether the page may move right now. False on the server and during hydration, so the first
 * client render matches the HTML that the server sent.
 */
export function useMotionAllowed(): boolean {
  return useSyncExternalStore(subscribeToMotion, motionAllowed, serverSnapshot);
}

/** Whether the visitor has paused motion. False on the server and during hydration. */
export function useMotionPaused(): boolean {
  return useSyncExternalStore(subscribeToMotion, pausedSnapshot, serverSnapshot);
}

/**
 * Whether the visitor's system asks for reduced motion. False on the server and during hydration,
 * so pair it with `useHydrated()` where a false answer must mean that the system doesn't ask.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToMotion, reducedMotionRequested, serverSnapshot);
}
