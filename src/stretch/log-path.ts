// The form of a request path that is safe to log. In three of the four flavors a stretched
// link's path is the whole link, and whoever has the link can open its page and read the
// destination, which can carry a token. So the logs get fixed text in place of any path under
// the link prefix. The helper lives here, and not in `src/lib`, because it knows the prefix.
import { LINK_PREFIX } from "./prefix.ts";

/**
 * Returns the path to write to a log: `/to/*` for any path under the link prefix, which also
 * covers the `.data` request for a link's page, and the path itself otherwise. Pass a path
 * without its query string. Every log line that names a request's path goes through this.
 */
export function loggablePath(path: string): string {
  return path.startsWith(LINK_PREFIX) ? `${LINK_PREFIX}*` : path;
}
