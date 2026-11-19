// Redirect route for stretched links. It resolves a long link from KV storage and sends the
// visitor to the original URL, which is the one thing a stretched link has to keep doing.
import { Hono } from "hono";

import { findLink, LINK_PREFIX } from "#stretch/links.ts";

/**
 * Routes for `GET /to/*`. A stored link answers with a redirect. Any other path under the prefix
 * falls through to the next handler, so the web app renders its 404 page for it.
 */
export const linkRoutes = new Hono<{ Bindings: Env }>().get(`${LINK_PREFIX}*`, async (c, next) => {
  const { pathname, search } = new URL(c.req.url);
  const link = await findLink(c.env.LINKS, pathname + search);
  if (!link) {
    return next();
  }
  // A cached redirect would outlive the link's record, and a shared cache could key it on less
  // than the whole query string, which is part of the link.
  c.header("Cache-Control", "no-store");
  return c.redirect(link.url, 302);
});
