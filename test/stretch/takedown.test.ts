// Tests for the pure parts of the takedown command: which link its argument names, and which
// combinations of options it accepts.
import { describe, expect, it } from "vitest";

import { parseTakedownArguments, stretchOfLink } from "#stretch/takedown.ts";

const LINK = "https://urlsuperstretcher.com/to/landing?utm_source=a&utm_medium=b";
const STRETCH = "landing?utm_source=a&utm_medium=b";

function options(...argv: string[]) {
  const result = parseTakedownArguments(argv);
  if (!result.ok) {
    throw new Error(`Expected the arguments to parse, and got: ${result.message}`);
  }
  return result.options;
}

function message(...argv: string[]): string {
  const result = parseTakedownArguments(argv);
  if (result.ok) {
    throw new Error("Expected the arguments to be rejected.");
  }
  return result.message;
}

describe("stretchOfLink", () => {
  it("returns the stretch of a whole link, query included", () => {
    expect(stretchOfLink(LINK)).toBe(STRETCH);
  });

  it("returns the same stretch whatever the host", () => {
    expect(
      stretchOfLink(`https://pr-7-url-super-stretcher.example.workers.dev/to/${STRETCH}`),
    ).toBe(STRETCH);
    expect(stretchOfLink(`http://localhost:5174/to/${STRETCH}`)).toBe(STRETCH);
  });

  it("accepts the path and query alone", () => {
    expect(stretchOfLink(`/to/${STRETCH}`)).toBe(STRETCH);
  });

  it("drops a fragment, which is never part of a link", () => {
    expect(stretchOfLink("https://urlsuperstretcher.com/to/looooong#top")).toBe("looooong");
  });

  it("keeps the letter case of the path", () => {
    expect(stretchOfLink("https://urlsuperstretcher.com/to/LoooONG")).toBe("LoooONG");
  });

  it("returns null for a URL that isn't a stretched link", () => {
    expect(stretchOfLink("https://urlsuperstretcher.com/")).toBeNull();
    expect(stretchOfLink("https://urlsuperstretcher.com/to/")).toBeNull();
    expect(stretchOfLink("https://urlsuperstretcher.com/account")).toBeNull();
    expect(stretchOfLink("https://")).toBeNull();
  });
});

describe("parseTakedownArguments", () => {
  it("takes a link down in production by default", () => {
    expect(options(LINK)).toEqual({
      stretch: STRETCH,
      reason: undefined,
      restore: false,
      blockHost: false,
      unblockHost: false,
      target: "production",
    });
  });

  it("reads the reason, the host ban, and the Preview namespace in any order", () => {
    expect(options("--preview", "--reason", " phishing page ", LINK, "--block-host")).toEqual({
      stretch: STRETCH,
      reason: "phishing page",
      restore: false,
      blockHost: true,
      unblockHost: false,
      target: "preview",
    });
  });

  it("restores a link, and lifts the host ban when asked", () => {
    expect(options(LINK, "--restore")).toMatchObject({ restore: true, unblockHost: false });
    expect(options(LINK, "--restore", "--unblock-host", "--local")).toMatchObject({
      restore: true,
      unblockHost: true,
      target: "local",
    });
  });

  it("rejects a missing link", () => {
    expect(message()).toContain("Pass the long link");
    expect(message("--block-host")).toContain("Pass the long link");
  });

  it("rejects a URL that isn't a stretched link", () => {
    expect(message("https://example.org/page")).toContain("isn't a stretched link");
  });

  it("rejects a second link, which is what an unquoted tracking link looks like", () => {
    expect(message(LINK, "utm_medium=b")).toContain("single quotes");
  });

  it("rejects an unknown option by name", () => {
    expect(message(LINK, "--delete")).toBe("Unknown option --delete.");
  });

  it("rejects a reason without text", () => {
    expect(message(LINK, "--reason")).toContain("--reason needs text");
    expect(message(LINK, "--reason", "  ")).toContain("--reason needs text");
  });

  it("rejects options that ask for opposite things", () => {
    expect(message(LINK, "--restore", "--reason", "spam")).toContain("--restore");
    expect(message(LINK, "--restore", "--block-host")).toContain("--unblock-host");
    expect(message(LINK, "--unblock-host")).toContain("--restore");
    expect(message(LINK, "--preview", "--local")).toContain("--preview and --local");
  });
});
