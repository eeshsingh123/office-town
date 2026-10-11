import { ArrowRight, Copy, Plus } from "lucide-react";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import styles from "./TemplatesGuide.module.css";

const BLUE = "#3A6EA5";

// The three steps of a template, each with a small picture of the screen it happens on.
const STEPS = [
  {
    title: "Set it up once",
    text: "Press New template, or open any agent's profile and choose Save as template.",
    picture: (
      <span className={styles.miniCard}>
        <span className={styles.miniTop}>
          <Avatar name="Web lead" colour={BLUE} size={24} />
          <span className={styles.miniText}>
            <strong>Web lead</strong>
            <span>Plans the web work</span>
          </span>
        </span>
        <span className={styles.miniLine}>Haiku 5.5 · Claude Code</span>
      </span>
    ),
  },
  {
    title: "Use it when you need it",
    text: "Press Use on its card, type / in a new task, or pick it when you add someone to a team.",
    picture: (
      <span className={styles.miniComposer}>
        <span className={styles.miniInput}>
          /web
          <span className={styles.caret} />
        </span>
        <span className={styles.miniOption}>
          <Avatar name="Web lead" colour={BLUE} size={18} />
          Web lead
        </span>
      </span>
    ),
  },
  {
    title: "Get a ready agent",
    text: "A new agent starts with the same job, model and notes. Changing it later leaves the template as it was.",
    picture: (
      <span className={styles.miniCopy}>
        <span className={`${styles.miniFace} ${styles.miniTemplate}`}>
          <Avatar name="Web lead" colour={BLUE} size={30} />
          Template
        </span>
        <ArrowRight size={16} aria-hidden />
        <span className={styles.miniFace}>
          <span className={styles.miniAgent}>
            <Avatar name="Web lead" colour={BLUE} size={30} />
            <span className={styles.copyBadge}>
              <Copy size={9} aria-hidden />
            </span>
          </span>
          New agent
        </span>
      </span>
    ),
  },
];

// onNew is passed only while there are no templates yet.
export function TemplatesGuide({ onHide, onNew }: { onHide: () => void; onNew?: () => void }) {
  return (
    <section className={styles.guide} aria-labelledby="templates-guide">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 id="templates-guide" className={styles.title}>
            How templates work
          </h2>
          <p className={styles.intro}>
            A template is an agent you set up once: its job, model and notes. Start new agents from
            it whenever you need one.
          </p>
        </div>
        <Button variant="ghost" onClick={onHide}>
          Hide
        </Button>
      </div>
      <ol className={styles.steps}>
        {STEPS.map((step, index) => (
          <li key={step.title} className={styles.step}>
            <span className={styles.picture} aria-hidden>
              {step.picture}
            </span>
            <span className={styles.number}>Step {index + 1}</span>
            <strong className={styles.stepTitle}>{step.title}</strong>
            <span className={styles.stepText}>{step.text}</span>
          </li>
        ))}
      </ol>
      {onNew === undefined ? null : (
        <div>
          <Button variant="primary" onClick={onNew}>
            <Plus size={14} aria-hidden />
            Make your first template
          </Button>
        </div>
      )}
    </section>
  );
}
