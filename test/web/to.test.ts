// Tests for the page of a stretched link: it shows the destination and never redirects, it
// answers 404 for a path that isn't a stored link, 410 for a link that was taken down, and 403
// for a destination on the security blocklist, and every answer tells caches and crawlers to
// keep away.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { FLAVORS } from "#stretch/flavors.ts";
import { createLink } from "#stretch/links.ts";
import { blockedHostKey, disableRecord, linkKey, stretchOf } from "#stretch/records.ts";
import type { StretchedLink } from "#stretch/records.ts";

import { AUD, createAccessIssuer, useAccessVars, useWebAccess } from "../helpers/access.ts";
import { captureLogs, eventsIn } from "../helpers/logs.ts";
import { resolver, unreachableResolver, useResolver } from "../helpers/reputation.ts";
import { longLinkIn, submitStretchForm } from "../helpers/stretch.ts";

const TARGET = "https://example.org/docs/page?ref=a%20b&id=42#section-3";
const ORIGIN = "http://example.com";

const network = useResolver();
const setAccessVars = useAccessVars();
const setWebAccess = useWebAccess();

afterEach(() => {
  vi.restoreAllMocks();
});

function view(path: string): Promise<Response> {
  return exports.default.fetch(ORIGIN + path, { redirect: "manual" });
}

// React writes `&` in text and attributes as an entity.
function inHtml(text: string): string {
  return text.replaceAll("&", "&amp;");
}

// The page lets a hostname wrap before each dot.
function hostInHtml(hostname: string): string {
  return hostname.replaceAll(".", "<wbr/>.");
}

async function disable(link: StretchedLink, reason?: string): Promise<void> {
  const record = disableRecord(link, new Date(), reason);
  await env.LINKS.put(await linkKey(stretchOf(link.path)!), JSON.stringify(record));
}

// In the flavors without a query string, the path is the whole link, and whoever has the link
// can see where it leads. So no log line may hold the path, the stretch, or the ID in it.
function expectLinkNotLogged(lines: string[], path: string): void {
  const written = lines.join("\n");
  expect(written).not.toContain(path);
  expect(written).not.toContain(path.slice("/to/".length));
  // The jargon and legalese flavors end with the ID as 32 hexadecimal digits. In the ooo flavor
  // the whole stretch is the ID.
  const id = /[0-9a-f]{32}$/.exec(path)?.[0] ?? path.slice("/to/".length);
  expect(written).not.toContain(id);
  // Whatever follows the prefix in a logged path is the fixed text.
  expect(written).not.toMatch(/\/to\/[^*]/);
}

function expectLinkHeaders(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
}

describe("GET /to/* for a stored link", () => {
  it.for(FLAVORS.map((flavor) => flavor.id))(
    "shows the destination of a %s link and doesn't redirect",
    async (id) => {
      const link = await createLink(env.LINKS, new URL(TARGET), id);

      const response = await view(link.path);

      expect(response.status).toBe(200);
      expect(response.headers.get("Location")).toBeNull();
      expect(response.headers.get("Refresh")).toBeNull();
      expect(response.headers.get("content-type")).toContain("text/html");
      const page = await response.text();
      expect(page).not.toMatch(/http-equiv/i);
      expect(page).toContain(`data-testid="destination-host">${hostInHtml("example.org")}</span>`);
      expect(page).toContain(`data-testid="destination-url">${inHtml(TARGET)}</p>`);
    },
  );

  it("offers the destination as a plain link that sends no referrer", async () => {
    const link = await createLink(env.LINKS, new URL(TARGET), "jargon");

    const page = await (await view(link.path)).text();

    expect(page).toContain(
      `<a class="button button-solid" href="${inHtml(TARGET)}" rel="noreferrer nofollow">Continue</a>`,
    );
    // The destination appears as a link once, and nowhere else as an address to load.
    expect(page.split(`href="${inHtml(TARGET)}"`)).toHaveLength(2);
  });

  it("reports the length of the link that the visitor followed", async () => {
    const link = await createLink(env.LINKS, new URL(TARGET), "ooo");

    const page = await (await view(link.path)).text();

    const length = new Intl.NumberFormat("en-US").format((ORIGIN + link.path).length);
    // React separates a text node from the expression before it with an empty comment.
    expect(page).toContain(`This link is <!-- -->${length}<!-- --> characters long.`);
  });

  it("tells caches and crawlers to keep away, and keeps the security headers", async () => {
    const link = await createLink(env.LINKS, new URL(TARGET), "jargon");

    const response = await view(link.path);

    expectLinkHeaders(response);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("sends the same headers with the route's data response", async () => {
    const link = await createLink(env.LINKS, new URL(TARGET), "ooo");

    const response = await view(`${link.path}.data`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expectLinkHeaders(response);
  });

  it("links a report to the abuse address with the long link in the body", async () => {
    const link = await createLink(env.LINKS, new URL(TARGET), "tracking");
    const longLink = ORIGIN + link.path;
    expect(longLink).toContain("&");

    const page = await (await view(link.path)).text();

    const href = /<a href="(mailto:[^"]+)">Report this link<\/a>/.exec(page)?.[1];
    expect(href).toBeDefined();
    const mail = new URL(href!.replaceAll("&amp;", "&"));
    expect(mail.pathname).toBe(env.ABUSE_EMAIL);
    expect(mail.searchParams.get("subject")).toBe("Report a stretched link");
    expect(mail.searchParams.get("body")).toContain(`\r\n${longLink}\r\n`);
    // Encoded as a `mailto` URL wants it: no `+` for a space, and no bare `&` from the link.
    expect(href).toContain("subject=Report%20a%20stretched%20link&amp;body=Link%3A%0D%0A");
    expect(href).toContain(encodeURIComponent(longLink));
  });

  it("shows a link that the home page's form created", async () => {
    const created = await submitStretchForm({ url: TARGET, flavor: "tracking" });
    const longLink = longLinkIn(await created.text());

    const response = await exports.default.fetch(longLink, { redirect: "manual" });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`data-testid="destination-url">${inHtml(TARGET)}</p>`);
  });

  it("stays public on a private site", async () => {
    const issuer = await createAccessIssuer();
    setWebAccess("private");
    setAccessVars(issuer.teamDomain, AUD);
    const link = await createLink(env.LINKS, new URL(TARGET), "ooo");

    const response = await view(link.path);

    expect(response.status).toBe(200);
  });
});

describe("GET /to/* for an internationalized destination", () => {
  it("shows the ASCII form of the name with a warning", async () => {
    const link = await createLink(env.LINKS, new URL("https://exämple.org/"), "ooo");

    const page = await (await view(link.path)).text();

    expect(page).toContain(
      `data-testid="destination-host">${hostInHtml("xn--exmple-cua.org")}</span>`,
    );
    expect(page).toContain("This name contains non-Latin characters");
    expect(page).toContain("can imitate other sites");
    expect(page).not.toContain("exämple");
  });

  it("shows no warning for an ASCII name", async () => {
    const link = await createLink(env.LINKS, new URL("https://xn.example.org/"), "ooo");

    const page = await (await view(link.path)).text();

    expect(page).not.toContain("non-Latin");
  });
});

describe("GET /to/* for a path that isn't a stored link", () => {
  it("renders the 404 page with the note about a missing part", async () => {
    const response = await view("/to/leveraging-nothing-in-particular");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expectLinkHeaders(response);
    const page = await response.text();
    expect(page).toContain("<h1>404</h1><p>This page doesn&#x27;t exist.</p>");
    expect(page).toContain("If you followed a stretched link, part of it is missing.");
  });

  it("needs the query string of a tracking link", async () => {
    const link = await createLink(env.LINKS, new URL(TARGET), "tracking");
    expect(link.path).toContain("?");

    const response = await view(link.path.slice(0, link.path.indexOf("?")));

    expect(response.status).toBe(404);
  });

  it("renders the 404 page for the bare prefix, with and without the slash", async () => {
    expect((await view("/to/")).status).toBe(404);
    expect((await view("/to")).status).toBe(404);
  });
});

describe("GET /to/* for a destination on the security blocklist", () => {
  const flagged = "https://malware.example/secret-path?x=1";
  let link: StretchedLink;

  beforeAll(async () => {
    link = await createLink(env.LINKS, new URL(flagged), "jargon");
  });

  it("answers 403 with the hostname as text and no link to the destination", async () => {
    network.use(resolver("malware.example"));

    const response = await view(link.path);

    expect(response.status).toBe(403);
    expect(response.headers.get("Location")).toBeNull();
    expectLinkHeaders(response);
    const page = await response.text();
    expect(page).toContain("<h1>Link blocked</h1>");
    expect(page).toContain("on a security blocklist");
    expect(page).toContain(`data-testid="blocked-host">${hostInHtml("malware.example")}</p>`);
    expect(page).not.toContain("secret-path");
    expect(page).not.toContain('href="https://malware.example');
    expect(page).not.toContain(">Continue<");
    expect(page).toMatch(
      /<a href="mailto:abuse@jade\.email\?[^"]+">Report a problem with this link<\/a>/,
    );
  });

  it("checks on every view, so a link made earlier is blocked once its name is flagged", async () => {
    expect((await view(link.path)).status).toBe(200);

    network.use(resolver("malware.example"));

    expect((await view(link.path)).status).toBe(403);
  });

  it("logs the hostname of a blocked view, and neither the URL nor the link", async () => {
    const logs = captureLogs();
    network.use(resolver("malware.example"));

    await view(link.path);

    const lines = logs();
    expect(eventsIn(lines, "stretch.view_blocked")).toEqual([
      { level: "info", event: "stretch.view_blocked", hostname: "malware.example" },
    ]);
    expect(eventsIn(lines, "http.request")).toEqual([
      expect.objectContaining({ method: "GET", path: "/to/*", status: 403 }),
    ]);
    expect(lines.join("\n")).not.toContain("secret-path");
    expectLinkNotLogged(lines, link.path);
  });

  it("answers the route's data request with 403 and no URL", async () => {
    network.use(resolver("malware.example"));

    const response = await view(`${link.path}.data`);

    expect(response.status).toBe(403);
    expect(response.headers.get("Location")).toBeNull();
    expectLinkHeaders(response);
    const body = await response.text();
    expect(body).toContain('"flagged"');
    expect(body).toContain('"malware.example"');
    expect(body).not.toContain("secret-path");
    expect(body).not.toContain("https://malware.example");
  });
});

describe("the logs of a view", () => {
  it.for(["jargon", "legalese", "ooo"] as const)(
    "leave out the path of a %s link that is shown",
    async (id) => {
      const link = await createLink(env.LINKS, new URL(TARGET), id);
      expect(link.path).not.toContain("?");
      const logs = captureLogs();

      const responses = [await view(link.path), await view(`${link.path}.data`)];

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const lines = logs();
      expect(eventsIn(lines, "http.request")).toEqual([
        expect.objectContaining({ path: "/to/*", status: 200 }),
        expect.objectContaining({ path: "/to/*", status: 200 }),
      ]);
      expectLinkNotLogged(lines, link.path);
    },
  );

  it("leave out the path of a link that isn't stored", async () => {
    // A link that lost its last character is still most of a link.
    const link = await createLink(env.LINKS, new URL(TARGET), "jargon");
    const path = link.path.slice(0, -1);
    const logs = captureLogs();

    const response = await view(path);

    expect(response.status).toBe(404);
    const lines = logs();
    expect(eventsIn(lines, "http.request")).toEqual([
      expect.objectContaining({ path: "/to/*", status: 404 }),
    ]);
    expectLinkNotLogged(lines, path);
  });

  it("leave out the path of a link whose lookup fails", async () => {
    const link = await createLink(env.LINKS, new URL(TARGET), "legalese");
    vi.spyOn(env.LINKS, "get").mockRejectedValue(new Error("The namespace is down."));
    const logs = captureLogs();

    const response = await view(link.path);

    expect(response.status).toBe(500);
    const lines = logs();
    expect(eventsIn(lines, "ssr.unhandled_error")).toEqual([
      expect.objectContaining({ level: "error", path: "/to/*" }),
    ]);
    expect(eventsIn(lines, "http.request")).toEqual([
      expect.objectContaining({ path: "/to/*", status: 500 }),
    ]);
    expectLinkNotLogged(lines, link.path);
  });
});

describe("GET /to/* for a link that was taken down", () => {
  const removed = "https://removed.example/landing";

  it("answers 410 for a disabled link and names no destination", async () => {
    const link = await createLink(env.LINKS, new URL(removed), "legalese");
    await disable(link, "phishing");

    const response = await view(link.path);

    expect(response.status).toBe(410);
    expect(response.headers.get("Location")).toBeNull();
    expectLinkHeaders(response);
    const page = await response.text();
    expect(page).toContain("<h1>Link removed</h1>");
    expect(page).toContain("This link was removed after an abuse report.");
    expect(page).not.toContain("removed.example");
    expect(page).not.toContain("phishing");
    expect(page).not.toContain(">Continue<");
  });

  it("answers the route's data request with 410 and no destination", async () => {
    const link = await createLink(env.LINKS, new URL(removed), "legalese");
    await disable(link, "phishing");

    const response = await view(`${link.path}.data`);

    expect(response.status).toBe(410);
    expect(response.headers.get("Location")).toBeNull();
    expectLinkHeaders(response);
    const body = await response.text();
    expect(body).toContain('"removed"');
    expect(body).not.toContain("removed.example");
    expect(body).not.toContain("phishing");
  });

  it("answers 410 for a stored hostname that isn't valid, without a lookup", async () => {
    // A second trailing dot would dodge a ban's exact match and the resolver's judgment, so the
    // page never shows such a destination, however its record came to exist.
    const link = await createLink(env.LINKS, new URL("https://example.org/"), "ooo");
    const record = { ...link, url: "https://banned.example.org../landing" };
    await env.LINKS.put(await linkKey(stretchOf(link.path)!), JSON.stringify(record));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    network.use(unreachableResolver);

    const response = await view(link.path);

    expect(response.status).toBe(410);
    expect(await response.text()).not.toContain("banned.example.org");
    expect(warn).not.toHaveBeenCalled();
  });

  it("answers 410 for every link to a blocked hostname", async () => {
    const first = await createLink(env.LINKS, new URL("https://banned.example/a"), "ooo");
    const second = await createLink(env.LINKS, new URL("https://banned.example/b"), "tracking");
    await env.LINKS.put(blockedHostKey("banned.example"), "{}");

    const responses = await Promise.all([view(first.path), view(second.path)]);

    expect(responses.map((response) => response.status)).toEqual([410, 410]);
    const pages = await Promise.all(responses.map((response) => response.text()));
    expect(pages.join("\n")).not.toContain("banned.example");
  });

  it("doesn't ask the resolver about a link that was taken down", async () => {
    const link = await createLink(env.LINKS, new URL(removed), "ooo");
    await disable(link);
    // With the resolver down, a lookup would log a warning.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    network.use(unreachableResolver);

    await view(link.path);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("when the resolver is down", () => {
  it("still creates a link and still shows its destination", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    network.use(unreachableResolver);

    const created = await submitStretchForm({ url: TARGET, flavor: "legalese" });

    expect(created.status).toBe(200);
    const longLink = longLinkIn(await created.text());

    const response = await exports.default.fetch(longLink, { redirect: "manual" });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`href="${inHtml(TARGET)}"`);
    const failures = warn.mock.calls.filter(([line]) =>
      String(line).includes('"reputation.check_failed"'),
    );
    expect(failures).toHaveLength(2);
  });
});
