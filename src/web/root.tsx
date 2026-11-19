// Root route of the web app. It owns the HTML document shell, the site header and footer, the
// stylesheet, the identity gate that keeps private routes private, and the error page that every
// route renders inside.
import type { ReactNode } from "react";
import {
  type ErrorResponse,
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from "react-router";

import { LINK_PREFIX } from "#stretch/prefix.ts";
import { cloudflareContext } from "#web/context.ts";
import { useHydrated } from "#web/hydrated.ts";
import { Marble } from "#web/marble.tsx";
import { requireIdentityMiddleware } from "#web/middleware.ts";
import { setMotionPaused, useMotionPaused, usePrefersReducedMotion } from "#web/motion.ts";

import type { Route } from "./+types/root.ts";

import stylesheet from "./app.css?url";

// Route patterns that anyone may see on a private site, written the way React Router reports
// them: `/` for the index route, and the path from `routes.ts` without a leading slash for any
// other, such as `blog/:slug`. Every other route needs a Cloudflare Access identity, so a new
// route stays private until you add it here.
const PUBLIC_PATHS = new Set(["/", "to/*"]);

/** Runs the identity gate for every route that isn't in the public list. */
export const middleware: Route.MiddlewareFunction[] = [
  (args, next) => (PUBLIC_PATHS.has(args.pattern) ? next() : requireIdentityMiddleware(args, next)),
];

/**
 * Gives the footer the address that takes abuse reports. It comes from a var, so the address
 * changes without a change to the code.
 */
export function loader({ context }: Route.LoaderArgs) {
  return { abuseEmail: context.get(cloudflareContext).env.ABUSE_EMAIL };
}

/**
 * Passes the headers of a thrown response to the error page. Only the root route's `headers`
 * export runs when this route's error boundary renders, so without this a route that throws a
 * response with `Cache-Control` would lose it.
 */
export function headers({ errorHeaders }: Route.HeadersArgs) {
  return errorHeaders ?? {};
}

/** Loads the site's stylesheet on every page, including the error page. */
export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];

// The footer control that pauses and resumes motion. Its hooks also start the motion store on
// every page, including the error page, so the stylesheet's switch is set even where no other
// component asks about motion. The control needs the script, so it renders only after hydration,
// and a visitor whose system asks for reduced motion has nothing to pause.
function MotionControl() {
  const hydrated = useHydrated();
  const reducedMotion = usePrefersReducedMotion();
  const paused = useMotionPaused();
  if (!hydrated || reducedMotion) {
    return null;
  }
  return (
    <p>
      <button type="button" className="link-button" onClick={() => setMotionPaused(!paused)}>
        {paused ? "Resume motion" : "Pause motion"}
      </button>
    </p>
  );
}

/** Document shell shared by every route, including error boundaries. */
export function Layout({ children }: { children: ReactNode }) {
  // The loader doesn't run when the identity gate rejects the request or no route matches, and
  // the footer then goes without the link. The copyright line needs no data, so it's always there.
  const abuseEmail = useRouteLoaderData<typeof loader>("root")?.abuseEmail;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* A phone's browser colors its own bars to match the page. */}
        <meta name="theme-color" content="#0b0907" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
      </head>
      <body>
        <header className="site-header">
          <Link to="/" className="site-name">
            URL Super Stretcher
          </Link>
        </header>
        {children}
        <footer className="site-footer">
          {abuseEmail ? (
            <p>
              <a href={`mailto:${abuseEmail}`}>Report abuse</a>
            </p>
          ) : null}
          <MotionControl />
          <p className="site-credit">© 2026 Alex McKenzie</p>
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** Renders the matched child route. */
export default function App() {
  return <Outlet />;
}

// Fixed text for common statuses. The status text of a thrown response isn't used, because
// `data()` leaves it to the runtime, which can report a 403 as "Internal Server Error".
const STATUS_MESSAGES: Record<number, string> = {
  400: "The request isn't valid.",
  401: "Sign in to see this page.",
  403: "You don't have access to this page.",
  404: "This page doesn't exist.",
  405: "This page doesn't accept that method.",
};

// A route that throws `data({ message }, { status })` chose that message for the person reading
// the page, so it wins over the fixed text.
function messageFor(error: ErrorResponse): string {
  const body: unknown = error.data;
  if (typeof body === "object" && body !== null && "message" in body) {
    const { message } = body;
    if (typeof message === "string") {
      return message;
    }
  }
  return STATUS_MESSAGES[error.status] ?? "The request failed.";
}

/**
 * Error page for every route. For a thrown response, it shows the status and the message that
 * the route supplied, or fixed text for the status. Anything else gets a generic message, so that
 * internal errors never reach the browser.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { pathname } = useLocation();
  if (isRouteErrorResponse(error)) {
    return (
      <main>
        <h1>{error.status}</h1>
        <p>{messageFor(error)}</p>
        {error.status === 404 && pathname.startsWith(LINK_PREFIX) ? (
          <p className="error-note">
            If you followed a stretched link, part of it is missing. Copy the entire link and try
            again.
          </p>
        ) : null}
        <Marble fit="top" />
      </main>
    );
  }
  return (
    <main>
      <h1>Error</h1>
      <p>Something went wrong.</p>
      <Marble fit="top" />
    </main>
  );
}
