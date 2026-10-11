import { ChevronUp, Clock, Folder, ShieldCheck } from "lucide-react";
import { Popover } from "radix-ui";
import { shell } from "../../shell.ts";
import type { Agent } from "../../store/agents.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { clockTime, compactCount } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import styles from "./RunBar.module.css";
import { tokenLine, useRunFacts } from "./run-facts.ts";

const folderName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;

// What the next message goes to, right above the box it is typed in.
export function RunBar({ agent }: { agent: Agent }) {
  const facts = useRunFacts(agent);
  const { inputTokens, outputTokens, cachedInputTokens } = facts.tokens;
  const { folder } = facts;
  return (
    <div className={styles.bar}>
      <span className={styles.item}>
        <Avatar name={agent.name} colour={agent.colour} size={16} />
        <span className={styles.text}>{agent.name}</span>
      </span>
      <span
        className={`${styles.item} ${styles.shrinks}`}
        title={`${facts.harness} · ${facts.model}`}
      >
        <span className={styles.text}>
          {facts.harness} · {facts.model}
        </span>
      </span>
      {facts.effort === undefined ? null : <span className={styles.item}>{facts.effort}</span>}
      <span className={styles.item} title={facts.permissions.description}>
        <ShieldCheck size={13} aria-hidden />
        {facts.permissions.label}
      </span>
      {folder === undefined ? null : shell === undefined ? (
        <span className={`${styles.item} ${styles.shrinks} ${styles.shrinksFirst}`} title={folder}>
          <Folder size={13} aria-hidden />
          <span className={styles.text}>{folderName(folder)}</span>
        </span>
      ) : (
        <button
          type="button"
          className={`${styles.item} ${styles.shrinks} ${styles.shrinksFirst} ${styles.button}`}
          title={`Open ${folder}`}
          onClick={() => void shell?.openFolder(folder)}
        >
          <Folder size={13} aria-hidden />
          <span className={styles.text}>{folderName(folder)}</span>
        </button>
      )}
      <Popover.Root>
        <Popover.Trigger className={`${styles.item} ${styles.button}`}>
          <Clock size={13} aria-hidden />
          {facts.duration} · {tokenLine(facts.tokens)}
          <ChevronUp size={13} aria-hidden />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className={`${menu.surface} ${styles.details}`}
            side="top"
            align="end"
            sideOffset={6}
            aria-label="Run details"
          >
            <dl>
              <dt>AI app</dt>
              <dd>{facts.harness}</dd>
              <dt>Model</dt>
              <dd>
                {facts.model}
                {facts.effort === undefined ? "" : ` · ${facts.effort}`}
              </dd>
              <dt>Permissions</dt>
              <dd>
                {facts.permissions.label}
                <span className={styles.muted}>{facts.permissions.description}</span>
              </dd>
              <dt>Runs on</dt>
              <dd>{facts.machine}</dd>
              <dt>Folder</dt>
              <dd className={styles.path}>{folder ?? "None"}</dd>
              <dt>Started</dt>
              <dd>
                {clockTime(facts.startedAt)} · {facts.duration}
              </dd>
              <dt>Tokens</dt>
              <dd>
                {compactCount(inputTokens - cachedInputTokens)} in · {compactCount(outputTokens)}{" "}
                out · {compactCount(cachedInputTokens)} from cache
              </dd>
            </dl>
            {folder === undefined || shell === undefined ? null : (
              <Button onClick={() => void shell?.openFolder(folder)}>
                <Folder size={14} aria-hidden />
                Open folder
              </Button>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
