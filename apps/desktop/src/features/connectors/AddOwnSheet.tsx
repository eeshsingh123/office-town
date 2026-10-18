import type {
  Audience,
  ConnectorAuth,
  ConnectorPermission,
  ConnectorSetup,
} from "@office-town/contract";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { Button } from "../../ui/Button.tsx";
import { OptionRows } from "../../ui/Choice.tsx";
import page from "../../ui/Page.module.css";
import { EVERYONE, givenToSomeone } from "../library/library.ts";
import styles from "./Connectors.module.css";
import { signIn } from "./connectors.ts";
import { ConnectorSheet, Field, KeyFields, PermissionField, WhoField } from "./SheetParts.tsx";

interface AddOwnSheetProps {
  keysInFile: boolean;
  // The words to look for, such as an app an agent asked for.
  describe?: string;
  audience?: Audience;
  onClose: () => void;
}

export interface OwnSetup {
  name: string;
  kind: "remote" | "local";
  url: string;
  command: string;
  args: string;
  auth: ConnectorAuth;
  // The header or variable a key fills.
  keyName: string;
}

const EMPTY: OwnSetup = {
  name: "",
  kind: "remote",
  url: "",
  command: "",
  args: "",
  auth: "none",
  keyName: "Authorization",
};

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 24) || "app";

// Arguments split on spaces, keeping quoted parts whole.
const argsOf = (text: string) =>
  [...text.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? "");

export function setupOf(own: OwnSetup, extra: Partial<ConnectorSetup> = {}): ConnectorSetup {
  const keyed = own.auth === "key" && own.keyName.trim() !== "";
  return {
    slug: slugOf(own.name),
    name: own.name.trim(),
    kind: own.kind,
    official: false,
    ...(own.kind === "remote"
      ? { url: own.url.trim() }
      : { command: own.command.trim(), args: argsOf(own.args) }),
    auth: own.kind === "local" && own.auth === "sign-in" ? "none" : own.auth,
    keys: keyed ? [{ name: own.keyName.trim(), label: "Key" }] : [],
    ...extra,
  };
}

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

export function AddOwnSheet({ keysInFile, audience: asked, onClose }: AddOwnSheetProps) {
  const [own, setOwn] = useState<OwnSetup>(EMPTY);
  const [audience, setAudience] = useState<Audience>(asked ?? EVERYONE);
  const [permission, setPermission] = useState<ConnectorPermission>("ask");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [tested, setTested] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const change = (next: Partial<OwnSetup>) => {
    setOwn({ ...own, ...next });
    setTested(undefined);
  };
  const setup = setupOf(own);
  const filled =
    setup.name !== "" &&
    (own.kind === "remote" ? own.url.trim() !== "" : own.command.trim() !== "");
  // A sign-in is tried by signing in; anything else is tried before it is added.
  const needsTest = setup.auth !== "sign-in";
  const ready = filled && givenToSomeone(audience) && (!needsTest || tested !== undefined);

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
  const test = () => run(async () => setTested(await api.testConnector({ setup, keys })));
  const add = () =>
    run(async () => {
      const connector = await api.addConnector({ setup, audience, permission, keys });
      if (setup.auth === "sign-in") await signIn(connector.id);
      onClose();
    });

  return (
    <ConnectorSheet
      logo={
        <span className={`${styles.logo} ${styles.md} ${styles.plus}`} aria-hidden>
          <Plus size={16} />
        </span>
      }
      title="Add your own"
      by="Enter its details"
      onClose={onClose}
      foot={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready || busy} onClick={add}>
            Add connector
          </Button>
        </>
      }
    >
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Name</span>
        <input
          className={page.input}
          value={own.name}
          placeholder="Blender"
          onChange={(event) => change({ name: event.target.value })}
        />
      </label>
      <Field label="Where it runs">
        <OptionRows
          name="own-kind"
          label="Where it runs"
          value={own.kind}
          options={[
            { value: "remote", title: "On the internet", description: "An address to connect to" },
            { value: "local", title: "On this computer", description: "A program the app starts" },
          ]}
          onChange={(kind) =>
            change({ kind, auth: "none", keyName: kind === "remote" ? "Authorization" : "" })
          }
        />
      </Field>
      {own.kind === "remote" ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Address</span>
          <input
            className={page.input}
            value={own.url}
            placeholder="https://example.com/mcp"
            onChange={(event) => change({ url: event.target.value })}
          />
        </label>
      ) : (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Command</span>
            <input
              className={page.input}
              value={own.command}
              placeholder="uvx"
              onChange={(event) => change({ command: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Arguments</span>
            <input
              className={page.input}
              value={own.args}
              placeholder="blender-mcp"
              onChange={(event) => change({ args: event.target.value })}
            />
          </label>
        </>
      )}
      <Field label="Signing in">
        <OptionRows
          name="own-auth"
          label="Signing in"
          value={own.auth}
          options={[
            { value: "none", title: "Nothing needed" },
            { value: "key", title: "A key" },
            ...(own.kind === "remote"
              ? [{ value: "sign-in" as const, title: "Sign in in the browser" }]
              : []),
          ]}
          onChange={(auth) => change({ auth })}
        />
        {own.auth === "key" ? (
          <>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {own.kind === "remote" ? "Header it goes in" : "Variable it goes in"}
              </span>
              <input
                className={page.input}
                value={own.keyName}
                onChange={(event) => change({ keyName: event.target.value })}
              />
            </label>
            <KeyFields keys={setup.keys} values={keys} onChange={setKeys} keysInFile={keysInFile} />
          </>
        ) : null}
      </Field>
      <WhoField audience={audience} onChange={setAudience} />
      <PermissionField value={permission} onChange={setPermission} />
      {needsTest ? (
        <Field label="Test">
          {own.kind === "local" && filled ? (
            <p className={styles.note}>
              Runs{" "}
              <span className={styles.code}>
                {[setup.command, ...(setup.args ?? [])].join(" ")}
              </span>{" "}
              on this computer.
            </p>
          ) : null}
          <div className={styles.account}>
            <span className={styles.accountText}>
              {tested === undefined ? (
                <span className={styles.sub}>Connects once and lists what it offers.</span>
              ) : (
                <span className={styles.tested}>
                  <Check size={14} aria-hidden />
                  Tested: {tested} actions
                </span>
              )}
            </span>
            <Button disabled={!filled || busy} onClick={test}>
              {own.kind === "local" ? "Run and test" : "Test"}
            </Button>
          </div>
        </Field>
      ) : null}
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </ConnectorSheet>
  );
}
