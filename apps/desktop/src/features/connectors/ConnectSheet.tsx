import type { Audience, CatalogEntry, ConnectorPermission } from "@office-town/contract";
import { BadgeCheck, Check } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { EVERYONE, givenToSomeone } from "../library/library.ts";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import { signIn } from "./connectors.ts";
import { ConnectorSheet, Field, KeyFields, PermissionField, WhoField } from "./SheetParts.tsx";

interface ConnectSheetProps {
  entry: CatalogEntry;
  keysInFile: boolean;
  audience?: Audience;
  onClose: () => void;
}

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

// A sign-in app is saved when the user signs in, so the core can take the app's answer; a key
// app is tried with the key on Done.
export function ConnectSheet({ entry, keysInFile, audience: asked, onClose }: ConnectSheetProps) {
  const { setup } = entry;
  const [audience, setAudience] = useState<Audience>(asked ?? EVERYONE);
  const [permission, setPermission] = useState<ConnectorPermission>("ask");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [connectorId, setConnectorId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const status = useApp((state) =>
    connectorId === undefined ? undefined : state.connectors[connectorId]?.status,
  );
  const signedIn = status === "connected";
  const keysGiven = setup.keys.every(({ name }) => (keys[name] ?? "").trim() !== "");
  const ready =
    givenToSomeone(audience) &&
    (setup.auth === "sign-in" ? signedIn : setup.auth === "none" || keysGiven);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const startSignIn = () =>
    run(async () => {
      const id =
        connectorId ??
        (
          await api.addConnector({
            setup,
            audience: givenToSomeone(audience) ? audience : EVERYONE,
            permission,
          })
        ).id;
      setConnectorId(id);
      await signIn(id);
    });

  const done = () =>
    run(async () => {
      if (connectorId === undefined) {
        await api.addConnector({ setup, audience, permission, keys });
      } else {
        await api.changeConnector(connectorId, { audience, permission });
      }
      onClose();
    });

  // One the user left before signing in is not kept.
  const cancel = () => {
    if (connectorId !== undefined && !signedIn) void api.removeConnector(connectorId);
    onClose();
  };

  return (
    <ConnectorSheet
      logo={<AppLogo app={setup.slug} />}
      title={`Connect ${setup.name}`}
      by={
        <>
          <BadgeCheck size={13} aria-hidden />
          Official, by {setup.maker}
        </>
      }
      onClose={cancel}
      foot={
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready || busy} onClick={done}>
            Done
          </Button>
        </>
      }
    >
      <Field label="Account">
        {setup.auth === "sign-in" ? (
          <div className={styles.account}>
            {signedIn ? (
              <span className={styles.check}>
                <Check size={13} strokeWidth={3} aria-hidden />
              </span>
            ) : null}
            <span className={styles.accountText}>
              <b>{signedIn ? "Signed in" : `Sign in to ${setup.name}`}</b>
              <span className={styles.sub}>
                {signedIn
                  ? "Your agents use this account."
                  : connectorId === undefined
                    ? "Its own page opens in your browser."
                    : "Finish in your browser, then come back."}
              </span>
            </span>
            <Button variant={signedIn ? "ghost" : "primary"} disabled={busy} onClick={startSignIn}>
              {signedIn ? "Change" : connectorId === undefined ? "Sign in" : "Open again"}
            </Button>
          </div>
        ) : setup.auth === "key" ? (
          <KeyFields keys={setup.keys} values={keys} onChange={setKeys} keysInFile={keysInFile} />
        ) : (
          <p className={styles.note}>No sign-in needed.</p>
        )}
      </Field>
      <WhoField audience={audience} onChange={setAudience} />
      <PermissionField value={permission} onChange={setPermission} />
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </ConnectorSheet>
  );
}
