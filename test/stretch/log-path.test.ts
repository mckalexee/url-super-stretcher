// Tests for the path that the logs carry: a stretched link's path becomes fixed text, and every
// other path stays as it is.
import { describe, expect, it } from "vitest";

import { loggablePath } from "#stretch/log-path.ts";

describe("loggablePath", () => {
  it.each([
    "/to/leveraging-synergies-0123456789abcdef0123456789abcdef",
    "/to/landing",
    "/to/looooong.data",
    "/to/a/b/c",
    "/to/",
  ])("replaces %j with fixed text", (path) => {
    expect(loggablePath(path)).toBe("/to/*");
  });

  it.each(["/", "/to", "/account", "/tomorrow/x", "/api/to/x", "/healthz"])(
    "keeps %j as it is",
    (path) => {
      expect(loggablePath(path)).toBe(path);
    },
  );
});
