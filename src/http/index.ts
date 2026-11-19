// Hono application that serves every request the Worker entry hands it. It owns the plain HTTP
// routes.
// It passes everything else to the React Router app.
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createRequestHandler, RouterContextProvider } from "react-router";

import { type Identity, resolveIdentity } from "#http/access.ts";
import { handleError } from "#http/errors.ts";
import { logRequests } from "#http/logging.ts";
import { apiRoutes } from "#http/routes/api.ts";
import { healthRoutes } from "#http/routes/health.ts";
import { linkRoutes } from "#http/routes/links.ts";
import { cloudflareContext, identityResolverContext } from "#web/context.ts";

const handleWebRequest = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/** Builds the Hono app with its middleware and routes registered in match order. */
export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.use(logRequests);
  // Hono's defaults set no Content-Security-Policy, and this app adds none, so each project sets
  // the policy that fits it.
  // A policy must allow the inline scripts that React Router uses for hydration.
  app.use(
    secureHeaders({
      // Nothing here is meant to be framed.
      xFrameOptions: "DENY",
      // HSTS belongs in the zone's SSL/TLS settings. With `includeSubDomains`, a value sent from
      // this Worker would also bind every other host on the domain.
      strictTransportSecurity: false,
    }),
  );
  app.onError(handleError);

  app.route("/", healthRoutes);
  app.route("/api", apiRoutes);
  app.route("/", linkRoutes);

  // The catch-all is registered last so that every Hono route matches before React Router.
  app.all("*", (c) => {
    const ctx = c.executionCtx;
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env: c.env, ctx });
    // Resolving an identity can mean fetching Access's signing keys, so it waits until the
    // identity gate asks for it, and a public page never pays for it.
    let identity: Promise<Identity | null> | undefined;
    context.set(identityResolverContext, () => {
      identity ??= resolveIdentity(c.req.raw, c.env, ctx);
      return identity;
    });
    return handleWebRequest(c.req.raw, context);
  });

  return app;
}
