import {
  House,
  Inbox,
  LayoutPanelLeft,
  List,
  type LucideIcon,
  Moon,
  Plus,
  Sun,
  SwatchBook,
} from "lucide-react";
import type { ReactNode } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { toggleTheme, useTheme } from "../../ui/theme.ts";
import { useYou } from "../you/you.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { Departments } from "./Departments.tsx";
import { RunningAgents } from "./RunningAgents.tsx";
import styles from "./Sidebar.module.css";

interface NavItemProps {
  view: "home" | "office" | "needs-you" | "tasks" | "templates";
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

function ThemeToggle() {
  const dark = useTheme() === "dark";
  const Icon = dark ? Sun : Moon;
  return (
    <button type="button" className={styles.nav} onClick={toggleTheme}>
      <Icon size={16} aria-hidden />
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}

// The person using the app, at the very bottom.
function YouItem() {
  const you = useYou();
  const current = useApp((state) => state.view.name === "you");
  const name = you.name.trim();
  return (
    <button
      type="button"
      className={`${styles.nav} ${styles.you}`}
      aria-current={current ? "page" : undefined}
      onClick={() => navigate({ name: "you" })}
    >
      <Avatar name={name || "You"} colour={you.colour} size={26} />
      <span className={styles.youText}>
        {name || "You"}
        <span className={styles.youHint}>Your profile</span>
      </span>
    </button>
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
      <Button
        variant="primary"
        className={styles.newTask}
        onClick={() => navigate({ name: "new-task" })}
      >
        <Plus size={16} aria-hidden />
        New task
        <Kbd>Ctrl N</Kbd>
      </Button>
      <NavItem view="home" icon={House} label="Home" />
      <NavItem view="office" icon={LayoutPanelLeft} label="Office" />
      <NavItem view="needs-you" icon={Inbox} label="Needs you" badge={<WaitingCount />} />
      <NavItem view="tasks" icon={List} label="Tasks" />
      <NavItem view="templates" icon={SwatchBook} label="Templates" />
      <Departments />
      <RunningAgents />
      <div className={styles.footer}>
        <ThemeToggle />
        <ConnectionStatus />
        <YouItem />
      </div>
    </nav>
  );
}
