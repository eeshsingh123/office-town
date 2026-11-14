import type { DepartmentRecord } from "@office-town/contract";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import styles from "./Office.module.css";
import { setShowAllRooms, useOffice } from "./office-state.ts";

// How many folded rooms the strip names before "+N".
const NAMED = 8;

// Free rooms folded into one strip under the floor; a name opens its room (design audit a2-2).
export function QuietRooms(props: {
  folded: DepartmentRecord[];
  // More departments than fold; only then the strip offers to fold or show them.
  foldable: boolean;
  onOpenRoom: (departmentId: string) => void;
}) {
  const { folded, foldable, onOpenRoom } = props;
  const agents = useApp((state) => state.agents);
  const showAll = useOffice((state) => state.showAllRooms);
  if (!foldable) return null;
  if (showAll) {
    return (
      <div className={styles.quiet}>
        <span className={styles.quietGrow} />
        <Button variant="ghost" onClick={() => setShowAllRooms(false)}>
          Fold free rooms
        </Button>
      </div>
    );
  }
  if (folded.length === 0) return null;
  const rest = folded.length - NAMED;
  return (
    <section className={styles.quiet} aria-label="Free departments">
      <strong className={styles.quietTitle}>
        {folded.length === 1 ? "1 free department" : `${folded.length} free departments`}
      </strong>
      {folded.slice(0, NAMED).map((department) => (
        <button
          key={department.id}
          type="button"
          className={styles.quietRoom}
          title={`Open ${department.name}`}
          onClick={() => onOpenRoom(department.id)}
        >
          <i
            style={{ background: agents[department.leadAgentId]?.colour ?? "var(--text-3)" }}
            aria-hidden
          />
          {department.name}
        </button>
      ))}
      {rest > 0 ? <span className={styles.quietMore}>+{rest}</span> : null}
      <span className={styles.quietGrow} />
      <Button variant="ghost" onClick={() => setShowAllRooms(true)}>
        Show all rooms
      </Button>
    </section>
  );
}
