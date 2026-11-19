// Storage for stretched links, and the checks on a URL before it becomes one. A link lives in
// Workers KV as one JSON record, whose shape and key `records.ts` defines. The same namespace
// holds the `blocked-host:` keys that ban a hostname, so one lookup here answers whether a link
// still works.
import { HttpError } from "#lib/errors.ts";

import { generateStretch } from "./flavors.ts";
import type { FlavorId, RandomSource } from "./flavors.ts";
import { LINK_PREFIX } from "./prefix.ts";
import {
  blockedHostKey,
  isValidHostname,
  linkKey,
  normalizeHostname,
  parseRecord,
  stretchOf,
} from "./records.ts";
import type { StretchedLink } from "./records.ts";

// Longer URLs than this fail in some browsers and proxies, and a stretched link adds its own
// length on top.
const MAX_TARGET_LENGTH = 2048;

const SCHEME_WITH_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\//i;

// A host with at least one dot, an optional port, and an optional path, query, or fragment. The
// dot keeps a single stray word from becoming a URL. The pattern excludes `@`, so input with
// credentials stays as typed and fails the scheme check or the credentials check.
const BARE_HOSTNAME = /^[^\s/?#:@]+\.[^\s/?#:@]+(:\d+)?([/?#].*)?$/;

// The URL parser rewrites every spelling of an IPv4 address, such as `0x7f.1` or `2130706433`,
// to four decimal numbers, and keeps an IPv6 address in brackets.
const IPV4_LITERAL = /^\d+\.\d+\.\d+\.\d+$/;

// Names that resolve only inside a machine or a private network. The resolver that judges
// destinations can't see them, and a public link has no business pointing at them.
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

// A name without a dot, such as `localhost`, `intranet`, or `router`, means something only to
// the network that the visitor is on, so every single-label name is private. The dot in front of
// the hostname lets a suffix match the bare name too, such as `home.arpa`.
function isPrivateName(hostname: string): boolean {
  return (
    !hostname.includes(".") || PRIVATE_SUFFIXES.some((suffix) => `.${hostname}`.endsWith(suffix))
  );
}

/**
 * Turns what a visitor typed into the URL that the link leads to. Input without a scheme that
 * looks like a hostname gets `https://`. The function throws an `HttpError` with status 400, and
 * a message written for the page, when the input is empty, isn't a URL, isn't `http` or `https`,
 * carries a username or password, is longer than 2,048 characters, names an IP address, a
 * hostname that DNS can't hold, or a private-network hostname, or points at `ownHostname`. A
 * stretched link that points at this site can lead to itself forever.
 */
export function parseTarget(input: string, ownHostname: string): URL {
  const text = input.trim();
  if (text === "") {
    throw new HttpError(400, "Enter a URL.");
  }

  const candidate =
    !SCHEME_WITH_AUTHORITY.test(text) && BARE_HOSTNAME.test(text) ? `https://${text}` : text;
  const url = parseUrl(candidate);
  if (url === null) {
    throw new HttpError(400, "Enter a valid URL, such as https://example.com/page.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "Only http and https URLs are supported.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new HttpError(400, "URLs that contain a username or password aren't supported.");
  }
  if (url.href.length > MAX_TARGET_LENGTH) {
    throw new HttpError(400, "URLs longer than 2,048 characters aren't supported.");
  }
  const hostname = normalizeHostname(url.hostname);
  // The reputation check judges names, so an address would pass it unjudged, and addresses also
  // cover every private network.
  if (hostname.startsWith("[") || IPV4_LITERAL.test(hostname)) {
    throw new HttpError(400, "URLs that use an IP address aren't supported.");
  }
  // This comes before every check that compares names. A name such as `example.com..` keeps a
  // trailing dot after normalization, so it would match neither this site's hostname, nor a
  // private suffix, nor a ban.
  if (!isValidHostname(hostname)) {
    throw new HttpError(400, "The hostname in that URL isn't valid.");
  }
  if (isPrivateName(hostname)) {
    throw new HttpError(400, "URLs on private networks aren't supported.");
  }
  if (hostname === normalizeHostname(ownHostname)) {
    throw new HttpError(400, "URLs on this site aren't supported.");
  }
  return url;
}

/**
 * Reports whether a takedown banned the hostname, which is true when its `blocked-host:` key
 * exists. The match is exact, so a ban on `example.com` doesn't cover `www.example.com`.
 */
export async function isHostBlocked(kv: KVNamespace, hostname: string): Promise<boolean> {
  return (await kv.get(blockedHostKey(hostname))) !== null;
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
  await kv.put(await linkKey(stretch), JSON.stringify(link));
  return link;
}

/**
 * Finds the record for a request's pathname plus search, such as `/to/landing?utm_source=x`. It
 * returns `null` when no stored link has exactly that path and query, and when the stored record
 * isn't a valid link. A link that was taken down is still found, with `disabledAt` set, so use
 * `resolveLink` to decide what a visitor sees.
 */
export async function findLink(
  kv: KVNamespace,
  pathAndQuery: string,
): Promise<StretchedLink | null> {
  const stretch = stretchOf(pathAndQuery);
  if (stretch === null) {
    return null;
  }
  const text = await kv.get(await linkKey(stretch));
  return text === null ? null : parseRecord(text, pathAndQuery);
}

/**
 * What a visitor to a link's path gets: nothing, because no such link exists, a notice that the
 * link was removed, or the link.
 */
export type LinkLookup =
  | { state: "missing" }
  | { state: "removed" }
  | { state: "active"; link: StretchedLink };

/**
 * Finds the link for a request's pathname plus search and says whether it still works. A link is
 * `removed` when its record was disabled or its destination's hostname was banned, so one
 * `blocked-host:` key takes down every link to that hostname. It's also `removed` when the
 * record's hostname isn't one that `parseTarget` accepts as valid, because neither the ban's
 * exact match nor the reputation check can judge such a name.
 */
export async function resolveLink(kv: KVNamespace, pathAndQuery: string): Promise<LinkLookup> {
  const link = await findLink(kv, pathAndQuery);
  if (link === null) {
    return { state: "missing" };
  }
  const hostname = normalizeHostname(new URL(link.url).hostname);
  // The validity check runs before the ban lookup, because a hostname that is too long makes a
  // key that KV refuses to read.
  if (
    link.disabledAt !== undefined ||
    !isValidHostname(hostname) ||
    (await isHostBlocked(kv, hostname))
  ) {
    return { state: "removed" };
  }
  return { state: "active", link };
}
