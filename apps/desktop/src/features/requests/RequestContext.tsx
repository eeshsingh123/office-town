import { useSessionAgent } from "../../store/agents.ts";
import { navigate, useApp, useHarnessName } from "../../store/app-store.ts";
import { progressOf } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { taskTitle } from "../../ui/format.ts";
import styles from "./RequestCard.module.css";

// Who is asking and what they are working on, for a card shown away from its trace.
export function RequestContext({ sessionId }: { sessionId: string }) {
  const trace = useApp((state) => state.traces[sessionId]);
  const agent = useSessionAgent(sessionId);
  const harness = useHarnessName(agent?.latest.options.harness ?? "");
  if (agent === undefined) return null;
  const step = trace === undefined ? undefined : progressOf(trace).step;
  return (
    <div className={styles.context}>
      <Avatar name={agent.name} colour={agent.colour} size={18} />
      <span>{agent.name}</span>
      <span className={styles.separator} />
      <button
        type="button"
        className={styles.taskLink}
        onClick={() => navigate({ name: "task", taskId: agent.taskId })}
      >
        {taskTitle(agent.task.prompt)}
      </button>
      <span className={styles.separator} />
      <span>
        {harness}
        {agent.latest.options.model === undefined ? "" : ` · ${agent.latest.options.model}`}
      </span>
      {step === undefined ? null : (
        <>
          <span className={styles.separator} />
          <span>
            Step {step.number} · {step.title}
          </span>
        </>
      )}
    </div>
  );
}
