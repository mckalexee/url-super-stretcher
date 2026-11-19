// Page for a stretched link. It shows where the link leads and leaves the decision to continue
// to the visitor, because a public redirector that forwards without a pause is a tool for
// phishing. The page never redirects by itself. It also carries the other protections: a link
// that was taken down gets a removal notice, and a destination on a security blocklist gets a
// blocked page without a link.
import { Fragment } from "react";
import { data } from "react-router";

import { log } from "#lib/log.ts";
import { resolveLink } from "#stretch/links.ts";
import { checkReputation } from "#stretch/reputation.ts";
import { cloudflareContext } from "#web/context.ts";

import type { Route } from "./+types/to.ts";

// A cached page would outlive a takedown or a new blocklist entry, and a shared cache could key
// it on less than the whole query string, which is part of the link. Search engines get nothing
// to index, so a stretched link earns its destination no ranking.
const LINK_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

// A mail body's line break, as the `mailto` scheme defines it.
const LINE_BREAK = "\r\n";

function reportHref(abuseEmail: string, longLink: string): string {
  const subject = "Report a stretched link";
  const body = ["Link:", longLink, "", "What's wrong with it:", ""].join(LINE_BREAK);
  return `mailto:${abuseEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// An internationalized name reaches the page in its ASCII form, where each label that holds
// other characters starts with `xn--`.
function isInternationalized(hostname: string): boolean {
  return hostname.split(".").some((label) => label.startsWith("xn--"));
}

/**
 * Looks the link up and decides which page the visitor gets. A path that isn't a stored link
 * throws a 404 for the error page. A link that was taken down answers 410 and names no
 * destination. A destination that the reputation check flags answers 403, with the hostname and
 * no URL, and the check runs on every view because a destination can be flagged after its link
 * was made. Every other link answers 200 with its destination. A failed check counts as no
 * objection.
 */
export async function loader({ url, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  // `url` is the address of the page. `request.url` isn't, on the data request that React Router
  // makes for a client-side navigation, where the path ends in `.data`.
  const { origin, pathname, search } = url;
  const lookup = await resolveLink(env.LINKS, pathname + search);
  if (lookup.state === "missing") {
    // The root route's `headers` export passes a thrown response's headers to the error page.
    // Without `statusText`, React Router reports the 404 as "Internal Server Error".
    throw data(null, { status: 404, statusText: "Not Found", headers: LINK_HEADERS });
  }
  if (lookup.state === "removed") {
    return data({ state: "removed" as const }, { status: 410, headers: LINK_HEADERS });
  }

  const longLink = origin + pathname + search;
  const report = reportHref(env.ABUSE_EMAIL, longLink);

  const { hostname } = new URL(lookup.link.url);
  if ((await checkReputation(hostname)) === "flagged") {
    // The hostname is safe to log, unlike the URL, whose query string can carry a token.
    log.info("stretch.view_blocked", { hostname });
    return data(
      { state: "flagged" as const, hostname, length: longLink.length, report },
      { status: 403, headers: LINK_HEADERS },
    );
  }

  return data(
    {
      state: "active" as const,
      url: lookup.link.url,
      hostname,
      internationalized: isInternationalized(hostname),
      length: longLink.length,
      report,
    },
    { headers: LINK_HEADERS },
  );
}

/** Sends the headers that the loader chose with every page that this route renders. */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

/** Page title for each state of a stretched link. */
export function meta({ loaderData }: Route.MetaArgs) {
  // A thrown 404 renders the error page with no loader data.
  const state = (loaderData as Route.ComponentProps["loaderData"] | undefined)?.state;
  if (state === "active") {
    return [{ title: "You have reached the end of the link" }];
  }
  return [{ title: state === "flagged" ? "Link blocked" : "Link removed" }];
}

const numberFormat = new Intl.NumberFormat("en-US");

// A long name wraps before a dot, so each line starts with a whole label and no label is cut in
// two while there is room for it. `<wbr>` adds no character, so a copied name stays exact.
function Hostname({ name }: { name: string }) {
  const [first, ...rest] = name.split(".");
  return (
    <>
      {first}
      {rest.map((label, index) => (
        // The labels of one name never reorder, so the position identifies each.
        // oxlint-disable-next-line react/no-array-index-key
        <Fragment key={index}>
          <wbr />
          {`.${label}`}
        </Fragment>
      ))}
    </>
  );
}

/** Page body: the destination and the way on, or the reason that there isn't one. */
export default function StretchedLinkPage({ loaderData }: Route.ComponentProps) {
  if (loaderData.state === "removed") {
    return (
      <main>
        <h1>Link removed.</h1>
        <p>
          This link was removed after a report. It no longer leads anywhere, which it now does at
          considerable length.
        </p>
      </main>
    );
  }

  if (loaderData.state === "flagged") {
    return (
      <main>
        <h1>Link blocked.</h1>
        <p>This link leads to a destination that is on a security blocklist, so it ends here.</p>
        {/* Text, not a link: the page offers no way to the destination. */}
        <p className="destination-host" data-testid="blocked-host">
          <Hostname name={loaderData.hostname} />
        </p>
        <p className="journey">
          The link is still {numberFormat.format(loaderData.length)} characters long. None of them
          lead anywhere. <a href={loaderData.report}>Report abuse</a>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1 className="destination">
        <span className="destination-label">This link goes to</span>
        <span className="destination-host" data-testid="destination-host">
          <Hostname name={loaderData.hostname} />
        </span>
      </h1>
      {loaderData.internationalized ? (
        <p className="field-error">
          This name uses non-Latin characters, shown here in their ASCII form. A name like this can
          imitate another site.
        </p>
      ) : null}
      <p className="destination-url" data-testid="destination-url">
        {loaderData.url}
      </p>
      <p className="field-hint">Check the name before you continue. Anyone can stretch a link.</p>
      <div className="result-actions">
        <a className="button button-primary" href={loaderData.url} rel="noreferrer nofollow">
          Continue
        </a>
        <a href={loaderData.report}>Report this link</a>
      </div>
      <p className="journey">
        You traveled {numberFormat.format(loaderData.length)} characters to get here. None of them
        were strictly necessary.
      </p>
    </main>
  );
}
