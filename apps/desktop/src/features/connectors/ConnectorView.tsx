import type {
  ConnectorActivity,
  ConnectorCall,
  ConnectorChange,
  ConnectorRecord,
} from "@office-town/contract";
import { Ellipsis } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { callTitle } from "../../trace/team-tools.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { Crumbs } from "../../ui/Crumbs.tsx";
import form from "../../ui/Form.module.css";
import { ago, taskTitle } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import page from "../../ui/Page.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { AudienceMenu, useHolders } from "../library/GivenToMenu.tsx";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import { PERMISSIONS, signIn } from "./connectors.ts";

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

function statusText({ enabled, status, setup }: ConnectorRecord): string {
  if (!enabled) return "Turned off";
  if (status === "signed_out") return "Signed out";
  if (status === "failing") return "Not answering";
  return setup.official ? `Official, by ${setup.maker}` : "Community";
}

async function change(connectorId: string, update: ConnectorChange) {
  try {
    await api.changeConnector(connectorId, update);
  } catch (failure) {
    showToast(errorText(failure));
  }
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
          <span className={styles.actWhat}>{callTitle(call.tool, call.input)}</span>
          <span className={styles.sub}>
            {agent?.name ?? "An agent"}
            {task === undefined ? "" : ` · ${taskTitle(task.prompt)}`}
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

// This week's calls, filtered by team or to changes; each row opens its task.
function Activity({ connectorId }: { connectorId: string }) {
  const departments = useApp((state) => state.departments);
  const [filter, setFilter] = useState<{ team?: string; changes?: true }>({});
  const [activity, setActivity] = useState<ConnectorActivity>();
  const [older, setOlder] = useState<ConnectorCall[]>([]);
  const [next, setNext] = useState<number>();
  useEffect(() => {
    let current = true;
    api.connectorActivity(connectorId, filter).then(
      (read) => {
        if (!current) return;
        setActivity(read);
        setOlder([]);
        setNext(read.next);
      },
      (failure: unknown) => showToast(errorText(failure)),
    );
    return () => {
      current = false;
    };
  }, [connectorId, filter]);
  const more = async () => {
    if (next === undefined) return;
    const read = await api.connectorActivity(connectorId, { ...filter, before: next });
    setOlder([...older, ...read.calls]);
    setNext(read.next);
  };
  if (activity === undefined) return null;
  const chips = [
    { key: "all", label: "All", count: activity.total, value: {} },
    ...activity.teams.map(({ departmentId, count }) => ({
      key: departmentId ?? "none",
      label: departmentId === undefined ? "No team" : (departments[departmentId]?.name ?? "A team"),
      count,
      value: { team: departmentId ?? "none" },
    })),
    {
      key: "changes",
      label: "Changes",
      count: activity.changes,
      value: { changes: true as const },
    },
  ];
  const chosen = filter.changes ? "changes" : (filter.team ?? "all");
  const calls = [...activity.calls, ...older];
  return (
    <>
      <fieldset className={`${form.row} ${form.group}`}>
        <legend className="visually-hidden">Show</legend>
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={form.chip}
            aria-pressed={chosen === chip.key}
            onClick={() => setFilter(chip.value)}
          >
            {chip.label}
            <span className={styles.chipCount}>{chip.count}</span>
          </button>
        ))}
      </fieldset>
      {calls.length === 0 ? (
        <p className={styles.empty}>Not used this week.</p>
      ) : (
        <ul className={styles.list} aria-label="Activity">
          {calls.map((call) => (
            <CallRow key={call.id} call={call} />
          ))}
          {next === undefined ? null : (
            <li className={styles.more}>
              <Button variant="ghost" onClick={() => void more()}>
                Show more
              </Button>
            </li>
          )}
        </ul>
      )}
    </>
  );
}

export function ConnectorView({ connectorId }: { connectorId: string }) {
  const connector = useApp((state) => state.connectors[connectorId]);
  const holders = useHolders();
  const [confirming, setConfirming] = useState(false);
  if (connector === undefined) {
    return (
      <section className={page.page}>
        <p className={styles.empty}>This connector was removed.</p>
      </section>
    );
  }
  const { setup, audience, permission, enabled } = connector;
  const trouble = !enabled || connector.status !== "connected";
  return (
    <section className={page.page} aria-labelledby="connector-title">
      <div className={styles.column}>
        <Crumbs
          items={[{ label: "Connectors", view: { name: "connectors" } }, { label: setup.name }]}
        />
        <header className={styles.detailHead}>
          <AppLogo app={setup.slug} size="lg" />
          <span className={styles.detailText}>
            <h1 id="connector-title" className={page.title}>
              {setup.name}
            </h1>
            <span className={`${styles.sub} ${trouble && enabled ? styles.warn : ""}`}>
              {statusText(connector)}
            </span>
          </span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" icon aria-label={`More for ${setup.name}`}>
                <Ellipsis size={16} aria-hidden />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menu.surface} align="end" sideOffset={4}>
                {setup.auth === "sign-in" ? (
                  <DropdownMenu.Item
                    className={menu.item}
                    onSelect={() =>
                      signIn(connector.id).catch((failure: unknown) =>
                        showToast(errorText(failure)),
                      )
                    }
                  >
                    Sign in again
                  </DropdownMenu.Item>
                ) : null}
                <DropdownMenu.Item
                  className={menu.item}
                  onSelect={() => void change(connector.id, { enabled: !enabled })}
                >
                  {enabled ? "Turn off" : "Turn on"}
                </DropdownMenu.Item>
                <DropdownMenu.Item className={menu.item} onSelect={() => setConfirming(true)}>
                  Disconnect
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </header>

        <div className={page.section}>
          <div className={page.sectionHead}>
            <h2 className={page.sectionTitle}>Access</h2>
          </div>
          <div className={styles.list}>
            <div className={styles.accessRow}>
              <span className={styles.accessKey}>Who can use it</span>
              <span>
                <AudienceMenu
                  audience={audience}
                  holders={holders}
                  onChange={(next) => void change(connector.id, { audience: next })}
                  everyone="Every agent, in any department"
                  empty="There are no departments yet."
                  label="Can use it:"
                />
              </span>
            </div>
            <div className={styles.accessRow}>
              <span className={styles.accessKey}>Permissions</span>
              <fieldset className={styles.segments}>
                <legend className="visually-hidden">Permissions</legend>
                {PERMISSIONS.map(({ value, title, description }) => (
                  <button
                    key={value}
                    type="button"
                    title={description}
                    aria-pressed={permission === value}
                    onClick={() => void change(connector.id, { permission: value })}
                  >
                    {title}
                  </button>
                ))}
              </fieldset>
            </div>
          </div>
        </div>

        <div className={page.section}>
          <div className={page.sectionHead}>
            <h2 className={page.sectionTitle}>
              Activity <span className={styles.chipCount}>This week</span>
            </h2>
          </div>
          <Activity connectorId={connector.id} />
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Disconnect ${setup.name}?`}
        description="Agents lose it at once, and its sign-in or key is deleted from this computer."
        confirmLabel="Disconnect"
        onConfirm={async () => {
          await api.removeConnector(connector.id);
          navigate({ name: "connectors" });
        }}
      />
    </section>
  );
}
