// The shape of the records in the `LINKS` namespace, the keys they live under, and the edits that
// take a link down and restore it. Nothing here touches a binding or another Workers-only API,
// so the Worker and the takedown command, which runs in Node.js, derive the same keys and read
// the same records from this one module.
import { z } from "zod";

import { isFlavorId } from "./flavors.ts";
import type { FlavorId } from "./flavors.ts";
import { LINK_PREFIX } from "./prefix.ts";

/** A stretched link and the URL that it leads to. */
export interface StretchedLink {
  /** The URL that the link leads to. */
  url: string;
  /** The flavor that wrote the link. */
  flavor: FlavorId;
  /** The path and query of the link on this site, starting with `LINK_PREFIX`. */
  path: string;
  /** When the link was created, as an ISO 8601 timestamp. */
  createdAt: string;
  /** When the link was taken down, as an ISO 8601 timestamp. Absent on a link that works. */
  disabledAt?: string | undefined;
  /** Why the link was taken down, for the person who reads the record later. */
  disabledReason?: string | undefined;
}

const LINK_KEY_PREFIX = "link:";
const BLOCKED_HOST_KEY_PREFIX = "blocked-host:";

// A record is read back long after it was written, and anyone with access to the namespace can
// write one, so the shape is checked on the way out. The scheme check means that the page never
// offers a visitor a `javascript:` or `data:` URL. The disabled fields are optional, so records
// written before takedowns existed stay valid.
const storedLink = z.object({
  url: z.url({ protocol: /^https?$/ }),
  flavor: z.custom<FlavorId>((value) => typeof value === "string" && isFlavorId(value)),
  path: z.string(),
  createdAt: z.iso.datetime(),
  disabledAt: z.iso.datetime().optional(),
  disabledReason: z.string().optional(),
});

/**
 * Returns the KV key for a stretch, which is everything after `LINK_PREFIX` in a link's path and
 * query. The key is `link:` plus the SHA-256 of the stretch in hex, because a KV key holds at
 * most 512 bytes and a stretch is longer.
 */
export async function linkKey(stretch: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stretch));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return LINK_KEY_PREFIX + hex.join("");
}

/**
 * Returns the stretch of a link's path and query, such as `landing?utm_source=x` for
 * `/to/landing?utm_source=x`. It returns `null` for a path outside `LINK_PREFIX` and for the
 * bare prefix.
 */
export function stretchOf(pathAndQuery: string): string | null {
  if (!pathAndQuery.startsWith(LINK_PREFIX) || pathAndQuery.length === LINK_PREFIX.length) {
    return null;
  }
  return pathAndQuery.slice(LINK_PREFIX.length);
}

/**
 * Reads a stored record. It returns `null` when the text isn't JSON, isn't a valid link, or holds
 * a different path than `pathAndQuery`. The record's key is a hash that already matched, so a
 * different path means that the record is wrong, not that two links share a hash.
 */
export function parseRecord(text: string, pathAndQuery: string): StretchedLink | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = storedLink.safeParse(json);
  if (!parsed.success || parsed.data.path !== pathAndQuery) {
    return null;
  }
  return parsed.data;
}

/**
 * Lowercases a hostname and drops the trailing dot of a fully qualified name, which names the
 * same host with or without it.
 */
export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

/**
 * Returns the KV key that bans a hostname: `blocked-host:` plus the normalized hostname. The
 * match is exact, so the key for `example.com` doesn't ban `www.example.com`.
 */
export function blockedHostKey(hostname: string): string {
  return BLOCKED_HOST_KEY_PREFIX + normalizeHostname(hostname);
}

/** Returns a copy of the record that is taken down as of `now`, with the reason when given. */
export function disableRecord(link: StretchedLink, now: Date, reason?: string): StretchedLink {
  const { disabledReason: _, ...rest } = link;
  return {
    ...rest,
    disabledAt: now.toISOString(),
    ...(reason === undefined ? {} : { disabledReason: reason }),
  };
}

/** Returns a copy of the record without the disabled fields, so the link works again. */
export function restoreRecord(link: StretchedLink): StretchedLink {
  const { disabledAt: _, disabledReason: __, ...rest } = link;
  return rest;
}
