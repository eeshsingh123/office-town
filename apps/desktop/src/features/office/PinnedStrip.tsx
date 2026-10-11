import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { AgentCard } from "./AgentCard.tsx";
import styles from "./PinnedStrip.module.css";
import { unpin, usePins } from "./pins.ts";

// Pinned agents at the bottom of every screen, so they can be watched from anywhere.
export function PinnedStrip() {
  const pinned = usePins((state) => state.pinned);
  const agents = useApp((state) => state.agents);
  // An agent deleted with its task drops out.
  const shown = pinned.filter((id) => agents[id] !== undefined);
  if (shown.length === 0) return null;
  return (
    <section className={styles.strip} aria-label="Pinned agents">
      <div className={styles.cards}>
        {shown.map((id) => (
          <AgentCard key={id} agentId={id} onUnpin={() => unpin([id])} />
        ))}
      </div>
      <Button variant="ghost" onClick={() => unpin(shown)}>
        Unpin all
      </Button>
    </section>
  );
}
