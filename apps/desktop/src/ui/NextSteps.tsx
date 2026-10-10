import styles from "./Page.module.css";

// What starting will do, in the user's words, so nothing on the page has to be guessed.
export function NextSteps({ title, steps }: { title: string; steps: readonly string[] }) {
  return (
    <section className={styles.panel} aria-labelledby="next-steps-title">
      <div>
        <div className={styles.eyebrow}>What happens next</div>
        <div id="next-steps-title" className={styles.panelTitle}>
          {title}
        </div>
      </div>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={step} className={styles.step}>
            <span className={styles.number} aria-hidden>
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}
