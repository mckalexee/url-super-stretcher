// Tests for the reputation check: the verdict for each kind of answer that the resolver gives,
// the request that it receives, and every failure that must come back as `unknown` instead of an
// error.
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkReputation } from "#stretch/reputation.ts";

import { useNetwork } from "../helpers/network.ts";
import {
  cleanAnswer,
  flaggedAnswer,
  RESOLVER_URL,
  resolver,
  unreachableResolver,
} from "../helpers/reputation.ts";

const network = useNetwork();

afterEach(() => {
  vi.restoreAllMocks();
});

function answerWith(body: Record<string, unknown>) {
  network.use(http.get(RESOLVER_URL, () => HttpResponse.json(body)));
}

function warnings(warn: { mock: { calls: unknown[][] } }): unknown[] {
  return warn.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown);
}

describe("checkReputation", () => {
  it("asks the resolver for the A record of the hostname as DNS JSON", async () => {
    const seen: { url: string; accept: string | null }[] = [];
    network.use(
      http.get(RESOLVER_URL, ({ request }) => {
        seen.push({ url: request.url, accept: request.headers.get("accept") });
        return HttpResponse.json(cleanAnswer("example.org"));
      }),
    );

    await checkReputation("example.org");

    expect(seen).toHaveLength(1);
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.get("name")).toBe("example.org");
    expect(url.searchParams.get("type")).toBe("A");
    expect(seen[0]!.accept).toBe("application/dns-json");
  });

  it("calls a name with real addresses clean", async () => {
    network.use(resolver());

    await expect(checkReputation("example.org")).resolves.toBe("clean");
  });

  it("calls a name flagged when the resolver censors the answer", async () => {
    network.use(resolver("malware.example"));

    await expect(checkReputation("malware.example")).resolves.toBe("flagged");
    await expect(checkReputation("example.org")).resolves.toBe("clean");
  });

  it("calls a name flagged on the censored comment alone", async () => {
    answerWith({ Status: 0, Comment: ["EDE(16): Censored"] });

    await expect(checkReputation("malware.example")).resolves.toBe("flagged");
  });

  it("calls a name flagged on the blocked address alone", async () => {
    answerWith({
      Status: 0,
      Answer: [{ name: "malware.example", type: 1, TTL: 60, data: "0.0.0.0" }],
    });

    await expect(checkReputation("malware.example")).resolves.toBe("flagged");
  });

  it("accepts a comment that is one string", async () => {
    answerWith({ ...flaggedAnswer("malware.example"), Comment: "EDE(16): Censored" });

    await expect(checkReputation("malware.example")).resolves.toBe("flagged");
  });

  it("calls a name without an A record clean", async () => {
    // An IPv6-only host answers the A question with its alias and no address.
    answerWith({
      Status: 0,
      Answer: [{ name: "ipv6.example", type: 5, TTL: 60, data: "ipv6.l.example." }],
    });
    await expect(checkReputation("ipv6.example")).resolves.toBe("clean");

    answerWith({ Status: 0 });
    await expect(checkReputation("ipv6.example")).resolves.toBe("clean");
  });

  it("calls a name clean when a comment carries another error code", async () => {
    answerWith({ ...cleanAnswer("example.org"), Comment: ["EDE(22): No Reachable Authority"] });

    await expect(checkReputation("example.org")).resolves.toBe("clean");
  });

  it("calls a name that doesn't exist clean", async () => {
    answerWith({ Status: 3 });

    await expect(checkReputation("nowhere.example")).resolves.toBe("clean");
  });

  it("returns unknown and logs a warning without the hostname on a network error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    network.use(unreachableResolver);

    await expect(checkReputation("secret-name.example")).resolves.toBe("unknown");

    expect(warnings(warn)).toEqual([
      { level: "warn", event: "reputation.check_failed", reason: "request_failed" },
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-name");
  });

  it("returns unknown on a status that isn't 2xx", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    network.use(http.get(RESOLVER_URL, () => new HttpResponse(null, { status: 503 })));

    await expect(checkReputation("example.org")).resolves.toBe("unknown");

    expect(warnings(warn)).toEqual([
      {
        level: "warn",
        event: "reputation.check_failed",
        reason: "request_failed",
        upstreamStatus: 503,
      },
    ]);
  });

  it("returns unknown on a body that isn't JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    network.use(http.get(RESOLVER_URL, () => HttpResponse.text("<html>busy</html>")));

    await expect(checkReputation("example.org")).resolves.toBe("unknown");
  });

  it("returns unknown on a body with the wrong shape", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    answerWith({ Status: "fine", Answer: "none" });

    await expect(checkReputation("example.org")).resolves.toBe("unknown");

    expect(warnings(warn)).toEqual([
      { level: "warn", event: "reputation.check_failed", reason: "invalid_body" },
    ]);
  });

  it("returns unknown when the resolver takes longer than two seconds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    network.use(
      http.get(RESOLVER_URL, async () => {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        return HttpResponse.json(cleanAnswer("example.org"));
      }),
    );

    const started = Date.now();
    await expect(checkReputation("example.org")).resolves.toBe("unknown");

    expect(Date.now() - started).toBeLessThan(2_400);
    expect(warnings(warn)).toEqual([
      { level: "warn", event: "reputation.check_failed", reason: "timeout" },
    ]);
  });
});
