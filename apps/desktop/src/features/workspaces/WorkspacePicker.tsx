import type { WorkspaceRecord, WorkspaceUsage } from "@office-town/contract";
import { ChevronDown, FolderGit2, Plus, Search, Sparkles, TriangleAlert } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { useApp } from "../../store/app-store.ts";
import {
  mainPath,
  useWorkingNow,
  useWorkspaces,
  useWorkspaceUsage,
} from "../../store/workspaces.ts";
import form from "../../ui/Form.module.css";
import { WorkspaceIcon, WorkspaceTip } from "./WorkspaceParts.tsx";
import { WorkspaceSheet } from "./WorkspaceSheet.tsx";
import styles from "./Workspaces.module.css";

const RECENT = 3;

interface WorkspacePickerProps {
  value: string | undefined;
  onChange: (workspaceId: string) => void;
  // Warns when another department already works there (D-56).
  warnShared?: boolean;
  label?: string;
  // Draws the choice as a small chip with this class, such as inside New task's box; the
  // caller then words any shared-folder warning itself (`useSharedWith`).
  chipClassName?: string | undefined;
}

// The departments that already work in a workspace.
export function useSharedWith(workspaceId: string | undefined): string[] {
  const usage = useWorkspaceUsage();
  const departments = useApp((state) => state.departments);
  return (usage?.[workspaceId ?? ""]?.departmentIds ?? []).flatMap(
    (id) => departments[id]?.name ?? [],
  );
}

function useUsageLine() {
  const departments = useApp((state) => state.departments);
  const workingNow = useWorkingNow();
  return (workspace: WorkspaceRecord, usage: WorkspaceUsage | undefined) => {
    const names = (usage?.departmentIds ?? []).flatMap((id) => departments[id]?.name ?? []);
    const working = new Set(workingNow[workspace.id]?.map(({ agent }) => agent.id)).size;
    const parts = [
      names.join(", "),
      working > 0 ? `${working} agent${working === 1 ? "" : "s"} working now` : "",
    ].filter(Boolean);
    const text =
      parts.length > 0
        ? parts.join(" · ")
        : workspace.kind === "scratch"
          ? "New folder for each task"
          : mainPath(workspace);
    // Only a folder's path is drawn as code.
    const path = parts.length === 0 && workspace.kind === "folders";
    return <span className={path ? styles.path : styles.usage}>{text}</span>;
  };
}

export function WorkspacePicker({
  value,
  onChange,
  warnShared = false,
  label = "Workspace",
  chipClassName,
}: WorkspacePickerProps) {
  const workspaces = useWorkspaces() ?? [];
  const usage = useWorkspaceUsage();
  const sharedWith = useSharedWith(value);
  const usageLine = useUsageLine();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const chosen = workspaces.find((known) => known.id === value);
  const words = query.trim().toLowerCase();
  const matching = workspaces.filter((workspace) =>
    `${workspace.name} ${mainPath(workspace)}`.toLowerCase().includes(words),
  );
  const groups =
    words === ""
      ? [
          { title: "Recently used", items: matching.slice(0, RECENT) },
          { title: "Others", items: matching.slice(RECENT) },
        ]
      : [{ title: "Matching", items: matching }];

  const sheet = creating ? (
    <WorkspaceSheet open onOpenChange={setCreating} onSaved={(saved) => onChange(saved.id)} />
  ) : null;

  const popover = (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {chipClassName !== undefined ? (
          <button
            type="button"
            className={chipClassName}
            aria-label={`${label}: ${chosen?.name ?? "none chosen"}`}
          >
            {chosen === undefined ? (
              "Choose a workspace"
            ) : (
              <>
                {chosen.kind === "scratch" ? (
                  <Sparkles size={14} aria-hidden />
                ) : (
                  <FolderGit2 size={14} aria-hidden />
                )}
                <span className={styles.chipName}>{chosen.name}</span>
              </>
            )}
            <ChevronDown size={13} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className={styles.trigger}
            aria-label={`${label}: ${chosen?.name ?? "none chosen"}`}
          >
            {chosen === undefined ? (
              <span className={form.hint}>Choose a workspace</span>
            ) : (
              <>
                <WorkspaceIcon kind={chosen.kind} />
                <span className={styles.optionText}>
                  <strong>{chosen.name}</strong>
                  {usageLine(chosen, usage?.[chosen.id])}
                </span>
              </>
            )}
            <ChevronDown size={16} aria-hidden className={styles.chevron} />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={styles.pop} align="start" sideOffset={6}>
          {workspaces.length > 4 ? (
            <label className={styles.popSearch}>
              <Search size={14} aria-hidden />
              <input
                type="search"
                value={query}
                placeholder="Search workspaces"
                aria-label="Search workspaces"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          ) : null}
          <div className={styles.popList}>
            {groups.map((group) =>
              group.items.length === 0 ? null : (
                <div key={group.title}>
                  <div className={styles.group}>{group.title}</div>
                  {group.items.map((workspace) => (
                    <button
                      key={workspace.id}
                      type="button"
                      className={styles.option}
                      aria-pressed={workspace.id === value}
                      onClick={() => {
                        onChange(workspace.id);
                        setOpen(false);
                      }}
                    >
                      <WorkspaceIcon kind={workspace.kind} small />
                      <span className={styles.optionText}>
                        <strong>{workspace.name}</strong>
                        {usageLine(workspace, usage?.[workspace.id])}
                      </span>
                    </button>
                  ))}
                </div>
              ),
            )}
            {matching.length === 0 && words !== "" ? (
              <p className={`${form.hint} ${styles.popEmpty}`}>No workspace matches.</p>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.popFoot}
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
          >
            <Plus size={14} aria-hidden />
            New workspace…
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );

  if (chipClassName !== undefined) {
    return (
      <>
        {popover}
        {sheet}
      </>
    );
  }
  return (
    <div className={styles.picker}>
      <span className={styles.fieldLabel}>
        {label}
        <WorkspaceTip />
      </span>
      {popover}
      {warnShared && sharedWith.length > 0 ? (
        <p className={styles.warnLine}>
          <TriangleAlert size={14} aria-hidden />
          {sharedWith.join(" and ")} also {sharedWith.length === 1 ? "works" : "work"} here and can
          change the same files.
        </p>
      ) : null}
      {sheet}
    </div>
  );
}
