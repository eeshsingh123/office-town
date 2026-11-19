import type { EnvironmentSpec } from "@office-town/contract";
import { useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { InstallSheet } from "../providers/InstallSheet.tsx";
import { FREE_PROVIDER, isReady, useHarnessStatuses } from "../providers/providers.ts";
import styles from "./Composer.module.css";

export const NO_PROVIDER = "No provider is ready yet.";

// True once every provider is checked and none can run a task. The app does not check installs
// in WSL (D-75), so a task that runs there is never held back.
export function useNoProvider(environment: EnvironmentSpec | undefined): boolean {
  const harnesses = useApp((state) => state.harnesses);
  const statuses = useHarnessStatuses();
  if (statuses === undefined || environment?.kind === "wsl") return false;
  if (harnesses.some(({ harness }) => statuses[harness] === undefined)) return false;
  return !harnesses.some(({ harness }) => isReady(statuses[harness]));
}

// One line above the task box: the free provider to install, or another in Providers.
export function NoProvider() {
  const free = useApp((state) => state.harnesses.find((one) => one.harness === FREE_PROVIDER));
  const [installing, setInstalling] = useState(false);
  return (
    <div className={styles.noProvider} role="status">
      <span>
        {NO_PROVIDER}{" "}
        {free === undefined ? "" : `${free.name} has free models and needs no account, or `}
        <button
          type="button"
          className={styles.inlineLink}
          onClick={() => navigate({ name: "providers" })}
        >
          {free === undefined ? "Set one up in Providers" : "pick another in Providers"}
        </button>
        .
      </span>
      {free === undefined ? null : (
        <Button variant="primary" onClick={() => setInstalling(true)}>
          Install {free.name}
        </Button>
      )}
      {free === undefined || !installing ? null : (
        <InstallSheet
          harness={free.harness}
          onSignIn={() => navigate({ name: "provider", harness: free.harness })}
          onClose={() => setInstalling(false)}
        />
      )}
    </div>
  );
}
