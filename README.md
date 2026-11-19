# url-super-stretcher

A Cloudflare Worker with tests that run in workerd and GitHub Actions workflows for CI, pull
request Previews, and production deploys.

It serves a server-rendered web app, which Cloudflare Access can make private.

## What you get

**Web app.** A React Router 8 app rendered on the server, behind Hono. Cloudflare Access identity
reaches loaders and API routes.

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

- `http://localhost:5173/`: the web app's home page.
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
