import type {
  Account,
  EnvironmentSpec,
  HarnessDescription,
  HarnessStatus,
} from "@office-town/contract";
import { useEffect } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";

// Each logo is named by its harness; OpenCode has none, so it gets its first letter.
const FILES = import.meta.glob<string>("./logos/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
export const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([file, url]) => [file.slice("./logos/".length, -".svg".length), url]),
);
// Black marks, flipped to light in dark mode.
export const DEEP = new Set(["codex", "copilot", "cursor"]);

// The CLI's own login on this computer, which setup and Providers sign in.
export const defaultLogin = (accounts: readonly Account[], harness: string) =>
  accounts.find(
    (account) =>
      account.harness === harness &&
      account.folder === undefined &&
      account.environment.kind === "native",
  );

// Ready for an agent: installed, and signed in or needing no sign-in.
export const isReady = (status: HarnessStatus | undefined): boolean =>
  status?.installed === true && status.signedIn !== false;

// Each check starts every CLI, so one soon after the last is skipped.
const CHECK_GAP_MS = 5000;
let checking: Promise<void> | undefined;
let checkedAt = 0;

export function checkHarnesses({ now = false } = {}): Promise<void> {
  if (checking !== undefined) return checking;
  if (!now && Date.now() - checkedAt < CHECK_GAP_MS) return Promise.resolve();
  checking = api
    .readHarnessStatus()
    .then((statuses) => {
      const byHarness = Object.fromEntries(statuses.map((status) => [status.harness, status]));
      useApp.setState({ harnessStatuses: byHarness });
    })
    .finally(() => {
      checking = undefined;
      checkedAt = Date.now();
    });
  return checking;
}

// Checked once when first needed. Pages about getting an app ready check again on coming back to
// the window, as after running an install command in a terminal; each check starts every CLI.
export function useHarnessStatuses({
  recheckOnFocus = false,
} = {}): Record<string, HarnessStatus> | undefined {
  const statuses = useApp((state) => state.harnessStatuses);
  useEffect(() => {
    const check = () => void checkHarnesses().catch(() => {});
    if (recheckOnFocus || useApp.getState().harnessStatuses === undefined) check();
    if (!recheckOnFocus) return;
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [recheckOnFocus]);
  return statuses;
}

// The AI apps an agent can be put on: the ones ready here, and the one already chosen. Every one
// until the check is in, so nothing disappears while it runs, and every one in WSL, where the app
// does not check installs (D-75).
export function useOfferedHarnesses(
  current: string | undefined,
  environment: EnvironmentSpec | undefined,
): HarnessDescription[] {
  const harnesses = useApp((state) => state.harnesses);
  const statuses = useHarnessStatuses();
  if (statuses === undefined || environment?.kind === "wsl") return harnesses;
  return harnesses.filter(
    (description) => description.harness === current || isReady(statuses[description.harness]),
  );
}
