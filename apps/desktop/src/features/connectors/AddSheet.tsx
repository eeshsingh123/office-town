import type {
  Audience,
  CatalogEntry,
  ConnectorAction,
  ConnectorAuth,
  ConnectorCatalog,
  ConnectorPermission,
  ConnectorSetup,
  DestinationKind,
} from "@office-town/contract";
import { providerOf } from "@office-town/contract";
import { ArrowLeft, BadgeCheck, Check, Plug } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { OptionRows } from "../../ui/Choice.tsx";
import page from "../../ui/Page.module.css";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { EVERYONE, givenToSomeone } from "../library/library.ts";
import { ActionGroups } from "./ActionGroups.tsx";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import { type AppGroup, CATEGORIES, isOffer, setUpThrough } from "./connectors.ts";
import { SERVICES } from "./destinations.ts";
import { ProviderTags } from "./ProviderTags.tsx";
import { RenewAction } from "./RenewAction.tsx";
import { SendSheet } from "./SendResults.tsx";
import { ConnectorSheet, Field, KeyFields, PermissionField, WhoField } from "./SheetParts.tsx";

interface AddSheetProps {
  keysAt: ConnectorCatalog["keys"];
  entries: CatalogEntry[];
  // Every app the user has; provider apps never set up, such as claude.ai's Gmail, are listed here
  // too and set up in the provider.
  groups: AppGroup[];
  // An app to open at once, by slug or name, such as one an agent asked for.
  app?: string;
  audience?: Audience;
  // Opens on the services automations send results to.
  sendResults?: boolean;
  onClose: () => void;
}

// Not a kind of app agents use: the services the core sends automation results to (D-130).
const SEND = "send";
const SERVICE_LIST = Object.entries(SERVICES).map(([kind, service]) => ({
  kind: kind as DestinationKind,
  ...service,
}));

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

// How the user gets an app, in words: "Key, or sign in through Codex".
function waysIn(entry: CatalogEntry, nameOf: (harness: string) => string): string {
  const providers = [
    ...(entry.setup.kind === "claude" ? ["claude"] : []),
    ...entry.signIn.filter((provider) => provider !== entry.setup.kind),
  ].map(nameOf);
  const through = providers.length === 0 ? "" : `sign in through ${providers.join(" or ")}`;
  const own =
    entry.setup.kind === "local"
      ? "Runs on this computer"
      : entry.setup.kind === "remote"
        ? entry.setup.auth === "key"
          ? "Key"
          : "No sign-in"
        : "";
  if (own === "") return through.charAt(0).toUpperCase() + through.slice(1);
  return through === "" ? own : `${own}, or ${through}`;
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
              <ProviderTags tags={[provider]} named={false} />
              Set up in {name}
            </Button>
          );
        })}
      </div>
    </Field>
  );
}

export function AddSheet({
  keysAt,
  entries,
  groups,
  app,
  audience: asked,
  sendResults = false,
  onClose,
}: AddSheetProps) {
  const harnesses = useApp((state) => state.harnesses);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(sendResults ? SEND : "");
  const [service, setService] = useState<DestinationKind>();
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

  const nameOf = (harness: string) =>
    harnesses.find((known) => known.harness === harness)?.name ?? harness;
  const words = query.trim().toLowerCase();
  const inCategory = (listed: CatalogEntry | undefined) =>
    category === "" || listed?.category === category;
  const services = SERVICE_LIST.filter(
    (one) =>
      (category === "" || category === SEND) &&
      `${one.label} ${one.description}`.toLowerCase().includes(words),
  );
  const offers = groups.filter((group) => group.routes.every(isOffer));
  const offered = offers.filter(
    (group) =>
      inCategory(group.entry) &&
      `${group.name} ${group.entry?.description ?? ""}`.toLowerCase().includes(words),
  );
  // An app the user already has opens its page; listed first, so what is set up is seen first.
  const added = new Map(
    groups
      .filter((group) => !group.routes.every(isOffer))
      .flatMap((group) =>
        group.entry === undefined ? [] : [[group.entry.setup.slug, group] as const],
      ),
  );
  const found = entries
    .filter(
      (candidate) =>
        !offers.some((group) => group.entry?.setup.slug === candidate.setup.slug) &&
        inCategory(candidate) &&
        `${candidate.setup.name} ${candidate.setup.maker ?? ""} ${candidate.description}`
          .toLowerCase()
          .includes(words),
    )
    .toSorted((a, b) => Number(added.has(b.setup.slug)) - Number(added.has(a.setup.slug)));

  const choosing = entry === undefined && !advanced;
  if (service !== undefined) {
    return <SendSheet kind={service} onBack={() => setService(undefined)} onClose={onClose} />;
  }
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
                {busy ? "Connecting" : "Connect"}
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
          <fieldset className={styles.categories}>
            <legend className="visually-hidden">Kind of app</legend>
            {[
              { value: "", label: "All" },
              ...CATEGORIES,
              { value: SEND, label: "Send results" },
            ].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`${styles.toggleChip} ${category === value ? styles.toggleOn : ""}`}
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <ul className={styles.list} aria-label="Apps to add">
            {category === SEND ? null : (
              <li>
                <button type="button" className={styles.connRow} onClick={() => setAdvanced(true)}>
                  <span className={`${styles.logo} ${styles.md}`} aria-hidden>
                    <Plug size={16} />
                  </span>
                  <span className={styles.connText}>
                    <span className={styles.connName}>Add your own</span>
                    <span className={styles.sub}>An address or a program on this computer</span>
                  </span>
                </button>
              </li>
            )}
            {offered.map((group) => {
              const [route] = group.routes;
              if (route === undefined) return null;
              const provider = providerOf(route.setup.kind);
              return (
                <li key={group.key} className={styles.connRow}>
                  <AppLogo app={group.logo} />
                  <span className={styles.connText}>
                    <span className={styles.connName}>{group.name}</span>
                    <span className={styles.twoLines}>{group.entry?.description}</span>
                  </span>
                  <RenewAction
                    route={route}
                    label={`Set up in ${provider === undefined ? "the provider" : nameOf(provider)}`}
                  />
                </li>
              );
            })}
            {found.map((candidate) => {
              const [first] = added.get(candidate.setup.slug)?.routes ?? [];
              return (
                <li key={candidate.setup.slug}>
                  <button
                    type="button"
                    className={styles.connRow}
                    onClick={() => {
                      if (first === undefined) {
                        pick(candidate);
                        return;
                      }
                      onClose();
                      navigate({ name: "connector", connectorId: first.id });
                    }}
                  >
                    <AppLogo app={candidate.setup.slug} />
                    <span className={styles.connText}>
                      <span className={styles.connName}>{candidate.setup.name}</span>
                      <span className={styles.twoLines}>{candidate.description}</span>
                      <span className={styles.sub}>{waysIn(candidate, nameOf)}</span>
                    </span>
                    {first === undefined ? null : <span className={styles.when}>Added</span>}
                  </button>
                </li>
              );
            })}
            {services.map((one) => (
              <li key={one.kind}>
                <button
                  type="button"
                  className={styles.connRow}
                  onClick={() => setService(one.kind)}
                >
                  <AppLogo app={one.label} />
                  <span className={styles.connText}>
                    <span className={styles.connName}>{one.label}</span>
                    <span className={styles.twoLines}>{one.description}</span>
                    <span className={styles.sub}>Sends automation results, set up with a key</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {found.length + offered.length + services.length === 0 ? (
            <p className={styles.empty}>No app matches.</p>
          ) : null}
        </>
      ) : (
        <>
          {entry === undefined ? (
            <OwnFields own={own} change={(next) => setOwn({ ...own, ...next })} />
          ) : null}
          {shared && setup !== undefined ? (
            <>
              {setup.auth === "key" ? (
                <KeyFields keys={setup.keys} values={keys} onChange={setKeys} keysAt={keysAt} />
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
                    <ActionGroups actions={tested} />
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
