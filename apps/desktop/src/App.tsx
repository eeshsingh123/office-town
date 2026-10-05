import { Tooltip } from "radix-ui";
import { useEffect } from "react";
import styles from "./App.module.css";
import { NeedsYouView } from "./features/needs-you/NeedsYouView.tsx";
import { NewTaskView } from "./features/new-task/NewTaskView.tsx";
import { OfficeView } from "./features/office/OfficeView.tsx";
import { ProfilesView } from "./features/profiles/ProfilesView.tsx";
import { Sidebar } from "./features/sidebar/Sidebar.tsx";
import { TaskView } from "./features/task/TaskView.tsx";
import { TasksView } from "./features/tasks/TasksView.tsx";
import { navigate, useApp, type View } from "./store/app-store.ts";

function Main({ view }: { view: View }) {
  switch (view.name) {
    case "office":
      return <OfficeView />;
    case "new-task":
      return <NewTaskView />;
    case "needs-you":
      return <NeedsYouView />;
    case "tasks":
      return <TasksView />;
    case "profiles":
      return <ProfilesView />;
    case "task":
      return <TaskView key={view.taskId} taskId={view.taskId} />;
  }
}

export function App() {
  const view = useApp((state) => state.view);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "n" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
        event.preventDefault();
        navigate({ name: "new-task" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <Tooltip.Provider delayDuration={300}>
      <div className={styles.app}>
        <Sidebar />
        <main className={styles.main}>
          <Main view={view} />
        </main>
      </div>
    </Tooltip.Provider>
  );
}
