import { useEffect } from "react";
import styles from "./App.module.css";
import { NewTaskView } from "./features/new-task/NewTaskView.tsx";
import { OfficeView } from "./features/office/OfficeView.tsx";
import { Sidebar } from "./features/sidebar/Sidebar.tsx";
import { TaskView } from "./features/task/TaskView.tsx";
import { navigate, useApp, type View } from "./store/app-store.ts";

function Main({ view }: { view: View }) {
  switch (view.name) {
    case "office":
      return <OfficeView />;
    case "new-task":
      return <NewTaskView />;
    case "task":
      return <TaskView key={view.taskId} taskId={view.taskId} />;
    default:
      return <OfficeView />;
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
    <div className={styles.app}>
      <Sidebar />
      <main className={styles.main}>
        <Main view={view} />
      </main>
    </div>
  );
}
