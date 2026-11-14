import type { RoleSettings } from "@office-town/contract";
import { AppWindow, Cpu, ExternalLink, Folder, FolderGit2, Info } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { shell } from "../../shell.ts";
import { type Agent, stateOf, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { useWorkspaces } from "../../store/workspaces.ts";
import { isBusy } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { clockTime, compactCount } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import { SwitchRow } from "../../ui/Switch.tsx";
import chip from "../new-task/Composer.module.css";
import { ModelChip, Segments } from "../new-task/ModelChip.tsx";
import { accountLabel, useIdentities } from "../usage/identity.ts";
import { sessionAccountId } from "../usage/limits.ts";
import styles from "./RunCard.module.css";
import { type RunFacts, useRunFacts } from "./run-facts.ts";
import { optionsOf, setTaskOption, TASK_OPTIONS } from "./task-options.ts";

// Who the shown chat belongs to and what it runs on, with the task's switches: a popover from
// "Details" in the task's header, so the chat keeps its width (a3-11).
export function RunDetailsButton({ agent }: { agent: Agent }) {
  const facts = useRunFacts(agent);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" title={`${agent.name} · ${facts.model} · ${facts.duration}`}>
          <Info size={14} aria-hidden />
          Details
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`${menu.surface} ${styles.popover}`}
          side="bottom"
          align="end"
          sideOffset={6}
        >
          <RunDetails agent={agent} facts={facts} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Saved on the agent, or on everyone in its department; a session at work takes it at its next
// start. The picks wait for Apply, as each change closes agents between their turns.
function ModelRow({ agent, working }: { agent: Agent; working: boolean }) {
  const { record, latest } = agent;
  const { departmentId } = record;
  const [draft, setDraft] = useState<RoleSettings>();
  const [wholeDepartment, setWholeDepartment] = useState(true);
  const [error, setError] = useState<string>();
  const save = (next: RoleSettings) => {
    if (departmentId !== undefined && wholeDepartment) {
      const { harness, model, effort } = next;
      return api.moveDepartment(departmentId, {
        harness,
        ...(model === undefined ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
      });
    }
    const { model: _, effort: __, accountId: ___, ...kept } = record.settings;
    return api.updateAgent(record.id, {
      colour: record.colour,
      purpose: record.purpose ?? "",
      settings: { ...kept, ...next },
    });
  };
  const apply = (close: () => void) => {
    if (draft === undefined) return;
    setError(undefined);
    save(draft)
      .then(close)
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      });
  };
  const { harness, model, effort } = record.settings;
  const { options } = latest;
  const later =
    working &&
    (harness !== options.harness || model !== options.model || effort !== options.effort);
  return (
    <li title="Provider, model and thinking" className={styles.modelRow}>
      <Cpu size={14} aria-hidden />
      <span className={styles.modelChange}>
        <ModelChip
          value={draft ?? record.settings}
          recent={[]}
          onChange={setDraft}
          draft={{
            onDiscard: () => setDraft(undefined),
            footer: (close) => (
              <div className={`${chip.menuRow} ${chip.menuFoot} ${styles.applyRow}`}>
                {departmentId === undefined ? null : (
                  <div className={styles.applyScope}>
                    <span className={chip.rowLabel}>Change it for</span>
                    <Segments
                      label="Change it for"
                      value={wholeDepartment ? "all" : "one"}
                      options={[
                        { value: "all", label: "Whole department" },
                        { value: "one", label: `Just ${agent.name}` },
                      ]}
                      onChange={(next) => setWholeDepartment(next === "all")}
                    />
                  </div>
                )}
                <Button
                  variant="primary"
                  disabled={draft === undefined}
                  onClick={() => apply(close)}
                >
                  Apply
                </Button>
              </div>
            ),
          }}
          triggerClassName={styles.modelButton}
        />
        {later ? <span className={styles.muted}>From its next task</span> : null}
        {error === undefined ? null : <span className={styles.modelError}>{error}</span>}
      </span>
    </li>
  );
}

// The task's, so they hold for every agent in it; taken at each agent's next check.
function TaskOptionsSection({ taskId }: { taskId: string }) {
  const task = useApp((state) => state.tasks[taskId]?.task);
  if (task === undefined) return null;
  const options = optionsOf(task);
  return (
    <section className={styles.options} aria-label="For this task">
      <span className={styles.optionsLabel}>For this task</span>
      {TASK_OPTIONS.map((option) => (
        <SwitchRow
          key={option.key}
          label={option.label}
          hint={option.hint}
          on={options[option.key]}
          onChange={(on) => setTaskOption(taskId, option.key, on)}
        />
      ))}
      <button
        type="button"
        className={styles.settingsLink}
        onClick={() => navigate({ name: "settings" })}
      >
        Defaults for new tasks are in Settings
      </button>
    </section>
  );
}

function RunDetails({ agent, facts }: { agent: Agent; facts: RunFacts }) {
  const traces = useApp((state) => state.traces);
  const waiting = useWaitingSessions().has(agent.latest.id);
  // The account it runs on, when it has a name to show: a nickname or the login's email.
  const accountId = sessionAccountId(agent.latest.options);
  const account = useApp((app) => app.accounts.find((one) => one.id === accountId));
  const identity = useIdentities((known) => known[accountId]);
  const accountName =
    account?.folder !== undefined || identity?.email !== undefined
      ? accountLabel(account, identity)
      : undefined;
  const state = stateOf(agent, traces, waiting);
  const { tokens, folder } = facts;
  const workspace = useWorkspaces()?.find((known) => known.id === agent.task.workspaceId);
  return (
    <>
      <div className={styles.who}>
        <Avatar name={agent.name} colour={agent.colour} size={32} />
        <span className={styles.whoText}>
          <strong>{agent.name}</strong>
          <span className={styles.state}>
            <StatusIcon state={state} size={12} />
            {STATE_LABELS[state]}
            {agent.record.role === undefined ? null : (
              <span className={styles.role}> · {agent.record.role.toLowerCase()}</span>
            )}
          </span>
        </span>
      </div>
      <ul className={styles.facts}>
        <ModelRow agent={agent} working={isBusy(state)} />
        <li title="Provider and where it runs">
          <AppWindow size={14} aria-hidden />
          <span className={styles.text}>
            {facts.harness}
            {accountName === undefined ? null : (
              <span className={styles.muted}> · {accountName}</span>
            )}
            <span className={styles.muted}> · {facts.machine}</span>
          </span>
        </li>
        {workspace === undefined ? null : (
          <li title="Workspace">
            <FolderGit2 size={14} aria-hidden />
            <button
              type="button"
              className={styles.folder}
              onClick={() =>
                navigate({ name: "workspace", workspaceId: workspace.id, tab: "library" })
              }
            >
              <span className={styles.text}>
                {workspace.name}
                <span className={styles.muted}> · Library</span>
              </span>
            </button>
          </li>
        )}
        {folder === undefined ? null : (
          <li title={folder}>
            <Folder size={14} aria-hidden />
            {shell === undefined ? (
              <span className={styles.text}>{facts.folderAlias}</span>
            ) : (
              <button
                type="button"
                className={styles.folder}
                onClick={() => void shell?.openFolder(folder)}
              >
                <span className={styles.text}>{facts.folderAlias}</span>
                <ExternalLink size={12} aria-hidden />
              </button>
            )}
          </li>
        )}
      </ul>
      <div className={styles.stats}>
        <div>
          <span className={styles.statLabel}>Time</span>
          <span className={styles.statValue}>{facts.duration}</span>
          <span className={styles.statNote}>since {clockTime(facts.startedAt)}</span>
        </div>
        <div>
          <span className={styles.statLabel}>Tokens</span>
          {tokens === undefined ? (
            <span className={styles.statNote}>Counting</span>
          ) : (
            <>
              <span className={styles.statValue}>
                {compactCount(tokens.inputTokens - tokens.cachedInputTokens + tokens.outputTokens)}
              </span>
              <span className={styles.statNote}>
                {compactCount(tokens.inputTokens - tokens.cachedInputTokens)} in ·{" "}
                {compactCount(tokens.outputTokens)} out
              </span>
            </>
          )}
        </div>
      </div>
      {tokens === undefined || tokens.cachedInputTokens === 0 ? null : (
        <p className={styles.cached}>
          Plus {compactCount(tokens.cachedInputTokens)} reused from earlier
        </p>
      )}
      <TaskOptionsSection taskId={agent.latest.taskId} />
    </>
  );
}
