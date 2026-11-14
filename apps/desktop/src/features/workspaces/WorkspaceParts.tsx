import type { WorkspaceKind } from "@office-town/contract";
import { FolderGit2, Info, Sparkles } from "lucide-react";
import { Tooltip } from "radix-ui";
import { WORKSPACE_TIP } from "../../store/workspaces.ts";
import styles from "./Workspaces.module.css";

export function WorkspaceIcon({ kind, small = false }: { kind: WorkspaceKind; small?: boolean }) {
  const Icon = kind === "scratch" ? Sparkles : FolderGit2;
  return (
    <span className={`${styles.icon} ${styles[kind]} ${small ? styles.iconSmall : ""}`}>
      <Icon size={small ? 15 : 18} aria-hidden />
    </span>
  );
}

// The one place that says what a workspace is, wherever the word appears.
export function WorkspaceTip() {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" className={styles.tipButton} aria-label="What is a workspace?">
          <Info size={14} aria-hidden />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={styles.tip} sideOffset={6}>
          {WORKSPACE_TIP}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// A folder path cut from the start, so its last two folders (what tells workspaces apart) show.
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  return parts.length <= 3 ? path : `…/${parts.slice(-2).join("/")}`;
}

export function ShortPath({ path, className }: { path: string; className?: string | undefined }) {
  return (
    <span className={className} title={path}>
      {shortPath(path)}
    </span>
  );
}

export const KIND_LABEL: Record<WorkspaceKind, string> = {
  folders: "Your folders",
  scratch: "Scratch",
};
