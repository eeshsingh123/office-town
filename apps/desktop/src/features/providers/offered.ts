import type { HarnessDescription } from "@office-town/contract";

// With nothing known yet, only the one chosen: an app that may not work is never shown and then
// taken away.
export function offeredHarnesses(
  harnesses: readonly HarnessDescription[],
  ready: readonly string[] | undefined,
  current: string | undefined,
): HarnessDescription[] {
  return harnesses.filter(
    ({ harness }) => harness === current || ready?.includes(harness) === true,
  );
}
