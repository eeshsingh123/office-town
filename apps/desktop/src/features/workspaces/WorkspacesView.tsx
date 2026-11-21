import type { WorkspaceRecord, WorkspaceUsage } from "@office-town/contract";
import { ArrowDown, Copy, GitBranch, ListX, Pencil, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { forSession, useKept, useKeptScroll } from "../../store/kept.ts";
import {
  mainPath,
  removeWorkspace,
  useWorkingNow,
  useWorkspaces,
  useWorkspaceUsage,
} from "../../store/workspaces.ts";
import { copyText, MoreMenu } from "../../ui/ActionMenu.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import { ago } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { KIND_LABEL, ShortPath, WorkspaceIcon, WorkspaceTip } from "./WorkspaceParts.tsx";
import { WorkspaceSheet } from "./WorkspaceSheet.tsx";
import styles from "./Workspaces.module.css";

type Filter = "all" | "folders" | "scratch" | "busy";

export async function removeFromList(workspace: WorkspaceRecord): Promise<boolean> {
  try {
    await removeWorkspace(workspace.id);
    showToast(`Removed ${workspace.name}`);
    return true;
  } catch (failure) {
    showToast(failure instanceof Error ? failure.message : String(failure));
    return false;
  }
}

export function WorkspaceMenu({
  workspace,
  usage,
  onEdit,
}: {
  workspace: WorkspaceRecord;
  usage: WorkspaceUsage | undefined;
  // Left out where an Edit button sits beside the menu.
  onEdit?: () => void;
}) {
  const scratches = (useWorkspaces() ?? []).filter((known) => known.kind === "scratch");
  const blocked =
    (usage?.departmentIds.length ?? 0) > 0
      ? "A department works here"
      : workspace.kind === "scratch" && scratches.length === 1
        ? "You need at least one Scratch workspace"
        : undefined;
  return (
    <MoreMenu
      label={`More for ${workspace.name}`}
      menu={() => ({
        actions: [
          ...(onEdit === undefined ? [] : [{ label: "Edit", icon: Pencil, run: onEdit }]),
          {
            label: "Copy path",
            icon: Copy,
            run: () => copyText(mainPath(workspace)),
          },
          {
            label: "Remove from list",
            icon: ListX,
            disabled: blocked !== undefined,
            ...(blocked === undefined ? {} : { note: blocked }),
            run: () => void removeFromList(workspace),
          },
        ],
      })}
    />
  );
}

type Sort = "used" | "name";

function Row({
  workspace,
  usage,
  onEdit,
}: {
  workspace: WorkspaceRecord;
  usage: WorkspaceUsage | undefined;
  onEdit: () => void;
}) {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const names = (usage?.departmentIds ?? []).flatMap((id) => departments[id]?.name ?? []);
  const working = [...new Set(useWorkingNow()[workspace.id]?.map(({ agent }) => agent.id))];
  const missing = (usage?.missingFolders.length ?? 0) > 0;
  const usedBy =
    names.length > 0
      ? names.join(", ")
      : workspace.kind === "scratch"
        ? `Solo tasks · ${usage?.taskCount ?? 0} task folder${usage?.taskCount === 1 ? "" : "s"}`
        : "No department";
  return (
    <li className={styles.wsRow}>
      <span className={styles.wsName}>
        <WorkspaceIcon kind={workspace.kind} small />
        <span className={styles.optionText}>
          <button
            type="button"
            className={styles.open}
            onClick={() => navigate({ name: "workspace", workspaceId: workspace.id })}
          >
            {workspace.name}
          </button>
          {missing ? (
            <span className={styles.missing}>
              <TriangleAlert size={12} aria-hidden />
              Folder not found
            </span>
          ) : (
            <ShortPath path={mainPath(workspace)} className={styles.path} />
          )}
        </span>
      </span>
      <span className={names.length === 0 ? styles.dimCell : styles.cell} title={usedBy}>
        {names.length > 1 ? <TriangleAlert size={12} aria-label="Shared" /> : null}
        {usedBy}
      </span>
      <span className={styles.cell}>
        {usage?.branch === undefined ? (
          <span className={styles.dimCell}>–</span>
        ) : (
          <span className={styles.branch} title={usage.branch}>
            <GitBranch size={13} aria-hidden />
            <span className={styles.branchName}>{usage.branch}</span>
          </span>
        )}
      </span>
      <span className={styles.cell}>
        {working.length === 0 ? (
          <span className={styles.dimCell}>–</span>
        ) : (
          <span className={styles.now}>
            <span className={styles.avatars}>
              {working.slice(0, 3).map((agentId) => {
                const agent = agents[agentId];
                return agent === undefined ? null : (
                  <Avatar key={agentId} name={agent.name} colour={agent.colour} size={20} />
                );
              })}
            </span>
            {working.length} working
          </span>
        )}
      </span>
      <span className={styles.dimCell}>{ago(workspace.usedAt)}</span>
      <span className={styles.rowMenu}>
        <WorkspaceMenu workspace={workspace} usage={usage} onEdit={onEdit} />
      </span>
    </li>
  );
}

function SortHeader({
  label,
  value,
  sort,
  onSort,
}: {
  label: string;
  value: Sort;
  sort: Sort;
  onSort: (sort: Sort) => void;
}) {
  return (
    <span>
      <button
        type="button"
        className={`${styles.sortButton} ${sort === value ? styles.sorted : ""}`}
        aria-pressed={sort === value}
        title={`Sort by ${label.toLowerCase()}`}
        onClick={() => onSort(value)}
      >
        {label}
        {sort === value ? <ArrowDown size={12} aria-hidden /> : null}
      </button>
    </span>
  );
}

const QUERY = forSession("workspaces.query", "");
const FILTER = forSession<Filter>("workspaces.filter", "all");
const SORT = forSession<Sort>("workspaces.sort", "used");

export function WorkspacesView() {
  const workspaces = useWorkspaces();
  const usage = useWorkspaceUsage();
  const working = useWorkingNow();
  const [query, setQuery] = useKept(QUERY);
  const [filter, setFilter] = useKept(FILTER);
  const [sort, setSort] = useKept(SORT);
  const scroll = useKeptScroll("workspaces");
  const [editing, setEditing] = useState<{ workspace?: WorkspaceRecord; key: number }>();
  const all = workspaces ?? [];
  const words = query.trim().toLowerCase();
  const shown = all
    .filter((workspace) => {
      const text = `${workspace.name} ${workspace.folders.map((folder) => folder.path).join(" ")}`;
      if (words !== "" && !text.toLowerCase().includes(words)) return false;
      if (filter === "busy") return (working[workspace.id]?.length ?? 0) > 0;
      return filter === "all" || workspace.kind === filter;
    })
    .toSorted((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : b.usedAt.localeCompare(a.usedAt),
    );
  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: `All ${all.length}` },
    { value: "folders", label: KIND_LABEL.folders },
    { value: "scratch", label: KIND_LABEL.scratch },
    { value: "busy", label: "In use now" },
  ];
  const edit = (workspace?: WorkspaceRecord) =>
    setEditing({ ...(workspace === undefined ? {} : { workspace }), key: (editing?.key ?? 0) + 1 });

  return (
    <section
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      className={page.page}
      aria-labelledby="workspaces-title"
    >
      <div className={styles.page}>
        <PageHeader
          id="workspaces-title"
          title={
            <span className={styles.titleRow}>
              Workspaces
              <WorkspaceTip />
            </span>
          }
          actions={
            <Button variant="primary" onClick={() => edit()}>
              <Plus size={14} aria-hidden />
              New workspace
            </Button>
          }
        />

        <div className={styles.listArea}>
          <div className={styles.tools}>
            <SearchBox
              value={query}
              onChange={(value) => setQuery(value)}
              label="Search workspaces"
              placeholder="Search by name or folder"
            />
            <fieldset className={`${form.row} ${form.group}`}>
              <legend className="visually-hidden">Show</legend>
              {filters.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={form.chip}
                  aria-pressed={filter === choice.value}
                  onClick={() => setFilter(choice.value)}
                >
                  {choice.label}
                </button>
              ))}
            </fieldset>
          </div>

          {workspaces === undefined ? null : shown.length === 0 && all.length > 0 ? (
            <p className={styles.empty}>No workspaces match.</p>
          ) : (
            <div className={styles.table}>
              <div className={styles.tableHead}>
                <SortHeader label="Workspace" value="name" sort={sort} onSort={setSort} />
                <span>Used by</span>
                <span>Branch</span>
                <span>Now</span>
                <SortHeader label="Last used" value="used" sort={sort} onSort={setSort} />
                <span />
              </div>
              <ul className={styles.rows} aria-label="Workspaces">
                {shown.map((workspace) => (
                  <Row
                    key={workspace.id}
                    workspace={workspace}
                    usage={usage?.[workspace.id]}
                    onEdit={() => edit(workspace)}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {editing === undefined ? null : (
        <WorkspaceSheet
          key={editing.key}
          {...(editing.workspace === undefined ? {} : { workspace: editing.workspace })}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(undefined);
          }}
        />
      )}
    </section>
  );
}
