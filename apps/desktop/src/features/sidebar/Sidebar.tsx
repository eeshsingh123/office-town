import {
  Bot,
  CalendarClock,
  CircleHelp,
  FolderGit2,
  Gauge,
  House,
  Inbox,
  LayoutPanelLeft,
  List,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Settings,
  SwatchBook,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { shell } from "../../shell.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import appIcon from "../../ui/app-icon.svg";
import { Button } from "../../ui/Button.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { type PaneSize, usePaneWidth } from "../../ui/pane.ts";
import { ResizeHandle } from "../../ui/ResizeHandle.tsx";
import { shortcut } from "../../ui/system.ts";
import { openCommandMenu } from "../command/command-menu.ts";
import { useConnectorNeedsUser } from "../connectors/connectors.ts";
import { useNewPosts } from "../feed/feed.ts";
import { startNewTask } from "../new-task/start-new-task.ts";
import { useAnyAccountHigh } from "../usage/use-usage.ts";
import { useYou } from "../you/you.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { Departments } from "./Departments.tsx";
import { RunningAgents } from "./RunningAgents.tsx";
import styles from "./Sidebar.module.css";
import { toggleSidebar, useSidebarCollapsed } from "./sidebar-state.ts";

const SIZE: PaneSize = { initial: 220, min: 180, max: 320 };
const RAIL = 60;

// Collapsed, a label moves into the button's name and tooltip.
function useRailLabel(label: string) {
  const collapsed = useSidebarCollapsed();
  return collapsed ? { "aria-label": label, title: label } : {};
}

interface NavItemProps {
  view:
    | "home"
    | "office"
    | "team"
    | "needs-you"
    | "feed"
    | "tasks"
    | "automations"
    | "templates"
    | "workspaces"
    | "providers"
    | "connectors"
    | "usage"
    | "settings"
    | "help";
  icon: LucideIcon;
  label: string;
  badge?: ReactNode;
}

export function NavItem({ view, icon: Icon, label, badge }: NavItemProps) {
  // A workspace's own page sits under Workspaces, an AI app's under Providers, and a
  // department's and the new one under Team.
  const current = useApp(
    (state) =>
      state.view.name === view ||
      (view === "workspaces" && state.view.name === "workspace") ||
      (view === "connectors" && state.view.name === "connector") ||
      (view === "providers" && state.view.name === "provider") ||
      (view === "automations" && ["automation", "new-automation"].includes(state.view.name)) ||
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

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <div className={styles.groupLabel}>{label}</div>
      {children}
    </div>
  );
}

// Requests, as the Needs you page counts them; tabs and Home count tasks (a3-13).
function WaitingCount() {
  const count = useApp((state) => Object.keys(state.waiting).length);
  if (count === 0) return null;
  const label = count === 1 ? "1 request" : `${count} requests`;
  return (
    <span className={styles.count} title={label}>
      {count}
      <span className="visually-hidden"> {count === 1 ? "request" : "requests"}</span>
    </span>
  );
}

// New posts since the user last looked; Needs you keeps the count (D-137).
function FeedDot() {
  if (useNewPosts() === 0) return null;
  return (
    <span className={styles.feedDot}>
      <span className="visually-hidden"> New posts</span>
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

// Amber while a connector is signed out or not answering.
function ConnectorDot() {
  if (!useConnectorNeedsUser()) return null;
  return (
    <span className={styles.attentionDot}>
      <span className="visually-hidden"> A connector needs you</span>
    </span>
  );
}

function useUpdateReady(): { version: string | undefined; installs: boolean } {
  const [version, setVersion] = useState<string>();
  const [installs, setInstalls] = useState(true);
  useEffect(() => {
    if (shell === undefined) return;
    const stop = shell.onUpdateReady(setVersion);
    void shell.updateReady().then((ready) => {
      if (ready !== null) setVersion(ready);
    });
    void shell.desktopPreferences().then((preferences) => setInstalls(preferences.updatesInstall));
    return stop;
  }, []);
  return { version, installs };
}

// Only once an update has downloaded. It installs on quit anyway; this installs it now. A build
// that cannot install it (an unsigned Mac build) opens its download page.
function UpdateItem() {
  const { version, installs } = useUpdateReady();
  const label = installs ? "Restart to update" : "Download update";
  const rail = useRailLabel(label);
  if (version === undefined) return null;
  return (
    <button
      type="button"
      className={`${styles.nav} ${styles.update}`}
      title={`Version ${version} is ready`}
      onClick={() => void shell?.restartToUpdate()}
      {...rail}
    >
      <RefreshCw size={16} aria-hidden />
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
      title="Your profile"
      {...rail}
    >
      <Avatar name={name || "You"} colour={you.colour} size={26} />
      <span className={styles.youText}>{name || "You"}</span>
    </button>
  );
}

export function Sidebar() {
  const collapsed = useSidebarCollapsed();
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
        <div className={styles.top}>
          <div className={styles.brand}>
            <img className={styles.logo} src={appIcon} alt="" />
            <span className={styles.text}>Office Town</span>
            <button
              type="button"
              className={styles.collapse}
              onClick={toggleSidebar}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={`${collapsed ? "Expand" : "Collapse"} sidebar (${shortcut("B")})`}
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
            onClick={() => startNewTask()}
            {...newTask}
          >
            <Plus size={16} aria-hidden />
            <span className={styles.text}>New task</span>
            <Kbd>{shortcut("N")}</Kbd>
          </Button>
          <button type="button" className={styles.nav} onClick={openCommandMenu} {...search}>
            <Search size={16} aria-hidden />
            <span className={styles.text}>Search</span>
            <span className={styles.shortcut}>
              <Kbd>{shortcut("K")}</Kbd>
            </span>
          </button>
          <Group label="Work">
            <NavItem view="home" icon={House} label="Home" />
            <NavItem view="feed" icon={Rss} label="Feed" badge={<FeedDot />} />
            <NavItem view="needs-you" icon={Inbox} label="Needs you" badge={<WaitingCount />} />
            <NavItem view="tasks" icon={List} label="Tasks" />
            <NavItem view="automations" icon={CalendarClock} label="Automations" />
            <NavItem view="office" icon={LayoutPanelLeft} label="Office" />
          </Group>
          <Group label="Organise">
            <NavItem view="team" icon={Users} label="Team" />
            <NavItem view="templates" icon={SwatchBook} label="Templates" />
            <NavItem view="workspaces" icon={FolderGit2} label="Workspaces" />
          </Group>
          <Group label="Setup">
            <NavItem view="providers" icon={Bot} label="Providers" />
            <NavItem view="connectors" icon={Plug} label="Connectors" badge={<ConnectorDot />} />
            <NavItem view="usage" icon={Gauge} label="Usage" badge={<UsageDot />} />
          </Group>
        </div>
        {/* The only part that scrolls, so the top and the footer never leave the screen. */}
        <div className={styles.middle}>
          {collapsed ? null : (
            <>
              <Departments />
              <RunningAgents />
            </>
          )}
        </div>
        <div className={styles.footer}>
          <UpdateItem />
          <NavItem view="settings" icon={Settings} label="Settings" />
          <NavItem view="help" icon={CircleHelp} label="Help" />
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
