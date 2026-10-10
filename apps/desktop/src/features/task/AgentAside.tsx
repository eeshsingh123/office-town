import type { AgentRecord, PlanStep, SessionRecord, UsageLimit } from "@office-town/contract";
import { Check, CircleDashed, LoaderCircle } from "lucide-react";
import { useLevel } from "../../store/agents.ts";
import { useApp, useHarnessName } from "../../store/app-store.ts";
import type { Trace } from "../../trace/trace.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { clockTime, compactCount, elapsed, environmentName, whenNext } from "../../ui/format.ts";
import { sumUsage } from "../departments/usage.ts";
import styles from "./TaskView.module.css";

function StepIcon({ step }: { step: PlanStep }) {
  if (step.status === "completed")
    return <Check size={14} className={styles.ok} aria-label="Done" />;
  if (step.status === "in_progress") {
    return <LoaderCircle size={14} className={`${styles.running} spin`} aria-label="In progress" />;
  }
  return <CircleDashed size={14} className={styles.quiet} aria-label="Not started" />;
}

export function Plan({ plan }: { plan: PlanStep[] }) {
  const done = plan.filter((step) => step.status === "completed").length;
  return (
    <section aria-labelledby="plan-title">
      <div className={styles.asideHeading}>
        <h2 id="plan-title">Plan</h2>
        <span>
          {done} of {plan.length} done
        </span>
      </div>
      <div className={styles.bar}>
        <i style={{ width: `${(done / plan.length) * 100}%` }} />
      </div>
      <ol className={styles.plan}>
        {plan.map((step) => (
          <li key={step.id} className={step.status === "in_progress" ? styles.current : undefined}>
            <StepIcon step={step} />
            {step.title}
          </li>
        ))}
      </ol>
    </section>
  );
}

// The provider's own usage limit is the only budget the app shows (D-29).
function Limits({ limits, harness }: { limits: UsageLimit[]; harness: string }) {
  return (
    <section aria-labelledby="limits-title">
      <h2 id="limits-title" className={styles.asideTitle}>
        {harness} plan usage
      </h2>
      {limits.map((limit) => (
        <div key={limit.id} className={styles.limit}>
          <div className={styles.limitLine}>
            <span>{limit.label.charAt(0).toUpperCase() + limit.label.slice(1)}</span>
            <span>{Math.round(limit.usedFraction * 100)}%</span>
          </div>
          <div className={styles.bar}>
            <i style={{ width: `${Math.min(100, limit.usedFraction * 100)}%` }} />
          </div>
          {limit.resetsAt === undefined ? null : (
            <div className={styles.faint}>Resets {whenNext(limit.resetsAt)}</div>
          )}
        </div>
      ))}
    </section>
  );
}

interface AgentAsideProps {
  agent: AgentRecord;
  first: SessionRecord;
  latest: SessionRecord;
  // Oldest first.
  traces: Trace[];
}

// A resumed session reports no plan until it changes, so the latest known one shows.
export function AgentAside({ agent, first, latest, traces }: AgentAsideProps) {
  const harness = useHarnessName(latest.options.harness);
  const level = useLevel(agent);
  const { options } = latest;
  const ended = latest.endedAt ?? new Date().toISOString();
  const plan = traces.findLast((trace) => trace.plan.length > 0)?.plan;
  const limits = useApp((state) => state.limits[latest.options.harness]?.limits);
  const model = traces.findLast((trace) => trace.model !== undefined)?.model;
  const usage = sumUsage(traces);
  return (
    <aside className={styles.aside} aria-label="Agent">
      {plan === undefined ? null : <Plan plan={plan} />}
      {limits === undefined || limits.length === 0 ? null : (
        <Limits limits={limits} harness={harness} />
      )}
      <section aria-labelledby="details-title">
        <h2 id="details-title" className={styles.asideTitle}>
          Details
        </h2>
        <dl className={styles.details}>
          <dt>AI app</dt>
          <dd>{harness}</dd>
          <dt>Model</dt>
          <dd>{model ?? options.model ?? "Default"}</dd>
          <dt>Effort</dt>
          <dd>{options.effort ?? "Default"}</dd>
          <dt>Without asking</dt>
          <dd title={AUTONOMY[level].description}>{AUTONOMY[level].label}</dd>
          <dt>Runs on</dt>
          <dd>{environmentName(options.environment)}</dd>
          <dt>Folder</dt>
          <dd title={options.workspacePath}>{options.workspacePath ?? "None"}</dd>
          <dt>Started</dt>
          <dd>
            {clockTime(first.createdAt)} · {elapsed(first.createdAt, ended)}
          </dd>
          <dt>Tokens</dt>
          <dd>
            {compactCount(usage.inputTokens - usage.cachedInputTokens)} in ·{" "}
            {compactCount(usage.outputTokens)} out
          </dd>
          <dt>Cached</dt>
          <dd>{compactCount(usage.cachedInputTokens)} read from cache</dd>
        </dl>
      </section>
    </aside>
  );
}
