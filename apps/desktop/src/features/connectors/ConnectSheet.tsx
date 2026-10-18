import type {
  Audience,
  CatalogEntry,
  ConnectorCatalog,
  ConnectorPermission,
  ConnectorSetup,
} from "@office-town/contract";
import { BadgeCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { Button } from "../../ui/Button.tsx";
import { EVERYONE, givenToSomeone } from "../library/library.ts";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import { openClaudeConnectors } from "./connectors.ts";
import { ConnectorSheet, Field, KeyFields, PermissionField, WhoField } from "./SheetParts.tsx";

interface ConnectSheetProps {
  entry: CatalogEntry;
  keysAt: ConnectorCatalog["keys"];
  audience?: Audience;
  onClose: () => void;
}

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

const by = (setup: CatalogEntry["setup"]) => (
  <>
    <BadgeCheck size={13} aria-hidden />
    Official, by {setup.maker}
  </>
);

// How to add an app on claude.ai, where Claude keeps its sign-in.
export function ClaudeSteps({ setup }: { setup: ConnectorSetup }) {
  return (
    <>
      <p className={styles.note}>
        {setup.name} connects in Claude, which signs you in and keeps the sign-in. Your Claude
        agents use it.
      </p>
      <ol className={styles.steps}>
        <li>Open Claude's connectors page and add {setup.name}.</li>
        {setup.url === undefined ? null : (
          <li>
            Not in Claude's list? Add a custom connector with this address: <code>{setup.url}</code>
          </li>
        )}
        <li>Come back here. It shows under Claude apps, where you choose who can use it.</li>
      </ol>
    </>
  );
}

// A sign-in app is connected on claude.ai, which keeps its sign-in; Claude agents then reach it
// and it shows under Claude apps, where who may use it is set (D-68).
function ClaudeSheet({ entry, onClose }: { entry: CatalogEntry; onClose: () => void }) {
  const { setup } = entry;
  return (
    <ConnectorSheet
      logo={<AppLogo app={setup.slug} />}
      title={`Connect ${setup.name}`}
      by={by(setup)}
      onClose={onClose}
      foot={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              openClaudeConnectors();
              onClose();
            }}
          >
            Open Claude
          </Button>
        </>
      }
    >
      <ClaudeSteps setup={setup} />
    </ConnectorSheet>
  );
}

// A key app is tried with the key on Done; one without a key at once.
function KeySheet({ entry, keysAt, audience: asked, onClose }: ConnectSheetProps) {
  const { setup } = entry;
  const [audience, setAudience] = useState<Audience>(asked ?? EVERYONE);
  const [permission, setPermission] = useState<ConnectorPermission>("ask");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const keysGiven = setup.keys.every(({ name }) => (keys[name] ?? "").trim() !== "");
  const ready = givenToSomeone(audience) && (setup.auth === "none" || keysGiven);

  const done = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.addConnector({ setup, audience, permission, keys });
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConnectorSheet
      logo={<AppLogo app={setup.slug} />}
      title={`Connect ${setup.name}`}
      by={by(setup)}
      onClose={onClose}
      foot={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready || busy} onClick={() => void done()}>
            Done
          </Button>
        </>
      }
    >
      <Field label="Account">
        {setup.auth === "key" ? (
          <KeyFields keys={setup.keys} values={keys} onChange={setKeys} keysAt={keysAt} />
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

export function ConnectSheet(props: ConnectSheetProps) {
  return props.entry.setup.kind === "claude" ? (
    <ClaudeSheet entry={props.entry} onClose={props.onClose} />
  ) : (
    <KeySheet {...props} />
  );
}
