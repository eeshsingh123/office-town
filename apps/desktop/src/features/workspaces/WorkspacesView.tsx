import type { WorkspaceRecord, WorkspaceUsage } from "@office-town/contract";
import { MoreHorizontal, Plus, Search, TriangleAlert } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import {
  mainPath,
  removeWorkspace,
  useWorkingNow,
  useWorkspaces,
  useWorkspaceUsage,
} from "../../store/workspaces.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import { ago } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import page from "../../ui/Page.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { KIND_LABEL, WorkspaceIcon, WorkspaceTip } from "./WorkspaceParts.tsx";
import { WorkspaceSheet } from "./WorkspaceSheet.tsx";
import styles from "./Workspaces.module.css";

type Filter = "all" | "folders" | "scratch" | "busy";

export async function removeFromList(workspace: WorkspaceRecord): Promise<boolean> {
  try {
    await removeWorkspace(workspace.id);
    showToast(`Removed ${workspace.name} from the list. Its folders and files are untouched.`);
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
  onEdit: () => void;
}) {
  const used = (usage?.departmentIds.length ?? 0) > 0;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button icon variant="ghost" aria-label={`More actions for ${workspace.name}`}>
          <MoreHorizontal size={16} aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menu.surface} align="end" sideOffset={4}>
          <DropdownMenu.Item className={menu.item} onSelect={onEdit}>
            Edit
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={menu.item}
            disabled={used}
            onSelect={() => void removeFromList(workspace)}
          >
            {used ? "Remove (a department works here)" : "Remove from list"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Card({
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
  const open = () => navigate({ name: "workspace", workspaceId: workspace.id });
  const meta = [
    names.length > 0
      ? names.join(", ")
      : workspace.kind === "scratch"
        ? "Solo tasks"
        : "No department",
    workspace.kind === "scratch"
      ? `${usage?.taskCount ?? 0} task folder${usage?.taskCount === 1 ? "" : "s"}`
      : `${workspace.folders.length} folder${workspace.folders.length === 1 ? "" : "s"}`,
    `used ${ago(workspace.usedAt)}`,
  ];
  return (
    <li className={styles.card}>
      <button type="button" className={styles.cardBody} onClick={open}>
        <span className={styles.cardTop}>
          <WorkspaceIcon kind={workspace.kind} />
          <span className={styles.optionText}>
            <strong className={styles.name}>{workspace.name}</strong>
            <span className={styles.path} title={mainPath(workspace)}>
              {mainPath(workspace)}
              {usage?.branch === undefined ? "" : ` · ${usage.branch}`}
            </span>
          </span>
        </span>
        {missing ? (
          <span className={styles.warnChip}>
            <TriangleAlert size={12} aria-hidden />
            Folder not found
          </span>
        ) : working.length > 0 ? (
          <span className={styles.live}>
            <span className={styles.dot} aria-hidden />
            {working.length} agent{working.length === 1 ? "" : "s"} working now
          </span>
        ) : (
          <span className={form.hint}>
            {workspace.kind === "scratch"
              ? "Each task gets its own new folder"
              : "No one working here now"}
          </span>
        )}
        <span className={form.hint}>{meta.join(" · ")}</span>
        {names.length > 1 ? (
          <span className={styles.warnChip}>Shared by {names.length} departments</span>
        ) : null}
      </button>
      <div className={styles.cardFoot}>
        <span className={styles.avatars}>
          {working.slice(0, 5).map((agentId) => {
            const agent = agents[agentId];
            return agent === undefined ? null : (
              <Avatar key={agentId} name={agent.name} colour={agent.colour} size={22} />
            );
          })}
        </span>
        <span className={styles.actions}>
          <WorkspaceMenu workspace={workspace} usage={usage} onEdit={onEdit} />
          <Button onClick={open}>Open</Button>
        </span>
      </div>
    </li>
  );
}

export function WorkspacesView() {
  const workspaces = useWorkspaces();
  const usage = useWorkspaceUsage();
  const working = useWorkingNow();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<{ workspace?: WorkspaceRecord; key: number }>();
  const all = workspaces ?? [];
  const words = query.trim().toLowerCase();
  const shown = all.filter((workspace) => {
    const text = `${workspace.name} ${workspace.folders.map((folder) => folder.path).join(" ")}`;
    if (words !== "" && !text.toLowerCase().includes(words)) return false;
    if (filter === "busy") return (working[workspace.id]?.length ?? 0) > 0;
    return filter === "all" || workspace.kind === filter;
  });
  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: `All ${all.length}` },
    { value: "folders", label: KIND_LABEL.folders },
    { value: "scratch", label: KIND_LABEL.scratch },
    { value: "busy", label: "In use now" },
  ];
  const edit = (workspace?: WorkspaceRecord) =>
    setEditing({ ...(workspace === undefined ? {} : { workspace }), key: (editing?.key ?? 0) + 1 });

  return (
    <section className={page.page} aria-labelledby="workspaces-title">
      <div className={styles.page}>
        <header className={styles.head}>
          <div className={page.header}>
            <h1 id="workspaces-title" className={`${page.title} ${styles.titleRow}`}>
              Workspaces
              <WorkspaceTip />
            </h1>
          </div>
          <Button variant="primary" onClick={() => edit()}>
            <Plus size={14} aria-hidden />
            New workspace
          </Button>
        </header>

        <div className={styles.tools}>
          <label className={styles.search}>
            <Search size={15} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder="Search by name or folder"
              aria-label="Search workspaces"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
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

        {workspaces === undefined ? (
          <p className={form.hint}>Loading workspaces…</p>
        ) : shown.length === 0 && all.length > 0 ? (
          <div className={styles.empty}>
            <strong>No workspaces match</strong>
            <p className={form.hint}>Try a different word, or show all.</p>
          </div>
        ) : (
          <ul className={styles.grid} aria-label="Workspaces">
            {shown.map((workspace) => (
              <Card
                key={workspace.id}
                workspace={workspace}
                usage={usage?.[workspace.id]}
                onEdit={() => edit(workspace)}
              />
            ))}
            <li>
              <button type="button" className={styles.newCard} onClick={() => edit()}>
                <Plus size={16} aria-hidden />
                New workspace
              </button>
            </li>
          </ul>
        )}
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
