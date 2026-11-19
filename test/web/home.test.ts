// Tests that the Worker server-renders the home page and its form, that the form's action
// stretches a link or re-renders the form with a message, that it turns away blocklisted and
// banned destinations and clients over the rate limit, that responses carry the security headers,
// and that an unknown path renders the error page.
import { env, exports } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FLAVORS } from "#stretch/flavors.ts";
import { blockedHostKey } from "#stretch/records.ts";

import { cleanAnswer, RESOLVER_URL, resolver, useResolver } from "../helpers/reputation.ts";
import { longLinkIn, submitStretchForm } from "../helpers/stretch.ts";

const network = useResolver();
const realLimiter = env.CREATE_LIMITER;

afterEach(() => {
  vi.restoreAllMocks();
  env.CREATE_LIMITER = realLimiter;
});

/**
 * Replaces the rate limiter with one that gives a fixed answer and records the key of each call.
 * The real binding counts in windows aligned to the wall clock, so a test can't drive it over
 * its limit at a known request.
 */
function useFakeLimiter(success: boolean): string[] {
  const keys: string[] = [];
  env.CREATE_LIMITER = {
    limit({ key }) {
      keys.push(key);
      return Promise.resolve({ success });
    },
  };
  return keys;
}

/** Replaces the resolver with a clean one that counts its lookups. */
function countLookups(): { count: number } {
  const lookups = { count: 0 };
  network.use(
    http.get(RESOLVER_URL, () => {
      lookups.count += 1;
      return HttpResponse.json(cleanAnswer("example.org"));
    }),
  );
  return lookups;
}

describe("GET /", () => {
  it("renders the form with the URL field and every flavor", async () => {
    const response = await exports.default.fetch("http://example.com/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const page = await response.text();
    expect(page).toContain('<label class="field-label" for="url">');
    expect(page).toContain('name="url"');
    for (const flavor of FLAVORS) {
      expect(page).toContain(`value="${flavor.id}"`);
      expect(page).toContain(flavor.name);
    }
  });

  it("selects exactly one flavor by default", async () => {
    const response = await exports.default.fetch("http://example.com/");

    expect((await response.text()).match(/ checked=""/g)).toHaveLength(1);
  });

  it("links the footer to the abuse address from the ABUSE_EMAIL var", async () => {
    const response = await exports.default.fetch("http://example.com/");

    expect(env.ABUSE_EMAIL).toBe("abuse@jade.email");
    expect(await response.text()).toContain('<a href="mailto:abuse@jade.email">Report abuse</a>');
  });

  it("doesn't count against the creation rate limit", async () => {
    const keys = useFakeLimiter(true);

    await exports.default.fetch("http://example.com/");

    expect(keys).toEqual([]);
  });

  it("sends the security headers without a policy that would block hydration", async () => {
    const response = await exports.default.fetch("http://example.com/");

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
  });
});

describe("POST /", () => {
  it.for(FLAVORS.map((flavor) => flavor.id))("stretches a link in the %s flavor", async (id) => {
    const response = await submitStretchForm({ url: "https://example.org/a?b=1", flavor: id });

    expect(response.status).toBe(200);
    const page = await response.text();
    const longLink = longLinkIn(page);
    expect(longLink.startsWith("http://example.com/to/")).toBe(true);
    expect(longLink.length).toBeGreaterThan(600);
    expect(page).toContain("Elongation report");
  });

  it("reports the lengths that the server measured", async () => {
    const target = "https://example.org/";
    const response = await submitStretchForm({ url: target, flavor: "ooo" });

    const page = await response.text();
    const longLink = longLinkIn(page);
    const format = new Intl.NumberFormat("en-US");
    // React separates a text node from the expression before it with an empty comment.
    expect(page).toContain(`<td>${target.length}<!-- --> characters</td>`);
    expect(page).toContain(`<td>${format.format(longLink.length)}<!-- --> characters</td>`);
    expect(page).toContain(`<td>${format.format(longLink.length - target.length)}</td>`);
    expect(page).toContain(`<td>${Math.ceil(longLink.length / 280)}</td>`);
  });

  it("adds https to a bare hostname", async () => {
    const response = await submitStretchForm({ url: "example.org", flavor: "jargon" });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<td>20<!-- --> characters</td>");
  });

  it("logs the flavor and the lengths, and neither URL", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await submitStretchForm({
      url: "https://example.org/reset?token=secret-value",
      flavor: "tracking",
    });
    const longLink = longLinkIn(await response.text());

    const lines = info.mock.calls.map(([line]) => String(line));
    const created = lines.filter((line) => line.includes('"stretch.link_created"'));
    expect(created).toHaveLength(1);
    expect(JSON.parse(created[0]!)).toEqual({
      level: "info",
      event: "stretch.link_created",
      flavor: "tracking",
      originalLength: 44,
      stretchedLength: longLink.length,
    });
    expect(lines.join("\n")).not.toContain("secret-value");
  });

  it.for([
    ["an empty field", "", "There&#x27;s nothing here to stretch."],
    ["text that isn't a URL", "not a url", "That doesn&#x27;t look like a URL."],
    ["a scheme other than http or https", "ftp://example.org/file", "Only http and https links"],
    [
      "a URL with credentials",
      "https://ada:pw@example.org/",
      "That URL contains a username or password.",
    ],
    [
      "a URL that is too long",
      `https://example.org/${"a".repeat(2048)}`,
      "That URL is longer than 2,048 characters.",
    ],
    ["a URL on this site", "http://example.com/to/anything", "That URL points at this site."],
    ["an IP address", "http://192.0.2.7/login", "That URL uses an IP address instead of a name."],
    ["an IPv6 address", "http://[2001:db8::1]/", "That URL uses an IP address instead of a name."],
    ["a private-network name", "http://router.local/", "That URL points at a private network."],
  ] as const)("rejects %s with status 400 and keeps the input", async ([, input, message]) => {
    const response = await submitStretchForm({ url: input, flavor: "legalese" });

    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain(`<p class="field-error" id="url-error">${message}`);
    expect(page).toContain('aria-invalid="true"');
    expect(page).toContain('aria-describedby="url-error url-hint"');
    expect(page).toContain(`value="${input}"`);
    // The flavor that the visitor chose stays chosen.
    expect(page).toMatch(/<input type="radio" name="flavor" checked="" value="legalese"\/>/);
    expect(page).not.toContain("Elongation report");
  });

  it("rejects an unknown flavor with status 400 and keeps the URL", async () => {
    const response = await submitStretchForm({ url: "https://example.org/", flavor: "brevity" });

    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain('<p class="field-error" id="flavor-error">Choose one of the listed');
    expect(page).toContain('value="https://example.org/"');
    expect(page).not.toContain("Elongation report");
  });

  it("rejects a submission without a flavor", async () => {
    const response = await submitStretchForm({ url: "https://example.org/" });

    expect(response.status).toBe(400);
  });
});

describe("POST / with a destination that isn't allowed", () => {
  it("rejects a destination on the security blocklist with status 400", async () => {
    network.use(resolver("malware.example"));

    const response = await submitStretchForm({
      url: "https://malware.example/install",
      flavor: "ooo",
    });

    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain(
      '<p class="field-error" id="url-error">That destination is on a security blocklist.',
    );
    expect(page).toContain('value="https://malware.example/install"');
    expect(page).not.toContain("Elongation report");
  });

  it("asks the resolver about the hostname only", async () => {
    const names: (string | null)[] = [];
    network.use(
      http.get(RESOLVER_URL, ({ request }) => {
        names.push(new URL(request.url).searchParams.get("name"));
        return HttpResponse.json(cleanAnswer("example.org"));
      }),
    );

    await submitStretchForm({ url: "https://Example.org:8443/a?token=secret", flavor: "ooo" });

    expect(names).toEqual(["example.org"]);
  });

  it("rejects a destination on a blocked hostname with status 400, without a lookup", async () => {
    await env.LINKS.put(blockedHostKey("banned.example"), "{}");
    const lookups = countLookups();

    const response = await submitStretchForm({ url: "https://Banned.example/x", flavor: "ooo" });

    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain(
      '<p class="field-error" id="url-error">Links to that destination were removed after a report',
    );
    expect(page).not.toContain("Elongation report");
    expect(lookups.count).toBe(0);
  });

  it("stretches a link to a subdomain of a blocked hostname, because the match is exact", async () => {
    await env.LINKS.put(blockedHostKey("banned.example"), "{}");

    const response = await submitStretchForm({ url: "https://www.banned.example/", flavor: "ooo" });

    expect(response.status).toBe(200);
  });
});

describe("POST / and the creation rate limit", () => {
  it("answers 429 with the input kept, before the reputation lookup and the write", async () => {
    useFakeLimiter(false);
    const lookups = countLookups();
    const put = vi.spyOn(env.LINKS, "put");

    const response = await submitStretchForm({ url: "https://example.org/kept", flavor: "jargon" });

    expect(response.status).toBe(429);
    const page = await response.text();
    expect(page).toContain(
      '<p class="field-error" id="url-error">That&#x27;s more than five links in a minute',
    );
    expect(page).toContain("Wait a minute, then stretch again.");
    expect(page).toContain('value="https://example.org/kept"');
    expect(page).toMatch(/<input type="radio" name="flavor" checked="" value="jargon"\/>/);
    expect(page).not.toContain("Elongation report");
    expect(lookups.count).toBe(0);
    expect(put).not.toHaveBeenCalled();
  });

  it("keys the limit on the CF-Connecting-IP header", async () => {
    const keys = useFakeLimiter(true);

    await submitStretchForm({ url: "https://example.org/", flavor: "ooo" }, "203.0.113.9");

    expect(keys).toEqual(["203.0.113.9"]);
  });

  it("uses one fixed key for requests without the header", async () => {
    const keys = useFakeLimiter(true);

    await submitStretchForm({ url: "https://example.org/", flavor: "ooo" }, null);
    await submitStretchForm({ url: "https://example.org/", flavor: "ooo" }, null);

    expect(keys).toEqual(["unknown", "unknown"]);
  });

  it("doesn't count a submission that could never create a link", async () => {
    const keys = useFakeLimiter(true);

    await submitStretchForm({ url: "not a url", flavor: "ooo" });
    await submitStretchForm({ url: "http://192.0.2.7/", flavor: "ooo" });
    await submitStretchForm({ url: "https://example.org/", flavor: "brevity" });

    expect(keys).toEqual([]);
  });

  it("limits one client to five links a minute with the real binding", async () => {
    const client = `limited-${crypto.randomUUID()}`;
    // The binding's window is aligned to the clock, so a new minute can start partway through.
    // Eleven requests can't all fit in two windows of five, whenever the window turns.
    const responses = await Promise.all(
      Array.from({ length: 11 }, () =>
        submitStretchForm({ url: "https://example.org/", flavor: "ooo" }, client),
      ),
    );
    const statuses = responses.map((response) => response.status);
    await Promise.all(responses.map((response) => response.text()));

    const created = statuses.filter((status) => status === 200).length;
    expect(created).toBeGreaterThanOrEqual(5);
    expect(created).toBeLessThanOrEqual(10);
    expect(statuses.filter((status) => status === 429)).toHaveLength(11 - created);
  });

  it("gives each client its own allowance with the real binding", async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        submitStretchForm({ url: "https://example.org/", flavor: "ooo" }),
      ),
    );
    const statuses = responses.map((response) => response.status);
    await Promise.all(responses.map((response) => response.text()));

    expect(statuses).toEqual(Array.from({ length: 8 }, () => 200));
  });
});

describe("GET an unknown path", () => {
  it("renders a 404 page with fixed text", async () => {
    const response = await exports.default.fetch("http://example.com/no-such-page");

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("This page doesn&#x27;t exist.");
  });
});
