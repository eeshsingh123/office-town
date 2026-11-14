import { type KeyboardEvent, useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { selectAgent, selectRoom } from "./office-state.ts";
import styles from "./TopBar.module.css";

const SHOWN = 8;

interface Match {
  id: string;
  kind: "department" | "person";
  name: string;
  line: string;
  colour: string;
}

// Departments and their people by name or role; a pick opens the room or the person, folded or
// not, and brings it into view (design audit a2-2).
export function FindOnFloor() {
  const [query, setQuery] = useState("");
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const needle = query.trim().toLowerCase();
  const matches: Match[] =
    needle === ""
      ? []
      : [
          ...Object.values(departments)
            .filter((one) => one.name.toLowerCase().includes(needle))
            .toSorted((a, b) => a.name.localeCompare(b.name))
            .map((one) => ({
              id: one.id,
              kind: "department" as const,
              name: one.name,
              line: "Department",
              colour: agents[one.leadAgentId]?.colour ?? "var(--text-3)",
            })),
          ...Object.values(agents)
            .filter((agent) => agent.departmentId !== undefined && agent.guest !== true)
            .filter((agent) => `${agent.name} ${agent.role ?? ""}`.toLowerCase().includes(needle))
            .flatMap((agent) => {
              const department = departments[agent.departmentId ?? ""];
              if (department === undefined) return [];
              const role = department.leadAgentId === agent.id ? "Lead" : (agent.role ?? "Member");
              return [
                {
                  id: agent.id,
                  kind: "person" as const,
                  name: agent.name,
                  line: `${role} · ${department.name}`,
                  colour: agent.colour,
                },
              ];
            }),
        ].slice(0, SHOWN);

  const pick = (match: Match) => {
    setQuery("");
    if (match.kind === "department") selectRoom(match.id);
    else selectAgent(match.id);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && matches[0] !== undefined) {
      event.preventDefault();
      pick(matches[0]);
    } else if (event.key === "Escape" && query !== "") {
      event.stopPropagation();
      setQuery("");
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Enter and Escape reach the box inside
    <div className={styles.find} onKeyDown={onKeyDown}>
      <SearchBox value={query} onChange={setQuery} label="Find a team or person" />
      {needle === "" ? null : (
        <div className={styles.found} role="listbox" aria-label="Matches">
          {matches.length === 0 ? (
            <p className={styles.noMatch}>No team or person matches.</p>
          ) : (
            matches.map((match) => (
              <button
                key={match.id}
                type="button"
                role="option"
                aria-selected={false}
                className={styles.match}
                onClick={() => pick(match)}
              >
                <Avatar name={match.name} colour={match.colour} size={22} />
                <span className={styles.matchText}>
                  <strong>{match.name}</strong>
                  <span>{match.line}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
