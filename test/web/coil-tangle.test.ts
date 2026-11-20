// Tests for the tangle's geometry: the seeded walk that grows the cord, the limits that it keeps,
// its fit to phone screens for long links, and the fallback from a seed that fails.
import { describe, expect, it } from "vitest";

import {
  fieldLine,
  fitTangle,
  hashSeed,
  planTangle,
  tangleLayout,
  tanglePoint,
  type TangleFit,
  type TangleWalker,
  tangleWalk,
  tightestBend,
} from "#web/coil-tangle.ts";

// The fixed-width face is 0.6 of its size wide, and the field's text is 16px on a phone.
const ADVANCE = 0.6;
const FIELD_SIZE = 16;
const INSET = 28;
const ROW_LENGTH = 31;
const CHUNK_LENGTH = 32;
const FIELD_HEIGHT = 58;

// A phone's screen with the field where the coil brings it into view: its box 24px above the
// screen's bottom edge, and its text 16px inside the box's left edge, which is 28px from the
// screen's left edge.
function screen(width: number, height: number) {
  const bottom = height - 24;
  const box = { left: 28, top: bottom - FIELD_HEIGHT, right: width - 28, bottom };
  const plan = planTangle({
    width,
    height,
    insets: { top: INSET, right: INSET, bottom: INSET, left: INSET },
    start: { x: 44, y: bottom - FIELD_HEIGHT / 2 },
    fieldRun: width - 88,
    fieldSize: FIELD_SIZE,
    advance: ADVANCE,
  });
  return { plan, box };
}

// A link of `length` characters, made of words, so each length has its own seed.
function link(length: number): string {
  const words = "http://localhost:5173/to/as-raised-by-the-chairman-at-the-leadership-offsite-";
  return words.repeat(Math.ceil(length / words.length)).slice(0, length);
}

// Runs a generator to its end, and counts the times it yielded.
function drain<T>(work: Generator<undefined, T>): { value: T; yields: number } {
  let yields = 0;
  for (;;) {
    const step = work.next();
    if (step.done === true) {
      return { value: step.value, yields };
    }
    yields += 1;
  }
}

function fit(width: number, height: number, characters: number): TangleFit | null {
  const { plan, box } = screen(width, height);
  return drain(
    fitTangle({
      plan,
      fieldSize: FIELD_SIZE,
      characters,
      box,
      seed: hashSeed(link(characters)),
      advance: ADVANCE,
      rowLength: ROW_LENGTH,
      chunkLength: CHUNK_LENGTH,
    }),
  ).value;
}

function fitOrFail(width: number, height: number, characters: number): TangleFit {
  const fitted = fit(width, height, characters);
  if (fitted === null) {
    throw new Error("The tangle doesn't fit.");
  }
  return fitted;
}

// The size of the character that covers the distance `along`.
function sizeAt(fitted: TangleFit, along: number): number {
  const { sizes, offsets } = fitted.walk;
  let index = 0;
  while (index + 1 < offsets.length && offsets[index + 1]! <= along) {
    index += 1;
  }
  return sizes[index]!;
}

const SCREENS = [
  [360, 740],
  [390, 844],
  [430, 932],
] as const;

describe("hashSeed", () => {
  it("gives the same seed for the same link and another for another link", () => {
    expect(hashSeed(link(1950))).toBe(hashSeed(link(1950)));
    expect(hashSeed(link(1950))).not.toBe(hashSeed(link(1951)));
  });
});

describe("planTangle", () => {
  it("stops the field's text short of the edge, so the cord can bend away as it leaves", () => {
    const { plan } = screen(390, 844);
    expect(plan.fieldEnd).toBeLessThanOrEqual(390 - INSET - tightestBend(FIELD_SIZE));
    expect(plan.fieldEnd).toBeCloseTo(44 + plan.fieldCount * FIELD_SIZE * ADVANCE);
    expect(plan.fieldCount).toBeGreaterThan(10);
  });
});

describe("fitTangle", () => {
  it("grows the same path from the same seed", () => {
    const first = fitOrFail(390, 844, 1950);
    const second = fitOrFail(390, 844, 1950);
    expect(second.data).toBe(first.data);
    expect(second.layout.pieces).toEqual(first.layout.pieces);
  });

  it("grows a different path for a different link", () => {
    const { plan, box } = screen(390, 844);
    const grow = (seed: number) =>
      drain(
        fitTangle({
          plan,
          fieldSize: FIELD_SIZE,
          characters: 1950,
          box,
          seed,
          advance: ADVANCE,
          rowLength: ROW_LENGTH,
          chunkLength: CHUNK_LENGTH,
        }),
      ).value?.data;
    expect(grow(1)).not.toBe(grow(2));
  });

  it("yields while it works, so a caller can spread the work over frames", () => {
    const { plan, box } = screen(390, 844);
    const { yields } = drain(
      fitTangle({
        plan,
        fieldSize: FIELD_SIZE,
        characters: 1950,
        box,
        seed: hashSeed(link(1950)),
        advance: ADVANCE,
        rowLength: ROW_LENGTH,
        chunkLength: CHUNK_LENGTH,
      }),
    );
    expect(yields).toBeGreaterThan(100);
  });

  for (const characters of [1950, 2600]) {
    for (const [width, height] of SCREENS) {
      describe(`a link of ${characters} characters at ${width} by ${height}`, () => {
        const fitted = fitOrFail(width, height, characters);
        const { walk, layout } = fitted;
        const { plan } = screen(width, height);

        it("holds every character", () => {
          expect(walk.sizes).toHaveLength(characters);
          expect(layout.count).toBe(characters);
          const end = walk.offsets[characters - 1]! + walk.sizes[characters - 1]! * ADVANCE;
          expect((walk.xs.length - 1) * walk.step).toBeGreaterThanOrEqual(end);
          expect(layout.pieces[0]?.from).toBe(0);
          expect(layout.pieces.at(-1)?.to).toBe(characters);
        });

        // The cord rules out a bend by looking ahead in coarser steps than it grows in, so it can
        // pass a bound by a fraction of a pixel. The insets leave room for that.
        it("stays inside its bounds", () => {
          const { bounds } = plan;
          const slack = 0.5;
          for (const [index, x] of walk.xs.entries()) {
            const y = walk.ys[index]!;
            expect(x).toBeGreaterThanOrEqual(bounds.left - slack);
            expect(x).toBeLessThanOrEqual(bounds.right + slack);
            expect(y).toBeGreaterThanOrEqual(bounds.top - slack);
            expect(y).toBeLessThanOrEqual(bounds.bottom + slack);
          }
        });

        it("bends no tighter than the limit for its text", () => {
          for (let index = 1; index < walk.headings.length; index += 1) {
            const turn = Math.abs(walk.headings[index]! - walk.headings[index - 1]!) / walk.step;
            const size = sizeAt(fitted, (index - 1) * walk.step);
            expect(turn).toBeLessThanOrEqual(1 / tightestBend(size) + 1e-9);
          }
        });

        it("types the field's characters on the field's line, at the field's size", () => {
          for (let index = 0; index < plan.fieldCount; index += 1) {
            expect(walk.sizes[index]).toBe(FIELD_SIZE);
            const point = tanglePoint(walk, walk.offsets[index]!);
            expect(point.y).toBe(plan.start.y);
          }
          // The field's line, which the coil types on first, divides the field's characters as the
          // whole tangle does.
          const field = fieldLine({
            plan,
            fieldSize: FIELD_SIZE,
            advance: ADVANCE,
            rowLength: ROW_LENGTH,
            chunkLength: CHUNK_LENGTH,
          });
          const inField = layout.chunks.filter((chunk) => chunk.from < plan.fieldCount);
          expect(field.layout.chunks).toEqual(inField);
        });

        it("shrinks as it piles up", () => {
          expect(walk.sizes.at(-1)!).toBeLessThan(walk.sizes[plan.fieldCount + 20]!);
        });
      });
    }
  }

  it("falls back to another seed when one fails", () => {
    const { plan, box } = screen(390, 844);
    const seed = hashSeed(link(1950));
    const tried: number[] = [];
    // A walker that boxes the first seed in for good and grows the cord for every other.
    const walker: TangleWalker = function* (options) {
      tried.push(options.seed);
      if (tried.length === 1) {
        yield;
        return null;
      }
      return yield* tangleWalk(options);
    };
    const fitted = drain(
      fitTangle({
        plan,
        fieldSize: FIELD_SIZE,
        characters: 1950,
        box,
        seed,
        advance: ADVANCE,
        rowLength: ROW_LENGTH,
        chunkLength: CHUNK_LENGTH,
        walker,
      }),
    ).value;
    expect(tried).toHaveLength(2);
    expect(tried[1]).not.toBe(tried[0]);
    expect(fitted?.attempt).toBe(1);
    expect(fitted?.layout.count).toBe(1950);
  });

  it("gives up when no seed holds the link", () => {
    expect(fit(200, 160, 1950)).toBeNull();
  });
});

describe("tangleLayout", () => {
  it("cuts a gap into an older strand at each crossing, under the newer strand's text", () => {
    const { walk, gaps, layout } = fitOrFail(390, 844, 1950);
    expect(walk.crossings.length).toBeGreaterThan(10);
    expect(gaps.size).toBeGreaterThan(0);
    // A chunk starts where each gap does, so the gap appears as the head reaches it.
    const starts = new Set(layout.chunks.map((chunk) => chunk.from));
    for (const character of gaps.keys()) {
      expect(starts.has(character)).toBe(true);
    }
  });

  it("keeps each piece to one row of the box", () => {
    const { walk } = fitOrFail(390, 844, 1950);
    const { layout } = tangleLayout({
      walk,
      fieldCount: screen(390, 844).plan.fieldCount,
      advance: ADVANCE,
      rowLength: ROW_LENGTH,
      chunkLength: CHUNK_LENGTH,
    });
    for (const piece of layout.pieces) {
      expect(Math.floor((piece.to - 1) / ROW_LENGTH)).toBe(piece.row);
    }
  });
});
