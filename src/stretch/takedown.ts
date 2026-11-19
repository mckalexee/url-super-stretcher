// The parts of the takedown command that need no network and no Wrangler: reading its arguments
// and working out which link they name. `scripts/takedown.ts` does the rest. This logic lives
// here, and not in the script, because the tests run in workerd and cover only `src/`.
import { stretchOf } from "./records.ts";

/** What one run of the takedown command was asked to do. */
export interface TakedownOptions {
  /** The stretch of the link to act on: everything after `/to/` in its path and query. */
  stretch: string;
  /** Why the link is taken down, stored in the record and with a banned hostname. */
  reason: string | undefined;
  /** Whether to restore the link instead of taking it down. */
  restore: boolean;
  /** Whether to also ban the hostname that the link leads to. */
  blockHost: boolean;
  /** Whether to also lift the ban on the hostname that the link leads to. */
  unblockHost: boolean;
  /** Which namespace to act on. `local` is the one that `pnpm dev` uses on this machine. */
  target: "production" | "preview" | "local";
}

/** The result of reading the command's arguments: the options, or what's wrong with them. */
export type TakedownArguments =
  | { ok: true; options: TakedownOptions }
  | { ok: false; message: string };

/** How to call the command, for its error output. */
export const TAKEDOWN_USAGE =
  "Usage: pnpm takedown '<long link URL>' [--reason <text>] [--block-host] [--preview | --local]\n" +
  "       pnpm takedown '<long link URL>' --restore [--unblock-host] [--preview | --local]";

const FLAGS = ["--block-host", "--unblock-host", "--preview", "--local", "--restore"] as const;

function isFlag(value: string): value is (typeof FLAGS)[number] {
  return (FLAGS as readonly string[]).includes(value);
}

/**
 * Returns the stretch that a long link names. It accepts the whole link, such as
 * `https://urlsuperstretcher.com/to/landing?utm_source=x`, or its path and query alone. It
 * returns `null` for anything that isn't under `/to/`. The fragment isn't part of a link.
 */
export function stretchOfLink(link: string): string | null {
  let url: URL;
  try {
    // The base only lets a bare path parse. Its hostname is never read.
    url = new URL(link, "https://placeholder.invalid");
  } catch {
    return null;
  }
  return stretchOf(url.pathname + url.search);
}

function fail(message: string): TakedownArguments {
  return { ok: false, message };
}

/**
 * Reads the command's arguments, which are everything after the script's name. It rejects a
 * missing or second link, an unknown flag, a `--reason` without text, and combinations that ask
 * for opposite things, with a message that says which.
 */
export function parseTakedownArguments(argv: readonly string[]): TakedownArguments {
  const flags = new Set<(typeof FLAGS)[number]>();
  let link: string | undefined;
  let reason: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--reason") {
      const text = argv[index + 1];
      if (text === undefined || text.trim() === "") {
        return fail("--reason needs text after it.");
      }
      reason = text.trim();
      index += 1;
    } else if (isFlag(argument)) {
      flags.add(argument);
    } else if (argument.startsWith("--")) {
      return fail(`Unknown option ${argument}.`);
    } else if (link === undefined) {
      link = argument;
    } else {
      // An unquoted tracking link reaches the command as several arguments, or not at all.
      return fail("Pass one long link, in single quotes so the shell leaves its `&` alone.");
    }
  }

  if (link === undefined) {
    return fail("Pass the long link to act on.");
  }
  const stretch = stretchOfLink(link);
  if (stretch === null) {
    return fail("That isn't a stretched link. A stretched link's path starts with /to/.");
  }

  const restore = flags.has("--restore");
  if (restore && reason !== undefined) {
    return fail("--reason describes a takedown, so it doesn't go with --restore.");
  }
  if (restore && flags.has("--block-host")) {
    return fail("--block-host doesn't go with --restore. To lift a ban, use --unblock-host.");
  }
  if (!restore && flags.has("--unblock-host")) {
    return fail("--unblock-host goes with --restore.");
  }
  if (flags.has("--preview") && flags.has("--local")) {
    return fail("Choose one of --preview and --local.");
  }

  return {
    ok: true,
    options: {
      stretch,
      reason,
      restore,
      blockHost: flags.has("--block-host"),
      unblockHost: flags.has("--unblock-host"),
      target: flags.has("--preview") ? "preview" : flags.has("--local") ? "local" : "production",
    },
  };
}
