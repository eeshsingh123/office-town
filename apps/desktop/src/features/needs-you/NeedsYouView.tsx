import type { UserRequestEvent } from "@office-town/contract";
import { ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { useLevel, useSessionAgent } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { useWorkspaces } from "../../store/workspaces.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import page from "../../ui/Page.module.css";
import { RequestCard } from "../requests/RequestCard.tsx";
import { RequestContext } from "../requests/RequestContext.tsx";
import { type BulkAnswer, BulkConfirm } from "./BulkConfirm.tsx";
import styles from "./NeedsYouView.module.css";
import {
  type Ask,
  buildAsks,
  type Filters,
  filterAsks,
  type Group,
  type GroupBy,
  groupAsks,
  KIND_LABEL,
  NO_FILTERS,
  ofType,
  type TypeFilter,
  typeCounts,
  waitedFor,
} from "./queue.ts";

const PAGE = 25;
const GROUP_PAGE = 10;
const HOUR = 3_600_000;
const GROUP_BY_KEY = "office-town.needs-you.group-by";

const GROUP_BY: { value: GroupBy; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "department", label: "Department" },
  { value: "workspace", label: "Workspace" },
  { value: "agent", label: "Agent" },
  { value: "type", label: "Type" },
];

const TYPES: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "decisions", label: "Plans and teams" },
  { value: "question", label: "Questions" },
  { value: "approval", label: "Approvals" },
];

// Storage can be blocked; grouping by task is the default (D-57).
function savedGroupBy(): GroupBy {
  try {
    const saved = localStorage.getItem(GROUP_BY_KEY);
    return GROUP_BY.find((choice) => choice.value === saved)?.value ?? "task";
  } catch {
    return "task";
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

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function LevelNote({ event }: { event: UserRequestEvent }) {
  const agent = useSessionAgent(event.sessionId);
  const level = useLevel(agent?.record);
  const departmentId = agent?.record.departmentId;
  if (event.type !== "permission.requested") return null;
  if (level !== "supervised") {
    return <p className={styles.levelNote}>It wants to change a read-only folder.</p>;
  }
  return (
    <p className={styles.levelNote}>
      Permissions are set to "{AUTONOMY[level].label}".{" "}
      {departmentId === undefined ? null : (
        <button
          type="button"
          className={styles.link}
          onClick={() => navigate({ name: "department", departmentId })}
        >
          Change
        </button>
      )}
    </p>
  );
}

interface AskRowProps {
  ask: Ask;
  now: number;
  open: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: (selected: boolean) => void;
}

function AskRow({ ask, now, open, selected, onToggle, onSelect }: AskRowProps) {
  const old = now - ask.askedAt > HOUR;
  return (
    <li className={styles.row} data-open={open}>
      <div className={styles.line}>
        {ask.kind === "approval" ? (
          <input
            type="checkbox"
            className={styles.check}
            checked={selected}
            aria-label={`Select: ${ask.title}`}
            onChange={(change) => onSelect(change.target.checked)}
          />
        ) : (
          <span className={styles.check} aria-hidden />
        )}
        <button type="button" className={styles.summary} aria-expanded={open} onClick={onToggle}>
          <span className={styles.kind} data-kind={ask.kind}>
            {KIND_LABEL[ask.kind]}
          </span>
          <span className={styles.what}>
            <span className={styles.title}>{ask.title}</span>
            {ask.detail === undefined ? null : <span className={styles.detail}>{ask.detail}</span>}
          </span>
          <span className={styles.who}>
            <Avatar name={ask.agentName} colour={ask.agentColour ?? "#8f897f"} size={20} />
            <span className={styles.whoName}>{ask.agentName}</span>
          </span>
          <span className={styles.age} data-old={old}>
            {waitedFor(ask.askedAt, now)}
          </span>
        </button>
      </div>
      {open ? (
        <div className={styles.open}>
          <RequestCard
            event={ask.event}
            context={
              <>
                <RequestContext sessionId={ask.event.sessionId} />
                <LevelNote event={ask.event} />
              </>
            }
          />
        </div>
      ) : null}
    </li>
  );
}

interface GroupSectionProps {
  group: Group;
  by: GroupBy;
  now: number;
  folded: boolean;
  shown: number;
  openKey: string | undefined;
  selected: ReadonlySet<string>;
  onFold: () => void;
  onMore: () => void;
  onOpen: (key: string) => void;
  onSelect: (key: string, selected: boolean) => void;
  onBulk: (answer: BulkAnswer) => void;
}

function GroupSection(props: GroupSectionProps) {
  const { group, by, now, folded, shown, openKey, selected, onBulk } = props;
  const approvals = group.approvals.length;
  const scope = by === "type" ? group.name.toLowerCase() : `"${group.name}"`;
  return (
    <section className={styles.group} aria-label={group.name}>
      <header className={styles.groupHead}>
        <button
          type="button"
          className={styles.fold}
          aria-expanded={!folded}
          aria-label={folded ? `Show ${group.name}` : `Fold ${group.name}`}
          onClick={props.onFold}
        >
          <ChevronDown size={16} aria-hidden data-folded={folded} />
        </button>
        {group.colour === undefined ? null : (
          <span className={styles.swatch} style={{ background: group.colour }} aria-hidden />
        )}
        <div className={styles.groupName}>
          <span className={styles.groupTitle}>{group.name}</span>
          <span className={styles.groupMeta}>{group.meta}</span>
        </div>
        <span className={styles.waiting}>
          {group.asks.length} waiting · oldest {waitedFor(group.oldestAt, now)}
        </span>
        {approvals === 0 ? null : (
          <div className={styles.groupActions}>
            <Button
              variant="ghost"
              onClick={() => onBulk({ decision: "reject", asks: group.approvals, scope })}
            >
              Reject all
            </Button>
            <Button onClick={() => onBulk({ decision: "allow", asks: group.approvals, scope })}>
              Approve all {approvals}
            </Button>
          </div>
        )}
      </header>
      {folded ? null : (
        <>
          <ul className={styles.rows}>
            {group.asks.slice(0, shown).map((ask) => (
              <AskRow
                key={ask.key}
                ask={ask}
                now={now}
                open={openKey === ask.key}
                selected={selected.has(ask.key)}
                onToggle={() => props.onOpen(ask.key)}
                onSelect={(next) => props.onSelect(ask.key, next)}
              />
            ))}
          </ul>
          {group.asks.length > shown ? (
            <div className={styles.more}>
              <Button variant="ghost" onClick={props.onMore}>
                Show {Math.min(PAGE, group.asks.length - shown)} more of {group.asks.length - shown}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

// Grouped by task by default, most urgent first, filtered and answered in bulk (D-57).
export function NeedsYouView() {
  const waiting = useApp((state) => state.waiting);
  const sessions = useApp((state) => state.sessions);
  const tasks = useApp((state) => state.tasks);
  const agents = useApp((state) => state.agents);
  const departments = useApp((state) => state.departments);
  const harnesses = useApp((state) => state.harnesses);
  const workspaces = useWorkspaces();
  const now = useNow();

  const [by, setBy] = useState<GroupBy>(savedGroupBy);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [olderThanHour, setOlderThanHour] = useState(false);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState<Record<string, number>>({});
  const [groupsShown, setGroupsShown] = useState(GROUP_PAGE);
  const [openKey, setOpenKey] = useState<string>();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<BulkAnswer>();
  const [notice, setNotice] = useState<string>();

  const asks = useMemo(
    () =>
      buildAsks({
        waiting,
        sessions,
        tasks,
        agents,
        departments,
        workspaces,
        harnessName: (harness) =>
          harnesses.find((known) => known.harness === harness)?.name ?? harness,
      }),
    [waiting, sessions, tasks, agents, departments, workspaces, harnesses],
  );
  const askedBefore = olderThanHour ? now - HOUR : undefined;
  const narrowed = useMemo(
    () => filterAsks(asks, { ...filters, askedBefore }),
    [asks, filters, askedBefore],
  );
  const counts = typeCounts(narrowed);
  const visible = ofType(narrowed, filters.type);
  const groups = groupAsks(visible, by);
  const oldCount = filterAsks(asks, { ...filters, askedBefore: now - HOUR }).length;
  const narrowing = olderThanHour || JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const visibleApprovals = visible.filter((ask) => ask.kind === "approval");
  // Answered requests leave the queue; a pick of one is dropped with it.
  const selected = asks.filter((ask) => ask.kind === "approval" && picked.has(ask.key));
  const selectedKeys = new Set(selected.map((ask) => ask.key));

  const options = (read: (ask: Ask) => [string | undefined, string]) =>
    [...new Map(asks.map(read).filter(([id]) => id !== undefined)).entries()].sort((a, b) =>
      a[1].localeCompare(b[1]),
    );
  const departmentOptions = options((ask) => [ask.departmentId, ask.departmentName]);
  const workspaceOptions = options((ask) => [ask.workspaceId, ask.workspaceName]);
  const harnessOptions = options((ask) => [ask.harness, ask.harness]);

  const decisions = asks.filter((ask) => ask.kind === "plan" || ask.kind === "team").length;
  const taskCount = new Set(asks.map((ask) => ask.taskId)).size;
  const oldest = asks.reduce((least, ask) => Math.min(least, ask.askedAt), now);

  const update = (change: Partial<Filters>) => {
    setFilters({ ...filters, ...change });
    setGroupsShown(GROUP_PAGE);
  };
  const chooseBy = (value: GroupBy) => {
    setBy(value);
    setFolded(new Set());
    setShown({});
    setGroupsShown(GROUP_PAGE);
    try {
      localStorage.setItem(GROUP_BY_KEY, value);
    } catch (error) {
      console.warn("Could not save the grouping.", error);
    }
  };
  const clearFilters = () => {
    setFilters(NO_FILTERS);
    setOlderThanHour(false);
  };
  const select = (key: string, next: boolean) => {
    const copy = new Set(picked);
    if (next) copy.add(key);
    else copy.delete(key);
    setPicked(copy);
  };
  const answered = (decision: BulkAnswer["decision"], count: number, skipped: number) => {
    setBulk(undefined);
    setPicked(new Set());
    const verb = decision === "allow" ? "Approved" : "Rejected";
    setNotice(
      skipped === 0
        ? `${verb} ${plural(count, "request", "requests")}.`
        : `${verb} ${count}. ${plural(skipped, "was", "were")} already answered or its agent had stopped.`,
    );
  };

  return (
    <section className={`${page.page} ${styles.page}`} aria-labelledby="needs-you-title">
      <div className={styles.column}>
        <header className={page.header}>
          <h1 id="needs-you-title" className={page.title}>
            Needs you
          </h1>
          <p className={page.lead}>
            {asks.length === 0
              ? "No agent is waiting for you."
              : [
                  `${asks.length} waiting across ${plural(taskCount, "task", "tasks")}`,
                  decisions === 0
                    ? undefined
                    : `${plural(decisions, "plan or team", "plans or teams")} to approve`,
                  `oldest waiting ${waitedFor(oldest, now)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </header>

        {notice === undefined ? null : (
          <p className={styles.notice} role="status">
            {notice}
            <button
              type="button"
              className={`${styles.link} ${styles.dismiss}`}
              onClick={() => setNotice(undefined)}
            >
              Dismiss
            </button>
          </p>
        )}

        {asks.length === 0 ? null : (
          <div className={styles.tools}>
            <div className={styles.toolsRow}>
              <label className={styles.search}>
                <Search size={15} aria-hidden />
                <input
                  type="search"
                  value={filters.query}
                  placeholder="Search asks, tasks, agents, commands"
                  aria-label="Search what needs you"
                  onChange={(event) => update({ query: event.target.value })}
                />
              </label>
              <fieldset className={`${styles.segment} ${form.group}`}>
                <legend className={styles.segmentLabel}>Group by</legend>
                {GROUP_BY.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    aria-pressed={by === choice.value}
                    onClick={() => chooseBy(choice.value)}
                  >
                    {choice.label}
                  </button>
                ))}
              </fieldset>
            </div>
            <div className={styles.toolsRow}>
              <fieldset className={`${form.row} ${form.group}`}>
                <legend className="visually-hidden">Show</legend>
                {TYPES.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    className={form.chip}
                    aria-pressed={filters.type === choice.value}
                    onClick={() => update({ type: choice.value })}
                  >
                    {choice.label} <span className={styles.count}>{counts[choice.value]}</span>
                  </button>
                ))}
              </fieldset>
              <span className={styles.divider} aria-hidden />
              <FilterSelect
                label="Workspace"
                value={filters.workspaceId}
                options={workspaceOptions}
                onChange={(workspaceId) => update({ workspaceId })}
              />
              <FilterSelect
                label="Department"
                value={filters.departmentId}
                options={departmentOptions}
                onChange={(departmentId) => update({ departmentId })}
              />
              <FilterSelect
                label="AI app"
                value={filters.harness}
                options={harnessOptions}
                onChange={(harness) => update({ harness })}
              />
              <button
                type="button"
                className={form.chip}
                aria-pressed={olderThanHour}
                onClick={() => setOlderThanHour(!olderThanHour)}
              >
                Waiting over 1h <span className={styles.count}>{oldCount}</span>
              </button>
            </div>
            {narrowing && visibleApprovals.length > 0 ? (
              <div className={styles.filteredBar}>
                <span>
                  {plural(visibleApprovals.length, "approval matches", "approvals match")} these
                  filters. Questions and plans are left out; answer them one by one.
                </span>
                <div className={styles.groupActions}>
                  <Button
                    onClick={() =>
                      setBulk({ decision: "reject", asks: visibleApprovals, scope: "filtered" })
                    }
                  >
                    Reject {visibleApprovals.length}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() =>
                      setBulk({ decision: "allow", asks: visibleApprovals, scope: "filtered" })
                    }
                  >
                    Approve {visibleApprovals.length} filtered
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {asks.length > 0 && visible.length === 0 ? (
          <div className={styles.empty}>
            <p>Nothing matches these filters.</p>
            <Button onClick={clearFilters}>Clear filters</Button>
          </div>
        ) : null}

        <div className={styles.groups}>
          {groups.slice(0, groupsShown).map((group) => (
            <GroupSection
              key={group.key}
              group={group}
              by={by}
              now={now}
              folded={folded.has(group.key)}
              shown={shown[group.key] ?? PAGE}
              openKey={openKey}
              selected={selectedKeys}
              onFold={() => {
                const copy = new Set(folded);
                if (copy.has(group.key)) copy.delete(group.key);
                else copy.add(group.key);
                setFolded(copy);
              }}
              onMore={() => setShown({ ...shown, [group.key]: (shown[group.key] ?? PAGE) + PAGE })}
              onOpen={(key) => setOpenKey(openKey === key ? undefined : key)}
              onSelect={select}
              onBulk={setBulk}
            />
          ))}
          {groups.length > groupsShown ? (
            <Button
              className={styles.moreGroups}
              onClick={() => setGroupsShown(groupsShown + GROUP_PAGE)}
            >
              Show {Math.min(GROUP_PAGE, groups.length - groupsShown)} more of{" "}
              {groups.length - groupsShown} groups (
              {groups.slice(groupsShown).reduce((sum, group) => sum + group.asks.length, 0)}{" "}
              waiting)
            </Button>
          ) : null}
        </div>
      </div>

      {selected.length === 0 ? null : (
        <section className={styles.selection} aria-label="Selected approvals">
          <span className={styles.selectionText}>
            {plural(selected.length, "approval", "approvals")} selected
          </span>
          <button type="button" className={styles.clear} onClick={() => setPicked(new Set())}>
            Clear
          </button>
          <Button
            onClick={() => setBulk({ decision: "reject", asks: selected, scope: "selected" })}
          >
            Reject {selected.length}
          </Button>
          <Button
            variant="primary"
            onClick={() => setBulk({ decision: "allow", asks: selected, scope: "selected" })}
          >
            Approve {selected.length}
          </Button>
        </section>
      )}

      <BulkConfirm
        answer={bulk}
        onCancel={() => setBulk(undefined)}
        onDone={answered}
        send={(answer) =>
          api.answerPermissions({
            decision: answer.decision,
            requests: answer.asks.map((ask) => ({
              sessionId: ask.event.sessionId,
              requestId: ask.event.payload.requestId,
            })),
          })
        }
      />
    </section>
  );
}

interface FilterSelectProps {
  label: string;
  value: string | undefined;
  options: [string | undefined, string][];
  onChange: (value: string | undefined) => void;
}

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  return (
    <label className={styles.select}>
      <span className="visually-hidden">{label}</span>
      <select
        value={value ?? ""}
        data-set={value !== undefined}
        onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
      >
        <option value="">{label}: All</option>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {label}: {name}
          </option>
        ))}
      </select>
    </label>
  );
}
