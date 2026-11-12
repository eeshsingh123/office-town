import { type ConnectorRecord, providerOf } from "@office-town/contract";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { showToast } from "../../ui/Toast.tsx";
import styles from "./Connectors.module.css";
import { renewsHere, signIn } from "./connectors.ts";

// Signs a provider app in again: a button where its provider gives a page, else where to do it.
export function RenewAction({ route, label }: { route: ConnectorRecord; label: string }) {
  const harnesses = useApp((state) => state.harnesses);
  if (renewsHere(route)) {
    return (
      <Button
        variant="primary"
        onClick={() =>
          signIn(route.id).catch((failure: unknown) =>
            showToast(failure instanceof Error ? failure.message : String(failure)),
          )
        }
      >
        {label}
      </Button>
    );
  }
  const provider = providerOf(route.setup.kind) ?? "";
  const name = harnesses.find(({ harness }) => harness === provider)?.name ?? provider;
  return <span className={styles.hint}>Sign in in {name}</span>;
}
