// Helpers for tests that stretch a link through the home page's form, the way a browser without
// JavaScript does.
import { exports } from "cloudflare:workers";

let clients = 0;

/**
 * Submits the home page's form as a URL-encoded document request and returns the response. The
 * path carries `?index`, as the form's `action` attribute does, because that's how React Router
 * tells the index route's action from the root route's.
 *
 * Each call comes from a new client address unless you pass `client`, so the creation rate limit
 * never rejects a test that isn't about it. Pass the same `client` to several calls to share one
 * allowance, or `null` to send no `CF-Connecting-IP` header.
 */
export function submitStretchForm(
  fields: Record<string, string>,
  client?: string | null,
): Promise<Response> {
  clients += 1;
  const address = client === undefined ? `test-client-${clients}-${crypto.randomUUID()}` : client;
  return exports.default.fetch("http://example.com/?index", {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: address === null ? {} : { "CF-Connecting-IP": address },
  });
}

/** Reads the long link from the result view of a rendered page. */
export function longLinkIn(page: string): string {
  const match = /data-testid="long-link">([^<]+)</.exec(page);
  if (!match?.[1]) {
    throw new Error("The page has no long link.");
  }
  // React escapes the `&` between the query parameters of a tracking link.
  return match[1].replaceAll("&amp;", "&");
}
