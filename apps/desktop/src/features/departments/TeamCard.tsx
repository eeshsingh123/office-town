import type { ReactNode } from "react";
import { Avatar } from "../../ui/Avatar.tsx";
import { useModelLine } from "../profiles/model-line.ts";
import styles from "./TeamCard.module.css";
import { type DepartmentForm, LEAD_COLOUR, memberColour, type PersonForm } from "./team-form.ts";
import { teamLine } from "./team-line.ts";

function Person({ person, colour, lead }: { person: PersonForm; colour: string; lead: boolean }) {
  const model = useModelLine(person.settings);
  const role = person.role.trim() || (lead ? "Lead" : "New member");
  return (
    <li className={lead ? styles.lead : styles.member}>
      <Avatar name={role} colour={colour} size={28} />
      <span className={styles.text}>
        <strong>{role}</strong>
        {person.purpose.trim() === "" ? null : <span>{person.purpose}</span>}
      </span>
      <span className={`${styles.model} ${person.modelGuessed ? styles.guessed : ""}`}>
        {model}
      </span>
    </li>
  );
}

// A department as it will be created: its name, what it is for, and who is on it.
export function TeamCard({ form, footer }: { form: DepartmentForm; footer?: ReactNode }) {
  const name = form.name.trim() || "New department";
  return (
    <section className={styles.card} aria-label={name}>
      <header className={styles.head}>
        <Avatar name={name} colour={LEAD_COLOUR} size={40} />
        <div className={styles.text}>
          <strong className={styles.name}>{name}</strong>
          <span>{form.purpose.trim() || teamLine(form.members.length)}</span>
        </div>
      </header>
      <ul className={styles.people}>
        <Person person={form.lead} colour={LEAD_COLOUR} lead />
        {form.members.map((member, index) => (
          <Person key={member.key} person={member} colour={memberColour(index)} lead={false} />
        ))}
      </ul>
      {footer}
    </section>
  );
}
