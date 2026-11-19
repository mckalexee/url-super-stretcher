// Route table for the web app. Each entry maps a URL pattern to a module in `src/web/routes`.
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("account", "routes/account.tsx"),
  // A splat, because a stretched link's path is whatever its flavor wrote.
  route("to/*", "routes/to.tsx"),
] satisfies RouteConfig;
