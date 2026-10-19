import type { DepartmentRecord, WorkspaceRecord } from "@office-town/contract";
import { Check, ChevronDown, FolderGit2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { mainPath } from "../../store/workspaces.ts";
import menu from "../../ui/Menu.module.css";
import styles from "./Composer.module.css";

interface DepartmentWorkspaceChipProps {
  department: DepartmentRecord;
  workspaces: WorkspaceRecord[];
  value: string;
  onChange: (workspaceId: string) => void;
}

// Which of the department's workspaces this goal runs in; fixed when it has only one.
export function DepartmentWorkspaceChip({
  department,
  workspaces,
  value,
  onChange,
}: DepartmentWorkspaceChipProps) {
  const own = department.workspaceIds.flatMap(
    (id) => workspaces.find((known) => known.id === id) ?? [],
  );
  const chosen = own.find((known) => known.id === value);
  if (own.length < 2) {
    return (
      <span className={`${styles.chip} ${styles.fixed}`} title="Set by the department">
        <FolderGit2 size={14} aria-hidden />
        <span className={styles.chipText}>{chosen?.name ?? "No workspace"}</span>
      </span>
    );
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={styles.chip}
          aria-label={`Workspace: ${chosen?.name ?? "none"}`}
        >
          <FolderGit2 size={14} aria-hidden />
          <span className={styles.chipText}>{chosen?.name ?? "Choose a workspace"}</span>
          <ChevronDown size={13} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menu.surface} align="start" sideOffset={4}>
          <DropdownMenu.Label className={menu.label}>
            {department.name}'s workspaces
          </DropdownMenu.Label>
          {own.map((workspace, index) => (
            <DropdownMenu.Item
              key={workspace.id}
              className={menu.item}
              onSelect={() => onChange(workspace.id)}
            >
              <span className={menu.itemText}>
                <span>
                  {workspace.name}
                  {index === 0 ? " (default)" : ""}
                </span>
                <span className={menu.itemDescription}>
                  {workspace.kind === "scratch"
                    ? "A new folder for each goal"
                    : mainPath(workspace)}
                </span>
              </span>
              {workspace.id === value ? (
                <Check size={14} className={menu.check} aria-hidden />
              ) : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
