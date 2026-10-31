import type {
  Account,
  EnvironmentSpec,
  HarnessDescription,
  HarnessStatus,
} from "@office-town/contract";
import { useEffect } from "react";
import { api } from "../../api/client.ts";
import { loadLastKnown, saveLastKnown } from "../../api/last-known.ts";
import { useApp } from "../../store/app-store.ts";
import { offeredHarnesses } from "./offered.ts";

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

const READY_NAME = "ready-harnesses";

const lastReady = loadLastKnown(READY_NAME, (stored) =>
  Array.isArray(stored) ? stored.map(String) : undefined,
);

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
      saveLastKnown(
        READY_NAME,
        statuses.filter((status) => isReady(status)).map((status) => status.harness),
      );
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

// The AI apps an agent can be put on: the ones ready here, as the last launch found them until
// this one's check is in, and the one already chosen. Every one in WSL, where the app does not
// check installs (D-75).
export function useOfferedHarnesses(
  current: string | undefined,
  environment: EnvironmentSpec | undefined,
): { offered: HarnessDescription[]; checking: boolean } {
  const harnesses = useApp((state) => state.harnesses);
  const statuses = useHarnessStatuses();
  if (environment?.kind === "wsl") return { offered: [...harnesses], checking: false };
  const ready =
    statuses === undefined
      ? lastReady
      : harnesses.flatMap(({ harness }) => (isReady(statuses[harness]) ? [harness] : []));
  return {
    offered: offeredHarnesses(harnesses, ready, current),
    checking: ready === undefined,
  };
}
