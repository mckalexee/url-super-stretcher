// Tests for link storage and target validation: the round trip from `createLink` to `findLink`
// in real KV, the lookups that must miss, and every input that `parseTarget` rejects.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { HttpError } from "#lib/errors.ts";
import { FLAVORS } from "#stretch/flavors.ts";
import type { RandomSource } from "#stretch/flavors.ts";
import { createLink, findLink, LINK_PREFIX, parseTarget } from "#stretch/links.ts";

const OWN_HOSTNAME = "stretch.example.com";
const TARGET = new URL("https://example.com/some/page?q=1#part");

/**
 * The KV key for a link, worked out independently of the module: `link:` plus the hex SHA-256 of
 * the text after the prefix.
 */
async function keyFor(path: string): Promise<string> {
  const stretch = path.slice(LINK_PREFIX.length);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stretch));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return `link:${hex.join("")}`;
}

const fortyTwos: RandomSource = (bytes) => {
  bytes.fill(42);
};

function rejection(input: string): unknown {
  try {
    parseTarget(input, OWN_HOSTNAME);
  } catch (error) {
    return error;
  }
  throw new Error(`Expected parseTarget to reject ${JSON.stringify(input)}.`);
}

describe("createLink", () => {
  it.each(FLAVORS.map((flavor) => flavor.id))("stores a %s link under /to/", async (flavor) => {
    const before = Date.now();

    const link = await createLink(env.LINKS, TARGET, flavor);

    expect(link.url).toBe(TARGET.href);
    expect(link.flavor).toBe(flavor);
    expect(link.path.startsWith(LINK_PREFIX)).toBe(true);
    expect(link.path.length).toBeGreaterThanOrEqual(LINK_PREFIX.length + 600);
    expect(new Date(link.createdAt).toISOString()).toBe(link.createdAt);
    expect(Date.parse(link.createdAt)).toBeGreaterThanOrEqual(before);
  });

  it("stores the record under a key that fits the KV limit", async () => {
    const link = await createLink(env.LINKS, TARGET, "legalese");
    const key = await keyFor(link.path);

    expect(key).toMatch(/^link:[0-9a-f]{64}$/);
    await expect(env.LINKS.get(key, "json")).resolves.toEqual(link);
  });

  it("creates the same path for the same random bytes", async () => {
    const first = await createLink(env.LINKS, TARGET, "jargon", fortyTwos);
    const second = await createLink(env.LINKS, TARGET, "jargon", fortyTwos);

    expect(second.path).toBe(first.path);
  });
});

describe("findLink", () => {
  it.each(FLAVORS.map((flavor) => flavor.id))("finds a %s link by its path", async (flavor) => {
    const link = await createLink(env.LINKS, TARGET, flavor);

    await expect(findLink(env.LINKS, link.path)).resolves.toEqual(link);
  });

  it.each(FLAVORS.map((flavor) => flavor.id))(
    "finds a %s link by the pathname and search of a parsed request URL",
    async (flavor) => {
      const link = await createLink(env.LINKS, TARGET, flavor);
      const url = new URL(`https://example.com${link.path}`);

      expect(url.pathname + url.search).toBe(link.path);
      await expect(findLink(env.LINKS, url.pathname + url.search)).resolves.toEqual(link);
    },
  );

  it("keeps the query string of a tracking link", async () => {
    const link = await createLink(env.LINKS, TARGET, "tracking");
    const url = new URL(`https://example.com${link.path}`);

    expect(url.pathname).toBe("/to/landing");
    expect(url.search).toMatch(/^\?utm_source=/);
    await expect(findLink(env.LINKS, url.pathname)).resolves.toBeNull();
  });

  it("returns null for a path that was never stored", async () => {
    await expect(findLink(env.LINKS, "/to/looooooooong")).resolves.toBeNull();
  });

  it("returns null for a path outside the prefix", async () => {
    const link = await createLink(env.LINKS, TARGET, "ooo");
    const stretch = link.path.slice(LINK_PREFIX.length);

    await expect(findLink(env.LINKS, `/${stretch}`)).resolves.toBeNull();
    await expect(findLink(env.LINKS, `/from/${stretch}`)).resolves.toBeNull();
    await expect(findLink(env.LINKS, LINK_PREFIX)).resolves.toBeNull();
    await expect(findLink(env.LINKS, "")).resolves.toBeNull();
  });

  it("returns null for a path that differs by one character", async () => {
    const link = await createLink(env.LINKS, TARGET, "legalese");

    await expect(findLink(env.LINKS, link.path.slice(0, -1))).resolves.toBeNull();
    await expect(findLink(env.LINKS, `${link.path}0`)).resolves.toBeNull();
    await expect(findLink(env.LINKS, link.path.replace("whereas", "whereat"))).resolves.toBeNull();
  });

  it("returns null for a path that differs only in letter case", async () => {
    const jargon = await createLink(env.LINKS, TARGET, "jargon");
    const ooo = await createLink(env.LINKS, TARGET, "ooo");

    await expect(findLink(env.LINKS, jargon.path.toUpperCase())).resolves.toBeNull();
    await expect(findLink(env.LINKS, ooo.path.toLowerCase())).resolves.toBeNull();
    await expect(findLink(env.LINKS, ooo.path.replace(/ng$/, "NG"))).resolves.toBeNull();
  });

  it("returns null for a record that isn't JSON", async () => {
    const path = "/to/corrupt-not-json";
    await env.LINKS.put(await keyFor(path), "{not json");

    await expect(findLink(env.LINKS, path)).resolves.toBeNull();
  });

  it.each([
    ["isn't an object", "just a string"],
    ["lacks a field", { url: TARGET.href, flavor: "ooo", path: "/to/corrupt-shape" }],
    [
      "names an unknown flavor",
      {
        url: TARGET.href,
        flavor: "emoji",
        path: "/to/corrupt-shape",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    [
      "has a timestamp that isn't ISO 8601",
      { url: TARGET.href, flavor: "ooo", path: "/to/corrupt-shape", createdAt: "yesterday" },
    ],
    [
      "redirects to a scheme other than http or https",
      {
        url: "javascript:alert(1)",
        flavor: "ooo",
        path: "/to/corrupt-shape",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    [
      "holds a different path",
      {
        url: TARGET.href,
        flavor: "ooo",
        path: "/to/another-path",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  ])("returns null for a record that %s", async (_, record) => {
    const path = "/to/corrupt-shape";
    await env.LINKS.put(await keyFor(path), JSON.stringify(record));

    await expect(findLink(env.LINKS, path)).resolves.toBeNull();
  });

  it("returns a hand-written record that is valid", async () => {
    // This guards the corrupt-record tests: they fail for the reason they name only if the same
    // record without the fault is found.
    const path = "/to/hand-written";
    const record = {
      url: TARGET.href,
      flavor: "ooo",
      path,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await env.LINKS.put(await keyFor(path), JSON.stringify(record));

    await expect(findLink(env.LINKS, path)).resolves.toEqual(record);
  });
});

describe("parseTarget", () => {
  it("returns the parsed URL", () => {
    const url = parseTarget("https://example.com/a?b=c#d", OWN_HOSTNAME);

    expect(url).toBeInstanceOf(URL);
    expect(url.href).toBe("https://example.com/a?b=c#d");
  });

  it("accepts http", () => {
    expect(parseTarget("http://example.com/", OWN_HOSTNAME).href).toBe("http://example.com/");
  });

  it("trims the input", () => {
    expect(parseTarget("  https://example.com/a \n", OWN_HOSTNAME).href).toBe(
      "https://example.com/a",
    );
  });

  it.each([
    ["example.com", "https://example.com/"],
    ["example.com/some/page?q=1", "https://example.com/some/page?q=1"],
    ["www.example.com:8443/x", "https://www.example.com:8443/x"],
    ["  example.org  ", "https://example.org/"],
  ])("adds https:// to the scheme-less input %j", (input, expected) => {
    expect(parseTarget(input, OWN_HOSTNAME).href).toBe(expected);
  });

  it.each([
    ["empty input", ""],
    ["input that is only whitespace", " \n\t "],
    ["text that isn't a URL", "not a url"],
    ["a single word", "example"],
    ["a URL without a host", "https://"],
    ["a mailto URL", "mailto:someone@example.com"],
    ["a javascript URL", "javascript:alert(1)"],
    ["an ftp URL", "ftp://example.com/file"],
    ["a file URL", "file:///etc/hosts"],
    ["a URL with a username and password", "https://user:secret@example.com/"],
    ["a URL with only a username", "https://user@example.com/"],
    ["a scheme-less URL with credentials", "user:secret@example.com"],
    ["a URL longer than 2,048 characters", `https://example.com/${"a".repeat(2048)}`],
    ["a URL on this site", `https://${OWN_HOSTNAME}/to/looooong`],
    ["a scheme-less URL on this site", `${OWN_HOSTNAME}/to/looooong`],
    ["a URL on this site in another letter case", "https://STRETCH.Example.com/"],
    ["a URL on this site with a trailing dot", `https://${OWN_HOSTNAME}./`],
    ["a URL on this site with a port", `http://${OWN_HOSTNAME}:8080/`],
  ])("rejects %s with a 400", (_, input) => {
    const error = rejection(input);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 400 });
    expect(error).toHaveProperty("message", expect.stringMatching(/\S/));
  });

  it("says what's wrong in each message", () => {
    expect(rejection("")).toHaveProperty("message", expect.stringContaining("nothing"));
    expect(rejection("not a url")).toHaveProperty(
      "message",
      expect.stringContaining("doesn't look like a URL"),
    );
    expect(rejection("ftp://example.com/")).toHaveProperty(
      "message",
      expect.stringContaining("http and https"),
    );
    expect(rejection("https://user:secret@example.com/")).toHaveProperty(
      "message",
      expect.stringContaining("username or password"),
    );
    expect(rejection(`https://example.com/${"a".repeat(2048)}`)).toHaveProperty(
      "message",
      expect.stringContaining("2,048"),
    );
    expect(rejection(`https://${OWN_HOSTNAME}/`)).toHaveProperty(
      "message",
      expect.stringContaining("this site"),
    );
  });

  it("keeps the rejected input out of the message", () => {
    expect(rejection("https://user:secret@example.com/")).toHaveProperty(
      "message",
      expect.not.stringContaining("secret"),
    );
  });

  it("accepts a URL of exactly 2,048 characters", () => {
    const input = `https://example.com/${"a".repeat(2048 - "https://example.com/".length)}`;

    expect(parseTarget(input, OWN_HOSTNAME).href).toHaveLength(2048);
  });

  it("accepts a different host that contains this site's name", () => {
    expect(parseTarget(`https://not-${OWN_HOSTNAME}/`, OWN_HOSTNAME).hostname).toBe(
      `not-${OWN_HOSTNAME}`,
    );
  });
});
