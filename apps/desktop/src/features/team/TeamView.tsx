import type { AgentRecord, DepartmentRecord } from "@office-town/contract";
import { ChevronDown, Crown, Plus, Settings, UserPlus } from "lucide-react";
import { useDepartmentState, useLiveState } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { forSession, useKept, useKeptScroll } from "../../store/kept.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { StatePill, StateTag } from "../../ui/StatusIcon.tsx";
import { selectRoom } from "../office/office-state.ts";
import { useModelLine, useModelName } from "../profiles/model-line.ts";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import styles from "./Team.module.css";
import { useTeamFolds } from "./team-folds.ts";

function Person({
  agent,
  departmentId,
  lead,
}: {
  agent: AgentRecord;
  departmentId: string;
  lead: boolean;
}) {
  const model = useModelName(agent.settings, agent.settings.model);
  const state = useLiveState(agent.id);
  const role = agent.role ?? (lead ? "Lead" : "Member");
  return (
    <li>
      <button
        type="button"
        className={`${styles.person} ${lead ? "" : styles.member}`}
        onClick={() => navigate({ name: "department", departmentId, member: agent.id })}
      >
        <span className={styles.who}>
          <Avatar name={agent.name} colour={agent.colour} size={24} />
          <span className={styles.role} title={role}>
            {role}
          </span>
          {lead && role.toLowerCase() !== "lead" ? (
            <span className={styles.leadChip}>Lead</span>
          ) : null}
        </span>
        <span className={styles.handle}>{agent.name}</span>
        <span className={styles.model} title={model}>
          <ProviderLogo harness={agent.settings.harness} size="sm" />
          <span className={styles.modelName}>{model}</span>
        </span>
        <StateTag state={state} />
      </button>
    </li>
  );
}

function DepartmentCard({
  department,
  members,
  folded,
  onFold,
}: {
  department: DepartmentRecord;
  members: AgentRecord[];
  folded: boolean;
  onFold: () => void;
}) {
  const state = useDepartmentState(department.id);
  const lead = members.find((agent) => agent.id === department.leadAgentId);
  const rest = members.filter((agent) => agent.id !== department.leadAgentId);
  const leadModel = useModelName(lead?.settings, lead?.settings.model);
  const people = members.length === 1 ? "1 person" : `${members.length} people`;
  const summary = folded
    ? lead === undefined
      ? people
      : `${people} · ${lead.role ?? "Lead"} on ${leadModel}`
    : (department.purpose ?? people);
  return (
    <article className={styles.department}>
      <header className={styles.departmentHead}>
        <button
          type="button"
          className={styles.fold}
          aria-expanded={!folded}
          aria-label={`${folded ? "Show" : "Hide"} ${department.name}'s people`}
          onClick={onFold}
        >
          <ChevronDown size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.openTeam}
          title={`Open ${department.name} in the office`}
          onClick={() => selectRoom(department.id)}
        >
          <Avatar name={department.name} colour={lead?.colour ?? "#4F5D75"} size={32} />
          <span className={styles.text}>
            <strong>{department.name}</strong>
            <span title={summary}>{summary}</span>
          </span>
        </button>
        <StatePill state={state} />
        <Button
          variant="ghost"
          icon
          aria-label={`${department.name} settings`}
          title="Department settings"
          onClick={() => navigate({ name: "department", departmentId: department.id })}
        >
          <Settings size={16} aria-hidden />
        </Button>
      </header>
      {folded ? null : (
        <div className={styles.people}>
          <div className={styles.columns} aria-hidden>
            <span>Role</span>
            <span>Name</span>
            <span>Model</span>
            <span>Status</span>
          </div>
          <ul className={styles.rows}>
            {lead === undefined ? null : <Person agent={lead} departmentId={department.id} lead />}
            {rest.map((agent) => (
              <Person key={agent.id} agent={agent} departmentId={department.id} lead={false} />
            ))}
          </ul>
          <button
            type="button"
            className={styles.addPerson}
            onClick={() =>
              navigate({ name: "department", departmentId: department.id, member: "new" })
            }
          >
            <UserPlus size={14} aria-hidden />
            Add member
          </button>
        </div>
      )}
    </article>
  );
}

// The chief's row, first in the list, only once one is set up.
function ChiefRow({ departments }: { departments: number }) {
  const chief = useApp((state) =>
    state.chiefId === undefined ? undefined : state.agents[state.chiefId],
  );
  const working = useApp((state) =>
    Object.values(state.tasks).some(
      ({ task }) => task.leadAgentId === state.chiefId && task.state === "working",
    ),
  );
  const model = useModelLine(chief?.settings);
  if (chief === undefined) return null;
  const across = departments === 1 ? "1 department" : `${departments} departments`;
  return (
    <li>
      <button
        type="button"
        className={`${styles.node} ${styles.chief}`}
        onClick={() => navigate({ name: "chief" })}
      >
        <Avatar name={chief.name} colour={chief.colour} size={32} />
        <span className={styles.text}>
          <strong>Chief</strong>
          <span>
            {chief.name} · plans across {across} · {model}
          </span>
        </span>
        <StatePill state={working ? "working" : "idle"} />
      </button>
    </li>
  );
}

const QUERY = forSession("team.query", "");

// Everyone who works for the user: the chief when there is one, then each department and its
// people (design audit a2-23).
export function TeamView() {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const hasChief = useApp((state) => state.chiefId !== undefined);
  const [query, setQuery] = useKept(QUERY);
  const scroll = useKeptScroll("team");
  const needle = query.trim().toLowerCase();
  const all = Object.values(departments).toSorted((a, b) => a.name.localeCompare(b.name));
  const { folded, toggle } = useTeamFolds(all.length);
  const membersOf = (department: DepartmentRecord) =>
    Object.values(agents)
      .filter((agent) => agent.departmentId === department.id)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const shown = all.filter(
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
  const empty = all.length === 0;

  return (
    <section
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      className={page.page}
      aria-labelledby="team-title"
    >
      <div className={styles.column}>
        <PageHeader
          id="team-title"
          title="Team"
          lead="Your departments, their people and your chief."
          actions={
            <>
              {empty || hasChief ? null : (
                <Button onClick={() => navigate({ name: "chief" })}>
                  <Crown size={14} aria-hidden />
                  Add a chief
                </Button>
              )}
              <Button variant="primary" onClick={() => navigate({ name: "new-department" })}>
                <Plus size={14} aria-hidden />
                New department
              </Button>
            </>
          }
        />

        {empty ? null : (
          // In a row, so the box keeps its height in the page's column.
          <div className={styles.tools}>
            <SearchBox
              value={query}
              onChange={(value) => setQuery(value)}
              label="Search the team"
              placeholder="Search departments, roles and names"
            />
          </div>
        )}

        {empty && !hasChief ? (
          <p className={page.hint}>No departments yet.</p>
        ) : (
          <ul className={styles.list}>
            {needle === "" ? <ChiefRow departments={all.length} /> : null}
            {shown.map((department) => (
              <li key={department.id}>
                <DepartmentCard
                  department={department}
                  members={membersOf(department)}
                  folded={needle === "" && folded(department.id)}
                  onFold={() => toggle(department.id)}
                />
              </li>
            ))}
          </ul>
        )}
        {!empty && shown.length === 0 ? (
          <p className={page.hint}>No department, role or name matches "{query.trim()}".</p>
        ) : null}
      </div>
    </section>
  );
}
