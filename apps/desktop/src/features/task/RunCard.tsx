import type { RoleSettings } from "@office-town/contract";
import { AppWindow, ChevronDown, Cpu, ExternalLink, Folder, ShieldCheck } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { shell } from "../../shell.ts";
import { type Agent, stateOf, useWaitingSessions } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { clockTime, compactCount } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import { ModelChip } from "../new-task/ModelChip.tsx";
import styles from "./RunCard.module.css";
import { type RunFacts, tokenLine, useRunFacts } from "./run-facts.ts";

// Who the trace belongs to and what it runs on: a card in the trace's right margin, or a
// pill that opens it when the trace has no margin to spare.
export function RunCard({ agent }: { agent: Agent }) {
  const facts = useRunFacts(agent);
  return (
    <aside className={styles.run} aria-label="Run details">
      <Popover.Root>
        <Popover.Trigger className={styles.pill}>
          <Avatar name={agent.name} colour={agent.colour} size={18} />
          <span className={styles.pillName}>{agent.name}</span>
          <span className={styles.pillFacts}>
            {facts.model} · {facts.duration} · {tokenLine(facts.tokens)}
          </span>
          <ChevronDown size={14} aria-hidden />
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
      <div className={styles.card}>
        <RunDetails agent={agent} facts={facts} />
      </div>
    </aside>
  );
}

// Saved on the agent, so it holds in its department too; a session at work takes it at its next start.
function ModelRow({ agent, working }: { agent: Agent; working: boolean }) {
  const { record, latest } = agent;
  const [error, setError] = useState<string>();
  const save = (next: RoleSettings) => {
    setError(undefined);
    api
      .updateAgent(record.id, {
        colour: record.colour,
        purpose: record.purpose ?? "",
        settings: { ...record.settings, ...next },
      })
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      });
  };
  const { model, effort } = record.settings;
  const later = working && (model !== latest.options.model || effort !== latest.options.effort);
  return (
    <li title="Model and effort" className={styles.modelRow}>
      <Cpu size={14} aria-hidden />
      <span className={styles.modelChange}>
        <ModelChip
          value={record.settings}
          recent={[]}
          onChange={save}
          modelOnly
          triggerClassName={styles.modelButton}
        />
        {later ? <span className={styles.muted}>From its next start</span> : null}
        {error === undefined ? null : <span className={styles.modelError}>{error}</span>}
      </span>
    </li>
  );
}

function RunDetails({ agent, facts }: { agent: Agent; facts: RunFacts }) {
  const traces = useApp((state) => state.traces);
  const waiting = useWaitingSessions().has(agent.latest.id);
  const state = stateOf(agent, traces, waiting);
  const { inputTokens, outputTokens, cachedInputTokens } = facts.tokens;
  const { folder } = facts;
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
        <ModelRow agent={agent} working={state === "working" || state === "starting"} />
        <li title="AI app and where it runs">
          <AppWindow size={14} aria-hidden />
          <span className={styles.text}>
            {facts.harness}
            <span className={styles.muted}> · {facts.machine}</span>
          </span>
        </li>
        <li title={facts.permissions.description}>
          <ShieldCheck size={14} aria-hidden />
          <span className={styles.text}>{facts.permissions.label}</span>
        </li>
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
          <span className={styles.statValue}>
            {compactCount(inputTokens - cachedInputTokens + outputTokens)}
          </span>
          <span className={styles.statNote}>
            {compactCount(inputTokens - cachedInputTokens)} in · {compactCount(outputTokens)} out
          </span>
        </div>
      </div>
      {cachedInputTokens === 0 ? null : (
        <p className={styles.cached}>Plus {compactCount(cachedInputTokens)} read from cache</p>
      )}
    </>
  );
}
