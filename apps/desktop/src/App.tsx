import { Tooltip } from "radix-ui";
import { useEffect } from "react";
import styles from "./App.module.css";
import { ChiefView } from "./features/chief/ChiefView.tsx";
import { DepartmentSettings } from "./features/departments/DepartmentSettings.tsx";
import { NewDepartmentView } from "./features/departments/NewDepartmentView.tsx";
import { HomeView } from "./features/home/HomeView.tsx";
import { NeedsYouView } from "./features/needs-you/NeedsYouView.tsx";
import { NewTaskView } from "./features/new-task/NewTaskView.tsx";
import { OfficeView } from "./features/office/OfficeView.tsx";
import { useWaitingKeys } from "./features/office/waiting-keys.ts";
import { TemplatesView } from "./features/profiles/TemplatesView.tsx";
import { Sidebar } from "./features/sidebar/Sidebar.tsx";
import { TaskView } from "./features/task/TaskView.tsx";
import { TasksView } from "./features/tasks/TasksView.tsx";
import { YouView } from "./features/you/YouView.tsx";
import { navigate, useApp, type View } from "./store/app-store.ts";
import { Toaster } from "./ui/Toast.tsx";

function Main({ view }: { view: View }) {
  switch (view.name) {
    case "home":
      return <HomeView />;
    case "office":
      return <OfficeView />;
    case "new-task":
      return <NewTaskView />;
    case "new-department":
      return <NewDepartmentView />;
    case "chief":
      return <ChiefView key={view.edit ? "edit" : "page"} edit={view.edit ?? false} />;
    case "needs-you":
      return <NeedsYouView />;
    case "tasks":
      return <TasksView />;
    case "templates":
      return <TemplatesView />;
    case "you":
      return <YouView />;
    case "department":
      return <DepartmentSettings key={view.departmentId} departmentId={view.departmentId} />;
    case "task":
      return <TaskView key={view.taskId} taskId={view.taskId} />;
  }
}

export function App() {
  const view = useApp((state) => state.view);
  useWaitingKeys();
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
        <Toaster />
      </div>
    </Tooltip.Provider>
  );
}
