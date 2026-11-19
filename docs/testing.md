# Testing

Tests run inside workerd, the runtime that serves the deployed Worker, through
`@cloudflare/vitest-plugin`. They use the bindings from `wrangler.jsonc`, the real Worker entry,
and real KV storage, and they never reach the network.

## Run the tests

```sh
pnpm test                             # every test once
pnpm test test/http/healthz.test.ts   # one file
pnpm test -t "returns the message"    # tests whose name matches
pnpm test:watch                       # rerun on change
pnpm test:coverage                    # coverage report in coverage/
pnpm test --no-isolate                # every file in one shared runtime
```

Each test file runs in its own isolated runtime by default. `--no-isolate` runs them all in one,
so state that one file leaves behind, such as a KV key or a changed var, can reach the next. Run
it before you merge a change to shared helpers or to anything with module-level state. When it
fails and the normal run passes, a test depends on the order the files run in.

## Configuration

`vitest.config.ts` sets up the runtime:

- `cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })` loads the Worker's bindings
  and compatibility settings from the same file that production uses.
- `miniflare.bindings` sets every var to its value in `wrangler.jsonc` and every secret in
  `secrets.required` to its value in `TEST_SECRETS`, or to an empty string. The plugin reads
  `.dev.vars`, `.env`, and the process environment over `wrangler.jsonc`, so these bindings keep
  your local values out of the tests. Give a new secret a value in `TEST_SECRETS` unless the tests
  expect it to be unset.

- `reactRouter()` in `plugins` resolves `virtual:react-router/server-build`, so requests reach the
  real Worker entry and the real web app.
- `environments.ssr.resolve.conditions` puts back the Workers resolve conditions (`workerd`,
  `worker`, `module`, `browser`). The React Router plugin sets its own conditions for the `ssr`
  environment, which drops them, and without them packages such as `@msw/cloudflare` load their
  Node entry instead of their Workers entry. The values match the Cloudflare Vite plugin's
  production build.

- `testTimeout` is 15 seconds instead of vitest's 5. The first request in a test file loads the
  Worker and its dependencies, which can take longer than five seconds on a busy machine.
- `coverage` uses istanbul over `src/**`. Istanbul instruments the code before it runs, so it
  works inside workerd, where V8 coverage isn't available.

## Call the Worker

Import `exports` from `cloudflare:workers` and call `exports.default.fetch()` to send a request
through the real entry and every layer that it composes.

```ts
import { exports } from "cloudflare:workers";

const response = await exports.default.fetch("http://example.com/healthz");
```

The vitest plugin doesn't populate `ctx.access`. To test the `ctx.access` branch of
`resolveIdentity()`, call it directly with a context object that has an `access` property, as
`test/http/access.test.ts` does. Requests with a `Cf-Access-Jwt-Assertion` header test the JWT
branch.

## Change vars in a test

`env` from `cloudflare:workers` is the same object that the Worker reads, so assigning to it
changes what the Worker sees. Restore every change after the test, or a later test sees it. For
a one-off change, save the value and restore it in `finally`.

`useAccessVars()` from `test/helpers/access.ts` returns a setter for `ACCESS_TEAM_DOMAIN` and
`ACCESS_AUD`, and restores them after each test.

`useWebAccess()` from the same file does the same for `WEB_ACCESS`.

To pass different bindings to one call only, spread `env` into a new object, such as
`{ ...env, APP_NAME: "Test" }`, and pass it to code that takes `env` as an argument. The Hono
app's `fetch(request, env, ctx)` takes it, and its routes read the object as `c.env`.

## Mock outbound requests

Call `useNetwork()` from `test/helpers/network.ts` at the top of any test file whose code makes
outbound requests. It enables MSW through `@msw/cloudflare` for the file and returns the network
object:

- A catch-all handler answers every request that no test handler matches with a network error,
  so no test reaches the real network, and a missing mock fails fast in the code under test.
- `network.use(...handlers)` adds handlers for one test. They're removed after each test.
- If a test replaces the catch-all with `network.resetHandlers(handler)`, a request that no
  handler matches fails instead of reaching the real network.

```ts
import { http, HttpResponse } from "msw";

import { useNetwork } from "../helpers/network.ts";

const network = useNetwork();

it("reads the upstream value", async () => {
  network.use(http.get("https://api.example.com/value", () => HttpResponse.json({ value: 1 })));
  // ...
});
```

## Test Cloudflare Access

`createAccessIssuer()` from `test/helpers/access.ts` creates a fake Access issuer with its own
RS256 key pair and a random team domain:

- `issuer.certs` is an MSW handler that serves the public key at the team's certificates URL.
- `issuer.sign(claims, options)` signs an application token. The options change the audience, the
  issuer, or the expiry, or sign with an untrusted key or with HS256, to test rejections.

Each issuer has its own team domain, and the Worker caches signing keys per team domain, so no
test reuses another test's keys. A test enables the network, adds `issuer.certs`, sets the vars with
`useAccessVars()`, and sends the signed token in `Cf-Access-Jwt-Assertion`, as
`test/http/access.test.ts` does.

A private-site test also sets `WEB_ACCESS` to `private` with `useWebAccess()`, as
`test/web/account.test.ts` does.

## Logs in tests

`src/lib/log.ts` writes to `console`, so tests that expect a warning or an error spy on the
console method and parse the JSON line. Restore spies with `vi.restoreAllMocks()` in `afterEach`.
