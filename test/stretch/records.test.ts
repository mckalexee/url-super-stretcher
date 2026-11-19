// Tests for the stored record and its keys: the key derivation that the Worker and the takedown
// command share, the records that parse and the ones that don't, and the edits that take a link
// down and restore it.
import { describe, expect, it } from "vitest";

import {
  blockedHostKey,
  disableRecord,
  linkKey,
  parseRecord,
  restoreRecord,
  stretchOf,
} from "#stretch/records.ts";
import type { StretchedLink } from "#stretch/records.ts";

const LINK: StretchedLink = {
  url: "https://example.org/page",
  flavor: "ooo",
  path: "/to/looooong",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("linkKey", () => {
  it("is link: plus the hex SHA-256 of the stretch", async () => {
    // The digest of "abc" is the test vector from the SHA-256 specification.
    await expect(linkKey("abc")).resolves.toBe(
      "link:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("fits the KV key limit for a stretch of any length", async () => {
    await expect(linkKey("o".repeat(5000))).resolves.toHaveLength("link:".length + 64);
  });
});

describe("stretchOf", () => {
  it("returns everything after the prefix, query included", () => {
    expect(stretchOf("/to/landing?utm_source=x&utm_medium=y")).toBe(
      "landing?utm_source=x&utm_medium=y",
    );
  });

  it("returns null outside the prefix and for the bare prefix", () => {
    expect(stretchOf("/from/landing")).toBeNull();
    expect(stretchOf("/to/")).toBeNull();
    expect(stretchOf("/to")).toBeNull();
    expect(stretchOf("")).toBeNull();
  });
});

describe("blockedHostKey", () => {
  it("lowercases the hostname and drops a trailing dot", () => {
    expect(blockedHostKey("example.org")).toBe("blocked-host:example.org");
    expect(blockedHostKey("Bad.Example.ORG.")).toBe("blocked-host:bad.example.org");
  });

  it("keeps an internationalized name in its ASCII form", () => {
    expect(blockedHostKey(new URL("https://bücher.example/").hostname)).toBe(
      "blocked-host:xn--bcher-kva.example",
    );
  });
});

describe("parseRecord", () => {
  it("reads a record that was written before takedowns existed", () => {
    expect(parseRecord(JSON.stringify(LINK), LINK.path)).toEqual(LINK);
  });

  it("reads a disabled record with and without a reason", () => {
    const disabled = { ...LINK, disabledAt: "2026-02-03T04:05:06.000Z" };

    expect(parseRecord(JSON.stringify(disabled), LINK.path)).toEqual(disabled);
    expect(
      parseRecord(JSON.stringify({ ...disabled, disabledReason: "phishing" }), LINK.path),
    ).toEqual({ ...disabled, disabledReason: "phishing" });
  });

  it("returns null for a disabled timestamp that isn't ISO 8601", () => {
    expect(parseRecord(JSON.stringify({ ...LINK, disabledAt: "last week" }), LINK.path)).toBeNull();
  });

  it("returns null for another path, and for text that isn't JSON", () => {
    expect(parseRecord(JSON.stringify(LINK), "/to/another")).toBeNull();
    expect(parseRecord("{not json", LINK.path)).toBeNull();
  });
});

describe("disableRecord and restoreRecord", () => {
  const now = new Date("2026-02-03T04:05:06.000Z");

  it("adds the time and the reason, and leaves the original alone", () => {
    expect(disableRecord(LINK, now, "phishing")).toEqual({
      ...LINK,
      disabledAt: "2026-02-03T04:05:06.000Z",
      disabledReason: "phishing",
    });
    expect(LINK).not.toHaveProperty("disabledAt");
  });

  it("writes no reason field when no reason is given", () => {
    const disabled = disableRecord(LINK, now);

    expect(disabled).toEqual({ ...LINK, disabledAt: "2026-02-03T04:05:06.000Z" });
    expect(disabled).not.toHaveProperty("disabledReason");
  });

  it("replaces the time and drops the old reason when a link is disabled again", () => {
    const first = disableRecord(LINK, new Date("2026-01-02T00:00:00.000Z"), "spam");

    const second = disableRecord(first, now);

    expect(second).toEqual({ ...LINK, disabledAt: "2026-02-03T04:05:06.000Z" });
    expect(second).not.toHaveProperty("disabledReason");
  });

  it("restores a disabled record to exactly the original", () => {
    const restored = restoreRecord(disableRecord(LINK, now, "phishing"));

    expect(restored).toEqual(LINK);
    expect(Object.keys(restored)).toEqual(Object.keys(LINK));
  });

  it("writes records that parse", () => {
    const disabled = disableRecord(LINK, now, "phishing");

    expect(parseRecord(JSON.stringify(disabled), LINK.path)).toEqual(disabled);
    expect(parseRecord(JSON.stringify(restoreRecord(disabled)), LINK.path)).toEqual(LINK);
  });
});
