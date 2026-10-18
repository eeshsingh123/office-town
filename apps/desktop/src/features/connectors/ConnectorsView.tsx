import type {
  Audience,
  CatalogEntry,
  ConnectorCategory,
  ConnectorRecord,
} from "@office-town/contract";
import { BadgeCheck, ChevronRight, Plus, Search } from "lucide-react";
import { useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import page from "../../ui/Page.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { audienceNames } from "../library/library.ts";
import { AddOwnSheet } from "./AddOwnSheet.tsx";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import { ConnectSheet } from "./ConnectSheet.tsx";
import {
  CATEGORIES,
  needsUser,
  permissionTitle,
  signIn,
  useCatalog,
  useConnectors,
} from "./connectors.ts";

type Sheet =
  | { kind: "connect"; entry: CatalogEntry; audience?: Audience }
  | { kind: "own"; describe?: string; audience?: Audience };

interface ConnectorsViewProps {
  // An app to connect at once, by slug or name, such as one an agent asked for.
  connect?: string;
  audience?: Audience;
}

function trouble({ status, enabled }: ConnectorRecord): string | undefined {
  if (!enabled) return "Turned off";
  if (status === "signed_out") return "Signed out";
  if (status === "failing") return "Not answering";
  return undefined;
}

function ConnectedRow({ connector }: { connector: ConnectorRecord }) {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const { setup, audience, permission } = connector;
  const problem = trouble(connector);
  const signedOut = connector.enabled && connector.status === "signed_out";
  return (
    <li className={styles.connItem}>
      <button
        type="button"
        className={`${styles.connRow} ${signedOut ? styles.withAction : ""}`}
        onClick={() => navigate({ name: "connector", connectorId: connector.id })}
      >
        <AppLogo app={setup.slug} />
        <span className={styles.connText}>
          <span className={styles.connName}>{setup.name}</span>
          <span className={`${styles.sub} ${needsUser(connector) ? styles.warn : ""}`}>
            {problem ??
              `${audienceNames(audience, departments, agents)} · ${permissionTitle(permission)}`}
          </span>
        </span>
        {signedOut ? null : <ChevronRight size={16} className={styles.go} aria-hidden />}
      </button>
      {/* Beside the row, not in it, so one button never holds another. */}
      {signedOut ? (
        <Button
          variant="primary"
          className={styles.connAction}
          onClick={() =>
            signIn(connector.id).catch((failure: unknown) => showToast(String(failure)))
          }
        >
          Sign in again
        </Button>
      ) : null}
    </li>
  );
}

function CatalogCard({ entry, onConnect }: { entry: CatalogEntry; onConnect: () => void }) {
  const { setup, description } = entry;
  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <AppLogo app={setup.slug} />
        <Button onClick={onConnect} aria-label={`Connect ${setup.name}`}>
          Connect
        </Button>
      </div>
      <span className={styles.cardName}>
        <span className={styles.cardTitle}>{setup.name}</span>
        <span className={styles.by}>
          <BadgeCheck size={13} aria-hidden />
          Official, by {setup.maker}
        </span>
      </span>
      <p className={styles.description}>{description}</p>
    </li>
  );
}

function firstSheet(entries: CatalogEntry[] | undefined, props: ConnectorsViewProps) {
  const { connect, audience } = props;
  if (connect === undefined || entries === undefined) return undefined;
  const wanted = connect.toLowerCase();
  const entry = entries.find(
    ({ setup }) => setup.slug === wanted || setup.name.toLowerCase() === wanted,
  );
  const preset = audience === undefined ? {} : { audience };
  return entry === undefined
    ? ({ kind: "own", describe: connect, ...preset } as const)
    : ({ kind: "connect", entry, ...preset } as const);
}

export function ConnectorsView(props: ConnectorsViewProps) {
  const connectors = useConnectors();
  const catalog = useCatalog();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ConnectorCategory | "all">("all");
  const [chosen, setChosen] = useState<Sheet | null>();
  // An app asked for opens once the catalog is in, unless the user has closed it since.
  const sheet = chosen === undefined ? firstSheet(catalog?.entries, props) : chosen;
  const connected = new Set(connectors.map(({ setup }) => setup.slug));
  const words = query.trim().toLowerCase();
  const shown = (catalog?.entries ?? []).filter(
    ({ setup, category: kind, description }) =>
      !connected.has(setup.slug) &&
      (category === "all" || kind === category) &&
      `${setup.name} ${description}`.toLowerCase().includes(words),
  );

  return (
    <section className={page.page} aria-labelledby="connectors-title">
      <div className={styles.column}>
        <header className={page.header}>
          <h1 id="connectors-title" className={page.title}>
            Connectors
          </h1>
          <p className={page.lead}>Apps your agents can use.</p>
        </header>

        {connectors.length === 0 ? null : (
          <div className={page.section}>
            <div className={page.sectionHead}>
              <h2 className={page.sectionTitle}>
                Connected <span className={styles.chipCount}>{connectors.length}</span>
              </h2>
            </div>
            <ul className={styles.list} aria-label="Connected apps">
              {connectors.map((connector) => (
                <ConnectedRow key={connector.id} connector={connector} />
              ))}
            </ul>
          </div>
        )}

        <div className={page.section}>
          <div className={page.sectionHead}>
            <h2 className={page.sectionTitle}>Add a connector</h2>
          </div>
          <label className={styles.search}>
            <Search size={15} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Search apps"
              aria-label="Search apps"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <fieldset className={`${form.row} ${form.group}`}>
            <legend className="visually-hidden">Show</legend>
            {[{ value: "all" as const, label: "All" }, ...CATEGORIES].map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={form.chip}
                aria-pressed={category === choice.value}
                onClick={() => setCategory(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </fieldset>
          <ul className={styles.grid} aria-label="Apps to connect">
            <li className={`${styles.card} ${styles.own}`}>
              <div className={styles.cardTop}>
                <span className={`${styles.logo} ${styles.md} ${styles.plus}`} aria-hidden>
                  <Plus size={16} />
                </span>
                <Button onClick={() => setChosen({ kind: "own" })}>Add</Button>
              </div>
              <span className={styles.cardName}>
                <span className={styles.cardTitle}>Add your own</span>
                <span className={styles.by}>Any app not listed</span>
              </span>
              <p className={styles.description}>
                Describe it, or enter its address or command by hand.
              </p>
            </li>
            {shown.map((entry) => (
              <CatalogCard
                key={entry.setup.slug}
                entry={entry}
                onConnect={() => setChosen({ kind: "connect", entry })}
              />
            ))}
          </ul>
          {catalog !== undefined && shown.length === 0 && words !== "" ? (
            <p className={styles.empty}>No app matches. Add your own instead.</p>
          ) : null}
        </div>
      </div>
      {sheet?.kind === "connect" ? (
        <ConnectSheet
          entry={sheet.entry}
          keysInFile={catalog?.keysInFile ?? false}
          {...(sheet.audience === undefined ? {} : { audience: sheet.audience })}
          onClose={() => setChosen(null)}
        />
      ) : null}
      {sheet?.kind === "own" ? (
        <AddOwnSheet
          keysInFile={catalog?.keysInFile ?? false}
          {...(sheet.describe === undefined ? {} : { describe: sheet.describe })}
          {...(sheet.audience === undefined ? {} : { audience: sheet.audience })}
          onClose={() => setChosen(null)}
        />
      ) : null}
    </section>
  );
}
