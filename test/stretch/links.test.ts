// Tests for link storage and target validation: the round trip from `createLink` to `findLink`
// in real KV, the lookups that must miss, the links that `resolveLink` reports as removed, and
// every input that `parseTarget` rejects.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { HttpError } from "#lib/errors.ts";
import { FLAVORS } from "#stretch/flavors.ts";
import type { RandomSource } from "#stretch/flavors.ts";
import { createLink, findLink, isHostBlocked, parseTarget, resolveLink } from "#stretch/links.ts";
import { LINK_PREFIX } from "#stretch/prefix.ts";
import { blockedHostKey, disableRecord } from "#stretch/records.ts";

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

const LABEL_63 = "a".repeat(63);
// Three labels of 63 characters, three dots, and four characters of `.com` leave 57 for the
// fourth label of a name that is exactly 253 characters long.
const NAME_253 = `${LABEL_63}.${LABEL_63}.${LABEL_63}.${"a".repeat(57)}.com`;

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

describe("resolveLink", () => {
  it("reports a stored link as active", async () => {
    const link = await createLink(env.LINKS, TARGET, "jargon");

    await expect(resolveLink(env.LINKS, link.path)).resolves.toEqual({ state: "active", link });
  });

  it("reports a path that was never stored as missing", async () => {
    await expect(resolveLink(env.LINKS, "/to/never-stored")).resolves.toEqual({
      state: "missing",
    });
  });

  it("reports a disabled link as removed, and findLink still returns its record", async () => {
    const link = await createLink(env.LINKS, TARGET, "ooo");
    const disabled = disableRecord(link, new Date("2026-02-03T04:05:06.000Z"), "phishing");
    await env.LINKS.put(await keyFor(link.path), JSON.stringify(disabled));

    await expect(resolveLink(env.LINKS, link.path)).resolves.toEqual({ state: "removed" });
    await expect(findLink(env.LINKS, link.path)).resolves.toEqual({
      ...link,
      disabledAt: "2026-02-03T04:05:06.000Z",
      disabledReason: "phishing",
    });
  });

  it("reports every link to a blocked hostname as removed", async () => {
    const first = await createLink(env.LINKS, new URL("https://banned.example/a"), "ooo");
    const second = await createLink(env.LINKS, new URL("https://Banned.Example./b"), "jargon");
    const other = await createLink(env.LINKS, new URL("https://www.banned.example/"), "ooo");
    await env.LINKS.put(blockedHostKey("banned.example"), "{}");

    await expect(resolveLink(env.LINKS, first.path)).resolves.toEqual({ state: "removed" });
    await expect(resolveLink(env.LINKS, second.path)).resolves.toEqual({ state: "removed" });
    // The match is exact, so a subdomain needs its own key.
    await expect(resolveLink(env.LINKS, other.path)).resolves.toMatchObject({ state: "active" });
  });
});

/** Writes a record straight to KV, the way anyone with access to the namespace can. */
async function storeRecord(path: string, url: string): Promise<void> {
  const record = { url, flavor: "ooo", path, createdAt: "2026-01-01T00:00:00.000Z" };
  await env.LINKS.put(await keyFor(path), JSON.stringify(record));
}

describe("resolveLink for a record with a hostname that isn't valid", () => {
  // `parseTarget` never lets such a hostname in, so only a record written some other way holds
  // one. Its second trailing dot would dodge the ban's exact match, and the resolver can't judge
  // the name.
  it("reports a link to a banned hostname with a second trailing dot as removed", async () => {
    await env.LINKS.put(blockedHostKey("banned.example.org"), "{}");
    await storeRecord("/to/dodges-the-ban", "https://banned.example.org../x");

    await expect(resolveLink(env.LINKS, "/to/dodges-the-ban")).resolves.toEqual({
      state: "removed",
    });
  });

  it.each([
    ["an empty label", "https://malware.testcategory.com../"],
    ["a label of 64 characters", `https://a${LABEL_63}.example.com/`],
    ["more than 253 characters", `https://${"a.".repeat(300)}com/`],
  ])("reports a link to a hostname with %s as removed", async (_, url) => {
    await storeRecord("/to/not-a-valid-hostname", url);

    await expect(resolveLink(env.LINKS, "/to/not-a-valid-hostname")).resolves.toEqual({
      state: "removed",
    });
  });
});

describe("isHostBlocked", () => {
  it("is true only for a hostname with a blocked-host key", async () => {
    await env.LINKS.put("blocked-host:blocked.example", "{}");

    await expect(isHostBlocked(env.LINKS, "blocked.example")).resolves.toBe(true);
    await expect(isHostBlocked(env.LINKS, "BLOCKED.example.")).resolves.toBe(true);
    await expect(isHostBlocked(env.LINKS, "sub.blocked.example")).resolves.toBe(false);
    await expect(isHostBlocked(env.LINKS, "example.org")).resolves.toBe(false);
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
    ["an IPv4 address", "http://192.0.2.7/admin"],
    ["a scheme-less IPv4 address", "192.0.2.7/admin"],
    ["a loopback address", "http://127.0.0.1:8080/"],
    ["an IPv4 address written as one number", "http://2130706433/"],
    ["an IPv4 address written in hexadecimal", "http://0x7f.0.0.1/"],
    ["a bracketed IPv6 address", "http://[2001:db8::1]/"],
    ["the IPv6 loopback address", "https://[::1]:8443/"],
    ["localhost", "http://localhost:3000/"],
    ["localhost with a trailing dot", "http://localhost./"],
    ["a name under .localhost", "http://app.localhost/"],
    ["a name under .local", "http://printer.local/"],
    ["a name under .internal", "https://wiki.corp.internal/page"],
    ["a private name in another letter case", "https://NAS.Local/"],
    ["a name under .home.arpa", "http://nas.home.arpa/"],
    ["home.arpa itself", "http://home.arpa/"],
    ["a name under .lan", "http://printer.lan/"],
    ["a single-label name", "http://router"],
    ["a single-label name with a path", "http://intranet/admin"],
    ["a single-label name with a trailing dot", "https://intranet./"],
    ["a name with two trailing dots", "https://malware.testcategory.com../"],
    ["a banned name's spelling with two trailing dots", "https://banned.example.org../"],
    ["a URL on this site with two trailing dots", `http://${OWN_HOSTNAME}../to/x`],
    ["a private name with two trailing dots", "http://x.localhost../"],
    ["a name with an empty label in the middle", "https://example..com/"],
    ["a name with a label of 64 characters", `https://a${LABEL_63}.example.com/`],
    ["a name of 254 characters", `https://a${NAME_253}/`],
    ["a name of 300 labels", `https://${"a.".repeat(300)}com/`],
  ])("rejects %s with a 400", (_, input) => {
    const error = rejection(input);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 400 });
    expect(error).toHaveProperty("message", expect.stringMatching(/\S/));
  });

  it("says what's wrong in each message", () => {
    expect(rejection("")).toHaveProperty("message", expect.stringContaining("Enter a URL"));
    expect(rejection("not a url")).toHaveProperty("message", expect.stringContaining("valid URL"));
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
    expect(rejection("http://192.0.2.7/")).toHaveProperty(
      "message",
      expect.stringContaining("IP address"),
    );
    expect(rejection("http://[::1]/")).toHaveProperty(
      "message",
      expect.stringContaining("IP address"),
    );
    expect(rejection("http://printer.local/")).toHaveProperty(
      "message",
      expect.stringContaining("private network"),
    );
    expect(rejection("http://intranet/admin")).toHaveProperty(
      "message",
      expect.stringContaining("private network"),
    );
    for (const input of [
      "https://banned.example.org../",
      `http://${OWN_HOSTNAME}../to/x`,
      "http://x.localhost../",
      `https://a${LABEL_63}.example.com/`,
      `https://${"a.".repeat(300)}com/`,
    ]) {
      expect(rejection(input)).toHaveProperty(
        "message",
        expect.stringContaining("hostname in that URL isn't valid"),
      );
    }
  });

  it("accepts a public name that only resembles a private one", () => {
    expect(parseTarget("https://local.example.com/", OWN_HOSTNAME).hostname).toBe(
      "local.example.com",
    );
    expect(parseTarget("https://notlocalhost.example/", OWN_HOSTNAME).hostname).toBe(
      "notlocalhost.example",
    );
    expect(parseTarget("https://1.2.3.example/", OWN_HOSTNAME).hostname).toBe("1.2.3.example");
  });

  it("accepts the longest label and the longest name that DNS allows", () => {
    expect(parseTarget(`https://${LABEL_63}.example.com/`, OWN_HOSTNAME).hostname).toBe(
      `${LABEL_63}.example.com`,
    );
    expect(NAME_253).toHaveLength(253);
    expect(parseTarget(`https://${NAME_253}/`, OWN_HOSTNAME).hostname).toBe(NAME_253);
    // The trailing dot of a fully qualified name doesn't count toward the limit.
    expect(parseTarget(`https://${NAME_253}./`, OWN_HOSTNAME).hostname).toBe(`${NAME_253}.`);
  });

  it("accepts a public name that only resembles a local one", () => {
    expect(parseTarget("https://lan.example.com/", OWN_HOSTNAME).hostname).toBe("lan.example.com");
    expect(parseTarget("https://example.plan/", OWN_HOSTNAME).hostname).toBe("example.plan");
    expect(parseTarget("https://home.arpa.example/", OWN_HOSTNAME).hostname).toBe(
      "home.arpa.example",
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
