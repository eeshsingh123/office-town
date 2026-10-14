import {
  FolderGit2,
  Gauge,
  House,
  Inbox,
  LayoutPanelLeft,
  List,
  type LucideIcon,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sun,
  SwatchBook,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { type PaneSize, usePaneWidth } from "../../ui/pane.ts";
import { ResizeHandle } from "../../ui/ResizeHandle.tsx";
import { toggleTheme, useTheme } from "../../ui/theme.ts";
import { openCommandMenu } from "../command/command-menu.ts";
import { useAnyAccountHigh } from "../usage/use-usage.ts";
import { useYou } from "../you/you.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { Departments } from "./Departments.tsx";
import { HistoryButtons } from "./HistoryButtons.tsx";
import { RunningAgents } from "./RunningAgents.tsx";
import styles from "./Sidebar.module.css";
import { toggleSidebar, useSidebar } from "./sidebar-state.ts";

const SIZE: PaneSize = { initial: 220, min: 180, max: 320 };
const RAIL = 60;

// Collapsed, a label moves into the button's name and tooltip.
function useRailLabel(label: string) {
  const collapsed = useSidebar((state) => state.collapsed);
  return collapsed ? { "aria-label": label, title: label } : {};
}

interface NavItemProps {
  view: "home" | "office" | "team" | "needs-you" | "tasks" | "templates" | "workspaces" | "usage";
  icon: LucideIcon;
  label: string;
  badge?: ReactNode;
}

export function NavItem({ view, icon: Icon, label, badge }: NavItemProps) {
  // A workspace's own page sits under Workspaces; a department's and the new one under Team.
  const current = useApp(
    (state) =>
      state.view.name === view ||
      (view === "workspaces" && state.view.name === "workspace") ||
      (view === "team" && ["department", "new-department"].includes(state.view.name)),
  );
  const rail = useRailLabel(label);
  return (
    <button
      type="button"
      className={styles.nav}
      aria-current={current ? "page" : undefined}
      onClick={() => navigate({ name: view })}
      {...rail}
    >
      <Icon size={16} aria-hidden />
      <span className={styles.text}>{label}</span>
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

// Red once an account is over 90% of a window.
function UsageDot() {
  if (!useAnyAccountHigh()) return null;
  return (
    <span className={styles.usageDot}>
      <span className="visually-hidden"> An account is near its limit</span>
    </span>
  );
}

function ThemeToggle() {
  const dark = useTheme() === "dark";
  const Icon = dark ? Sun : Moon;
  const label = dark ? "Light mode" : "Dark mode";
  const rail = useRailLabel(label);
  return (
    <button type="button" className={styles.nav} onClick={toggleTheme} {...rail}>
      <Icon size={16} aria-hidden />
      <span className={styles.text}>{label}</span>
    </button>
  );
}

// The person using the app, at the very bottom.
function YouItem() {
  const you = useYou();
  const current = useApp((state) => state.view.name === "you");
  const name = you.name.trim();
  const rail = useRailLabel("Your profile");
  return (
    <button
      type="button"
      className={`${styles.nav} ${styles.you}`}
      aria-current={current ? "page" : undefined}
      onClick={() => navigate({ name: "you" })}
      {...rail}
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
  const collapsed = useSidebar((state) => state.collapsed);
  const [width, resize] = usePaneWidth("sidebar", SIZE);
  const [dragging, setDragging] = useState(false);
  const newTask = useRailLabel("New task");
  const search = useRailLabel("Search");
  return (
    <div
      className={`${styles.frame} ${dragging ? styles.dragging : ""}`}
      style={{ width: collapsed ? RAIL : width }}
    >
      <nav aria-label="Main" className={`${styles.sidebar} ${collapsed ? styles.rail : ""}`}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden>
            O
          </span>
          <span className={styles.text}>Office Town</span>
          {/* Collapsed, back and forward move to the top of the main area. */}
          {collapsed ? null : <HistoryButtons />}
          <button
            type="button"
            className={styles.collapse}
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} aria-hidden />
            ) : (
              <PanelLeftClose size={16} aria-hidden />
            )}
          </button>
        </div>
        <Button
          variant="primary"
          className={styles.newTask}
          onClick={() => navigate({ name: "new-task" })}
          {...newTask}
        >
          <Plus size={16} aria-hidden />
          <span className={styles.text}>New task</span>
          <Kbd>Ctrl N</Kbd>
        </Button>
        <button type="button" className={styles.nav} onClick={openCommandMenu} {...search}>
          <Search size={16} aria-hidden />
          <span className={styles.text}>Search</span>
          <span className={styles.shortcut}>
            <Kbd>Ctrl K</Kbd>
          </span>
        </button>
        <NavItem view="home" icon={House} label="Home" />
        <NavItem view="office" icon={LayoutPanelLeft} label="Office" />
        <NavItem view="team" icon={Users} label="Team" />
        <NavItem view="needs-you" icon={Inbox} label="Needs you" badge={<WaitingCount />} />
        <NavItem view="tasks" icon={List} label="Tasks" />
        <NavItem view="templates" icon={SwatchBook} label="Templates" />
        <NavItem view="workspaces" icon={FolderGit2} label="Workspaces" />
        <NavItem view="usage" icon={Gauge} label="Usage" badge={<UsageDot />} />
        {collapsed ? null : (
          <>
            <Departments />
            <RunningAgents />
          </>
        )}
        <div className={styles.footer}>
          <ThemeToggle />
          <ConnectionStatus />
          <YouItem />
        </div>
      </nav>
      {collapsed ? null : (
        <ResizeHandle
          label="Resize sidebar"
          width={width}
          size={SIZE}
          edge="right"
          onResize={resize}
          onDragging={setDragging}
        />
      )}
    </div>
  );
}
