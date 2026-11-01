import type { CSSProperties, ReactNode } from "react";
import { Avatar } from "../../ui/Avatar.tsx";
import { useModelLine } from "../profiles/model-line.ts";
import styles from "./TeamCard.module.css";
import {
  byRole,
  type DepartmentForm,
  LEAD_COLOUR,
  memberColour,
  type PersonForm,
} from "./team-form.ts";
import { teamLine } from "./team-line.ts";

const CHART_COLUMNS = 4;

function Person({
  person,
  colour,
  lead,
  title,
}: {
  person: PersonForm;
  colour: string;
  lead: boolean;
  // Replaces the role, such as inside a box that already names it.
  title?: string;
}) {
  const model = useModelLine(person.settings);
  const role = person.role.trim() || (lead ? "Lead" : "New member");
  return (
    <li className={lead ? styles.lead : styles.member}>
      <Avatar name={role} colour={colour} size={28} />
      <span className={styles.text}>
        <strong>{title ?? role}</strong>
        {person.purpose.trim() === "" ? null : <span>{person.purpose}</span>}
      </span>
      <span className={`${styles.model} ${person.modelGuessed ? styles.guessed : ""}`}>
        {model}
      </span>
    </li>
  );
}

// The lead on top and the team evenly under it; people who share a role sit in one box.
function Chart({ form }: { form: DepartmentForm }) {
  const colourOf = (person: PersonForm) => memberColour(form.members.indexOf(person));
  const groups = byRole(form.members, (member) => member.role).toSorted(
    (a, b) => b.people.length - a.people.length,
  );
  return (
    <div className={styles.chart}>
      <ul className={styles.top}>
        <Person person={form.lead} colour={LEAD_COLOUR} lead />
      </ul>
      {form.members.length === 0 ? null : (
        <ul className={styles.rows}>
          {groups.map(({ role, people }) => {
            const [only] = people;
            if (people.length === 1 && only !== undefined) {
              return <Person key={only.key} person={only} colour={colourOf(only)} lead={false} />;
            }
            const span = { "--span": Math.min(people.length, CHART_COLUMNS) } as CSSProperties;
            return (
              <li key={role} className={styles.group} style={span}>
                <span className={styles.groupName}>
                  {role || "New member"}
                  <span className={styles.groupCount}>{people.length}</span>
                </span>
                <ul className={styles.groupPeople}>
                  {people.map((member, index) => (
                    <Person
                      key={member.key}
                      person={member}
                      colour={colourOf(member)}
                      lead={false}
                      title={`No. ${index + 1}`}
                    />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// A department as it will be created: its name, what it is for, and who is on it. `chart` lays the
// team out across a full page; without it the team is a list that fits a side column.
export function TeamCard({
  form,
  footer,
  chart = false,
}: {
  form: DepartmentForm;
  footer?: ReactNode;
  chart?: boolean;
}) {
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
      {chart ? (
        <Chart form={form} />
      ) : (
        <ul className={styles.people}>
          <Person person={form.lead} colour={LEAD_COLOUR} lead />
          {form.members.map((member, index) => (
            <Person key={member.key} person={member} colour={memberColour(index)} lead={false} />
          ))}
        </ul>
      )}
      {footer}
    </section>
  );
}
