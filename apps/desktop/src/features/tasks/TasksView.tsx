import { Check, ChevronDown, Database, Plus, Search } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { loadOlderTasks } from "../../store/live.ts";
import { useWorkspaces } from "../../store/workspaces.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { byteSize } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import page from "../../ui/Page.module.css";
import { useLoaded } from "../../ui/use-loaded.ts";
import { useModelLine } from "../profiles/model-line.ts";
import { TaskRow, type Team } from "./TaskRow.tsx";
import styles from "./TasksView.module.css";
import {
  buildItems,
  DAY_LABELS,
  type Filters,
  type Group,
  type GroupBy,
  groupRows,
  type Item,
  NO_FILTERS,
  STATUS_LABELS,
  type Started,
  type Tab,
  tabCounts,
} from "./task-list.ts";

// Past this, the history is worth pruning; deleting tasks is the only way to free it.
const LARGE_STORE_BYTES = 1024 ** 3;
const GROUP_BY_KEY = "office-town.tasks.group-by";

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs", label: "Needs you" },
  { value: "active", label: "Working" },
  { value: "review", label: "To review" },
  { value: "done", label: "Done" },
  { value: "ended", label: "Failed or stopped" },
];

const GROUP_BY: { value: GroupBy; label: string }[] = [
  { value: "team", label: "Team" },
  { value: "status", label: "Status" },
  { value: "day", label: "Day" },
];

const STARTED: { value: Started; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "older", label: "Older" },
];

// Storage can be blocked; grouping by team is the default.
function savedGroupBy(): GroupBy {
  try {
    const saved = localStorage.getItem(GROUP_BY_KEY);
    return GROUP_BY.find((choice) => choice.value === saved)?.value ?? "team";
  } catch {
    return "team";
  }
}

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// The chief, then each department by name, then the agents working alone.
function useTeams(): Map<string, Team & { leadId: string | undefined; role: string }> {
  const chiefId = useApp((state) => state.chiefId);
  const agents = useApp((state) => state.agents);
  const departments = useApp((state) => state.departments);
  return useMemo(() => {
    const teams = new Map<string, Team & { leadId: string | undefined; role: string }>();
    const chief = chiefId === undefined ? undefined : agents[chiefId];
    if (chief !== undefined) {
      const team = { key: "chief", name: chief.name, colour: chief.colour };
      teams.set("chief", { ...team, leadId: chief.id, role: "Chief" });
    }
    for (const department of Object.values(departments).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const lead = agents[department.leadAgentId];
      teams.set(department.id, {
        key: department.id,
        name: department.name,
        colour: lead?.colour,
        leadId: lead?.id,
        role: "",
      });
    }
    teams.set("solo", {
      key: "solo",
      name: "Assistants",
      colour: undefined,
      leadId: undefined,
      role: "",
    });
    return teams;
  }, [chiefId, agents, departments]);
}

function StoreSize() {
  const size = useLoaded("store-size", api.readStoreSize);
  if (size.value === undefined) return null;
  const total = size.value.databaseBytes + size.value.resultBytes;
  const large = total >= LARGE_STORE_BYTES;
  return (
    <span
      className={`${styles.storage} ${large ? styles.storageLarge : ""}`}
      title={
        large
          ? "Task history on this computer. Deleting old tasks frees the space."
          : "Task history on this computer"
      }
    >
      <Database size={13} aria-hidden />
      {byteSize(total)}
    </span>
  );
}

function TeamFilter(props: {
  teams: Team[];
  chosen: string[];
  onChange: (teams: string[]) => void;
}) {
  const { teams, chosen, onChange } = props;
  const names = teams.filter((team) => chosen.includes(team.key)).map((team) => team.name);
  const label =
    names.length === 0 ? "All" : names.length <= 2 ? names.join(", ") : `${names.length} teams`;
  const toggle = (key: string, on: boolean) =>
    onChange(on ? [...chosen, key] : chosen.filter((known) => known !== key));
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={`${menu.chip} ${chosen.length > 0 ? styles.set : ""}`}>
        <span className={menu.chipLabel}>Team</span>
        {label}
        <ChevronDown size={14} className={menu.chipLabel} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menu.surface} align="start" sideOffset={4}>
          {teams.map((team) => (
            <DropdownMenu.CheckboxItem
              key={team.key}
              className={menu.item}
              checked={chosen.includes(team.key)}
              onCheckedChange={(on) => toggle(team.key, on)}
              onSelect={(event) => event.preventDefault()}
            >
              <Avatar name={team.name} colour={team.colour ?? "var(--text-3)"} size={18} />
              <span className={menu.itemText}>{team.name}</span>
              <DropdownMenu.ItemIndicator>
                <Check size={14} className={menu.check} aria-hidden />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// The lead's model; agent names are handles, which mean little in a heading.
function LeadLine({ leadId, role }: { leadId: string | undefined; role: string }) {
  const lead = useApp((state) => (leadId === undefined ? undefined : state.agents[leadId]));
  const model = useModelLine(lead?.settings);
  const text = [role, model].filter((part) => part !== "").join(" · ");
  return text === "" ? null : <span className={styles.groupLead}>{text}</span>;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function GroupCounts({ rows }: { rows: Group["rows"] }) {
  const all = rows.flatMap((row) => [row.item, ...row.parts]).filter((item) => item.task);
  const needs = all.filter((item) => item.status === "needs" && item.parts.length === 0).length;
  const working = all.filter((item) => item.status === "working").length;
  const done = all.filter((item) => item.status === "done").length;
  return (
    <span className={styles.groupCounts}>
      {needs === 0 ? null : <span className={styles.needsCount}>{needs} need you</span>}
      {working === 0 ? null : <span>{working} working</span>}
      {done === 0 ? null : <span>{done} done</span>}
    </span>
  );
}

const OPEN_STATUSES = new Set(["needs", "working", "queued"]);

export function TasksView() {
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const agents = useApp((state) => state.agents);
  const departments = useApp((state) => state.departments);
  const pieces = useApp((state) => state.pieces);
  const waiting = useApp((state) => state.waiting);
  const traces = useApp((state) => state.traces);
  const chiefId = useApp((state) => state.chiefId);
  const older = useApp((state) => state.olderTasks);
  const workspaces = useWorkspaces();
  const teams = useTeams();
  const now = useNow();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [by, setBy] = useState<GroupBy>(savedGroupBy);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const items = useMemo(
    () =>
      buildItems({ tasks, sessions, agents, departments, pieces, waiting, traces, chiefId }, now),
    [tasks, sessions, agents, departments, pieces, waiting, traces, chiefId, now],
  );
  const workspaceNames = useMemo(
    () => new Map((workspaces ?? []).map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );
  const teamOf = (key: string): Team =>
    teams.get(key) ?? { key, name: departments[key]?.name ?? "Assistants", colour: undefined };
  const haystack = (item: Item) =>
    [
      item.title,
      item.task?.prompt,
      item.line?.text,
      teamOf(item.team).name,
      ...item.agents.map((agent) => agent.name),
      item.workspaceId === undefined ? undefined : workspaceNames.get(item.workspaceId),
    ].join(" ");

  const counts = tabCounts(items, filters, haystack, now);
  const groups = groupRows(items, filters, by, haystack, [...teams.keys()], now);
  const presentTeams = [...teams.values()].filter((team) =>
    items.some((item) => item.task !== undefined && item.team === team.key),
  );
  const workspaceOptions = [
    ...new Set(items.flatMap((item) => (item.workspaceId === undefined ? [] : [item.workspaceId]))),
  ]
    .map((id) => ({ value: id, label: workspaceNames.get(id) ?? "Removed workspace" }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
  const narrowing =
    filters.query !== "" ||
    filters.teams.length > 0 ||
    filters.workspaceId !== undefined ||
    filters.started !== "any";

  const taskItems = items.filter((item) => item.task !== undefined);
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const running = taskItems.filter((item) => item.status === "working").length;
  const needYou = taskItems.filter((item) => item.status === "needs" && item.parts.length === 0);
  const doneToday = taskItems.filter(
    (item) => item.status === "done" && Date.parse(item.activityAt) >= midnight,
  ).length;
  const summary = [
    running === 0 ? undefined : `${running} running`,
    needYou.length === 0 ? undefined : `${needYou.length} need you`,
    doneToday === 0 ? undefined : `${doneToday} done today`,
  ].filter(Boolean);

  const update = (change: Partial<Filters>) => setFilters({ ...filters, ...change });
  const chooseBy = (value: GroupBy) => {
    setBy(value);
    setFolded(new Set());
    try {
      localStorage.setItem(GROUP_BY_KEY, value);
    } catch (error) {
      console.warn("Could not save the grouping.", error);
    }
  };
  const flip = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };
  const loadMore = async () => {
    setLoading(true);
    try {
      await loadOlderTasks();
    } finally {
      setLoading(false);
    }
  };

  const groupHead = (group: Group) => {
    if (by === "team") {
      const team = teams.get(group.key);
      return (
        <>
          <Avatar name={team?.name ?? "?"} colour={team?.colour ?? "var(--text-3)"} size={22} />
          <span className={styles.groupName}>{team?.name ?? "Assistants"}</span>
          {team === undefined ? null : <LeadLine leadId={team.leadId} role={team.role} />}
        </>
      );
    }
    const label =
      by === "status" ? STATUS_LABELS[group.key as Item["status"]] : DAY_LABELS[group.key];
    return (
      <>
        <span className={styles.groupName}>{label}</span>
        <span className={styles.groupLead}>{group.rows.length}</span>
      </>
    );
  };

  return (
    <section className={`${page.page} ${styles.page}`} aria-labelledby="tasks-title">
      <div className={styles.column}>
        <div className={styles.top}>
          <header className={page.header}>
            <h1 id="tasks-title" className={page.title}>
              Tasks
            </h1>
            <p className={styles.summary}>
              {taskItems.length === 0 ? "No tasks yet." : summary.join(" · ") || "Nothing running."}
            </p>
          </header>
          <Button variant="primary" onClick={() => navigate({ name: "new-task" })}>
            <Plus size={14} aria-hidden />
            New task
          </Button>
        </div>

        {taskItems.length === 0 ? null : (
          <div className={styles.tools}>
            <div className={styles.tabsRow}>
              <div className={styles.tabs} role="tablist" aria-label="Show">
                {TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={filters.tab === tab.value}
                    className={styles.tab}
                    onClick={() => update({ tab: tab.value })}
                  >
                    {tab.label}
                    <span
                      className={
                        tab.value === "needs" && counts.needs > 0 ? styles.needsBadge : styles.count
                      }
                    >
                      {counts[tab.value]}
                    </span>
                  </button>
                ))}
              </div>
              <StoreSize />
            </div>
            <div className={styles.filters}>
              <label className={styles.search}>
                <Search size={15} aria-hidden />
                <input
                  type="search"
                  value={filters.query}
                  placeholder="Search tasks, agents, teams"
                  aria-label="Search tasks"
                  onChange={(event) => update({ query: event.target.value })}
                />
              </label>
              <TeamFilter
                teams={presentTeams}
                chosen={filters.teams}
                onChange={(chosen) => update({ teams: chosen })}
              />
              {workspaceOptions.length === 0 ? null : (
                <ChoiceMenu
                  label="Workspace"
                  value={filters.workspaceId ?? ""}
                  choices={[{ value: "", label: "All" }, ...workspaceOptions]}
                  onChange={(value) => update({ workspaceId: value === "" ? undefined : value })}
                />
              )}
              <ChoiceMenu
                label="Started"
                value={filters.started}
                choices={STARTED}
                onChange={(started) => update({ started })}
              />
              <span className={styles.spacer} />
              <ChoiceMenu label="Group by" value={by} choices={GROUP_BY} onChange={chooseBy} />
            </div>
            {narrowing ? (
              <button
                type="button"
                className={styles.link}
                onClick={() => setFilters({ ...NO_FILTERS, tab: filters.tab })}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        )}

        {taskItems.length > 0 && groups.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No tasks match</p>
            <button type="button" className={styles.link} onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </button>
          </div>
        ) : null}

        <div className={styles.groups}>
          {groups.map((group) => {
            const isFolded = folded.has(group.key);
            const live = group.rows.filter((row) => row.item.status !== "done");
            const done = group.rows.length - live.length;
            const hideDone =
              filters.tab === "all" &&
              filters.query === "" &&
              by !== "status" &&
              live.length > 0 &&
              done > 1 &&
              !showDone.has(group.key);
            const rows = hideDone ? live : group.rows;
            return (
              <section key={group.key} className={styles.group} aria-label={group.key}>
                <button
                  type="button"
                  className={styles.groupHead}
                  aria-expanded={!isFolded}
                  onClick={() => setFolded(flip(folded, group.key))}
                >
                  <ChevronDown
                    size={14}
                    className={`${styles.caret} ${isFolded ? styles.folded : ""}`}
                    aria-hidden
                  />
                  {groupHead(group)}
                  {by === "team" ? <GroupCounts rows={group.rows} /> : null}
                </button>
                {isFolded ? null : (
                  <ul className={styles.rows}>
                    {rows.map(({ item, parts, goalTitle }) => {
                      const viaParts = parts !== item.parts;
                      const opened =
                        viaParts ||
                        (toggled.has(item.id)
                          ? !OPEN_STATUSES.has(item.status)
                          : OPEN_STATUSES.has(item.status));
                      return [
                        <TaskRow
                          key={item.id}
                          item={item}
                          team={teamOf(item.team)}
                          byTeam={by === "team"}
                          goalTitle={goalTitle}
                          expanded={opened}
                          onToggleParts={
                            parts.length === 0 || viaParts
                              ? undefined
                              : () => setToggled(flip(toggled, item.id))
                          }
                          now={now}
                        />,
                        ...(opened
                          ? parts.map((part) => (
                              <TaskRow
                                key={part.id}
                                item={part}
                                team={teamOf(part.team)}
                                byTeam={false}
                                nested
                                now={now}
                              />
                            ))
                          : []),
                      ];
                    })}
                    {hideDone ? (
                      <li>
                        <button
                          type="button"
                          className={styles.showDone}
                          onClick={() => setShowDone(flip(showDone, group.key))}
                        >
                          Show {plural(done, "done task", "done tasks")}
                        </button>
                      </li>
                    ) : null}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        {older === undefined ? null : (
          <Button variant="ghost" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Show older tasks"}
          </Button>
        )}
      </div>
    </section>
  );
}
