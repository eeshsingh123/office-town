import type {
  Audience,
  CatalogEntry,
  ConnectorAction,
  ConnectorAuth,
  ConnectorCatalog,
  ConnectorPermission,
  ConnectorSetup,
} from "@office-town/contract";
import { ArrowLeft, BadgeCheck, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { OptionRows } from "../../ui/Choice.tsx";
import page from "../../ui/Page.module.css";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { EVERYONE, givenToSomeone } from "../library/library.ts";
import { ActionGroups } from "./ActionGroups.tsx";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import { type AppGroup, entryTags, setUpThrough, tagsOf } from "./connectors.ts";
import { ProviderTags } from "./ProviderTags.tsx";
import { RenewAction } from "./RenewAction.tsx";
import { ConnectorSheet, Field, KeyFields, PermissionField, WhoField } from "./SheetParts.tsx";

interface AddSheetProps {
  keysAt: ConnectorCatalog["keys"];
  entries: CatalogEntry[];
  // Provider apps never set up, such as claude.ai's Gmail: listed here too, set up in the provider.
  offers: AppGroup[];
  // An app to open at once, by slug or name, such as one an agent asked for.
  app?: string;
  audience?: Audience;
  onClose: () => void;
}

interface OwnSetup {
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

function setupOf(own: OwnSetup): ConnectorSetup {
  const keyed = own.auth === "key" && own.keyName.trim() !== "";
  return {
    slug: slugOf(own.name),
    name: own.name.trim(),
    kind: own.kind,
    official: false,
    ...(own.kind === "remote"
      ? { url: own.url.trim() }
      : { command: own.command.trim(), args: argsOf(own.args) }),
    auth: own.auth,
    keys: keyed ? [{ name: own.keyName.trim(), label: "Key" }] : [],
  };
}

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

const checkedOn = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

const findEntry = (entries: CatalogEntry[], app: string | undefined) => {
  const wanted = app?.trim().toLowerCase();
  return wanted === undefined
    ? undefined
    : entries.find(({ setup }) => setup.slug === wanted || setup.name.toLowerCase() === wanted);
};

// The address or command of an app not on the list, for technical users.
function OwnFields({ own, change }: { own: OwnSetup; change: (next: Partial<OwnSetup>) => void }) {
  return (
    <>
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
          ]}
          onChange={(auth) => change({ auth })}
        />
        {own.auth === "key" ? (
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
        ) : null}
      </Field>
    </>
  );
}

// The ways a provider signs in to the app itself, which only its agents then use.
function ProviderWays({ entry, onDone }: { entry: CatalogEntry; onDone: () => void }) {
  const harnesses = useApp((state) => state.harnesses);
  const providers = [
    ...(entry.setup.kind === "claude" ? ["claude"] : []),
    ...entry.signIn.filter((provider) => provider !== entry.setup.kind),
  ].filter((provider) => harnesses.some(({ harness }) => harness === provider));
  if (providers.length === 0) return null;
  const shared = entry.setup.kind === "remote" || entry.setup.kind === "local";
  return (
    <Field label={shared ? "Or sign in through a provider" : "Sign in through"}>
      <div className={styles.ways}>
        {providers.map((provider) => {
          const name = harnesses.find(({ harness }) => harness === provider)?.name ?? provider;
          return (
            <Button
              key={provider}
              onClick={() =>
                setUpThrough(provider, entry.setup.slug).then(onDone, (failure: unknown) =>
                  showToast(errorText(failure)),
                )
              }
            >
              <ProviderTags tags={[provider]} />
              Set up in {name}
            </Button>
          );
        })}
      </div>
      <p className={styles.hint}>The provider keeps the sign-in; only its agents use the app.</p>
    </Field>
  );
}

export function AddSheet({
  keysAt,
  entries,
  offers,
  app,
  audience: asked,
  onClose,
}: AddSheetProps) {
  const [query, setQuery] = useState("");
  const [entry, setEntry] = useState(() => findEntry(entries, app));
  const [advanced, setAdvanced] = useState(
    app !== undefined && findEntry(entries, app) === undefined,
  );
  const [own, setOwn] = useState<OwnSetup>({ ...EMPTY, name: app ?? "" });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [audience, setAudience] = useState<Audience>(asked ?? EVERYONE);
  const [permission, setPermission] = useState<ConnectorPermission>("ask");
  const [tested, setTested] = useState<ConnectorAction[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const setup = entry !== undefined ? entry.setup : advanced ? setupOf(own) : undefined;
  const shared = setup !== undefined && (setup.kind === "remote" || setup.kind === "local");
  const keysGiven = (setup?.keys ?? []).every(({ name }) => (keys[name] ?? "").trim() !== "");
  const filled =
    setup !== undefined &&
    setup.name !== "" &&
    (setup.kind === "remote" ? (setup.url ?? "") !== "" : (setup.command ?? "") !== "");

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
  const pick = (next: CatalogEntry | undefined) => {
    setEntry(next);
    setKeys({});
    setTested(undefined);
    setError(undefined);
  };
  const tryIt = () =>
    run(async () => {
      if (setup !== undefined) setTested(await api.testConnector({ setup, keys }));
    });
  const save = () =>
    run(async () => {
      if (setup === undefined) return;
      await api.addConnector({ setup, audience, permission, keys });
      onClose();
    });

  const words = query.trim().toLowerCase();
  const offered = offers.filter((group) =>
    `${group.name} ${group.entry?.description ?? ""}`.toLowerCase().includes(words),
  );
  const found = entries.filter((candidate) =>
    `${candidate.setup.name} ${candidate.setup.maker ?? ""} ${candidate.description}`
      .toLowerCase()
      .includes(words),
  );

  const choosing = entry === undefined && !advanced;
  return (
    <ConnectorSheet
      logo={
        setup === undefined || choosing ? null : (
          <Button
            variant="ghost"
            icon
            aria-label="Back to the list"
            onClick={() => {
              pick(undefined);
              setAdvanced(false);
            }}
          >
            <ArrowLeft size={16} aria-hidden />
          </Button>
        )
      }
      title={choosing ? "Add an app" : `Add ${setup?.name || "an app"}`}
      by={
        choosing ? (
          "Apps checked by us"
        ) : entry === undefined ? (
          "Not on our checked list"
        ) : (
          <>
            <BadgeCheck size={13} aria-hidden />
            By {entry.setup.maker} · Checked {checkedOn(entry.checked)}
          </>
        )
      }
      onClose={onClose}
      foot={
        choosing ? (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {shared && tested === undefined ? (
              <Button
                variant="primary"
                disabled={!filled || !keysGiven || busy}
                onClick={() => void tryIt()}
              >
                {busy ? "Connecting…" : "Connect"}
              </Button>
            ) : shared ? (
              <Button
                variant="primary"
                disabled={!givenToSomeone(audience) || busy}
                onClick={() => void save()}
              >
                Save
              </Button>
            ) : null}
          </>
        )
      }
    >
      {choosing ? (
        <>
          <SearchBox value={query} onChange={setQuery} label="Search apps" autoFocus />
          <ul className={styles.list} aria-label="Apps to add">
            {offered.map((group) => {
              const [route] = group.routes;
              return route === undefined ? null : (
                <li key={group.key} className={styles.connRow}>
                  <AppLogo app={group.logo} />
                  <span className={styles.connText}>
                    <span className={styles.connName}>{group.name}</span>
                    <span className={styles.sub}>{group.entry?.description}</span>
                  </span>
                  <ProviderTags tags={tagsOf(group.routes)} />
                  <RenewAction route={route} label="Set up" />
                </li>
              );
            })}
            {found.map((candidate) => (
              <li key={candidate.setup.slug}>
                <button type="button" className={styles.connRow} onClick={() => pick(candidate)}>
                  <AppLogo app={candidate.setup.slug} />
                  <span className={styles.connText}>
                    <span className={styles.connName}>{candidate.setup.name}</span>
                    <span className={styles.sub}>{candidate.description}</span>
                  </span>
                  <ProviderTags tags={entryTags(candidate)} />
                </button>
              </li>
            ))}
          </ul>
          {found.length + offered.length === 0 ? (
            <p className={styles.empty}>No app matches.</p>
          ) : null}
          <button
            type="button"
            className={styles.fold}
            aria-expanded={false}
            onClick={() => setAdvanced(true)}
          >
            <ChevronDown size={14} aria-hidden />
            Advanced: add by address or command
          </button>
        </>
      ) : (
        <>
          {entry === undefined ? (
            <OwnFields own={own} change={(next) => setOwn({ ...own, ...next })} />
          ) : null}
          {shared && setup !== undefined ? (
            <>
              {setup.auth === "key" ? (
                <Field label="Account">
                  <KeyFields keys={setup.keys} values={keys} onChange={setKeys} keysAt={keysAt} />
                </Field>
              ) : null}
              {setup.kind === "local" ? (
                <Field label="Runs on this computer">
                  <code className={styles.code}>
                    {[setup.command, ...(setup.args ?? [])].join(" ")}
                  </code>
                </Field>
              ) : null}
              {tested === undefined ? null : (
                <>
                  <p className={styles.tested}>
                    <Check size={14} aria-hidden />
                    Connected · works for <ProviderTags tags={["all"]} />
                  </p>
                  <Field label="What agents can do">
                    <ActionGroups actions={tested} permission={permission} />
                  </Field>
                  <PermissionField value={permission} onChange={setPermission} />
                  <WhoField audience={audience} onChange={setAudience} />
                </>
              )}
            </>
          ) : null}
          {entry === undefined ? null : <ProviderWays entry={entry} onDone={onClose} />}
          {error === undefined ? null : (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </ConnectorSheet>
  );
}
