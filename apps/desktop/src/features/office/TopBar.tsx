import type { HarnessDescription, HarnessLimits, TaskRecord } from "@office-town/contract";
import { MapIcon, SquareKanban } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { useMemo } from "react";
import { stateOf, useAgents, useWaitingSessions } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import type { TaskEntry } from "../../store/records.ts";
import { compactCount, whenNext } from "../../ui/format.ts";
import { newTokens } from "../departments/usage.ts";
import { waitingOrder } from "./next-waiting.ts";
import { showMode, useOffice } from "./office-state.ts";
import styles from "./TopBar.module.css";
import { goToNextWaiting } from "./waiting-keys.ts";

interface PlanWindow {
  harness: string;
  text: string;
  // How full its fullest limit is, where the harness reports one.
  fraction?: number;
  detail?: string;
}

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

// Each harness's fullest plan limit, or else the new tokens of today's goals on it (D-29).
function planWindows(
  harnesses: readonly HarnessDescription[],
  limits: Record<string, HarnessLimits>,
  tasks: readonly TaskRecord[],
): PlanWindow[] {
  return harnesses.flatMap(({ harness, name }): PlanWindow[] => {
    const fullest = (limits[harness]?.limits ?? []).toSorted(
      (a, b) => b.usedFraction - a.usedFraction,
    )[0];
    if (fullest !== undefined) {
      const percent = Math.round(fullest.usedFraction * 100);
      return [
        {
          harness,
          text: `${name} ${fullest.label} ${percent}%`,
          fraction: Math.min(1, fullest.usedFraction),
          ...(fullest.resetsAt === undefined
            ? {}
            : { detail: `Resets ${whenNext(fullest.resetsAt)}` }),
        },
      ];
    }
    const tokens = tasks
      .filter((task) => isToday(task.createdAt))
      .flatMap((task) => task.usage.filter((usage) => usage.harness === harness))
      .reduce((sum, usage) => sum + newTokens(usage), 0);
    if (tokens === 0) return [];
    return [{ harness, text: `${name} ${compactCount(tokens)} tokens`, detail: "Today's goals" }];
  });
}

function useCounts(entries: Record<string, TaskEntry>) {
  const agents = useAgents();
  const traces = useApp((state) => state.traces);
  const waiting = useApp((state) => state.waiting);
  const sessions = useApp((state) => state.sessions);
  const pieces = useApp((state) => state.pieces);
  const waitingSessions = useWaitingSessions();
  return useMemo(() => {
    const tasks = Object.values(entries).map((entry) => entry.task);
    const working = agents.filter((agent) => {
      const state = stateOf(agent, traces, waitingSessions.has(agent.latest.id));
      return state === "working" || state === "starting";
    }).length;
    const queued =
      tasks.filter((task) => task.state === "queued").length +
      Object.values(pieces).filter((piece) => piece.status === "queued").length;
    const toReview = tasks.filter(
      (task) =>
        task.state === "ended" && task.reviewedAt === undefined && task.parentTaskId === undefined,
    ).length;
    return { working, queued, toReview, order: waitingOrder(waiting, sessions) };
  }, [agents, traces, waitingSessions, waiting, sessions, pieces, entries]);
}

// What the whole office is doing at a glance, and where to go next (D-49).
export function TopBar() {
  const entries = useApp((state) => state.tasks);
  const harnesses = useApp((state) => state.harnesses);
  const limits = useApp((state) => state.limits);
  const focus = useApp((state) => state.focus);
  const mode = useOffice((state) => state.mode);
  const { working, queued, toReview, order } = useCounts(entries);
  const windows = useMemo(
    () =>
      planWindows(
        harnesses,
        limits,
        Object.values(entries).map((entry) => entry.task),
      ),
    [harnesses, limits, entries],
  );
  const at = focus === undefined ? -1 : order.indexOf(focus.agentId);

  return (
    <header className={styles.bar}>
      <ToggleGroup.Root
        type="single"
        className={styles.segments}
        value={mode}
        onValueChange={(next) => {
          if (next === "floor" || next === "board") showMode(next);
        }}
        aria-label="Show the office as"
      >
        <ToggleGroup.Item
          value="floor"
          className={styles.segment}
          title="Walk with WASD or the arrow keys, click an agent or a room's sign, drag to select several"
        >
          <MapIcon size={14} aria-hidden />
          Floor
        </ToggleGroup.Item>
        <ToggleGroup.Item value="board" className={styles.segment}>
          <SquareKanban size={14} aria-hidden />
          Board
        </ToggleGroup.Item>
      </ToggleGroup.Root>

      <span className={styles.count}>
        <span className={`${styles.dot} ${working > 0 ? styles.dotWorking : ""}`} aria-hidden />
        {working} working
      </span>
      {order.length === 0 ? (
        <span className={styles.count}>0 need you</span>
      ) : (
        <button
          type="button"
          className={styles.needYou}
          onClick={goToNextWaiting}
          title="Go to the next waiting agent (N)"
        >
          <span className={styles.waitDot} aria-hidden />
          {at === -1 ? `${order.length} need you` : `${at + 1} of ${order.length}`}
        </button>
      )}
      <button type="button" className={styles.link} onClick={() => showMode("board")}>
        {queued} queued
      </button>
      <button type="button" className={styles.link} onClick={() => showMode("board")}>
        {toReview > 0 ? <span className={styles.unread} aria-hidden /> : null}
        {toReview} to review
      </button>

      <div className={styles.windows}>
        {windows.map((window) => (
          <span key={window.harness} className={styles.window} title={window.detail}>
            {window.text}
            {window.fraction === undefined ? null : (
              <span className={styles.meter} aria-hidden>
                <i style={{ width: `${window.fraction * 100}%` }} />
              </span>
            )}
          </span>
        ))}
      </div>
    </header>
  );
}
