// Home page, which is the whole product: a form that takes a URL and a flavor, the action that
// stores the stretched link, and the result view that shows the long link with its statistics.
// The form posts to this route's own action, so it works without JavaScript.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { data, Form, useNavigation } from "react-router";

import { HttpError } from "#lib/errors.ts";
import { log } from "#lib/log.ts";
import { FLAVORS, isFlavorId } from "#stretch/flavors.ts";
import { createLink, isHostBlocked, parseTarget } from "#stretch/links.ts";
import { checkReputation } from "#stretch/reputation.ts";
import { cloudflareContext } from "#web/context.ts";

import type { Route } from "./+types/home.ts";

// The longest post that the specifications assume when they count posts per link.
const POST_LENGTH = 280;
// A typing speed of 40 words a minute, at the usual five characters a word.
const TYPED_CHARACTERS_PER_MINUTE = 200;

/** The numbers in the result view's report. All of them are computed on the server. */
export interface StretchStatistics {
  originalLength: number;
  stretchedLength: number;
  gained: number;
  growthPercent: number;
  posts: number;
  typingSeconds: number;
}

function measure(original: string, stretched: string): StretchStatistics {
  const gained = stretched.length - original.length;
  return {
    originalLength: original.length,
    stretchedLength: stretched.length,
    gained,
    growthPercent: Math.round((gained / original.length) * 100),
    posts: Math.ceil(stretched.length / POST_LENGTH),
    typingSeconds: Math.round((stretched.length / TYPED_CHARACTERS_PER_MINUTE) * 60),
  };
}

// The rate limiter's key for a request that has no client address. Cloudflare sets
// `CF-Connecting-IP` on every request it proxies, so only local development and tests share this
// key.
const UNKNOWN_CLIENT = "unknown";

// A file upload in a text field's place counts as an empty field.
function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Gives the page its flavors. They come from the loader, not from an import in the component, so
 * the flavor generators stay out of the browser bundle.
 */
export function loader() {
  return { flavors: FLAVORS.map(({ id, name, description }) => ({ id, name, description })) };
}

/**
 * Stretches the submitted URL and stores the link. A rejected input comes back with status 400,
 * the visitor's values, and a message for the field at fault, so the form renders again with
 * nothing lost. A destination that was banned or that is on a security blocklist is rejected the
 * same way. A client that creates more than five links a minute gets status 429. A method other
 * than `POST` gets status 405 on the error page. Any other failure propagates to the error
 * boundary.
 */
export async function action({ request, context }: Route.ActionArgs) {
  // React Router runs the action for `PUT`, `PATCH`, and `DELETE` too. The form only posts, so
  // anything else is turned away before it reads the body or spends a rate limit token. The root
  // route's `headers` export passes `Allow` to the error page.
  if (request.method !== "POST") {
    throw data(null, {
      status: 405,
      statusText: "Method Not Allowed",
      headers: { Allow: "GET, HEAD, POST" },
    });
  }
  const { env } = context.get(cloudflareContext);
  const origin = new URL(request.url);
  const form = await request.formData();
  const values = { url: textField(form, "url"), flavor: textField(form, "flavor") };

  if (!isFlavorId(values.flavor)) {
    return data(
      {
        ok: false as const,
        field: "flavor" as const,
        message: "Select a finish.",
        values,
      },
      { status: 400 },
    );
  }

  const reject = (status: number, message: string) =>
    data({ ok: false as const, field: "url" as const, message, values }, { status });

  let target: URL;
  try {
    target = parseTarget(values.url, origin.hostname);
  } catch (error) {
    if (error instanceof HttpError) {
      return reject(error.status, error.message);
    }
    throw error;
  }

  // Only a submission that would create a link counts against the limit, so this comes after the
  // input checks. It comes before every lookup, so a flood costs one call each and nothing more.
  const client = request.headers.get("CF-Connecting-IP") ?? UNKNOWN_CLIENT;
  const { success } = await env.CREATE_LIMITER.limit({ key: client });
  if (!success) {
    log.info("stretch.rate_limited");
    return reject(429, "The limit is five links per minute. Try again in a minute.");
  }

  if (await isHostBlocked(env.LINKS, target.hostname)) {
    return reject(400, "Links to that destination aren't available.");
  }
  // A failed check lets the link through, because an outage of the resolver must not take the
  // site down. The link's page checks again on every view.
  if ((await checkReputation(target.hostname)) === "flagged") {
    log.info("stretch.target_flagged", { hostname: target.hostname });
    return reject(400, "That destination is on a security blocklist.");
  }

  const link = await createLink(env.LINKS, target, values.flavor);
  const longLink = origin.origin + link.path;
  const statistics = measure(link.url, longLink);
  // The lengths say how well the product works. The URLs stay out of the log, because a query
  // string can carry a token.
  log.info("stretch.link_created", {
    flavor: link.flavor,
    originalLength: statistics.originalLength,
    stretchedLength: statistics.stretchedLength,
  });
  return { ok: true as const, longLink, flavor: link.flavor, statistics };
}

/** Title and description for the home route. */
export function meta() {
  return [
    { title: "URL Super Stretcher" },
    {
      name: "description",
      content: "Make your links appear longer and more intimidating.",
    },
  ];
}

const numberFormat = new Intl.NumberFormat("en-US");

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? `${rest} s` : `${numberFormat.format(minutes)} min ${rest} s`;
}

const subscribeToNothing = () => () => {};

// False on the server and during hydration, then true. Controls that need the script render only
// when this is true, so a visitor without JavaScript never sees a button that does nothing.
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

function CopyButton({ text }: { text: string }) {
  const hydrated = useHydrated();
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  if (!hydrated) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        className="button button-primary"
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => setStatus("copied"),
            () => setStatus("failed"),
          );
        }}
      >
        Copy
      </button>
      {/* The live region is in the page before its text changes, so screen readers announce it. */}
      <output className="copy-status">
        {status === "copied" ? "Copied" : null}
        {status === "failed" ? "Couldn't copy. Select the link and copy it manually." : null}
      </output>
    </>
  );
}

function Result({ longLink, statistics }: { longLink: string; statistics: StretchStatistics }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // An enhanced submission doesn't load a new page, so focus moves to the result to tell
  // keyboard and screen reader users that it arrived. The page gives each result a new key, so
  // this runs once per stretched link.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section aria-labelledby="result-heading">
      <h1 id="result-heading" ref={heading} tabIndex={-1}>
        Your link is ready
      </h1>
      <p className="long-link" data-testid="long-link">
        {longLink}
      </p>
      <div className="result-actions">
        <CopyButton text={longLink} />
        <a className="button" href={longLink} rel="nofollow noreferrer">
          Open
        </a>
      </div>
      <table className="report">
        <caption>Specifications</caption>
        <tbody>
          <tr>
            <th scope="row">Original length</th>
            <td>{numberFormat.format(statistics.originalLength)} characters</td>
          </tr>
          <tr>
            <th scope="row">New length</th>
            <td>{numberFormat.format(statistics.stretchedLength)} characters</td>
          </tr>
          <tr>
            <th scope="row">Increase</th>
            <td>{numberFormat.format(statistics.growthPercent)}%</td>
          </tr>
          <tr>
            <th scope="row">Characters added</th>
            <td>{numberFormat.format(statistics.gained)}</td>
          </tr>
          <tr>
            <th scope="row">Posts required to share, at {POST_LENGTH} characters each</th>
            <td>{numberFormat.format(statistics.posts)}</td>
          </tr>
          <tr>
            <th scope="row">
              Time to type by hand, at {TYPED_CHARACTERS_PER_MINUTE} characters per minute
            </th>
            <td>{formatDuration(statistics.typingSeconds)}</td>
          </tr>
          <tr>
            <th scope="row">Destination</th>
            <td>Unchanged</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/** Home page body: the result of the last stretch, when there is one, and the form. */
export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const stretching = navigation.state === "submitting";
  const result = actionData?.ok ? actionData : null;
  const rejection = actionData && !actionData.ok ? actionData : null;
  const urlError = rejection?.field === "url" ? rejection.message : null;
  const flavorError = rejection?.field === "flavor" ? rejection.message : null;
  const chosenFlavor = loaderData.flavors.some((flavor) => flavor.id === rejection?.values.flavor)
    ? rejection?.values.flavor
    : (result?.flavor ?? loaderData.flavors[0]?.id);

  const urlInput = useRef<HTMLInputElement>(null);
  // After an enhanced submission is rejected, focus returns to the field, where the message is.
  // Each rejection is a new object, so this also runs when the same message comes back twice.
  useEffect(() => {
    if (rejection?.field === "url") {
      urlInput.current?.focus();
    }
  }, [rejection]);

  return (
    <main>
      {result ? (
        <Result key={result.longLink} longLink={result.longLink} statistics={result.statistics} />
      ) : (
        <>
          <h1 className="hero-title">
            <span>Your link is</span> <span>too short</span>
          </h1>
          <p className="lede">Make your links appear longer and more intimidating.</p>
        </>
      )}

      {result ? <h2 className="again">Stretch another link</h2> : null}
      {/* A new key after each success clears the field, so the next link starts from empty. */}
      <Form method="post" className="stretch-form" key={result?.longLink ?? "first"}>
        <div>
          <label className="field-label" htmlFor="url">
            Your link
          </label>
          <input
            ref={urlInput}
            className="field-input"
            id="url"
            name="url"
            // Not `type="url"`: the server decides what counts as a link, and its message says
            // why, which the browser's own check would replace with a generic one.
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://example.com"
            defaultValue={rejection?.values.url ?? ""}
            aria-invalid={urlError === null ? undefined : true}
            aria-describedby={urlError === null ? undefined : "url-error"}
          />
          {urlError === null ? null : (
            <p className="field-error" id="url-error">
              {urlError}
            </p>
          )}
        </div>

        <fieldset
          className="flavors"
          aria-describedby={flavorError === null ? undefined : "flavor-error"}
        >
          <legend>Finish</legend>
          <div className="flavor-list">
            {loaderData.flavors.map((flavor) => (
              <label className="flavor" key={flavor.id}>
                <input
                  type="radio"
                  name="flavor"
                  value={flavor.id}
                  defaultChecked={flavor.id === chosenFlavor}
                />
                <span className="flavor-name">{flavor.name}</span>
                <span className="flavor-description">{flavor.description}</span>
              </label>
            ))}
          </div>
          {flavorError === null ? null : (
            <p className="field-error" id="flavor-error">
              {flavorError}
            </p>
          )}
        </fieldset>

        <button type="submit" className="button button-primary" disabled={stretching}>
          {stretching ? "Stretching" : "Stretch link"}
        </button>
      </Form>
    </main>
  );
}
