# url-super-stretcher

URL Super Stretcher is a satirical website at [urlsuperstretcher.com](https://urlsuperstretcher.com)
that does the opposite of a link shortener. You paste a URL, pick a flavor, and get an absurdly
long link that still redirects to the original. The flavors are corporate jargon, legalese, a long
run of o's, and a pile of tracking parameters.

It's one Cloudflare Worker that serves a server-rendered web app and stores the links in Workers
KV. Tests run in workerd, and GitHub Actions workflows cover CI, pull request Previews, and
production deploys.

## What you get

**Web app.** A React Router 8 app rendered on the server, behind Hono. The home page's form works
without JavaScript. Cloudflare Access identity reaches loaders and API routes.

**Stretched links.** `src/stretch` writes the long links and stores them in the `LINKS` KV
namespace. `GET /to/*` redirects a stored link to its original URL.

**Tooling.** Hono serves `/healthz` and maps errors to responses. Tests run in workerd, the same
runtime as production, with no network access. GitHub Actions run CI on every pull request, deploy
a Worker Preview per pull request, and deploy to production on every push to `main`. Renovate
groups and pins dependency updates.

## Stack

`package.json` pins the exact version of every package.

- **Runtime and CLI:** `wrangler`
- **HTTP:** `hono`
- **Build:** `vite`, `@cloudflare/vite-plugin`
- **Language:** `typescript`
- **Lint and format:** `oxlint`, `oxlint-tsgolint`, `oxfmt`
- **Tests:** `vitest`, `@cloudflare/vitest-plugin`, `@vitest/coverage-istanbul`
- **Network mocks:** `msw`, `@msw/cloudflare`
- **Tooling:** Node.js 24, pnpm 12

- **Web app:** `react-router`, `react`, `react-dom`, `isbot`

- **Access tokens:** `jose`

## Run it locally

You need Node.js 24 and pnpm 12. Install the dependencies. The install also generates the
TypeScript types for the Worker.

```sh
pnpm install
```

Start the dev server:

```sh
pnpm dev
```

The dev server listens on port 5173 and stops if another process holds that port. It serves:

- `http://localhost:5173/healthz`: the health check.

- `http://localhost:5173/`: the home page, with the form that stretches a link.
- `http://localhost:5173/to/...`: a stretched link, which redirects to its original URL. A path
  that isn't a stored link gets the 404 page.
- `http://localhost:5173/account`: the signed-in Access identity, or a public-mode note.
- `http://localhost:5173/api/me`: the same identity as JSON.

## Deploy

CI runs `pnpm verify` on every pull request. Once the repository has its Cloudflare secrets and
the variable `DEPLOY_ENABLED` set to `true`, each pull request also gets a Worker Preview, and each
push to `main` deploys to production. To deploy by hand, run `pnpm run deploy`. The `run` is
required, because `pnpm deploy` is a built-in pnpm command.
[docs/deploy.md](docs/deploy.md) covers secrets, Previews, custom domains, and the API token.

## Documentation

- [AGENTS.md](AGENTS.md): commands, checklists, and invariants for changing the code. `CLAUDE.md`
  is a symlink to it.
- [docs/conventions.md](docs/conventions.md): the opinions on structure, naming, comments, errors,
  logging, dependencies, and writing style.
- [docs/deploy.md](docs/deploy.md): secrets, Previews, custom domains, Renovate, and observability.
- [docs/testing.md](docs/testing.md): how tests run in workerd and the test helpers.

- [docs/web.md](docs/web.md): the React Router app, identity in loaders, public mode, and the
  Cloudflare Access applications.

## License

This project is licensed under the [MIT License](LICENSE).
