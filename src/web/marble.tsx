// The moving marble: a canvas over the still marble that the stylesheet paints, on which
// `water.ts` makes the gold veins sway. It renders only after the page's script has taken over,
// so the HTML that the server sends has no canvas and the page is whole without script.
import { useEffect, useRef } from "react";

import { useHydrated } from "#web/hydrated.ts";
import { type MarbleFit, mountWater } from "#web/water.ts";

import marbleUrl from "./marble.svg?url";

// Mounts only in the browser, so its canvas is there for its effect, and the effect runs once
// for each value of `fit` and on no other render.
function Water({ fit }: { fit: MarbleFit }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current === null) {
      return undefined;
    }
    return mountWater(canvas.current, { imageUrl: marbleUrl, fit });
  }, [fit]);
  return (
    <div className="marble-water" aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}

/**
 * A layer of water over the marble of the element that it's in. Put it last in that element,
 * because the stylesheet has rules for the element's first child and for neighbors. `fit` names
 * the way the stylesheet fits the marble to that element: `cover` for the home page's stage, and
 * `top` for a page. It renders nothing on the server and during hydration.
 */
export function Marble({ fit }: { fit: MarbleFit }) {
  return useHydrated() ? <Water fit={fit} /> : null;
}
