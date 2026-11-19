// Captures everything that the Worker logs during a test, at every level, so a test can assert
// what must never reach the logs, whichever event would carry it.
import { vi } from "vitest";
import { z } from "zod";

const logLine = z.record(z.string(), z.unknown());

const LEVELS = ["debug", "info", "warn", "error"] as const;

/**
 * Silences the console and returns a reader for the lines written since the call, in the order
 * of the levels, not of the calls. Restore the spies with `vi.restoreAllMocks()` after the test.
 */
export function captureLogs(): () => string[] {
  const spies = LEVELS.map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
  return () => spies.flatMap((spy) => spy.mock.calls.map(([line]) => String(line)));
}

/**
 * Parses the captured lines that carry the given event name. It skips lines that aren't JSON,
 * which come from a library that writes to the console directly, such as a React warning.
 */
export function eventsIn(lines: string[], event: string): Record<string, unknown>[] {
  return lines.flatMap((line) => {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return [];
    }
    const entry = logLine.safeParse(json);
    return entry.success && entry.data["event"] === event ? [entry.data] : [];
  });
}
