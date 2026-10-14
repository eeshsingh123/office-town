import type { AgentRecord, DepartmentRecord } from "@office-town/contract";
import { Plus, Search, Settings } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import page from "../../ui/Page.module.css";
import { selectRoom } from "../office/office-state.ts";
import { useModelLine, useModelName } from "../profiles/model-line.ts";
import { useYou } from "../you/you.ts";
import styles from "./Team.module.css";

const ROW = 3;

function Member({
  agent,
  departmentId,
  lead,
}: {
  agent: AgentRecord;
  departmentId: string;
  lead: boolean;
}) {
  const model = useModelName(agent.settings, agent.settings.model);
  return (
    <li>
      <button
        type="button"
        className={styles.member}
        onClick={() => navigate({ name: "department", departmentId, member: agent.id })}
      >
        <Avatar name={agent.name} colour={agent.colour} size={22} />
        <span className={styles.memberText}>
          {lead ? <strong>{agent.role ?? "Lead"}</strong> : (agent.role ?? "Member")}
        </span>
        <span className={styles.memberModel}>{model}</span>
      </button>
    </li>
  );
}

function DepartmentCard({
  department,
  members,
}: {
  department: DepartmentRecord;
  members: AgentRecord[];
}) {
  const working = useApp((state) =>
    Object.values(state.tasks).some(
      ({ task }) => task.departmentId === department.id && task.state === "working",
    ),
  );
  const lead = members.find((agent) => agent.id === department.leadAgentId);
  const rest = members.filter((agent) => agent.id !== department.leadAgentId);
  return (
    <article className={styles.department}>
      <header className={styles.departmentHead}>
        <div className={styles.departmentText}>
          <strong>{department.name}</strong>
          <span>{working ? "Working" : (department.purpose ?? `${members.length} people`)}</span>
        </div>
        <Button
          variant="ghost"
          icon
          aria-label={`${department.name} settings`}
          onClick={() => navigate({ name: "department", departmentId: department.id })}
        >
          <Settings size={14} aria-hidden />
        </Button>
      </header>
      <ul className={styles.members}>
        {lead === undefined ? null : <Member agent={lead} departmentId={department.id} lead />}
        {rest.map((agent) => (
          <Member key={agent.id} agent={agent} departmentId={department.id} lead={false} />
        ))}
      </ul>
      <footer className={styles.departmentFoot}>
        <Button variant="ghost" onClick={() => selectRoom(department.id)}>
          Open in office
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            navigate({ name: "department", departmentId: department.id, member: "new" })
          }
        >
          <Plus size={14} aria-hidden />
          Member
        </Button>
      </footer>
    </article>
  );
}

function ChiefNode() {
  const chief = useApp((state) =>
    state.chiefId === undefined ? undefined : state.agents[state.chiefId],
  );
  const model = useModelLine(chief?.settings);
  if (chief === undefined) {
    return (
      <button type="button" className={styles.addNode} onClick={() => navigate({ name: "chief" })}>
        <Plus size={16} aria-hidden />
        Set up a chief
        <span>Plans big goals across your departments</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.node} ${styles.chief}`}
      onClick={() => navigate({ name: "chief" })}
    >
      <Avatar name={chief.name} colour={chief.colour} size={32} />
      <span className={styles.nodeText}>
        <strong>{chief.name}</strong>
        <span>Plans across departments · {model}</span>
      </span>
    </button>
  );
}

// Everyone who works for the user, as an org chart: you, the chief, then each department.
export function TeamView() {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const hasChief = useApp((state) => state.chiefId !== undefined);
  const you = useYou();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const membersOf = (department: DepartmentRecord) =>
    Object.values(agents)
      .filter((agent) => agent.departmentId === department.id)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const shown = Object.values(departments)
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .filter(
      (department) =>
        needle === "" ||
        [
          department.name,
          department.purpose ?? "",
          ...membersOf(department).flatMap((agent) => [agent.name, agent.role ?? ""]),
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle),
    );
  const cards = [...shown.map((department) => department.id), "~new"];
  const rows = Array.from({ length: Math.ceil(cards.length / ROW) }, (_, index) =>
    cards.slice(index * ROW, index * ROW + ROW),
  );

  return (
    <section className={page.page} aria-labelledby="team-title">
      <div className={styles.column}>
        <header className={styles.head}>
          <div className={page.header}>
            <h1 id="team-title" className={page.title}>
              Team
            </h1>
            <p className={page.lead}>Who works for you, and who plans for whom.</p>
          </div>
          <div className={page.row}>
            <Button onClick={() => navigate({ name: "chief" })}>
              {hasChief ? "Chief" : "Set up a chief"}
            </Button>
            <Button variant="primary" onClick={() => navigate({ name: "new-department" })}>
              <Plus size={14} aria-hidden />
              New department
            </Button>
          </div>
        </header>

        {Object.keys(departments).length === 0 ? null : (
          <label className={styles.search}>
            <Search size={15} aria-hidden />
            <span className="visually-hidden">Search the team</span>
            <input
              value={query}
              placeholder="Search departments, roles and names"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}

        <div className={styles.chart}>
          <div className={styles.node}>
            <Avatar name={you.name || "You"} colour={you.colour} size={32} />
            <span className={styles.nodeText}>
              <strong>You</strong>
              <span>Give goals, approve plans</span>
            </span>
          </div>
          <span className={styles.trunk} aria-hidden />
          <ChiefNode />
          {rows.map((row) => (
            <div key={row.join()} className={styles.row}>
              <span className={styles.trunk} aria-hidden />
              <div className={styles.branches} style={{ "--count": row.length } as CSSProperties}>
                {row.map((id) => {
                  const department = departments[id];
                  return (
                    <div key={id} className={styles.branch}>
                      {department === undefined ? (
                        <button
                          type="button"
                          className={styles.addDepartment}
                          onClick={() => navigate({ name: "new-department" })}
                        >
                          <Plus size={18} aria-hidden />
                          <strong>New department</strong>
                          <span>Describe it or build it by hand</span>
                        </button>
                      ) : (
                        <DepartmentCard department={department} members={membersOf(department)} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
