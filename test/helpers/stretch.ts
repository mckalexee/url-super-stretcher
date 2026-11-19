// Helpers for tests that stretch a link through the home page's form, the way a browser without
// JavaScript does.
import { exports } from "cloudflare:workers";

/**
 * Submits the home page's form as a URL-encoded document request and returns the response. The
 * path carries `?index`, as the form's `action` attribute does, because that's how React Router
 * tells the index route's action from the root route's.
 */
export function submitStretchForm(fields: Record<string, string>): Promise<Response> {
  return exports.default.fetch("http://example.com/?index", {
    method: "POST",
    body: new URLSearchParams(fields),
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
