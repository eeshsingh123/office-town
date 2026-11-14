import type { Audience, CatalogEntry } from "@office-town/contract";
import { CircleAlert, Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { navigate } from "../../store/app-store.ts";
import { forSession, useKept, useKeptScroll } from "../../store/kept.ts";
import { Button } from "../../ui/Button.tsx";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { AddSheet } from "./AddSheet.tsx";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import {
  type AppGroup,
  entryTags,
  groupApps,
  isOffer,
  needsRenewing,
  refreshApps,
  tagsOf,
  useCatalog,
  useConnectors,
} from "./connectors.ts";
import { ProviderTags } from "./ProviderTags.tsx";
import { RenewAction } from "./RenewAction.tsx";

interface ConnectorsViewProps {
  // An app to set up at once, by slug or name, such as one an agent asked for.
  connect?: string;
  audience?: Audience;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function AppCard({ group }: { group: AppGroup }) {
  const renewing = group.routes.find(needsRenewing);
  const actions = Math.max(...group.routes.map(({ actions }) => actions));
  const [first] = group.routes;
  if (first === undefined) return null;
  return (
    <li className={`${styles.card} ${renewing === undefined ? "" : styles.cardRenew}`}>
      <button
        type="button"
        className={`${styles.cardName} ${styles.appCard}`}
        onClick={() => navigate({ name: "connector", connectorId: first.id })}
      >
        <span className={styles.cardTop}>
          <AppLogo app={group.logo} />
          <ProviderTags tags={tagsOf(group.routes)} />
        </span>
        <span className={styles.cardTitle}>{group.name}</span>
        <span className={styles.description}>
          {group.entry?.description ?? (actions > 0 ? plural(actions, "action") : "")}
        </span>
      </button>
      {renewing === undefined ? null : (
        <div className={styles.cardFoot}>
          <span className={styles.renew}>
            <CircleAlert size={14} aria-hidden />
            Needs renewing
          </span>
          <RenewAction route={renewing} label="Renew" />
        </div>
      )}
    </li>
  );
}

// An app not set up yet: one from the vetted list, or one a provider offers before its sign-in.
function SuggestedCard({
  group,
  entry,
  action,
}: {
  group?: AppGroup;
  entry?: CatalogEntry;
  action: ReactNode;
}) {
  const name = group?.name ?? entry?.setup.name ?? "";
  const tags =
    group === undefined ? (entry === undefined ? [] : entryTags(entry)) : tagsOf(group.routes);
  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <AppLogo app={group?.logo ?? entry?.setup.slug ?? name} />
        <ProviderTags tags={tags} />
      </div>
      <span className={styles.cardTitle}>{name}</span>
      <p className={styles.description}>{entry?.description ?? group?.entry?.description}</p>
      <div className={styles.cardFoot}>
        <span />
        {action}
      </div>
    </li>
  );
}

const QUERY = forSession("connectors.query", "");
const SUGGESTED = 8;

export function ConnectorsView(props: ConnectorsViewProps) {
  const connectors = useConnectors();
  const catalog = useCatalog();
  const [query, setQuery] = useKept(QUERY);
  const scroll = useKeptScroll("connectors");
  const [adding, setAdding] = useState<{ app?: string; audience?: Audience } | null>();
  // An app asked for opens once, unless the user has closed it since.
  const sheet =
    adding === undefined
      ? props.connect === undefined
        ? null
        : {
            app: props.connect,
            ...(props.audience === undefined ? {} : { audience: props.audience }),
          }
      : adding;
  // Provider apps signed in since are read on opening and on coming back to the app.
  useEffect(() => {
    refreshApps();
    window.addEventListener("focus", refreshApps);
    return () => window.removeEventListener("focus", refreshApps);
  }, []);
  const entries = catalog?.entries ?? [];
  const groups = groupApps(connectors, entries);
  const words = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(words);
  const mine = groups
    .filter((group) => !group.routes.every(isOffer))
    .filter((group) => matches(`${group.name} ${group.entry?.description ?? ""}`))
    .toSorted(
      (a, b) =>
        Number(b.routes.some(needsRenewing)) - Number(a.routes.some(needsRenewing)) ||
        a.name.localeCompare(b.name),
    );
  const offers = groups.filter((group) => group.routes.every(isOffer) && matches(group.name));
  const known = new Set(groups.map(({ key }) => key));
  const matching = entries.filter(
    (entry) => !known.has(entry.setup.slug) && matches(`${entry.setup.name} ${entry.description}`),
  );
  // A short list keeps the page calm; a search shows every match, and Add has the rest.
  const listed =
    words === "" ? matching.slice(0, Math.max(0, SUGGESTED - offers.length)) : matching;

  return (
    <section
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      className={page.page}
      aria-labelledby="connectors-title"
    >
      <div className={styles.column}>
        <PageHeader
          id="connectors-title"
          title="Connectors"
          lead="Apps your agents can use."
          actions={
            <Button variant="primary" data-tour="connectors-add" onClick={() => setAdding({})}>
              <Plus size={14} aria-hidden />
              Add app
            </Button>
          }
        />
        <SearchBox value={query} onChange={setQuery} label="Search apps" />

        {mine.length === 0 ? null : (
          <div className={page.section}>
            <div className={page.sectionHead}>
              <h2 className={page.sectionTitle}>
                Your apps <span className={styles.chipCount}>{mine.length}</span>
              </h2>
            </div>
            <ul className={styles.grid} aria-label="Your apps">
              {mine.map((group) => (
                <AppCard key={group.key} group={group} />
              ))}
            </ul>
          </div>
        )}

        <div className={page.section}>
          <div className={page.sectionHead}>
            <h2 className={page.sectionTitle}>Suggested</h2>
          </div>
          <ul className={styles.grid} aria-label="Suggested apps">
            {offers.map((group) => {
              const [route] = group.routes;
              return route === undefined ? null : (
                <SuggestedCard
                  key={group.key}
                  group={group}
                  action={<RenewAction route={route} label="Set up" />}
                />
              );
            })}
            {listed.map((entry) => (
              <SuggestedCard
                key={entry.setup.slug}
                entry={entry}
                action={
                  <Button
                    onClick={() => setAdding({ app: entry.setup.slug })}
                    aria-label={`Set up ${entry.setup.name}`}
                  >
                    Set up
                  </Button>
                }
              />
            ))}
          </ul>
          {catalog !== undefined && listed.length === 0 && words !== "" ? (
            <p className={styles.empty}>No app matches.</p>
          ) : null}
          {listed.length < matching.length ? (
            <Button variant="ghost" className={styles.seeAll} onClick={() => setAdding({})}>
              See all {matching.length + offers.length} apps
            </Button>
          ) : null}
        </div>
      </div>
      {sheet === null ? null : (
        <AddSheet
          keysAt={catalog?.keys ?? "store"}
          entries={entries}
          {...(sheet.app === undefined ? {} : { app: sheet.app })}
          {...(sheet.audience === undefined ? {} : { audience: sheet.audience })}
          onClose={() => setAdding(null)}
        />
      )}
    </section>
  );
}
