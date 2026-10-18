import type { AgentRecord, DepartmentRecord } from "@office-town/contract";
import { ChevronDown, Lock, Network, Plus, Search, Settings, UserPlus } from "lucide-react";
import { useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import page from "../../ui/Page.module.css";
import { selectRoom } from "../office/office-state.ts";
import { useModelLine, useModelName } from "../profiles/model-line.ts";
import { useYou } from "../you/you.ts";
import styles from "./Team.module.css";
import { useTeamFolds } from "./team-folds.ts";

const EXAMPLES = [
  {
    label: "Newsletter: writer and editor",
    text: "A writer and an editor for a weekly newsletter. The editor checks tone and facts before anything goes out.",
  },
  {
    label: "Research: researcher and fact checker",
    text: "A researcher who finds sources on a topic and a fact checker who confirms each claim before the summary is done.",
  },
  {
    label: "Web app: developer and reviewer",
    text: "A developer who builds features in our app and a reviewer who checks the code and tests before it merges.",
  },
];

// "Newsletter and Research", "A, B and C", or "your 5 departments".
function listNames(names: string[]): string {
  if (names.length > 3) return `your ${names.length} departments`;
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

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
  return (
    <button
      type="button"
      className={styles.person}
      onClick={() => navigate({ name: "department", departmentId, member: agent.id })}
    >
      <Avatar name={agent.name} colour={agent.colour} size={22} />
      <span className={styles.role}>
        {lead ? (
          <>
            <strong>{agent.role ?? "Lead"}</strong>
            {agent.role === undefined || agent.role.toLowerCase() === "lead" ? null : " · lead"}
          </>
        ) : (
          (agent.role ?? "Member")
        )}
      </span>
      <span className={styles.model}>{model}</span>
    </button>
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
  const working = useApp((state) =>
    Object.values(state.tasks).some(
      ({ task }) => task.departmentId === department.id && task.state === "working",
    ),
  );
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
          <ChevronDown size={15} aria-hidden />
        </button>
        <Avatar name={department.name} colour={lead?.colour ?? "#4F5D75"} size={32} />
        <div className={styles.text}>
          <strong>{department.name}</strong>
          <span>{summary}</span>
        </div>
        <span className={`${styles.status} ${working ? styles.working : ""}`}>
          {working ? "Working" : "Idle"}
        </span>
        <Button variant="ghost" className={styles.small} onClick={() => selectRoom(department.id)}>
          Open in office
        </Button>
        <Button
          variant="ghost"
          icon
          aria-label={`${department.name} settings`}
          onClick={() => navigate({ name: "department", departmentId: department.id })}
        >
          <Settings size={14} aria-hidden />
        </Button>
      </header>
      {folded ? null : (
        <div className={styles.people}>
          <ul className={`${styles.tree} ${styles.peopleTree}`}>
            {lead === undefined ? null : (
              <li>
                <Person agent={lead} departmentId={department.id} lead />
                {rest.length === 0 ? null : (
                  <ul>
                    {rest.map((agent) => (
                      <li key={agent.id}>
                        <Person agent={agent} departmentId={department.id} lead={false} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}
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

// The chief's place in the tree: the chief, an offer to add one, or locked until a department exists.
function ChiefSlot({ departmentNames }: { departmentNames: string[] }) {
  const chief = useApp((state) =>
    state.chiefId === undefined ? undefined : state.agents[state.chiefId],
  );
  const working = useApp((state) =>
    Object.values(state.tasks).some(
      ({ task }) => task.leadAgentId === state.chiefId && task.state === "working",
    ),
  );
  const model = useModelLine(chief?.settings);
  if (chief !== undefined) {
    const across =
      departmentNames.length === 1 ? "1 department" : `${departmentNames.length} departments`;
    return (
      <button
        type="button"
        className={`${styles.node} ${styles.chief}`}
        onClick={() => navigate({ name: "chief" })}
      >
        <Avatar name={chief.name} colour={chief.colour} size={32} />
        <span className={styles.text}>
          <strong>{chief.name}</strong>
          <span>
            Chief · plans across {across} · {model}
          </span>
        </span>
        <span className={`${styles.status} ${working ? styles.working : ""}`}>
          {working ? "Working" : "Ready"}
        </span>
      </button>
    );
  }
  if (departmentNames.length === 0) {
    return (
      <div className={styles.slot}>
        <span className={styles.ring}>
          <Lock size={15} aria-hidden />
        </span>
        <span className={styles.text}>
          <strong>Chief</strong>
          <span>
            Optional. Splits one big goal across departments. Opens once you have a department.
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className={styles.slot}>
      <span className={styles.ring}>
        <Network size={15} aria-hidden />
      </span>
      <span className={styles.text}>
        <strong>No chief</strong>
        <span>
          You give each department its own tasks. A chief takes one goal and splits it across{" "}
          {listNames(departmentNames)}.
        </span>
      </span>
      <Button className={styles.small} onClick={() => navigate({ name: "chief" })}>
        Add a chief
      </Button>
    </div>
  );
}

// The first step on an empty Team page: describe a department, or build it by hand.
function Starter() {
  const [text, setText] = useState("");
  const describe = text.trim();
  return (
    <section className={styles.starter} aria-labelledby="starter-title">
      <div className={styles.starterHead}>
        <span className={page.eyebrow}>Your first department</span>
        <h2 id="starter-title" className={styles.starterTitle}>
          Describe the team you need
        </h2>
        <p className={styles.starterLead}>
          A lead plans the work and hands parts to its people. You review what comes back.
        </p>
      </div>
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          if (describe !== "") navigate({ name: "new-department", describe });
        }}
      >
        <label htmlFor="team-describe" className="visually-hidden">
          Describe the department
        </label>
        <textarea
          id="team-describe"
          rows={3}
          value={text}
          placeholder={EXAMPLES[0]?.text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className={styles.composerBar}>
          <Button
            variant="ghost"
            className={styles.small}
            onClick={() => navigate({ name: "new-department", byHand: true })}
          >
            Build by hand
          </Button>
          <Button type="submit" variant="primary" disabled={describe === ""}>
            Draft department
          </Button>
        </div>
      </form>
      <div className={styles.examples}>
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            className={styles.example}
            onClick={() => setText(example.text)}
          >
            {example.label}
          </button>
        ))}
      </div>
    </section>
  );
}

// Everyone who works for the user, as one vertical tree: you, the chief, each department and
// its people.
export function TeamView() {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const hasChief = useApp((state) => state.chiefId !== undefined);
  const you = useYou();
  const [query, setQuery] = useState("");
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
    <section className={page.page} aria-labelledby="team-title">
      <div className={styles.column}>
        <header className={styles.head}>
          <div className={page.header}>
            <h1 id="team-title" className={page.title}>
              Team
            </h1>
            <p className={page.lead}>Who works for you, and who plans for whom.</p>
          </div>
          {empty ? null : (
            <Button variant="primary" onClick={() => navigate({ name: "new-department" })}>
              <Plus size={14} aria-hidden />
              New department
            </Button>
          )}
        </header>

        {empty ? null : (
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

        <ul className={styles.tree}>
          <li>
            <div className={styles.node}>
              <Avatar name={you.name || "You"} colour={you.colour} size={32} />
              <span className={styles.text}>
                <strong>You</strong>
                <span>Give goals, approve plans</span>
              </span>
            </div>
            <ul>
              <li className={!hasChief && empty ? styles.future : undefined}>
                <ChiefSlot departmentNames={all.map((department) => department.name)} />
                <ul>
                  {empty ? (
                    <li>
                      <Starter />
                    </li>
                  ) : (
                    shown.map((department) => (
                      <li key={department.id}>
                        <DepartmentCard
                          department={department}
                          members={membersOf(department)}
                          folded={needle === "" && folded(department.id)}
                          onFold={() => toggle(department.id)}
                        />
                      </li>
                    ))
                  )}
                </ul>
              </li>
            </ul>
          </li>
        </ul>
        {!empty && shown.length === 0 ? (
          <p className={page.hint}>No department, role or name matches "{query.trim()}".</p>
        ) : null}
      </div>
    </section>
  );
}
