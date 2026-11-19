// Tests for the flavors: the picker's list, and the text that `generateStretch` writes. The text
// must stay inside the length bounds, use only characters that survive a URL round trip, and be a
// pure function of the flavor and the random bytes.
import { describe, expect, it } from "vitest";

import { FLAVORS, generateStretch, isFlavorId } from "#stretch/flavors.ts";
import type { FlavorId, RandomSource } from "#stretch/flavors.ts";

const FLAVOR_IDS = FLAVORS.map((flavor) => flavor.id);
const MIN_LENGTH = 600;
const MAX_LENGTH = 1500;
const RANDOM_DRAWS = 300;

// The ID takes the first 16 bytes that the generator asks for.
const ID_BYTES = 16;

const PATH_ONLY = /^[A-Za-z0-9._~-]+$/;
const PATH_AND_QUERY = /^[A-Za-z0-9._~-]+\?[A-Za-z0-9._~=&-]+$/;

/** A source that repeats the given bytes, so a test controls every byte the generator reads. */
function fixed(pattern: readonly number[]): RandomSource {
  return (bytes) => {
    bytes.forEach((_, index) => {
      bytes[index] = pattern[index % pattern.length] ?? 0;
    });
  };
}

/** A source that returns a copy of the given bytes. */
function replay(source: Uint8Array): RandomSource {
  return (bytes) => {
    bytes.set(source.subarray(0, bytes.length));
  };
}

/** Records the bytes that one call to the generator reads from the real random source. */
function capture(flavor: FlavorId): Uint8Array<ArrayBuffer> {
  let captured = new Uint8Array();
  generateStretch(flavor, (bytes) => {
    crypto.getRandomValues(bytes);
    captured = bytes.slice();
  });
  return captured;
}

describe("FLAVORS", () => {
  it("lists the four flavors in the picker's order", () => {
    expect(FLAVOR_IDS).toEqual(["jargon", "legalese", "ooo", "tracking"]);
  });

  it("gives every flavor a name and a description", () => {
    for (const flavor of FLAVORS) {
      expect(flavor.name).not.toBe("");
      expect(flavor.description).not.toBe("");
    }
  });
});

describe("isFlavorId", () => {
  it("accepts every flavor's ID", () => {
    for (const id of FLAVOR_IDS) {
      expect(isFlavorId(id)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isFlavorId("")).toBe(false);
    expect(isFlavorId("Jargon")).toBe(false);
    expect(isFlavorId("emoji")).toBe(false);
  });
});

describe.each(FLAVOR_IDS)("generateStretch(%s)", (flavor) => {
  it("stays inside the length bounds over many random draws", () => {
    for (let draw = 0; draw < RANDOM_DRAWS; draw += 1) {
      const { length } = generateStretch(flavor);

      expect(length).toBeGreaterThanOrEqual(MIN_LENGTH);
      expect(length).toBeLessThanOrEqual(MAX_LENGTH);
    }
  });

  it("stays inside the length bounds at its shortest and its longest", () => {
    // Each random byte makes one choice, so the choices add to the length independently. Taking
    // the shortest and the longest value of every byte in turn reaches the true extremes, which
    // random draws almost never do.
    const shortest = capture(flavor);
    const longest = shortest.slice();
    for (let index = 0; index < shortest.length; index += 1) {
      let min = Infinity;
      let max = -Infinity;
      const trial = shortest.slice();
      for (let value = 0; value < 256; value += 1) {
        trial[index] = value;
        const { length } = generateStretch(flavor, replay(trial));
        if (length < min) {
          min = length;
          shortest[index] = value;
        }
        if (length > max) {
          max = length;
          longest[index] = value;
        }
      }
    }

    expect(generateStretch(flavor, replay(shortest)).length).toBeGreaterThanOrEqual(MIN_LENGTH);
    expect(generateStretch(flavor, replay(longest)).length).toBeLessThanOrEqual(MAX_LENGTH);
  });

  it("uses only characters that a URL keeps unchanged", () => {
    for (let draw = 0; draw < RANDOM_DRAWS; draw += 1) {
      const stretch = generateStretch(flavor);

      expect(stretch).toMatch(flavor === "tracking" ? PATH_AND_QUERY : PATH_ONLY);
      expect(stretch.endsWith(".")).toBe(false);
    }
  });

  it("survives URL parsing unchanged", () => {
    for (let draw = 0; draw < RANDOM_DRAWS; draw += 1) {
      const stretch = generateStretch(flavor);
      const url = new URL(`https://example.com/to/${stretch}`);

      expect(url.pathname + url.search).toBe(`/to/${stretch}`);
      expect(url.hash).toBe("");
    }
  });

  it("returns the same text for the same random bytes", () => {
    const source = fixed([7, 201, 33, 148, 90]);

    expect(generateStretch(flavor, source)).toBe(generateStretch(flavor, source));
  });

  it("returns different text when any byte of the ID changes", () => {
    const base = capture(flavor);
    const original = generateStretch(flavor, replay(base));

    for (let index = 0; index < ID_BYTES; index += 1) {
      const changed = base.slice();
      changed[index] = (changed[index] ?? 0) ^ 1;

      expect(generateStretch(flavor, replay(changed))).not.toBe(original);
    }
  });

  it("returns different text on every random draw", () => {
    const seen = new Set<string>();
    for (let draw = 0; draw < RANDOM_DRAWS; draw += 1) {
      seen.add(generateStretch(flavor));
    }

    expect(seen.size).toBe(RANDOM_DRAWS);
  });
});

describe("generateStretch", () => {
  it("writes a query string only for the tracking flavor", () => {
    expect(generateStretch("jargon")).not.toContain("?");
    expect(generateStretch("legalese")).not.toContain("?");
    expect(generateStretch("ooo")).not.toContain("?");
    expect(generateStretch("tracking")).toMatch(/^landing\?utm_source=/);
  });

  it("writes the ooo flavor as the word long, in o's of three kinds", () => {
    expect(generateStretch("ooo")).toMatch(/^l[oO0]+ng$/);
  });
});
