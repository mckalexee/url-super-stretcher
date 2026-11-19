// Worker entry point and composition root, and the only module that wires the areas of `src/`
// together. The Hono app from `src/http` serves the HTTP routes.
// @starter:web
// It hands every request that no route matches to the React Router app.
// @starter:end
import { createApp } from "#http/index.ts";

const app = createApp();

const appHandler = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;

export default appHandler;
