import type { WorkspaceRecord } from "@office-town/contract";
import { GitBranch, MoreHorizontal, Plus, TriangleAlert } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { navigate, useApp } from "../../store/app-store.ts";
import { mainPath, useWorkspaces, useWorkspaceUsage } from "../../store/workspaces.ts";
import { Button } from "../../ui/Button.tsx";
import menu from "../../ui/Menu.module.css";
import { WorkspaceIcon } from "../workspaces/WorkspaceParts.tsx";
import { WorkspacePicker } from "../workspaces/WorkspacePicker.tsx";
import styles from "./DepartmentWorkspaces.module.css";

interface DepartmentWorkspacesProps {
  // The default first.
  value: string[];
  onChange: (workspaceIds: string[]) => void;
  departmentName: string;
  // Left out of "also works here".
  departmentId?: string | undefined;
  // Marks the workspace the department's open goal runs in.
  goalWorkspaceId?: string | undefined;
  compact?: boolean;
}

export function DepartmentWorkspaces({
  value,
  onChange,
  departmentName,
  departmentId,
  goalWorkspaceId,
  compact = false,
}: DepartmentWorkspacesProps) {
  const workspaces = useWorkspaces() ?? [];
  const usage = useWorkspaceUsage();
  const departments = useApp((state) => state.departments);
  const chosen = value.flatMap((id) => workspaces.find((known) => known.id === id) ?? []);
  const sharedWith = (workspaceId: string) =>
    (usage?.[workspaceId]?.departmentIds ?? [])
      .filter((id) => id !== departmentId)
      .flatMap((id) => departments[id]?.name ?? []);
  const scratchIds = (among: readonly WorkspaceRecord[]) =>
    among.filter((known) => known.kind === "scratch").map((known) => known.id);
  // Scratch stands in for a department with no folders: the first folder replaces it, and it
  // comes back when the last one goes.
  const hasFolders = chosen.some((workspace) => workspace.kind === "folders");
  const add = (workspaceId: string) => {
    // One just made in the picker is in the store, but not yet in this render.
    const scratch = scratchIds(useApp.getState().workspaces ?? []);
    const kept = scratch.includes(workspaceId)
      ? value
      : value.filter((id) => !scratch.includes(id));
    onChange([...kept, workspaceId]);
  };
  const remove = (workspaceId: string) => {
    const left = value.filter((id) => id !== workspaceId);
    onChange(left.length > 0 ? left : scratchIds(workspaces).slice(0, 1));
  };

  return (
    <div className={`${styles.list} ${compact ? styles.compact : ""}`}>
      {chosen.length === 0 ? (
        <p className={styles.empty}>No workspace yet. Add the folders this team can edit.</p>
      ) : (
        <ul className={styles.rows}>
          {chosen.map((workspace, index) => {
            const shared = sharedWith(workspace.id);
            const branch = usage?.[workspace.id]?.branch;
            return (
              <li key={workspace.id} className={styles.row}>
                <WorkspaceIcon kind={workspace.kind} small />
                <span className={styles.text}>
                  <span className={styles.name}>
                    <strong>{workspace.name}</strong>
                    {index === 0 ? <span className={styles.badge}>Default</span> : null}
                    {workspace.id === goalWorkspaceId ? (
                      <span className={styles.goal}>This goal</span>
                    ) : null}
                  </span>
                  <span className={styles.meta}>
                    <span className={workspace.kind === "folders" ? styles.path : undefined}>
                      {workspace.kind === "scratch"
                        ? "A new folder for each goal"
                        : mainPath(workspace)}
                    </span>
                    {branch === undefined || compact ? null : (
                      <span className={styles.branch}>
                        <GitBranch size={12} aria-hidden />
                        {branch}
                      </span>
                    )}
                  </span>
                  {shared.length === 0 || compact ? null : (
                    <span className={styles.shared}>
                      <TriangleAlert size={13} aria-hidden />
                      {shared.join(" and ")} also {shared.length === 1 ? "works" : "work"} here and
                      can change the same files.
                    </span>
                  )}
                </span>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button variant="ghost" icon aria-label={`More for ${workspace.name}`}>
                      <MoreHorizontal size={16} aria-hidden />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className={menu.surface} align="end" sideOffset={4}>
                      {index === 0 ? null : (
                        <DropdownMenu.Item
                          className={menu.item}
                          onSelect={() =>
                            onChange([workspace.id, ...value.filter((id) => id !== workspace.id)])
                          }
                        >
                          Make default
                        </DropdownMenu.Item>
                      )}
                      <DropdownMenu.Item
                        className={menu.item}
                        onSelect={() => navigate({ name: "workspace", workspaceId: workspace.id })}
                      >
                        Open workspace
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className={menu.item}
                        disabled={value.length === 1 && workspace.kind === "scratch"}
                        onSelect={() => remove(workspace.id)}
                      >
                        Remove from {departmentName}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </li>
            );
          })}
        </ul>
      )}
      <WorkspacePicker
        value={undefined}
        exclude={hasFolders ? [...value, ...scratchIds(workspaces)] : value}
        onChange={add}
        trigger={
          <Button>
            <Plus size={15} aria-hidden />
            Add workspace
          </Button>
        }
      />
    </div>
  );
}
