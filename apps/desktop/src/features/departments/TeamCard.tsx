import type { CSSProperties, ReactNode } from "react";
import { Avatar } from "../../ui/Avatar.tsx";
import { Count } from "../../ui/Count.tsx";
import { useModelLine } from "../profiles/model-line.ts";
import styles from "./TeamCard.module.css";
import {
  byRole,
  type DepartmentForm,
  LEAD_COLOUR,
  memberColour,
  type PersonForm,
} from "./team-form.ts";
import { peopleLine } from "./team-line.ts";

const CHART_COLUMNS = 4;

function Person({
  person,
  colour,
  lead,
  title,
  className = "",
}: {
  person: PersonForm;
  colour: string;
  lead: boolean;
  // Replaces the role, such as inside a box that already names it.
  title?: string;
  className?: string;
}) {
  const model = useModelLine(person.settings);
  const role = person.role.trim() || (lead ? "Lead" : "New member");
  return (
    <li className={`${lead ? styles.lead : styles.member} ${className}`}>
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

// Where the line over the first row of the team runs, as a share of columns and gaps, so it joins
// the middle of the first box to the middle of the last, and passes under the lead.
function lineOver(spans: number[], columns: number) {
  const row: number[] = [];
  for (const span of spans) {
    if (row.reduce((sum, one) => sum + one, 0) + span > columns) break;
    row.push(span);
  }
  const middleOf = (index: number) => {
    const before = row.slice(0, index).reduce((sum, one) => sum + one, 0);
    const span = row[index] ?? 1;
    return { columns: before + span / 2, gaps: before + (span - 1) / 2 };
  };
  const centre = { columns: columns / 2, gaps: (columns - 1) / 2 };
  const first = middleOf(0);
  const last = middleOf(row.length - 1);
  const from = first.columns < centre.columns ? first : centre;
  const to = last.columns > centre.columns ? last : centre;
  return {
    joined: row.length,
    style: {
      "--columns": columns,
      "--from-columns": from.columns,
      "--from-gaps": from.gaps,
      "--to-columns": to.columns,
      "--to-gaps": to.gaps,
    } as CSSProperties,
  };
}

// The lead on top and the team under it, only as wide as the team; people who share a role sit in
// one box.
function Chart({ form }: { form: DepartmentForm }) {
  const colourOf = (person: PersonForm) => memberColour(form.members.indexOf(person));
  const groups = byRole(form.members, (member) => member.role)
    .toSorted((a, b) => b.people.length - a.people.length)
    .map((group) => ({ ...group, span: Math.min(group.people.length, CHART_COLUMNS) }));
  const spans = groups.map((group) => group.span);
  const columns = Math.min(
    CHART_COLUMNS,
    spans.reduce((sum, span) => sum + span, 0),
  );
  const line = lineOver(spans, columns);
  return (
    <div className={styles.chart}>
      <ul className={styles.top}>
        <Person person={form.lead} colour={LEAD_COLOUR} lead />
      </ul>
      {form.members.length === 0 ? null : (
        <ul className={styles.rows} style={line.style}>
          {groups.map(({ role, people, span }, index) => {
            const [only] = people;
            const joined = index < line.joined ? (styles.joined ?? "") : "";
            if (people.length === 1 && only !== undefined) {
              return (
                <Person
                  key={only.key}
                  person={only}
                  colour={colourOf(only)}
                  lead={false}
                  className={joined}
                />
              );
            }
            const style = { "--span": span } as CSSProperties;
            return (
              <li key={role} className={`${styles.group} ${joined}`} style={style}>
                <span className={styles.groupName}>
                  {role || "New member"}
                  <Count value={people.length} tone="accent" />
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
          <span>{form.purpose.trim() || peopleLine(form.members.length + 1)}</span>
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
