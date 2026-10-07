import type { AgentState } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { StatusIcon } from "../../ui/StatusIcon.tsx";
import styles from "./Office.module.css";

interface CharacterProps {
  name: string;
  colour: string;
  state: AgentState | undefined;
  selected: boolean;
  square?: boolean;
  focused?: boolean;
}

// Pixel art or themes replace this component later, as a skin.
export function Character({ name, colour, state, selected, square, focused }: CharacterProps) {
  const classes = [
    styles.character,
    selected ? styles.selected : "",
    square ? styles.square : "",
    focused ? styles.focused : "",
  ];
  return (
    <span className={classes.join(" ")}>
      <Avatar name={name} colour={colour} size={36} />
      {state === undefined ? null : (
        <span className={styles.badge}>
          <StatusIcon state={state} size={11} />
        </span>
      )}
    </span>
  );
}
