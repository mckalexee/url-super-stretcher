// Home page, which is the whole product: a form that takes a URL and a flavor, the action that
// stores the stretched link, and the result view that shows the long link with its statistics.
// The form posts to this route's own action, so it works without JavaScript.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { data, Form, useNavigation } from "react-router";

import { HttpError } from "#lib/errors.ts";
import { log } from "#lib/log.ts";
import { FLAVORS, generateStretch, isFlavorId, type RandomSource } from "#stretch/flavors.ts";
import { createLink, isHostBlocked, parseTarget } from "#stretch/links.ts";
import { checkReputation } from "#stretch/reputation.ts";
import { type CoilRun, startCoil } from "#web/coil.ts";
import { cloudflareContext } from "#web/context.ts";
import { useHydrated } from "#web/hydrated.ts";
import { Marble } from "#web/marble.tsx";
import { useMotionAllowed } from "#web/motion.ts";
import { SHARE_IMAGES, shareMeta } from "#web/share.ts";
import { typedShare } from "#web/typing.ts";

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

// Takes lengths, not strings, so that the result view can also measure a link that is only
// partly typed while its animation runs.
function measure(originalLength: number, stretchedLength: number): StretchStatistics {
  const gained = stretchedLength - originalLength;
  return {
    originalLength,
    stretchedLength,
    gained,
    growthPercent: Math.round((gained / originalLength) * 100),
    posts: Math.ceil(stretchedLength / POST_LENGTH),
    typingSeconds: Math.round((stretchedLength / TYPED_CHARACTERS_PER_MINUTE) * 60),
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

// How much of a stretched link the gold bar on the home page has room for.
const SAMPLE_LENGTH = 220;
// The bar runs off the left edge of the page, so its text starts partway through a word.
const SAMPLE_START = 3;

// Bytes from a fixed sequence, so every visitor sees the same engraving.
const sampleRandom: RandomSource = (bytes) => {
  let state = 7;
  for (let index = 0; index < bytes.length; index += 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    bytes[index] = Math.floor(state / 65_536) % 256;
  }
};

/**
 * Gives the page its flavors, each with a piece of its own output for the gold bar. They come
 * from the loader, not from an import in the component, so the flavor generators stay out of
 * the browser bundle. The site's origin goes along for the share tags.
 */
export function loader({ url }: Route.LoaderArgs) {
  return {
    origin: url.origin,
    flavors: FLAVORS.map(({ id, name, description }) => ({
      id,
      name,
      description,
      sample: generateStretch(id, sampleRandom).slice(SAMPLE_START, SAMPLE_START + SAMPLE_LENGTH),
    })),
  };
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
  const statistics = measure(link.url.length, longLink.length);
  // The lengths say how well the product works. The URLs stay out of the log, because a query
  // string can carry a token.
  log.info("stretch.link_created", {
    flavor: link.flavor,
    originalLength: statistics.originalLength,
    stretchedLength: statistics.stretchedLength,
  });
  return { ok: true as const, longLink, original: link.url, flavor: link.flavor, statistics };
}

const DESCRIPTION = "Make your links appear longer and more intimidating.";

/** Title, description, and share tags for the home route. */
export function meta({ loaderData }: Route.MetaArgs) {
  // The error page renders this route's meta with no loader data.
  const origin = (loaderData as Route.ComponentProps["loaderData"] | undefined)?.origin;
  return [
    { title: "URL Super Stretcher" },
    { name: "description", content: DESCRIPTION },
    ...(origin === undefined
      ? []
      : shareMeta({
          origin,
          title: "URL Super Stretcher",
          description: DESCRIPTION,
          image: SHARE_IMAGES.home,
          path: "/",
        })),
  ];
}

const numberFormat = new Intl.NumberFormat("en-US");

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? `${rest} s` : `${numberFormat.format(minutes)} min ${rest} s`;
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
        className="button button-solid"
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

// How long the result takes to fade in, in milliseconds. It matches the `result-arrive`
// animation in the stylesheet. The typing waits for it, so the first characters arrive on a
// result that the visitor can already see.
const FADE_MS = 250;
// How long the long link takes to type over the visitor's link, in milliseconds, after the fade.
// At this length, a link of 1,900 characters types its first dozen in about 0.4 seconds, slow
// enough to read them one by one, and the curve's fast end types its last thousand in about
// half a second, so the end never seems to stall.
const TYPING_MS = 4000;
// The number of characters at the typing position that take the accent color.
const LEADING_EDGE = 10;

/**
 * Runs the result's typing: the long link is typed over the visitor's own link, one character at
 * a time from the left. Returns how many characters are typed, or `null` when the link is at
 * rest. A result that arrives without a page load types, while the motion switch allows motion,
 * unless `atRest` says that it arrived some other way. A result that the server rendered is at
 * rest. A pause in the middle sends the link to rest for good, so a later resume doesn't type it
 * again.
 */
function useTyping(stretchedLength: number, atRest: boolean): number | null {
  const motion = useMotionAllowed();
  // The switch is off on the server and during hydration, so only a result that first renders
  // in the browser can start typing. Deciding here, and not in an effect, makes the first
  // painted frame the starting one.
  const [running, setRunning] = useState(motion && !atRest);
  const [typed, setTyped] = useState(0);
  if (running && !motion) {
    setRunning(false);
  }

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const stop = new AbortController();
    const start = performance.now();
    const tick = (now: number) => {
      if (stop.signal.aborted) {
        return;
      }
      const t = (now - start - FADE_MS) / TYPING_MS;
      if (t >= 1) {
        setRunning(false);
        return;
      }
      setTyped(Math.floor(stretchedLength * typedShare(t)));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => stop.abort();
  }, [running, stretchedLength]);
  return running ? typed : null;
}

// The link in the well while it's typed. Every frame holds as many characters as the long link,
// in one monospace face, and the stylesheet breaks lines at any character, so each line break
// stays where it is at rest and the well never changes size.
function TypedLink({
  longLink,
  original,
  typed,
}: {
  longLink: string;
  original: string;
  typed: number;
}) {
  const edge = Math.min(LEADING_EDGE, typed);
  const covered = Math.max(typed, original.length);
  return (
    <>
      {longLink.slice(0, typed - edge)}
      <span className="long-link-edge">{longLink.slice(typed - edge, typed)}</span>
      {typed < original.length ? (
        <>
          {/* Assistive technology reads the long link whole in every frame. The part of it that
              the visitor's link still covers is read from here, and the visitor's link is
              hidden from it. */}
          <span className="long-link-unseen">{longLink.slice(typed, original.length)}</span>
          <span className="long-link-old" aria-hidden="true">
            {original.slice(typed)}
          </span>
        </>
      ) : null}
      {/* Laid out but invisible, so the well has its final size from the first frame. */}
      <span className="long-link-pending">{longLink.slice(covered)}</span>
    </>
  );
}

// The text of the figures that the coil counts while the rows land, for a link of a given
// length, formatted as the result formats them.
function countedFigures(
  originalLength: number,
  length: number,
): readonly [string, string, string, string] {
  const shown = measure(originalLength, length);
  return [
    `${numberFormat.format(shown.growthPercent)}%`,
    `${numberFormat.format(shown.stretchedLength)} characters`,
    numberFormat.format(shown.gained),
    numberFormat.format(shown.posts),
  ];
}

// `atRest` is for a result that the coil brought in: it's mounted once the coil has written the
// link, so it neither fades in nor types. The first render reads it, and a later change does
// nothing.
function Result({
  longLink,
  original,
  statistics,
  atRest,
}: {
  longLink: string;
  original: string;
  statistics: StretchStatistics;
  atRest: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // An enhanced submission doesn't load a new page, so focus moves to the result to tell
  // keyboard and screen reader users that it arrived. The page gives each result a new key, so
  // this runs once per stretched link.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const typed = useTyping(statistics.stretchedLength, atRest);
  // The first render decides the fade, as it decides the typing. The stylesheet runs the fade
  // only while the motion switch is on, so a pause stops it too.
  const [arriving] = useState(typed !== null);
  // While the link types, every figure describes the link in the well, so the text and the
  // numbers agree in every frame. Until the typing passes the end of the visitor's link, the
  // well holds a link as long as the visitor's, which shows no growth.
  const shown =
    typed === null
      ? statistics
      : measure(statistics.originalLength, Math.max(typed, statistics.originalLength));

  return (
    <section
      className={arriving ? "result result-arriving" : "result"}
      aria-labelledby="result-heading"
    >
      <div>
        <h1 id="result-heading" ref={heading} tabIndex={-1}>
          Your link is ready
        </h1>
        <dl className="figure">
          <dt>Increase</dt>
          <dd>{numberFormat.format(shown.growthPercent)}%</dd>
        </dl>
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
              <td>{numberFormat.format(shown.originalLength)} characters</td>
            </tr>
            <tr>
              <th scope="row">New length</th>
              <td>{numberFormat.format(shown.stretchedLength)} characters</td>
            </tr>
            <tr>
              <th scope="row">Characters added</th>
              <td>{numberFormat.format(shown.gained)}</td>
            </tr>
            <tr>
              <th scope="row">Posts required to share, at {POST_LENGTH} characters each</th>
              <td>{numberFormat.format(shown.posts)}</td>
            </tr>
            <tr>
              <th scope="row">
                Time to type by hand, at {TYPED_CHARACTERS_PER_MINUTE} characters per minute
              </th>
              <td>{formatDuration(shown.typingSeconds)}</td>
            </tr>
            <tr>
              <th scope="row">Destination</th>
              <td>Unchanged</td>
            </tr>
          </tbody>
        </table>
      </div>
      {/* At rest, the paragraph holds the long link as one text node. */}
      <p className="long-link" data-testid="long-link">
        {typed === null ? (
          longLink
        ) : (
          <TypedLink longLink={longLink} original={original} typed={typed} />
        )}
      </p>
    </section>
  );
}

// The button's label while a stretch is pending. Screen readers hear the same word while the coil
// plays.
const STRETCHING = "Stretching";

type ActionData = Route.ComponentProps["actionData"];
type StretchResult = Extract<NonNullable<ActionData>, { ok: true }>;
type Rejection = Extract<NonNullable<ActionData>, { ok: false }>;

// A coil in progress. `before` is the action's answer that the home page showed when the visitor
// submitted, so the home page stays exactly as it was while the coil runs over it. The phase is
// `deciding` for the one render before the coil starts or the page gives it up, `writing` while
// the link coils, and `landing` once the result is mounted for the finale.
interface CoilState {
  before: ActionData;
  phase: "deciding" | "writing" | "landing";
}

/** Home page body: the result of the last stretch, when there is one, and the form. */
export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const stretching = navigation.state === "submitting";
  const motion = useMotionAllowed();

  // The action's answer that the page last saw. A new one is the moment to decide on the coil,
  // and deciding during the render, not in an effect, keeps the result off the screen until the
  // decision is made. A result that the server rendered is the first answer seen, so it never
  // coils.
  const [seen, setSeen] = useState(actionData);
  const [coil, setCoil] = useState<CoilState | null>(null);
  // The long link of a result that has to arrive at rest, because the coil brought it in or was
  // stopped on its way.
  const [restingLink, setRestingLink] = useState<string | null>(null);
  // The home form's generation, which is part of its key. The coil overwrites the field, so a
  // coil that ends without a result, as on a navigation to the home page, leaves a new form.
  const [homeForm, setHomeForm] = useState(0);
  if (actionData !== seen) {
    setSeen(actionData);
    if (coil !== null) {
      setHomeForm((generation) => generation + 1);
    }
    // Only a stretch from the home page's form coils. The form under a result has no field on
    // the coil's line.
    const fromHome = !(seen?.ok ?? false);
    setCoil(actionData?.ok && fromHome && motion ? { before: seen, phase: "deciding" } : null);
  }

  const result: StretchResult | null = actionData?.ok ? actionData : null;
  // While the coil plays, the home page shows the answer from before the submission.
  const homeData = coil === null ? actionData : coil.before;
  const rejection: Rejection | null = homeData && !homeData.ok ? homeData : null;
  const urlError = rejection?.field === "url" ? rejection.message : null;
  const flavorError = rejection?.field === "flavor" ? rejection.message : null;
  // A rejection belongs to the home page's form, and the form under a result starts from the
  // result's finish.
  const flavorFor = (shown: StretchResult | null) => {
    const rejected = shown ? undefined : rejection?.values.flavor;
    return loaderData.flavors.some((flavor) => flavor.id === rejected)
      ? rejected
      : (shown?.flavor ?? loaderData.flavors[0]?.id);
  };

  const urlInput = useRef<HTMLInputElement>(null);
  // After an enhanced submission is rejected, focus returns to the field, where the message is.
  // Each rejection is a new object, so this also runs when the same message comes back twice.
  useEffect(() => {
    if (rejection?.field === "url") {
      urlInput.current?.focus();
    }
  }, [rejection]);

  const homeMain = useRef<HTMLElement>(null);
  const resultMain = useRef<HTMLElement>(null);
  const run = useRef<CoilRun | null>(null);
  const longLink = result?.longLink;
  const originalLength = result?.statistics.originalLength;
  // The coil's steps run in layout effects, so each one is done before the browser paints: the
  // decision, before the first frame of the new result, and the finale's setup, before the first
  // frame of the mounted result.
  useLayoutEffect(() => {
    if (coil === null) {
      // Whatever ended the coil, nothing of it outlives it.
      run.current?.cancel();
      run.current = null;
      return;
    }
    if (longLink === undefined || originalLength === undefined) {
      return;
    }
    // The page shows the result at rest synchronously, so the frame after the coil's last one
    // already has it.
    const rest = () => {
      run.current = null;
      flushSync(() => {
        setRestingLink(longLink);
        setCoil(null);
      });
    };
    if (coil.phase === "deciding") {
      const home = homeMain.current;
      const field = home?.querySelector<HTMLInputElement>(".field-input");
      run.current =
        home && field
          ? startCoil({
              home,
              field,
              longLink,
              originalLength,
              figures: (length) => countedFigures(originalLength, length),
              announcement: STRETCHING,
              onComplete: () => setCoil((current) => current && { ...current, phase: "landing" }),
              onLanded: rest,
              onDropped: rest,
            })
          : null;
      setCoil(run.current === null ? null : { ...coil, phase: "writing" });
    } else if (coil.phase === "landing") {
      const landed = resultMain.current !== null && run.current?.land(resultMain.current);
      if (!landed) {
        run.current = null;
        setRestingLink(longLink);
        setCoil(null);
      }
    }
  }, [coil, longLink, originalLength]);
  // A page that leaves mid-coil takes the coil with it.
  useLayoutEffect(
    () => () => {
      run.current?.cancel();
      run.current = null;
    },
    [],
  );

  // The home page's form keeps its key while the coil plays, so the field keeps the visitor's
  // link for the coil to overwrite, and its button keeps the label it had at the submission. The
  // result's form is new for each result, which clears its field.
  //
  // In the finale, the home page and the result are both in the page. The frozen form is inert,
  // so it gives up its ids, and the ids and the label of the result's form stay unique.
  const renderForm = (shown: StretchResult | null) => {
    const frozen = shown === null && coil !== null;
    const busy = stretching || frozen;
    const id = (name: string) => (frozen ? undefined : name);
    return (
      <Form
        method="post"
        className={shown ? "stretch-form again" : "stretch-form"}
        key={shown ? `form:${shown.longLink}` : `form:home:${homeForm}`}
      >
        {shown ? <h2>Stretch another link</h2> : null}
        <fieldset
          className="flavors"
          aria-describedby={flavorError === null || shown ? undefined : id("flavor-error")}
        >
          <legend>Finish</legend>
          <div className="flavor-list">
            {loaderData.flavors.map((flavor) => (
              <label className="flavor" key={flavor.id}>
                <input
                  type="radio"
                  name="flavor"
                  value={flavor.id}
                  defaultChecked={flavor.id === flavorFor(shown)}
                />
                <span className="flavor-name">{flavor.name}</span>
                <span className="flavor-description">{flavor.description}</span>
              </label>
            ))}
          </div>
          {flavorError === null || shown ? null : (
            <p className="field-error" id={id("flavor-error")}>
              {flavorError}
            </p>
          )}
        </fieldset>

        <div className="go">
          <label className="field-label" htmlFor={id("url")}>
            Your link
          </label>
          <input
            // The form that leaves with the coil gives the ref up, so the ref always points at
            // the form that stays.
            ref={frozen ? undefined : urlInput}
            className="field-input"
            id={id("url")}
            name="url"
            // Not `type="url"`: the server decides what counts as a link, and its message says
            // why, which the browser's own check would replace with a generic one.
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://example.com"
            defaultValue={shown ? "" : (rejection?.values.url ?? "")}
            aria-invalid={urlError === null || shown ? undefined : true}
            aria-describedby={urlError === null || shown ? undefined : id("url-error")}
          />
          <button type="submit" className="button button-solid" disabled={busy}>
            {busy ? STRETCHING : "Stretch link"}
          </button>
          {urlError === null || shown ? null : (
            <p className="field-error" id={id("url-error")}>
              {urlError}
            </p>
          )}
        </div>
      </Form>
    );
  };

  // The home page and the result are separate `main` elements with their own keys. For most of
  // the coil the page is the home page alone, and in the finale the result follows it, so that
  // the home page can fade out over the result while each keeps its elements.
  const homeView = (
    <main key="home" ref={homeMain} className="home" inert={coil !== null}>
      {/* A picture of the product, with one bar for each finish. The stylesheet shows the bar
          of the chosen finish. */}
      <div className="stage" aria-hidden="true">
        {loaderData.flavors.map((flavor) => (
          <div className="rig" data-flavor={flavor.id} key={flavor.id}>
            <div className="bar-shadow" />
            <div className="bar bar-sharp">{flavor.sample}</div>
            <div className="bar bar-soft">{flavor.sample}</div>
          </div>
        ))}
        {/* Last, because the stylesheet picks the first bar as the first child. */}
        <Marble />
      </div>
      <div className="hero">
        <h1>Your link is too short</h1>
        <p className="lede">Make your links appear longer and more intimidating.</p>
      </div>
      {renderForm(null)}
    </main>
  );
  const resultView =
    result === null ? null : (
      <main key="result" ref={resultMain}>
        <Result
          // Each stretched link gets a new result, which types again. The prefix keeps this key
          // apart from the form's, because the two are siblings.
          key={`result:${result.longLink}`}
          longLink={result.longLink}
          original={result.original}
          statistics={result.statistics}
          atRest={coil !== null || restingLink === result.longLink}
        />
        {renderForm(result)}
        {/* A result is on the marble that every page has. The form page's marble is the
            stage's. */}
        <Marble />
      </main>
    );

  if (coil === null) {
    return resultView ?? homeView;
  }
  return coil.phase === "landing" ? (
    <>
      {homeView}
      {resultView}
    </>
  ) : (
    homeView
  );
}
