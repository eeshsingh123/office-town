import { CircleUser, Inbox, LayoutPanelLeft, List, type LucideIcon, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { Departments } from "./Departments.tsx";
import { RunningAgents } from "./RunningAgents.tsx";
import styles from "./Sidebar.module.css";

interface NavItemProps {
  view: "office" | "needs-you" | "tasks" | "profiles";
  icon: LucideIcon;
  label: string;
  badge?: ReactNode;
}

export function NavItem({ view, icon: Icon, label, badge }: NavItemProps) {
  const current = useApp((state) => state.view.name === view);
  return (
    <button
      type="button"
      className={styles.nav}
      aria-current={current ? "page" : undefined}
      onClick={() => navigate({ name: view })}
    >
      <Icon size={16} aria-hidden />
      {label}
      {badge}
    </button>
  );
}

function WaitingCount() {
  const count = useApp((state) => Object.keys(state.waiting).length);
  if (count === 0) return null;
  return (
    <span className={styles.count}>
      {count}
      <span className="visually-hidden"> waiting</span>
    </span>
  );
}

export function Sidebar() {
  return (
    <nav aria-label="Main" className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden>
          O
        </span>
        Office Town
      </div>
      <Button className={styles.newTask} onClick={() => navigate({ name: "new-task" })}>
        <Plus size={16} aria-hidden />
        New task
        <Kbd>Ctrl N</Kbd>
      </Button>
      <NavItem view="office" icon={LayoutPanelLeft} label="Office" />
      <NavItem view="needs-you" icon={Inbox} label="Needs you" badge={<WaitingCount />} />
      <NavItem view="tasks" icon={List} label="Tasks" />
      <Departments />
      <RunningAgents />
      <div className={styles.footer}>
        <NavItem view="profiles" icon={CircleUser} label="Profiles" />
        <ConnectionStatus />
      </div>
    </nav>
  );
}
