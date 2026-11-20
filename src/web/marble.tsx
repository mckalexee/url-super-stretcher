// The moving marble: a canvas over the still marble that the stylesheet paints, on which
// `water.ts` draws the gold veins as moving light. It renders only after the page's script has
// taken over, so the HTML that the server sends has no canvas and the page is whole without
// script.
import { useEffect, useRef } from "react";

import { useHydrated } from "#web/hydrated.ts";
import { mountWater } from "#web/water.ts";

// Mounts only in the browser, so its canvas is there for its effect, and the effect runs once.
function Water() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current === null) {
      return undefined;
    }
    return mountWater(canvas.current);
  }, []);
  return (
    <div className="marble-water" aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}

/**
 * A layer of moving light over the marble of the element that it's in. Put it last in that
 * element, because the stylesheet has rules for the element's first child and for neighbors. The
 * stylesheet sizes the layer to cover the marble wherever the element shows it. It renders
 * nothing on the server and during hydration.
 */
export function Marble() {
  return useHydrated() ? <Water /> : null;
}
