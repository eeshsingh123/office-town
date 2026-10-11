import page from "../../ui/Page.module.css";
import { Composer } from "./Composer.tsx";
import styles from "./NewTaskView.module.css";

export function NewTaskView() {
  return (
    <section className={page.page} aria-labelledby="new-task-title">
      <div className={styles.column}>
        <header className={page.header}>
          <h1 id="new-task-title" className={page.title}>
            What do you need done?
          </h1>
          <p className={page.lead}>Write it the way you would ask a colleague.</p>
        </header>
        <Composer />
      </div>
    </section>
  );
}
