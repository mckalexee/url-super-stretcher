// Reputation check for a destination's hostname. It asks Cloudflare's malware-blocking DNS
// resolver about the name over DNS over HTTPS, and the resolver's block answer is the verdict.
// The check can fail without failing the caller, because the site must keep working while the
// resolver is down.
import { z } from "zod";

import { UpstreamError } from "#lib/errors.ts";
import { fetchJson } from "#lib/http.ts";
import { log } from "#lib/log.ts";

/**
 * What the resolver says about a hostname. `flagged` means that it blocks the name. `unknown`
 * means that the check itself failed, which callers treat as no objection.
 */
export type Verdict = "clean" | "flagged" | "unknown";

const RESOLVER_URL = "https://security.cloudflare-dns.com/dns-query";

// A visitor waits for this check on every creation and every view, so a slow resolver gives up
// its say long before the default timeout.
const TIMEOUT_MS = 2_000;

const A_RECORD = 1;

// The resolver answers a blocked name with this address in place of the real one.
const BLOCKED_ADDRESS = "0.0.0.0";

// Extended DNS Error 16, "Censored", which the resolver attaches to a blocked answer.
const CENSORED = /\bEDE\(16\)/;

// Only the fields that the verdict reads. `Comment` is an array today, and a lone string in
// other DNS over HTTPS JSON implementations, so both are accepted.
const dnsAnswer = z.object({
  Status: z.number(),
  Answer: z.array(z.object({ type: z.number(), data: z.string() })).optional(),
  Comment: z.union([z.string(), z.array(z.string())]).optional(),
});

/**
 * Asks the resolver whether it blocks `hostname`. Either of the resolver's two block signals
 * makes the verdict `flagged`: an A record of `0.0.0.0`, or a comment that carries the "Censored"
 * error code. A name without an A record, such as an IPv6-only host or a name that doesn't
 * exist, shows neither signal and is `clean`. A timeout, a network error, a status other than
 * 2xx, or an unexpected body gives `unknown` and a logged warning, and never throws.
 */
export async function checkReputation(hostname: string): Promise<Verdict> {
  const url = new URL(RESOLVER_URL);
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", "A");

  let answer: z.infer<typeof dnsAnswer>;
  try {
    answer = await fetchJson(url, {
      schema: dnsAnswer,
      timeoutMs: TIMEOUT_MS,
      headers: { accept: "application/dns-json" },
    });
  } catch (error) {
    if (error instanceof UpstreamError) {
      // The hostname stays out of the log. The failure is the resolver's, whatever the name was.
      log.warn("reputation.check_failed", {
        reason: error.timedOut ? "timeout" : "request_failed",
        upstreamStatus: error.upstreamStatus,
      });
      return "unknown";
    }
    if (error instanceof z.ZodError) {
      log.warn("reputation.check_failed", { reason: "invalid_body" });
      return "unknown";
    }
    throw error;
  }

  const comments = typeof answer.Comment === "string" ? [answer.Comment] : (answer.Comment ?? []);
  const censored = comments.some((comment) => CENSORED.test(comment));
  const blockedAddress = (answer.Answer ?? []).some(
    (record) => record.type === A_RECORD && record.data === BLOCKED_ADDRESS,
  );
  return censored || blockedAddress ? "flagged" : "clean";
}
