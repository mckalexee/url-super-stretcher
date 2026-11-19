// Tests for the redirect route: a stretched link redirects to its exact target, and a path under
// the prefix that was never stored falls through to the web app's 404 page.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { FLAVORS } from "#stretch/flavors.ts";
import { createLink } from "#stretch/links.ts";

import { longLinkIn, submitStretchForm } from "../helpers/stretch.ts";

const TARGET = "https://example.org/docs/page?ref=a%20b&id=42#section-3";

function follow(path: string): Promise<Response> {
  return exports.default.fetch(`http://example.com${path}`, { redirect: "manual" });
}

describe("GET /to/*", () => {
  it.for(FLAVORS.map((flavor) => flavor.id))(
    "redirects a %s link to its exact target",
    async (id) => {
      const link = await createLink(env.LINKS, new URL(TARGET), id);

      const response = await follow(link.path);

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(TARGET);
    },
  );

  it("needs the query string of a tracking link", async () => {
    const link = await createLink(env.LINKS, new URL(TARGET), "tracking");
    expect(link.path).toContain("?");

    const response = await follow(link.path.slice(0, link.path.indexOf("?")));

    expect(response.status).toBe(404);
  });

  it("tells caches not to store the redirect, and keeps the security headers", async () => {
    const link = await createLink(env.LINKS, new URL(TARGET), "jargon");

    const response = await follow(link.path);

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("redirects a link that the home page's form created", async () => {
    const created = await submitStretchForm({ url: TARGET, flavor: "tracking" });
    const longLink = longLinkIn(await created.text());

    const response = await exports.default.fetch(longLink, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(TARGET);
  });

  it("renders the 404 page for a link that was never stored", async () => {
    const response = await follow("/to/leveraging-nothing-in-particular");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    const page = await response.text();
    expect(page).toContain("<h1>404</h1><p>This page doesn&#x27;t exist.</p>");
    expect(page).toContain("If this was a stretched link, some of it is missing.");
  });

  it("renders the 404 page for the bare prefix", async () => {
    const response = await follow("/to/");

    expect(response.status).toBe(404);
  });
});
