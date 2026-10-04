import styles from "./App.module.css";
import { OfficeView } from "./features/office/OfficeView.tsx";
import { Sidebar } from "./features/sidebar/Sidebar.tsx";
import { useApp, type View } from "./store/app-store.ts";

function Main({ view }: { view: View }) {
  switch (view.name) {
    case "office":
      return <OfficeView />;
    default:
      return <OfficeView />;
  }
}

export function App() {
  const view = useApp((state) => state.view);
  return (
    <div className={styles.app}>
      <Sidebar />
      <main className={styles.main}>
        <Main view={view} />
      </main>
    </div>
  );
}
