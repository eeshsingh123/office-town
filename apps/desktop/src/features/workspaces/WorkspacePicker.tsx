import type { WorkspaceRecord, WorkspaceUsage } from "@office-town/contract";
import { ChevronDown, Plus, Search, TriangleAlert } from "lucide-react";
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
          ? "A new empty folder for each task"
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
}: WorkspacePickerProps) {
  const workspaces = useWorkspaces() ?? [];
  const usage = useWorkspaceUsage();
  const departments = useApp((state) => state.departments);
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
  const sharedWith = (usage?.[value ?? ""]?.departmentIds ?? []).flatMap(
    (id) => departments[id]?.name ?? [],
  );

  return (
    <div className={styles.picker}>
      <span className={styles.fieldLabel}>
        {label}
        <WorkspaceTip />
      </span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
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
      {warnShared && sharedWith.length > 0 ? (
        <p className={styles.warnLine}>
          <TriangleAlert size={14} aria-hidden />
          {sharedWith.join(" and ")} already {sharedWith.length === 1 ? "works" : "work"} here.
          Their agents and this team can change the same files at the same time.
        </p>
      ) : null}
      {creating ? (
        <WorkspaceSheet open onOpenChange={setCreating} onSaved={(saved) => onChange(saved.id)} />
      ) : null}
    </div>
  );
}
