import { taskStateOf, useTasksWithAgents, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { taskTitle } from "../../ui/format.ts";
import { STATE_LABELS } from "../../ui/StatusIcon.tsx";
import styles from "./Composer.module.css";
import { CHIEF, SOLO } from "./targets.ts";

const SHOWN = 4;

const EXAMPLES = {
  software: [
    {
      title: "Fix the failing tests in a project",
      text: "Find out why the tests fail in this project, fix them and tell me what was wrong.",
    },
    {
      title: "Write a README for a project",
      text: "Read this project and write a README that says what it does, how to install it and how to run it.",
    },
    {
      title: "List the top problems in a file of support tickets",
      text: "Go through tickets.csv and list the five problems customers mention most, with an example of each.",
    },
  ],
  business: [
    {
      title: "List the top problems in a file of support tickets",
      text: "Go through tickets.csv and list the five problems customers mention most, with an example of each.",
    },
    {
      title: "Compare three tools and write a one-page summary",
      text: "Compare three note-taking apps for a small team and write a one-page summary with a recommendation.",
    },
    {
      title: "Draft a project brief",
      text: "Write a one-page brief for a new customer survey: goal, audience, questions to ask and a timeline.",
    },
  ],
};

interface SuggestionsProps {
  // Fills the box with the text and who it goes to.
  onUse: (text: string, target: string) => void;
}

// Examples until the first task; then the latest tasks, to send again.
export function Suggestions({ onUse }: SuggestionsProps) {
  const chiefId = useApp((state) => state.chiefId);
  const purpose = useApp((state) => state.onboarding?.purpose);
  const departments = useApp((state) => state.departments);
  const traces = useApp((state) => state.traces);
  const waiting = useWaitingSessions();
  const tasks = useTasksWithAgents().filter((entry) => entry.task.parentTaskId === undefined);

  if (tasks.length === 0) {
    return (
      <section className={styles.suggestions} aria-labelledby="suggested-title">
        <div className={styles.suggestionsHead}>
          <h2 id="suggested-title">Suggested tasks</h2>
          <button
            type="button"
            className={styles.link}
            onClick={() => navigate({ name: "templates" })}
          >
            Browse templates
          </button>
        </div>
        <div className={styles.examples}>
          {EXAMPLES[purpose === "software" ? "software" : "business"].map((example) => (
            <button
              key={example.title}
              type="button"
              className={styles.example}
              onClick={() => onUse(example.text, SOLO)}
            >
              <strong>{example.title}</strong>
              <span>An assistant</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.suggestions} aria-labelledby="again-title">
      <div className={styles.suggestionsHead}>
        <h2 id="again-title">Use again</h2>
        <button type="button" className={styles.link} onClick={() => navigate({ name: "tasks" })}>
          All tasks
        </button>
      </div>
      <ul className={styles.recent}>
        {tasks.slice(0, SHOWN).map(({ task, agents }) => {
          const department =
            task.departmentId === undefined ? undefined : departments[task.departmentId];
          const target =
            department !== undefined
              ? department.id
              : chiefId !== undefined && task.leadAgentId === chiefId
                ? CHIEF
                : SOLO;
          const state = taskStateOf(agents, traces, waiting);
          const who = department?.name ?? agents[0]?.name;
          return (
            <li key={task.id} className={styles.recentRow}>
              <span className={styles.recentText}>
                <strong>{taskTitle(task.prompt)}</strong>
                <span>
                  {[who, state === undefined ? undefined : STATE_LABELS[state]]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <button
                type="button"
                className={styles.again}
                onClick={() => onUse(task.prompt, target)}
              >
                Use again
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
