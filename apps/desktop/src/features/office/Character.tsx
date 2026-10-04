import type { AgentState } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { StatusIcon } from "../../ui/StatusIcon.tsx";
import styles from "./Office.module.css";

interface CharacterProps {
  name: string;
  colour: string;
  state: AgentState;
  selected: boolean;
}

// An agent on the floor: its face and a small status badge. Pixel art or themes replace this one
// component later, as a skin.
export function Character({ name, colour, state, selected }: CharacterProps) {
  return (
    <span className={`${styles.character} ${selected ? styles.selected : ""}`}>
      <Avatar name={name} colour={colour} size={36} />
      <span className={styles.badge}>
        <StatusIcon state={state} size={11} />
      </span>
    </span>
  );
}
