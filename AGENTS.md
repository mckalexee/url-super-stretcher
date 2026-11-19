# url-super-stretcher

One Cloudflare Worker with Hono in front. The README says what the project is and how to run it.
This file holds what you need to change it well.

Halves present: web app.

The web app is React Router 8 behind Hono, and Cloudflare Access can make it private.

## Commands

```sh
pnpm install                         # also runs pnpm typegen
pnpm dev                             # http://localhost:5173, secrets from .dev.vars
pnpm verify                          # format, lint, typecheck, tests, build, deploy dry run
pnpm test:watch                      # tests in watch mode
pnpm test:coverage                   # istanbul coverage report in coverage/
pnpm test test/http/healthz.test.ts  # one test file
pnpm fmt                             # fix formatting
pnpm typegen                         # regenerate the generated types
pnpm tail                            # stream the deployed Worker's live logs
pnpm takedown '<long link URL>'      # disable a reported link, see docs/abuse.md
```

- A change is done when `pnpm verify` passes. Run it before you report a change as finished.
- Never deploy unless the user asks you to. To deploy by hand, run `pnpm run deploy`, never
  `pnpm deploy`, which is a built-in pnpm command. A push to `main` deploys through
  `.github/workflows/deploy.yml` once the repository variable `DEPLOY_ENABLED` is `true`.
- Each pull request gets a Worker Preview named `pr-<number>`, and a comment with its URL.

## Layout

`src/worker.ts` is the composition root, the only module that knows about every area. Import a
module outside the current directory through its `#` subpath with the file extension, such as
`#lib/log.ts`. [docs/conventions.md](docs/conventions.md#file-layout-and-naming) has the rules.

## Checklists

### Add a route

- HTTP route: add it to a router in `src/http/routes/`, mount it in `src/http/index.ts` before
  the catch-all, and throw `HttpError` for failures. Add `requireIdentity()` for a private route.
- Web page: add a module in `src/web/routes/` and an entry in `src/web/routes.ts`. On a private
  site, it needs an Access identity unless its pattern is in `PUBLIC_PATHS` in `src/web/root.tsx`.
- Add tests in `test/http/` or `test/web/`.

### Add a binding, var, or secret

1. Declare it at the top level of `wrangler.jsonc`.
2. Declare it again in the `previews` block. Previews inherit nothing from production.
3. For a secret, add its name to `secrets.required`, which you create if it's missing, describe
   it in `.dev.vars.example`, and give it a test value in `vitest.config.ts`.
4. Run `pnpm typegen`.
5. Tell the user to set the production secret before the next deploy. `wrangler deploy` fails
   while a required secret is missing. [docs/deploy.md](docs/deploy.md) covers Preview secrets.

## Invariants

- Never log a token, secret, cookie, or other credential. Log an ID to say who made a request.
- pnpm refuses a dependency version that's younger than one day. To use one, commit its
  `minimumReleaseAgeExclude` entry in `pnpm-workspace.yaml`, or pick an older version.

- A stretched link's KV key is `link:` plus the SHA-256 of everything after `/to/` in its path
  and query, because a KV key is limited to 512 bytes and a link is longer. Never use the link
  itself as a key. `linkKey()` in `src/stretch/records.ts` is the one place that derives it.
- A KV key `blocked-host:<hostname>` in the same namespace bans a hostname: lowercase, no
  trailing dot, ASCII form. Only its existence matters. The match is exact, so it doesn't cover
  subdomains.
- The server never redirects a stretched link: no `Location` header and no meta refresh. The
  page shows the destination first. Its script sends the visitor on after a 10-second countdown
  that the visitor can stop, and never for an internationalized hostname, a blocked link, or a
  removed one.
- `src/stretch/records.ts` and `src/stretch/takedown.ts` also run in Node.js, for
  `scripts/takedown.ts`. Keep bindings and other Workers-only APIs and types out of them.
- A failed reputation check lets a link through. Never turn a resolver outage into an error.
- Never log a stretched link's path, because the path is the link. Pass every request path that
  you log through `loggablePath()` in `src/stretch/log-path.ts`.

- Identity goes through `src/http/access.ts`. `ctx.access` is absent behind the static assets
  router in production, so `access.ts` verifies the `Cf-Access-Jwt-Assertion` header itself.
  Don't read `ctx.access` anywhere else.
- `access.dev.aud` in `wrangler.jsonc` must equal `ACCESS_AUD`, or `pnpm dev` has no identity.

- `WEB_ACCESS` alone decides whether the web app is private. It has the same value in `vars` and
  `previews.vars`.

## Writing

Follow [docs/conventions.md](docs/conventions.md) for structure, comments, errors, logging, and
prose: a header comment in every source file, prose JSDoc without tags on exports, comments that
explain why, and the Google developer documentation style with no em dashes.

Visitor-facing copy has its own voice and its own rules, in [docs/copy.md](docs/copy.md). That
covers every string on a page and the word lists in `src/stretch/flavors.ts`. Read it before you
change any of them. Claude Fable writes and reviews copy in the main session: a subagent on a
smaller model never writes it, and the owner sees new copy before it's applied.

Topic guides:

- [docs/copy.md](docs/copy.md): the deadpan voice, who writes copy, and the rules for it.
- [docs/design.md](docs/design.md): the site's look, its typefaces, its colors, and how to use
  the taste skill here.

- [docs/deploy.md](docs/deploy.md): secrets, Previews, the API token, and Renovate.
- [docs/testing.md](docs/testing.md): the test runtime and helpers.
- [docs/abuse.md](docs/abuse.md): the abuse protections, takedowns, and hostname bans.

- [docs/web.md](docs/web.md): the web app, identity, and the Cloudflare Access applications.
