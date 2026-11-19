// Tests that the Worker server-renders the home page and its form, that the form's action
// stretches a link or re-renders the form with a message, that responses carry the security
// headers, and that an unknown path renders the error page.
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FLAVORS } from "#stretch/flavors.ts";

import { longLinkIn, submitStretchForm } from "../helpers/stretch.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("GET an unknown path", () => {
  it("renders a 404 page with fixed text", async () => {
    const response = await exports.default.fetch("http://example.com/no-such-page");

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("This page doesn&#x27;t exist.");
  });
});
