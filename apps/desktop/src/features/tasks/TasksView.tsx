import {
  Check,
  CheckCheck,
  ChevronDown,
  CloudOff,
  Database,
  ListChecks,
  type LucideIcon,
  Plus,
  RotateCcw,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useMemo, useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { useAutomations } from "../../store/automations.ts";
import {
  forSession,
  type Keep,
  oneOf,
  useKept,
  useKeptScroll,
  writeKept,
} from "../../store/kept.ts";
import { isLive } from "../../store/records.ts";
import { useWorkspaces } from "../../store/workspaces.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { ClearFilters } from "../../ui/ClearFilters.tsx";
import { EmptyState, NoMatch } from "../../ui/EmptyState.tsx";
import { Fact, Facts } from "../../ui/Facts.tsx";
import { byteSize } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { TabRow } from "../../ui/TabRow.tsx";
import composer from "../new-task/Composer.module.css";
import { startNewTask } from "../new-task/start-new-task.ts";
import { useModelLine } from "../profiles/model-line.ts";
import { LARGE_STORE_BYTES, useStoreSize } from "./store-size.ts";
import { TaskRow, type Team } from "./TaskRow.tsx";
import styles from "./TasksView.module.css";
import {
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
import { useNow, useTaskItems } from "./use-items.ts";
import { useTaskMoves, useTaskSearch } from "./use-task-search.ts";

// An empty tab with nothing filtered is good news, not a failed search.
const EMPTY_TAB: Record<Tab, { icon: LucideIcon; title: string; tone?: "good" }> = {
  all: { icon: ListChecks, title: "No tasks yet" },
  needs: { icon: CheckCheck, title: "No tasks are waiting for you", tone: "good" },
  active: { icon: ListChecks, title: "Nothing is in progress" },
  review: { icon: CheckCheck, title: "Nothing to review", tone: "good" },
  done: { icon: ListChecks, title: "Nothing is done yet" },
  ended: { icon: CheckCheck, title: "Nothing failed or stopped", tone: "good" },
};

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs", label: "Needs you" },
  { value: "active", label: "In progress" },
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

const GROUPED_BY: Keep<GroupBy> = {
  name: "tasks.group-by",
  lasts: "saved",
  start: "team",
  parse: oneOf(GROUP_BY.map((choice) => choice.value)),
};
const NONE: ReadonlySet<string> = new Set();
const FILTERS = forSession("tasks.filters", NO_FILTERS);

// Tasks on one tab, with no other filter, such as from Home's status line.
export function showTasksTab(tab: Tab): void {
  writeKept(FILTERS, { ...NO_FILTERS, tab });
  navigate({ name: "tasks" });
}

// Every task in one workspace, such as from its page.
export function showWorkspaceTasks(workspaceId: string): void {
  writeKept(FILTERS, { ...NO_FILTERS, workspaceId });
  navigate({ name: "tasks" });
}
const FOLDED = forSession("tasks.folded", NONE);
const TOGGLED = forSession("tasks.toggled", NONE);
const SHOW_DONE = forSession("tasks.show-done", NONE);

type TeamInfo = Team & { leadId: string | undefined; role: string };

// The chief, then each department by name, then the agents working alone.
export function useTeams(): Map<string, TeamInfo> {
  const chiefId = useApp((state) => state.chiefId);
  const agents = useApp((state) => state.agents);
  const departments = useApp((state) => state.departments);
  return useMemo(() => {
    const teams = new Map<string, TeamInfo>();
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

// Only once it is large; Settings always shows it (a3-19).
function StoreSize() {
  const total = useStoreSize();
  if (total === undefined || total < LARGE_STORE_BYTES) return null;
  return (
    <span
      className={`${styles.storage} ${styles.storageLarge}`}
      title="Task history on this computer. Deleting old tasks frees the space."
    >
      <Database size={13} aria-hidden />
      History {byteSize(total)}
    </span>
  );
}

const FIND_FROM = 8;

export function TeamFilter(props: {
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
  const [find, setFind] = useState("");
  const words = find.trim().toLowerCase();
  const shown = teams.filter((team) => team.name.toLowerCase().includes(words));
  return (
    <DropdownMenu.Root onOpenChange={() => setFind("")}>
      <DropdownMenu.Trigger className={`${menu.chip} ${chosen.length > 0 ? styles.set : ""}`}>
        <span className={menu.chipLabel}>Team</span>
        {label}
        <ChevronDown size={14} className={menu.chipLabel} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menu.surface} align="start" sideOffset={4}>
          {/* Past this many teams, a box to find one (a3-14). */}
          {teams.length > FIND_FROM ? (
            <input
              className={composer.menuFind}
              type="search"
              value={find}
              placeholder="Find a team"
              aria-label="Find a team"
              onChange={(event) => setFind(event.target.value)}
              // Typing goes to the box, not to the menu's jump-to-item.
              onKeyDown={(event) => {
                if (event.key !== "Escape") event.stopPropagation();
              }}
            />
          ) : null}
          {shown.map((team) => (
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

// The lead's model is team information: on hover only, so a heading stays one name (a3-14).
function useLeadLine(leadId: string | undefined): string {
  const lead = useApp((state) => (leadId === undefined ? undefined : state.agents[leadId]));
  return useModelLine(lead?.settings);
}

function TeamHead({ team }: { team: TeamInfo | undefined }) {
  const model = useLeadLine(team?.leadId);
  return (
    <>
      <Avatar name={team?.name ?? "?"} colour={team?.colour ?? "var(--text-3)"} size={22} />
      <span className={styles.groupName} title={model === "" ? undefined : model}>
        {team?.name ?? "Assistants"}
      </span>
      {team === undefined || team.role === "" ? null : (
        <span className={styles.groupLead}>{team.role}</span>
      )}
    </>
  );
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

export function TasksView({ startedBy }: { startedBy?: string }) {
  // Opened for one automation's runs, from its page.
  useState(() => {
    if (startedBy !== undefined) writeKept(FILTERS, { ...NO_FILTERS, startedBy });
  });
  const tasks = useApp((state) => state.tasks);
  const automations = useAutomations();
  const sessions = useApp((state) => state.sessions);
  const departments = useApp((state) => state.departments);
  const workspaces = useWorkspaces();
  const teams = useTeams();
  const now = useNow();
  const [filters, setFilters] = useKept(FILTERS);
  const [by, setBy] = useKept(GROUPED_BY);
  const [folded, setFolded] = useKept(FOLDED);
  const [toggled, setToggled] = useKept(TOGGLED);
  const [showDone, setShowDone] = useKept(SHOW_DONE);
  const scroll = useKeptScroll("tasks");
  const [loading, setLoading] = useState(false);

  const items = useTaskItems(now);
  // The core searches the tasks no agent is at work on; the app answers for the live ones.
  const live = useMemo(
    () =>
      new Set(
        Object.values(tasks).flatMap((entry) => (isLive(entry, sessions) ? [entry.task.id] : [])),
      ),
    [tasks, sessions],
  );
  const moves = useTaskMoves(tasks, live);
  const teamOf = (key: string): Team =>
    teams.get(key) ?? { key, name: departments[key]?.name ?? "Assistants", colour: undefined };
  const { found, failed, retry, showOlder } = useTaskSearch(
    filters,
    [...teams.values()],
    moves,
    now,
  );
  const liveItems = items.filter((item) => live.has(item.id));
  // Until the core answers, every task the app holds, so the page never opens empty while the core
  // is busy. Then down to the oldest the search returned, plus any that just went quiet.
  const shown = items.filter(
    (item) =>
      found === undefined ||
      live.has(item.id) ||
      found.oldest === undefined ||
      item.createdAt >= found.oldest,
  );
  // The teams and workspaces to filter by: the core's, or the held tasks' until it answers.
  const known = found === undefined ? items : liveItems;
  const workspaceNames = useMemo(
    () => new Map((workspaces ?? []).map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );
  const haystack = (item: Item) =>
    [
      item.title,
      item.task?.prompt,
      item.line?.text,
      teamOf(item.team).name,
      ...item.agents.map((agent) => agent.name),
      item.workspaceId === undefined ? undefined : workspaceNames.get(item.workspaceId),
    ].join(" ");

  const liveCounts = tabCounts(liveItems, filters, haystack, now);
  const counts = Object.fromEntries(
    Object.entries(liveCounts).map(([tab, count]) => [
      tab,
      count + (found?.counts[tab as Tab] ?? 0),
    ]),
  ) as Record<Tab, number>;
  const groups = groupRows(shown, filters, by, haystack, [...teams.keys()], now);
  const allFolded = groups.length > 0 && groups.every((group) => folded.has(group.key));
  const presentTeams = [...teams.values()].filter(
    (team) => found?.teams.has(team.key) || known.some((item) => item.team === team.key),
  );
  const workspaceOptions = [
    ...new Set([
      ...(found?.workspaceIds ?? []),
      ...known.flatMap((item) => (item.workspaceId === undefined ? [] : [item.workspaceId])),
    ]),
  ]
    .map((id) => ({ value: id, label: workspaceNames.get(id) ?? "Removed workspace" }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
  const narrowing =
    filters.query !== "" ||
    filters.teams.length > 0 ||
    filters.workspaceId !== undefined ||
    filters.startedBy !== undefined ||
    filters.started !== "any";

  const taskItems = items.filter((item) => item.task !== undefined);
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const count = (status: Item["status"]) =>
    taskItems.filter((item) => item.status === status).length;
  const working = count("working");
  const needYou = count("needs");
  const toReview = count("review");
  const doneToday = taskItems.filter(
    (item) => item.status === "done" && Date.parse(item.activityAt) >= midnight,
  ).length;
  // Counted and worded as Home's status line (a3-25).
  const summary =
    working + needYou + toReview + doneToday === 0 ? undefined : (
      <Facts>
        {working === 0 ? null : <Fact count={working}>working</Fact>}
        {needYou === 0 ? null : (
          <Fact count={needYou} urgent>
            {needYou === 1 ? "needs you" : "need you"}
          </Fact>
        )}
        {toReview === 0 ? null : <Fact count={toReview}>to review</Fact>}
        {doneToday === 0 ? null : <Fact count={doneToday}>done today</Fact>}
      </Facts>
    );

  const update = (change: Partial<Filters>) => setFilters({ ...filters, ...change });
  const chooseBy = (value: GroupBy) => {
    setBy(value);
    setFolded(new Set());
  };
  const flip = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };
  const loadMore = async () => {
    setLoading(true);
    try {
      await showOlder();
    } finally {
      setLoading(false);
    }
  };

  const groupHead = (group: Group) => {
    if (by === "team") return <TeamHead team={teams.get(group.key)} />;
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
    <section
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      className={`${page.page} ${styles.page}`}
      aria-labelledby="tasks-title"
    >
      <div className={styles.column}>
        <PageHeader
          id="tasks-title"
          title="Tasks"
          lead={taskItems.length === 0 ? undefined : (summary ?? "Nothing is working.")}
          actions={
            <Button variant="primary" onClick={() => startNewTask()}>
              <Plus size={14} aria-hidden />
              New task
            </Button>
          }
        />

        {taskItems.length === 0 ? null : (
          <div className={styles.tools}>
            <div className={styles.tabsRow}>
              <TabRow
                label="Show"
                tabs={TABS.map((tab) => ({
                  ...tab,
                  count: found === undefined ? undefined : counts[tab.value],
                  urgent: tab.value === "needs" && counts.needs > 0,
                }))}
                value={filters.tab}
                onChange={(tab) => update({ tab })}
              />
              <StoreSize />
            </div>
            <div className={styles.filters}>
              <SearchBox
                value={filters.query}
                onChange={(value) => update({ query: value })}
                label="Search tasks"
                placeholder="Search tasks, agents, teams"
              />
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
              {automations === undefined || automations.length === 0 ? null : (
                <ChoiceMenu
                  label="Started by"
                  value={filters.startedBy ?? ""}
                  choices={[
                    { value: "", label: "Anyone" },
                    { value: "you", label: "You" },
                    ...automations.map((one) => ({ value: one.id, label: one.name })),
                  ]}
                  onChange={(value) => update({ startedBy: value === "" ? undefined : value })}
                />
              )}
              <ChoiceMenu
                label="Started"
                value={filters.started}
                choices={STARTED}
                onChange={(started) => update({ started })}
              />
              <ClearFilters
                shown={narrowing}
                onClear={() => setFilters({ ...NO_FILTERS, tab: filters.tab })}
              />
              <span className={styles.spacer} />
              <ChoiceMenu label="Group by" value={by} choices={GROUP_BY} onChange={chooseBy} />
              {groups.length < 2 ? null : (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setFolded(allFolded ? new Set() : new Set(groups.map((group) => group.key)))
                  }
                >
                  {allFolded ? "Expand all" : "Collapse all"}
                </Button>
              )}
            </div>
          </div>
        )}

        {failed ? (
          <EmptyState
            icon={CloudOff}
            title="Could not load all your tasks"
            tone="bad"
            size={groups.length === 0 ? "page" : "panel"}
          >
            <Button onClick={retry}>
              <RotateCcw size={14} aria-hidden />
              Try again
            </Button>
          </EmptyState>
        ) : taskItems.length === 0 ? (
          <EmptyState icon={ListChecks} title="No tasks yet" hint="Tasks you start show up here." />
        ) : found !== undefined && groups.length === 0 ? (
          narrowing ? (
            <NoMatch title="No tasks match these filters" />
          ) : (
            <EmptyState {...EMPTY_TAB[filters.tab]} />
          )
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

        {found?.next === undefined ? null : (
          <Button variant="ghost" onClick={loadMore} disabled={loading}>
            {loading ? "Loading" : "Show older tasks"}
          </Button>
        )}
      </div>
    </section>
  );
}
