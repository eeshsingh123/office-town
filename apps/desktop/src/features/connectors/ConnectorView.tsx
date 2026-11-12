import {
  type ConnectorAction,
  type ConnectorCall,
  type ConnectorChange,
  type ConnectorRecord,
  providerOf,
  workPlacesOf,
} from "@office-town/contract";
import { CircleAlert, CircleCheck, Ellipsis, Globe, KeyRound, Monitor } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { knowAgents } from "../../store/live.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Crumbs } from "../../ui/Crumbs.tsx";
import { ago, taskName } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import page from "../../ui/Page.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { AudienceMenu, useHolders } from "../library/GivenToMenu.tsx";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import { ActionGroups, actionWords } from "./ActionGroups.tsx";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import {
  groupApps,
  isProviderApp,
  needsRenewing,
  PERMISSIONS,
  tagsOf,
  useCatalog,
  useConnectors,
} from "./connectors.ts";
import { ProviderTags } from "./ProviderTags.tsx";
import { RenewAction } from "./RenewAction.tsx";

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

async function changeAll(routes: ConnectorRecord[], update: ConnectorChange) {
  try {
    await Promise.all(routes.map(({ id }) => api.changeConnector(id, update)));
  } catch (failure) {
    showToast(errorText(failure));
  }
}

const PLACES = { app: "In the app", background: "In the background", cloud: "In the cloud" };

function signedInText(route: ConnectorRecord, accountName: string | undefined): string {
  const { setup } = route;
  if (setup.kind === "claude")
    return `Signed in on claude.ai${accountName ? ` · ${accountName}` : ""}`;
  // Codex names a server from the user's own Codex settings "server:<name>"; the rest are ChatGPT's.
  if (setup.kind === "codex") {
    return `Signed in through ${setup.app?.startsWith("server:") ? "Codex" : "ChatGPT"}`;
  }
  if (setup.kind === "opencode") return "Signed in through OpenCode";
  if (setup.kind === "local") return "A program on this computer";
  return setup.auth === "key" ? "Key saved on this computer" : "No sign-in needed";
}

function RouteRow({ route, first }: { route: ConnectorRecord; first: boolean }) {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const provider = providerOf(route.setup.kind);
  const name =
    provider === undefined
      ? "Office Town"
      : (harnesses.find(({ harness }) => harness === provider)?.name ?? provider);
  const account = accounts.find(({ id }) => id === route.setup.account)?.name;
  const renewing = needsRenewing(route);
  return (
    <div className={styles.routeRow}>
      {provider === undefined ? (
        <span className={`${styles.logo} ${styles.md}`} aria-hidden>
          {route.setup.kind === "local" ? (
            <Monitor size={16} />
          ) : route.setup.auth === "key" ? (
            <KeyRound size={16} />
          ) : (
            <Globe size={16} />
          )}
        </span>
      ) : (
        <ProviderLogo harness={provider} />
      )}
      <span className={styles.connText}>
        <span className={styles.connName}>
          {name}{" "}
          {first && provider === undefined ? (
            <span className={styles.first}>Used first</span>
          ) : null}
        </span>
        <span className={styles.sub}>{signedInText(route, account)}</span>
        <span className={styles.sub}>
          {workPlacesOf(route.setup.kind)
            .map((place) => PLACES[place])
            .join(" · ")}
        </span>
      </span>
      {renewing ? (
        <RenewAction route={route} label="Renew" />
      ) : (
        <span className={`${styles.routeStatus} ${route.enabled ? "" : styles.warn}`}>
          {!route.enabled ? (
            "Turned off"
          ) : route.status === "failing" ? (
            <>
              <CircleAlert size={14} aria-hidden /> Not answering
            </>
          ) : (
            <>
              <CircleCheck size={14} aria-hidden /> Ready
            </>
          )}
        </span>
      )}
    </div>
  );
}

const OUTCOMES: Partial<Record<ConnectorCall["outcome"], string>> = {
  refused: "Not allowed",
  failed: "Failed",
  asked: "Waiting for you",
};

function CallRow({ call }: { call: ConnectorCall }) {
  const agent = useApp((state) => state.agents[call.agentId]);
  const task = useApp((state) => state.tasks[call.taskId]?.task);
  const outcome = OUTCOMES[call.outcome];
  return (
    <li>
      <button
        type="button"
        className={styles.actRow}
        onClick={() => navigate({ name: "task", taskId: call.taskId })}
      >
        <Avatar name={agent?.name ?? "?"} colour={agent?.colour ?? "#736d64"} size={28} />
        <span className={styles.connText}>
          <span className={styles.actWhat}>{actionWords(call.tool)}</span>
          <span className={styles.sub}>
            {agent?.name ?? "An agent"}
            {task === undefined ? "" : ` · ${taskName(task)}`}
          </span>
        </span>
        <span className={styles.when}>
          {outcome === undefined ? null : <span className={styles.badge}>{outcome}</span>}
          {ago(call.at)}
        </span>
      </button>
    </li>
  );
}

const SHORT = 5;

// This week's calls through every way in, newest first: a short list, then more on request.
function RecentUse({ routes }: { routes: ConnectorRecord[] }) {
  const [calls, setCalls] = useState<ConnectorCall[]>();
  const [next, setNext] = useState<Record<string, number | undefined>>({});
  const [shown, setShown] = useState(SHORT);
  const ids = routes.map(({ id }) => id).join(",");
  useEffect(() => {
    let current = true;
    const routeIds = ids.split(",");
    Promise.all(routeIds.map((id) => api.connectorActivity(id, {}))).then(
      (pages) => {
        if (!current) return;
        const all = pages.flatMap((read) => read.calls);
        knowAgents(all.map((call) => call.agentId)).catch(() => undefined);
        setCalls(all.toSorted((a, b) => b.at.localeCompare(a.at)));
        setNext(Object.fromEntries(routeIds.map((id, index) => [id, pages[index]?.next])));
        setShown(SHORT);
      },
      (failure: unknown) => showToast(errorText(failure)),
    );
    return () => {
      current = false;
    };
  }, [ids]);
  if (calls === undefined) return null;
  const more = async () => {
    const wanted = shown + 10;
    setShown(wanted);
    if (wanted <= calls.length) return;
    const pages = await Promise.all(
      Object.entries(next)
        .filter(([, before]) => before !== undefined)
        .map(async ([id, before]) => [id, await api.connectorActivity(id, { before })] as const),
    );
    const older = pages.flatMap(([, read]) => read.calls);
    knowAgents(older.map((call) => call.agentId)).catch(() => undefined);
    setCalls([...calls, ...older].toSorted((a, b) => b.at.localeCompare(a.at)));
    setNext({ ...next, ...Object.fromEntries(pages.map(([id, read]) => [id, read.next])) });
  };
  const hasMore =
    shown < calls.length || Object.values(next).some((before) => before !== undefined);
  if (calls.length === 0) return <p className={styles.empty}>Not used this week.</p>;
  return (
    <ul className={styles.list} aria-label="Recent use">
      {calls.slice(0, shown).map((call) => (
        <CallRow key={call.id} call={call} />
      ))}
      {hasMore ? (
        <li className={styles.more}>
          <Button variant="ghost" onClick={() => void more()}>
            Show more
          </Button>
        </li>
      ) : null}
    </ul>
  );
}

function useActions(routes: ConnectorRecord[]): ConnectorAction[] | undefined {
  const [actions, setActions] = useState<ConnectorAction[]>();
  const source = routes.toSorted((a, b) => b.actions - a.actions)[0];
  const sourceId = source?.id;
  const count = source?.actions ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when its count changes, such as an OpenCode action seen for the first time.
  useEffect(() => {
    if (sourceId === undefined) return;
    let current = true;
    api.connectorActions(sourceId).then(
      (read) => {
        if (current) setActions(read);
      },
      (failure: unknown) => showToast(errorText(failure)),
    );
    return () => {
      current = false;
    };
  }, [sourceId, count]);
  return actions;
}

export function ConnectorView({ connectorId }: { connectorId: string }) {
  const connectors = useConnectors();
  const catalog = useCatalog();
  const holders = useHolders();
  const [confirming, setConfirming] = useState(false);
  const group = groupApps(connectors, catalog?.entries).find(({ routes }) =>
    routes.some(({ id }) => id === connectorId),
  );
  const routes = group?.routes ?? [];
  const actions = useActions(routes);
  const [main] = routes;
  if (group === undefined || main === undefined) {
    return (
      <section className={page.page}>
        <p className={styles.empty}>This app was removed.</p>
      </section>
    );
  }
  const shared = routes.filter((route) => !isProviderApp(route));
  const enabled = routes.some((route) => route.enabled);
  const onlyOpenCode = routes.every(({ setup }) => setup.kind === "opencode");
  return (
    <section className={page.page} aria-labelledby="connector-title">
      <div className={styles.column}>
        <Crumbs
          items={[{ label: "Connectors", view: { name: "connectors" } }, { label: group.name }]}
        />
        <header className={styles.detailHead}>
          <AppLogo app={group.logo} size="lg" />
          <span className={styles.detailText}>
            <h1 id="connector-title" className={page.title}>
              {group.name}
            </h1>
            <ProviderTags tags={tagsOf(routes)} named />
          </span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" icon aria-label={`More for ${group.name}`}>
                <Ellipsis size={16} aria-hidden />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menu.surface} align="end" sideOffset={4}>
                <DropdownMenu.Item
                  className={menu.item}
                  onSelect={() => void changeAll(routes, { enabled: !enabled })}
                >
                  {enabled ? "Turn off" : "Turn on"}
                </DropdownMenu.Item>
                {shared.length === 0 ? null : (
                  <DropdownMenu.Item className={menu.item} onSelect={() => setConfirming(true)}>
                    Disconnect
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </header>

        <div className={page.section}>
          <div className={page.sectionHead}>
            <h2 className={page.sectionTitle}>Works with</h2>
          </div>
          <div className={styles.list}>
            {routes.map((route, index) => (
              <RouteRow key={route.id} route={route} first={index === 0 && routes.length > 1} />
            ))}
          </div>
        </div>

        <div className={page.section}>
          <div className={page.sectionHead}>
            <h2 className={page.sectionTitle}>Access</h2>
          </div>
          <div className={styles.list}>
            <div className={styles.accessRow}>
              <span className={styles.accessKey}>Permission</span>
              <span>
                <fieldset className={styles.segments}>
                  <legend className="visually-hidden">Permission</legend>
                  {PERMISSIONS.map(({ value, title, description }) => (
                    <button
                      key={value}
                      type="button"
                      title={description}
                      aria-pressed={main.permission === value}
                      onClick={() => void changeAll(routes, { permission: value })}
                    >
                      {title}
                    </button>
                  ))}
                </fieldset>
                <p className={styles.hint}>
                  {onlyOpenCode
                    ? "OpenCode doesn't say which actions only read: Ask me first asks before each one, showing only its name, and Read only blocks them all."
                    : "Reads never ask. Changes follow this."}
                </p>
              </span>
            </div>
            <div className={styles.accessRow}>
              <span className={styles.accessKey}>Who can use it</span>
              <span>
                <AudienceMenu
                  audience={main.audience}
                  holders={holders}
                  onChange={(next) => void changeAll(routes, { audience: next })}
                  everyone="Every agent, in any department"
                  empty="There are no departments yet."
                  label="Can use it:"
                />
              </span>
            </div>
          </div>
        </div>

        <div className={page.section}>
          <div className={page.sectionHead}>
            <h2 className={page.sectionTitle}>What agents can do</h2>
          </div>
          {actions === undefined ? null : (
            <ActionGroups actions={actions} permission={main.permission} />
          )}
        </div>

        <div className={page.section}>
          <div className={page.sectionHead}>
            <h2 className={page.sectionTitle}>
              Recent use <span className={styles.chipCount}>This week</span>
            </h2>
          </div>
          <RecentUse routes={routes} />
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Disconnect ${group.name}?`}
        description="Agents can't use it through Office Town any more, and its key is deleted from this computer."
        confirmLabel="Disconnect"
        onConfirm={async () => {
          await Promise.all(shared.map(({ id }) => api.removeConnector(id)));
          navigate({ name: "connectors" });
        }}
      />
    </section>
  );
}
