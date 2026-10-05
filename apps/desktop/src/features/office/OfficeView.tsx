import { useMemo } from "react";
import { stateOf, useAgents } from "../../store/agents.ts";
import { navigate, select, useApp } from "../../store/app-store.ts";
import type { WaitingRequest } from "../../store/records.ts";
import { type AgentState, type Progress, progressOf } from "../../trace/progress.ts";
import { Button } from "../../ui/Button.tsx";
import { AgentPanel } from "./AgentPanel.tsx";
import { Floor, type FloorAgent } from "./Floor.tsx";
import { floorPlan, onTheFloor } from "./floor-plan.ts";
import { GroupPanel } from "./GroupPanel.tsx";
import styles from "./Office.module.css";

const BUBBLE_LENGTH = 42;

// What shows above an agent's head: what it asks, or what it does now. Others stay quiet.
function bubbleOf(state: AgentState, request?: WaitingRequest, progress?: Progress) {
  let text: string | undefined;
  if (request !== undefined) {
    text = request.event.type === "permission.requested" ? "Needs your approval" : "Has a question";
  } else if (state === "working" && progress?.step !== undefined) {
    text = `Step ${progress.step.number} of ${progress.stepCount} · ${progress.step.title}`;
  } else if (state === "working") {
    text = progress?.current?.title ?? "Working";
  }
  if (text === undefined) return {};
  return { bubble: text.length > BUBBLE_LENGTH ? `${text.slice(0, BUBBLE_LENGTH - 1)}…` : text };
}

function EmptyPanel({ count }: { count: number }) {
  return (
    <aside className={styles.panel} aria-label="Office">
      <p className={styles.empty}>
        {count === 0
          ? "No agent is at work today. Start a task and its agent takes a desk here."
          : "Click an agent, walk up to one and press E, or drag a box around several."}
      </p>
      {count === 0 ? (
        <div>
          <Button variant="primary" onClick={() => navigate({ name: "new-task" })}>
            New task
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

// The home screen (D-35): every agent at work, or done today, at a desk on one open floor.
export function OfficeView() {
  const agents = useAgents();
  const traces = useApp((state) => state.traces);
  const waiting = useApp((state) => state.waiting);
  const harnesses = useApp((state) => state.harnesses);
  const selection = useApp((state) => state.selection);

  const { plan, floorAgents } = useMemo(() => {
    const asking = new Map(
      Object.values(waiting).map((request) => [request.event.sessionId, request]),
    );
    // Oldest first, so each agent keeps its desk as others arrive.
    const present = agents
      .filter((agent) => onTheFloor(agent.latest, asking.has(agent.latest.id)))
      .reverse();
    const plan = floorPlan(present.length);
    const floorAgents = present.map((agent, index): FloorAgent => {
      const state = stateOf(agent, traces, asking.has(agent.latest.id));
      const trace = traces[agent.latest.id];
      const progress = trace === undefined ? undefined : progressOf(trace);
      const harness =
        harnesses.find((known) => known.harness === agent.latest.options.harness)?.name ??
        agent.latest.options.harness;
      return {
        agent,
        state,
        harness,
        position: plan.seats[index]?.agent ?? plan.start,
        ...bubbleOf(state, asking.get(agent.latest.id), progress),
      };
    });
    return { plan, floorAgents };
  }, [agents, traces, waiting, harnesses]);

  const chosen = floorAgents.filter(({ agent }) => selection.includes(agent.id));
  const asking = floorAgents.filter(({ state }) => state === "waiting").length;

  return (
    <section aria-labelledby="office-title" className={styles.office}>
      <header className={styles.header}>
        <h1 id="office-title">Office</h1>
        <span>{floorAgents.length === 1 ? "1 agent" : `${floorAgents.length} agents`}</span>
        {asking === 0 ? null : <span className={styles.asking}>{asking} need you</span>}
        <span className={styles.keys}>
          Walk with WASD or the arrow keys · click an agent · drag to select several
        </span>
      </header>
      <div className={styles.body}>
        <div className={styles.scroll}>
          <Floor plan={plan} agents={floorAgents} selection={selection} onSelect={select} />
        </div>
        {chosen.length === 1 && chosen[0] !== undefined ? (
          <AgentPanel member={chosen[0]} />
        ) : chosen.length > 1 ? (
          <GroupPanel members={chosen} />
        ) : (
          <EmptyPanel count={floorAgents.length} />
        )}
      </div>
    </section>
  );
}
