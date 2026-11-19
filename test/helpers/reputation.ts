// Test stand-ins for the DNS resolver behind the reputation check. Tests have no network, so
// every test that creates a link or views one needs the resolver mocked, and these handlers
// answer the way the real resolver does for a clean name, a blocked name, and an outage.
import { http, HttpResponse, type HttpHandler } from "msw";
import { beforeEach } from "vitest";

import { useNetwork } from "./network.ts";

/** The resolver's DNS over HTTPS endpoint, which every handler here answers. */
export const RESOLVER_URL = "https://security.cloudflare-dns.com/dns-query";

/** The resolver's answer for a name that it doesn't block. */
export function cleanAnswer(name: string) {
  return {
    Status: 0,
    Question: [{ name, type: 1 }],
    Answer: [{ name, type: 1, TTL: 300, data: "192.0.2.1" }],
  };
}

/** The resolver's answer for a name that it blocks, as it gives for its own test names. */
export function flaggedAnswer(name: string) {
  return {
    Status: 0,
    Question: [{ name, type: 1 }],
    Answer: [{ name, type: 1, TTL: 60, data: "0.0.0.0" }],
    Comment: ["EDE(16): Censored"],
  };
}

/**
 * A resolver that blocks the given hostnames and no others. With no hostnames, every name is
 * clean.
 */
export function resolver(...flagged: string[]): HttpHandler {
  return http.get(RESOLVER_URL, ({ request }) => {
    const name = new URL(request.url).searchParams.get("name") ?? "";
    return HttpResponse.json(flagged.includes(name) ? flaggedAnswer(name) : cleanAnswer(name));
  });
}

/** A resolver that is down: every lookup fails with a network error. */
export const unreachableResolver: HttpHandler = http.get(RESOLVER_URL, () => HttpResponse.error());

/**
 * Enables the mocked network for the test file, with a resolver that calls every name clean
 * before each test, and returns the network. A test that needs another answer adds its own
 * handler with `network.use()`, which takes precedence.
 */
export function useResolver(): ReturnType<typeof useNetwork> {
  const network = useNetwork();
  beforeEach(() => {
    network.use(resolver());
  });
  return network;
}
