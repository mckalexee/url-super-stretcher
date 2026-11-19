// Storage for stretched links, and the checks on a URL before it becomes one. A link lives in
// Workers KV as one JSON record. A KV key holds at most 512 bytes and a stretched link is longer,
// so the key is a hash of the link, and the record repeats the link for an exact comparison.
import { z } from "zod";

import { HttpError } from "#lib/errors.ts";

import { generateStretch, isFlavorId } from "./flavors.ts";
import type { FlavorId, RandomSource } from "./flavors.ts";

/** A stretched link and the URL that it redirects to. */
export interface StretchedLink {
  /** The URL that the link redirects to. */
  url: string;
  /** The flavor that wrote the link. */
  flavor: FlavorId;
  /** The path and query of the link on this site, starting with `LINK_PREFIX`. */
  path: string;
  /** When the link was created, as an ISO 8601 timestamp. */
  createdAt: string;
}

/** The path prefix that every stretched link starts with. */
export const LINK_PREFIX = "/to/";

const KEY_PREFIX = "link:";

// Longer URLs than this fail in some browsers and proxies, and a stretched link adds its own
// length on top.
const MAX_TARGET_LENGTH = 2048;

const SCHEME_WITH_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\//i;

// A host with at least one dot, an optional port, and an optional path, query, or fragment. The
// dot keeps a single stray word from becoming a URL. The pattern excludes `@`, so input with
// credentials stays as typed and fails the scheme check or the credentials check.
const BARE_HOSTNAME = /^[^\s/?#:@]+\.[^\s/?#:@]+(:\d+)?([/?#].*)?$/;

// A record is read back long after it was written, and anyone with access to the namespace can
// write one, so the shape is checked on the way out. The scheme check means that a redirect
// never sends a visitor to a `javascript:` or `data:` URL.
const storedLink = z.object({
  url: z.url({ protocol: /^https?$/ }),
  flavor: z.custom<FlavorId>((value) => typeof value === "string" && isFlavorId(value)),
  path: z.string(),
  createdAt: z.iso.datetime(),
});

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

// A fully qualified hostname can end in a dot and still names the same host.
function withoutTrailingDot(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

/**
 * Turns what a visitor typed into the URL to redirect to. Input without a scheme that looks like
 * a hostname gets `https://`. The function throws an `HttpError` with status 400, and a message
 * written for the page, when the input is empty, isn't a URL, isn't `http` or `https`, carries a
 * username or password, is longer than 2,048 characters, or points at `ownHostname`. A stretched
 * link that points at this site can redirect to itself forever.
 */
export function parseTarget(input: string, ownHostname: string): URL {
  const text = input.trim();
  if (text === "") {
    throw new HttpError(400, "There's nothing here to stretch. Enter a URL first.");
  }

  const candidate =
    !SCHEME_WITH_AUTHORITY.test(text) && BARE_HOSTNAME.test(text) ? `https://${text}` : text;
  const url = parseUrl(candidate);
  if (url === null) {
    throw new HttpError(
      400,
      "That doesn't look like a URL. Try something like https://example.com/page.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(
      400,
      "Only http and https links can be stretched. Other schemes have to stay the length they are.",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new HttpError(
      400,
      "That URL contains a username or password. Remove them, because anyone with the long link can see where it goes.",
    );
  }
  if (url.href.length > MAX_TARGET_LENGTH) {
    throw new HttpError(400, "That URL is longer than 2,048 characters. It doesn't need our help.");
  }
  if (withoutTrailingDot(url.hostname) === withoutTrailingDot(ownHostname)) {
    throw new HttpError(
      400,
      "That URL points at this site. A stretched link to a stretched link could go on forever, which is too long even for us.",
    );
  }
  return url;
}

async function keyFor(stretch: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stretch));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return KEY_PREFIX + hex.join("");
}

/**
 * Creates a stretched link to `target` in the given flavor, stores it, and returns it. Validate
 * the target with `parseTarget` first. `random` is for tests that need the same link every time.
 */
export async function createLink(
  kv: KVNamespace,
  target: URL,
  flavor: FlavorId,
  random?: RandomSource,
): Promise<StretchedLink> {
  const stretch = generateStretch(flavor, random);
  const link: StretchedLink = {
    url: target.href,
    flavor,
    path: LINK_PREFIX + stretch,
    createdAt: new Date().toISOString(),
  };
  await kv.put(await keyFor(stretch), JSON.stringify(link));
  return link;
}

/**
 * Finds the link for a request's pathname plus search, such as `/to/landing?utm_source=x`. It
 * returns `null` when no stored link has exactly that path and query, and when the stored record
 * isn't a valid link.
 */
export async function findLink(
  kv: KVNamespace,
  pathAndQuery: string,
): Promise<StretchedLink | null> {
  if (!pathAndQuery.startsWith(LINK_PREFIX) || pathAndQuery.length === LINK_PREFIX.length) {
    return null;
  }
  const text = await kv.get(await keyFor(pathAndQuery.slice(LINK_PREFIX.length)));
  if (text === null) {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = storedLink.safeParse(json);
  // The hash already matches, so a different path means that the record is wrong, not that two
  // links share a hash.
  if (!parsed.success || parsed.data.path !== pathAndQuery) {
    return null;
  }
  return parsed.data;
}
