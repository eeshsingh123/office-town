import type { SessionRecord } from "@office-town/contract";
import { useMemo } from "react";
import { useApp } from "../../store/app-store.ts";
import { compactCount, whenNext } from "../../ui/format.ts";
import styles from "./Usage.module.css";
import { usageByHarness } from "./usage.ts";

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface UsageProps {
  sessions: readonly SessionRecord[];
  title?: string;
}

// Each harness's own limit, or its tokens where it reports none (D-29).
export function Usage({ sessions, title = "Usage" }: UsageProps) {
  const traces = useApp((state) => state.traces);
  const harnesses = useApp((state) => state.harnesses);
  const everySession = useApp((state) => state.sessions);
  const usage = useMemo(
    () => usageByHarness(sessions, traces, Object.values(everySession)),
    [sessions, traces, everySession],
  );
  if (usage.length === 0) return null;
  const nameOf = (harness: string) =>
    harnesses.find((known) => known.harness === harness)?.name ?? harness;
  return (
    <section className={styles.usage} aria-label="Usage">
      <h3 className={styles.title}>{title}</h3>
      {usage.map(({ harness, limits, tokens }) =>
        limits.length === 0 ? (
          <div key={harness} className={styles.line}>
            <span className={styles.name}>{nameOf(harness)}</span>
            <span>
              {compactCount(tokens.inputTokens - tokens.cachedInputTokens)} in ·{" "}
              {compactCount(tokens.outputTokens)} out
              <span className={styles.faint}>
                {" "}
                (+{compactCount(tokens.cachedInputTokens)} cached)
              </span>
            </span>
          </div>
        ) : (
          limits.map((limit) => (
            <div key={`${harness}:${limit.id}`} className={styles.limit}>
              <div className={styles.line}>
                <span className={styles.name}>
                  {nameOf(harness)} · {capital(limit.label)}
                </span>
                <span>
                  {Math.round(limit.usedFraction * 100)}%
                  {limit.resetsAt === undefined ? "" : ` · resets ${whenNext(limit.resetsAt)}`}
                </span>
              </div>
              <div className={styles.bar}>
                <i style={{ width: `${Math.min(100, limit.usedFraction * 100)}%` }} />
              </div>
            </div>
          ))
        ),
      )}
    </section>
  );
}
