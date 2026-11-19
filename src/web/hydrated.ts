// A hook that tells a component whether the page's script has taken over from the HTML that the
// server sent. Controls that need the script render only when it has.
import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};

/**
 * False on the server and during hydration, then true. A control that needs the script renders
 * only when this is true, so a visitor without JavaScript never sees a button that does nothing.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}
