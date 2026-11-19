// Tests for the coil's geometry: the line that the text follows, the zones of text on it, the
// fit of a link to a window, and the division of the link into pieces and text elements.
import { describe, expect, it } from "vitest";

import { coilLayout, coilPath, coilZones, fitCoil } from "#web/coil-geometry.ts";

const INSETS = { top: 34, right: 34, bottom: 34, left: 34 };

// A wide window with the field where the home page puts it: its text starts 86px from the left,
// with its baseline 112px above the window's bottom edge, in the 19px fixed-width face.
const WINDOW = { width: 1440, height: 900, start: { x: 86, y: 788 } };
const ADVANCE = 0.6;
const FIT = {
  ...WINDOW,
  advance: ADVANCE,
  fieldRun: 1040,
  fieldSize: 19,
  inset: 34,
  radius: 20,
  depth: Math.min(900 - 34 - 788 - 11, 86 - 34 - 7),
  minLaps: 2,
  maxLaps: 4,
  minSize: 10,
  maxSize: 15,
  pitchRatio: 1.45,
  minPitchRatio: 1.15,
  taperSteps: 12,
  taperRun: 3,
};

function fitOrFail(fit: ReturnType<typeof fitCoil>): NonNullable<ReturnType<typeof fitCoil>> {
  if (fit === null) {
    throw new Error("The link doesn't fit.");
  }
  return fit;
}

// The capacity of the line that a fit describes, as the coil lays it out.
function capacityOf(fit: NonNullable<ReturnType<typeof fitCoil>>): number {
  const line = coilPath({ ...WINDOW, ...fit, radius: FIT.radius });
  return coilZones({
    pathLength: line.length,
    lead: line.lead,
    advance: ADVANCE,
    fieldRun: FIT.fieldRun,
    fieldSize: FIT.fieldSize,
    coilSize: fit.size,
    taperSteps: FIT.taperSteps,
    taperRun: FIT.taperRun,
  }).capacity;
}

describe("coilPath", () => {
  const square = {
    width: 1000,
    height: 800,
    start: { x: 100, y: 500 },
    insets: INSETS,
    pitch: 20,
    fieldPitch: 20,
    laps: 1,
  };

  it("runs right from the start and spirals clockwise to the top right", () => {
    const line = coilPath({ ...square, radius: 0 });

    expect(line.data).toBe(
      "M100 500L966 500A0 0 0 0 1 966 500L966 766A0 0 0 0 1 966 766L34 766A0 0 0 0 1 34 766" +
        "L34 34A0 0 0 0 1 34 34L966 34",
    );
    expect(line.length).toBe(866 + 266 + 932 + 732 + 932);
    expect(line.lead).toBe(866);
    expect(line.corners).toEqual([866, 866 + 266, 866 + 266 + 932, 866 + 266 + 932 + 732]);
  });

  it("rounds each corner with a quarter circle of the radius", () => {
    const sharp = coilPath({ ...square, radius: 0 });
    const round = coilPath({ ...square, radius: 20 });

    // Each corner cuts two straight runs of 20px and adds a quarter of a circle.
    expect(round.length).toBeCloseTo(sharp.length - 4 * (40 - 10 * Math.PI), 9);
    expect(round.lead).toBe(846);
    expect(round.corners[0]).toBeCloseTo(846 + 5 * Math.PI, 9);
    expect(round.data).toContain("A20 20 0 0 1 ");
  });

  it("tightens a corner on a side shorter than two radii", () => {
    const line = coilPath({ ...square, start: { x: 100, y: 750 }, radius: 20 });

    // The right side runs 16px, from 750 to 766, so its corners have a radius of 8px.
    expect(line.data).toContain("A8 8 0 0 1 ");
  });

  it("starts with the innermost lap and ends on the outermost", () => {
    const line = coilPath({ ...square, laps: 3, pitch: 20, fieldPitch: 12, radius: 0 });

    // The first lap is two lanes in: 40px in on the right and the top, 24px on the bottom and
    // the left.
    expect(line.data.startsWith("M100 500L926 500A0 0 0 0 1 926 500L926 742")).toBe(true);
    expect(line.data).toContain("L58 742");
    expect(line.data).toContain("L58 74");
    // The last run is on the outermost lane along the top.
    expect(line.data.endsWith("L966 34")).toBe(true);
    expect(line.corners).toHaveLength(12);
  });

  it("puts the corners in order along the line", () => {
    const line = coilPath({ ...square, laps: 4, radius: 20 });

    for (let index = 1; index < line.corners.length; index += 1) {
      expect(line.corners[index]).toBeGreaterThan(line.corners[index - 1] ?? Infinity);
    }
    expect(line.corners.at(-1)).toBeLessThan(line.length);
  });
});

describe("coilZones", () => {
  const zones = coilZones({
    pathLength: 10_000,
    lead: 1300,
    advance: 0.6,
    fieldRun: 1000,
    fieldSize: 20,
    coilSize: 10,
    taperSteps: 5,
    taperRun: 3,
  });

  it("fills the field at the field's size", () => {
    // Each character is 12px wide, and 83 of them fit in 1,000px.
    expect(zones.fieldCount).toBe(83);
  });

  it("keeps a character that fits the field exactly", () => {
    const exact = coilZones({
      pathLength: 10_000,
      lead: 1300,
      advance: 0.6,
      fieldRun: 1200,
      fieldSize: 20,
      coilSize: 10,
      taperSteps: 5,
      taperRun: 3,
    });

    expect(exact.fieldCount).toBe(100);
  });

  it("steps down from the field's size to the coil's", () => {
    expect(zones.taper).toEqual([18, 16, 14, 12]);
  });

  it("ends the taper before the first corner", () => {
    // One character of each size takes 36px, and 304px are left before the corner, so the taper
    // could repeat eight times, but no more than three.
    expect(zones.run).toBe(3);
    const narrow = coilZones({
      pathLength: 10_000,
      lead: 1050,
      advance: 0.6,
      fieldRun: 1000,
      fieldSize: 20,
      coilSize: 10,
      taperSteps: 5,
      taperRun: 3,
    });
    expect(narrow.run).toBe(1);
  });

  it("holds nothing when the taper doesn't fit before the first corner", () => {
    // The field's text ends 24px before the corner, and one pass of the taper takes 36px.
    const short = coilZones({
      pathLength: 10_000,
      lead: 1020,
      advance: 0.6,
      fieldRun: 1000,
      fieldSize: 20,
      coilSize: 10,
      taperSteps: 5,
      taperRun: 3,
    });
    expect(short.run).toBe(0);
    expect(short.capacity).toBe(0);
  });

  it("counts every character that the line holds", () => {
    const rest = 10_000 - 83 * 12 - 3 * 36;
    expect(zones.capacity).toBe(83 + 3 * 4 + Math.floor(rest / 6));
  });
});

describe("fitCoil", () => {
  it("holds a long link in a wide window", () => {
    const fit = fitCoil({ ...FIT, characters: 1960 });

    expect(fit).toEqual({ laps: 3, size: 10.88, pitch: 16, fieldPitch: 16, insets: INSETS });
    expect(capacityOf(fitOrFail(fit))).toBeGreaterThanOrEqual(1960);
  });

  it("chooses the fewest laps, and then the largest size that holds the link", () => {
    // Two laps can't hold this link at the smallest size, so it takes three.
    expect(fitCoil({ ...FIT, characters: 1960, maxLaps: 2 })).toBeNull();
    // At a slightly larger size, three laps hold fewer characters than the link has.
    const fit = fitOrFail(fitCoil({ ...FIT, characters: 1960 }));
    const larger = { ...fit, size: fit.size + 0.05, pitch: Math.round((fit.size + 0.05) * 1.45) };
    expect(capacityOf(larger)).toBeLessThan(1960);
  });

  it("uses the largest size for a short link, and never more than the field's size", () => {
    expect(fitCoil({ ...FIT, characters: 300 })?.size).toBe(15);
    expect(fitCoil({ ...FIT, characters: 300, fieldSize: 12 })?.size).toBe(12);
  });

  it("closes the lanes beside the field to the depth, but no further than the letters allow", () => {
    // Four laps pass the field's text in a depth of 45px, so those lanes are 15px apart and the
    // others 16px.
    const fit = fitCoil({ ...FIT, characters: 2600 });

    expect(fit).toEqual({ laps: 4, size: 10.77, pitch: 16, fieldPitch: 15, insets: INSETS });
    const { size, fieldPitch } = fitOrFail(fit);
    expect(fieldPitch).toBeGreaterThanOrEqual(size * FIT.minPitchRatio);
  });

  it("gives up on a link that four laps at the smallest size can't hold", () => {
    expect(fitCoil({ ...FIT, characters: 20_000 })).toBeNull();
  });

  it("gives up when the field leaves no room for the lanes", () => {
    expect(fitCoil({ ...FIT, characters: 1960, depth: 8 })).toBeNull();
  });

  it("gives up when the run to the first corner is shorter than one pass of the taper", () => {
    // The field's text ends about 54px before the first corner, and one pass of the taper takes
    // more than 95px at every size.
    expect(fitCoil({ ...FIT, characters: 300, fieldRun: 1240 })).toBeNull();
  });

  it("gives up in a window of no size", () => {
    expect(
      fitCoil({
        ...FIT,
        width: 0,
        height: 0,
        start: { x: 0, y: 0 },
        fieldRun: 0,
        depth: 0,
        characters: 300,
      }),
    ).toBeNull();
  });
});

describe("coilLayout", () => {
  const line = coilPath({
    width: 1000,
    height: 800,
    start: { x: 100, y: 700 },
    insets: INSETS,
    pitch: 16,
    fieldPitch: 14,
    laps: 2,
    radius: 20,
  });
  const zones = coilZones({
    pathLength: line.length,
    lead: line.lead,
    advance: ADVANCE,
    fieldRun: 600,
    fieldSize: 19,
    coilSize: 11,
    taperSteps: 12,
    taperRun: 3,
  });
  const layout = coilLayout({
    characters: 900,
    corners: line.corners,
    zones,
    advance: ADVANCE,
    fieldSize: 19,
    coilSize: 11,
    rowLength: 70,
    chunkLength: 32,
  });

  it("lays out every character that fits", () => {
    expect(layout.count).toBe(Math.min(900, zones.capacity));
    expect(layout.fieldCount).toBe(zones.fieldCount);
    expect(layout.rowLength).toBe(70);
  });

  it("sizes the field, the taper, and the coil", () => {
    expect(layout.sizes[0]).toBe(19);
    expect(layout.sizes[zones.fieldCount - 1]).toBe(19);
    expect(layout.sizes[zones.fieldCount]).toBe(zones.taper[0]);
    expect(layout.sizes[layout.count - 1]).toBe(11);
    for (let index = 1; index < layout.count; index += 1) {
      expect(layout.sizes[index]).toBeLessThanOrEqual(layout.sizes[index - 1] ?? 0);
    }
  });

  it("places each character after the one before it", () => {
    expect(layout.offsets[0]).toBe(0);
    for (let index = 0; index < layout.count; index += 1) {
      expect(layout.offsets[index + 1]).toBeCloseTo(
        (layout.offsets[index] ?? 0) + (layout.sizes[index] ?? 0) * ADVANCE,
        9,
      );
    }
    expect(layout.offsets[layout.count]).toBeLessThanOrEqual(line.length + 1e-6);
  });

  it("divides the link into pieces that each sit in one row and one zone", () => {
    let next = 0;
    for (const piece of layout.pieces) {
      expect(piece.from).toBe(next);
      expect(piece.to).toBeGreaterThan(piece.from);
      expect(piece.row).toBe(Math.floor(piece.from / 70));
      expect(Math.floor((piece.to - 1) / 70)).toBe(piece.row);
      const crossesField = piece.from < zones.fieldCount && piece.to > zones.fieldCount;
      expect(crossesField).toBe(false);
      next = piece.to;
    }
    expect(next).toBe(layout.count);
  });

  it("cuts a piece at the middle of each corner", () => {
    for (const corner of line.corners) {
      const straddles = layout.pieces.some((piece) => {
        const start = layout.offsets[piece.from] ?? 0;
        const end = layout.offsets[piece.to] ?? 0;
        const middleOfFirst = (start + (layout.offsets[piece.from + 1] ?? 0)) / 2;
        return middleOfFirst < corner && end > corner + 11 * ADVANCE;
      });
      expect(straddles).toBe(false);
    }
  });

  it("divides each piece into chunks of one size and at most the chunk length", () => {
    let next = 0;
    for (const chunk of layout.chunks) {
      const piece = layout.pieces[chunk.piece];
      expect(piece).toBeDefined();
      expect(chunk.from).toBe(next);
      expect(chunk.from).toBeGreaterThanOrEqual(piece?.from ?? Infinity);
      expect(chunk.to).toBeLessThanOrEqual(piece?.to ?? -Infinity);
      expect(chunk.to - chunk.from).toBeLessThanOrEqual(32);
      for (let index = chunk.from; index < chunk.to; index += 1) {
        expect(layout.sizes[index]).toBe(chunk.size);
      }
      expect(chunk.offset).toBe(layout.offsets[chunk.from]);
      expect(chunk.plain).toBe(chunk.from < zones.fieldCount);
      next = chunk.to;
    }
    expect(next).toBe(layout.count);
  });

  it("stops at the line's capacity", () => {
    const over = coilLayout({
      characters: zones.capacity + 500,
      corners: line.corners,
      zones,
      advance: ADVANCE,
      fieldSize: 19,
      coilSize: 11,
      rowLength: 70,
      chunkLength: 32,
    });
    expect(over.count).toBe(zones.capacity);
  });
});
