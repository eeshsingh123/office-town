import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { type AppState, goBack, goForward, useApp, type Visit } from "../../store/app-store.ts";
import { taskTitle } from "../../ui/format.ts";
import styles from "./Sidebar.module.css";
import { useSidebar } from "./sidebar-state.ts";

const PAGES: Record<string, string> = {
  home: "Home",
  "new-task": "New task",
  "new-department": "New department",
  chief: "Chief",
  "needs-you": "Needs you",
  tasks: "Tasks",
  templates: "Templates",
  workspaces: "Workspaces",
  usage: "Usage",
  you: "Your profile",
};

export function visitLabel({ view, selection }: Visit, state: AppState): string {
  switch (view.name) {
    case "office": {
      const room = view.room === undefined ? undefined : state.departments[view.room]?.name;
      const [only] = selection;
      const agent =
        selection.length > 1
          ? `${selection.length} agents`
          : only === undefined
            ? undefined
            : state.agents[only]?.name;
      return ["Office", room, agent].filter(Boolean).join(" · ");
    }
    case "task": {
      const prompt = state.tasks[view.taskId]?.task.prompt;
      return prompt === undefined ? "Task" : taskTitle(prompt);
    }
    case "department":
      return state.departments[view.departmentId]?.name ?? "Department";
    case "workspace":
      return state.workspaces?.find((one) => one.id === view.workspaceId)?.name ?? "Workspace";
    default:
      return PAGES[view.name] ?? "Previous screen";
  }
}

// Alt+arrows and the mouse's side buttons, as in a browser.
export function useHistoryKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === "ArrowLeft") goBack();
      else if (event.key === "ArrowRight") goForward();
      else return;
      event.preventDefault();
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3) goBack();
      else if (event.button === 4) goForward();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);
}

export function HistoryButtons() {
  const back = useApp((state) => {
    const last = state.back.at(-1);
    return last === undefined ? undefined : visitLabel(last, state);
  });
  const forward = useApp((state) => {
    const [next] = state.forward;
    return next === undefined ? undefined : visitLabel(next, state);
  });
  return (
    <span className={styles.history}>
      <button
        type="button"
        className={styles.collapse}
        onClick={goBack}
        disabled={back === undefined}
        aria-label={back === undefined ? "Back" : `Back to ${back}`}
        title={back === undefined ? "Back (Alt+←)" : `Back to ${back} (Alt+←)`}
      >
        <ArrowLeft size={16} aria-hidden />
      </button>
      <button
        type="button"
        className={styles.collapse}
        onClick={goForward}
        disabled={forward === undefined}
        aria-label={forward === undefined ? "Forward" : `Forward to ${forward}`}
        title={forward === undefined ? "Forward (Alt+→)" : `Forward to ${forward} (Alt+→)`}
      >
        <ArrowRight size={16} aria-hidden />
      </button>
    </span>
  );
}

// With the sidebar collapsed, back and forward sit in a row at the top of the
// main area. The Office has its own top bar and shows them there instead.
export function HistoryRow() {
  const collapsed = useSidebar((state) => state.collapsed);
  const office = useApp((state) => state.view.name === "office");
  if (!collapsed || office) return null;
  return (
    <div className={styles.historyRow}>
      <HistoryButtons />
    </div>
  );
}
