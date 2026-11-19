import type { TaskRecord } from "@office-town/contract";
import { Command, defaultFilter } from "cmdk";
import {
  Bot,
  CircleHelp,
  CornerDownLeft,
  FolderGit2,
  Gauge,
  GraduationCap,
  House,
  Inbox,
  LayoutPanelLeft,
  List,
  type LucideIcon,
  Network,
  Plug,
  Plus,
  Search,
  Settings,
  Sparkles,
  SunMoon,
  SwatchBook,
  UserRound,
  Users,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { useTasksWithAgents } from "../../store/agents.ts";
import { navigate, useApp, type View } from "../../store/app-store.ts";
import { useTemplates } from "../../store/templates.ts";
import { useWorkspaces } from "../../store/workspaces.ts";
import dialog from "../../ui/Dialog.module.css";
import { taskName } from "../../ui/format.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import menu from "../../ui/Menu.module.css";
import { toggleTheme, useTheme } from "../../ui/theme.ts";
import { AppLogo } from "../connectors/AppLogo.tsx";
import { groupApps, isOffer, useCatalog, useConnectors } from "../connectors/connectors.ts";
import picker from "../new-task/ModelPicker.module.css";
import { selectAgent, selectRoom } from "../office/office-state.ts";
import { startTutorial } from "../onboarding/tutorial-state.ts";
import { TUTORIALS } from "../onboarding/tutorials.ts";
import { SETTINGS_SECTIONS } from "../settings/SettingsView.tsx";
import styles from "./CommandMenu.module.css";
import { setCommandMenuOpen, useCommandMenu } from "./command-menu.ts";

const RECENT_TASKS = 8;
const TYPING_MS = 150;
// No label starts with "~", so the typed-task row never collides with another.
const START_VALUE = "~start";
// The core already matched these, on their prompt and agents too, not only their title.
const FOUND_VALUE = "~found ";
const FOUND_SCORE = 0.5;
// The typed task always shows, after anything that matches, so Enter on "templ" opens Templates.
const filter = (value: string, search: string, keywords?: string[]) => {
  if (value === START_VALUE) return Number.MIN_VALUE;
  if (value.startsWith(FOUND_VALUE)) return FOUND_SCORE;
  return defaultFilter(value, search, keywords);
};

// Tasks across the whole history that match what was typed, not only those loaded.
function useFoundTasks(typed: string): TaskRecord[] {
  const [found, setFound] = useState<TaskRecord[]>([]);
  useEffect(() => {
    if (typed === "") return;
    let current = true;
    const timer = setTimeout(() => {
      api
        .searchTasks({ text: typed, limit: RECENT_TASKS * 3 })
        .then(({ tasks }) => {
          if (!current) return;
          setFound(tasks.filter((task) => task.parentTaskId === undefined).slice(0, RECENT_TASKS));
        })
        .catch((error: unknown) => console.error("Could not search tasks.", error));
    }, TYPING_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [typed]);
  return typed === "" ? [] : found;
}

function Row(props: {
  icon: LucideIcon;
  // Drawn in place of the icon, such as an app's logo.
  leading?: ReactNode;
  label: string;
  value?: string;
  keywords?: string[];
  // Quiet text after the label, such as a member's department.
  hint?: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  const Icon = props.icon;
  return (
    <Command.Item
      value={props.value ?? props.label}
      keywords={[props.label, ...(props.keywords ?? [])]}
      className={menu.item}
      onSelect={props.onSelect}
    >
      {props.leading ?? <Icon size={15} className={styles.icon} aria-hidden />}
      <span className={menu.itemText}>{props.label}</span>
      {props.hint === undefined ? null : <span className={styles.hint}>{props.hint}</span>}
      {props.shortcut === undefined ? null : <Kbd>{props.shortcut}</Kbd>}
    </Command.Item>
  );
}

// Ctrl+K: opens on the recent tasks. Typing finds any page, team, member, workspace, template,
// provider or app, or starts a task with what was typed.
export function CommandMenu() {
  const open = useCommandMenu((state) => state.open);
  const [search, setSearch] = useState("");
  const departmentRecords = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const harnesses = useApp((state) => state.harnesses);
  const workspaces = useWorkspaces() ?? [];
  const templates = useTemplates() ?? [];
  const theme = useTheme();
  const connectors = useConnectors();
  const catalog = useCatalog();
  const apps = groupApps(connectors, catalog?.entries).filter(
    (group) => !group.routes.every(isOffer),
  );
  const chief = useApp((state) =>
    state.chiefId === undefined ? undefined : state.agents[state.chiefId],
  );
  const tasks = useTasksWithAgents()
    .filter((entry) => entry.task.parentTaskId === undefined)
    .slice(0, RECENT_TASKS);
  const departments = Object.values(departmentRecords).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  );
  // Each department's people by name, opened at their desk.
  const members = Object.values(agents).flatMap((agent) => {
    const department =
      agent.departmentId === undefined ? undefined : departmentRecords[agent.departmentId];
    return department === undefined || agent.guest === true
      ? []
      : [{ id: agent.id, name: agent.name, department: department.name }];
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setCommandMenuOpen(!useCommandMenu.getState().open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const close = () => {
    setCommandMenuOpen(false);
    setSearch("");
  };
  const go = (view: View) => {
    close();
    navigate(view);
  };
  const typed = search.trim();
  const found = useFoundTasks(typed);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setCommandMenuOpen(next);
        if (!next) setSearch("");
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={styles.content} aria-describedby={undefined}>
          <Dialog.Title className="visually-hidden">Search</Dialog.Title>
          <Command label="Search" loop filter={filter}>
            <div className={picker.search}>
              <Search size={15} aria-hidden />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search pages and tasks, or type a new task"
              />
            </div>
            <Command.List className={`${picker.list} ${styles.list}`}>
              <Command.Empty className={picker.empty}>No results.</Command.Empty>
              {typed !== "" || tasks.length === 0 ? null : (
                <Command.Group heading="Recent tasks">
                  {tasks.map(({ task }) => (
                    <Row
                      key={task.id}
                      icon={List}
                      label={taskName(task)}
                      value={`task ${task.id}`}
                      onSelect={() => go({ name: "task", taskId: task.id })}
                    />
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Create">
                <Row
                  icon={Plus}
                  label="New task"
                  shortcut="Ctrl N"
                  onSelect={() => go({ name: "new-task" })}
                />
                <Row
                  icon={Users}
                  label="New department"
                  onSelect={() => go({ name: "new-department" })}
                />
                <Row
                  icon={Plug}
                  label="Add app"
                  keywords={["connector", "connect"]}
                  onSelect={() => go({ name: "connectors", connect: "" })}
                />
              </Command.Group>
              <Command.Group heading="Go to">
                <Row icon={House} label="Home" onSelect={() => go({ name: "home" })} />
                <Row icon={Inbox} label="Needs you" onSelect={() => go({ name: "needs-you" })} />
                <Row icon={List} label="Tasks" onSelect={() => go({ name: "tasks" })} />
                <Row
                  icon={LayoutPanelLeft}
                  label="Office"
                  onSelect={() => go({ name: "office" })}
                />
                <Row icon={Users} label="Team" onSelect={() => go({ name: "team" })} />
                <Row
                  icon={SwatchBook}
                  label="Templates"
                  onSelect={() => go({ name: "templates" })}
                />
                <Row
                  icon={FolderGit2}
                  label="Workspaces"
                  onSelect={() => go({ name: "workspaces" })}
                />
                <Row icon={Bot} label="Providers" onSelect={() => go({ name: "providers" })} />
                <Row icon={Plug} label="Connectors" onSelect={() => go({ name: "connectors" })} />
                <Row icon={Gauge} label="Usage" onSelect={() => go({ name: "usage" })} />
                <Row
                  icon={Settings}
                  label="Settings"
                  shortcut="Ctrl ,"
                  keywords={["preferences"]}
                  onSelect={() => go({ name: "settings" })}
                />
                <Row
                  icon={Network}
                  label={chief === undefined ? "Add a chief" : `Chief · ${chief.name}`}
                  onSelect={() => go({ name: "chief" })}
                />
                <Row icon={UserRound} label="Your profile" onSelect={() => go({ name: "you" })} />
                <Row
                  icon={CircleHelp}
                  label="Help"
                  shortcut="F1"
                  keywords={["tutorials"]}
                  onSelect={() => go({ name: "help" })}
                />
                <Row icon={Sparkles} label="What's new" onSelect={() => go({ name: "help" })} />
                <Row
                  icon={SunMoon}
                  label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                  keywords={["theme", "appearance"]}
                  onSelect={() => {
                    close();
                    toggleTheme();
                  }}
                />
              </Command.Group>
              {/* The rest shows once something is typed, so the menu opens on recent work. */}
              {typed === "" ? null : (
                <>
                  <Command.Group heading="Settings">
                    {SETTINGS_SECTIONS.map((section) => (
                      <Row
                        key={section.id}
                        icon={Settings}
                        label={`Settings: ${section.title}`}
                        keywords={[...section.keywords]}
                        onSelect={() => go({ name: "settings", section: section.id })}
                      />
                    ))}
                  </Command.Group>
                  <Command.Group heading="Tutorials">
                    {TUTORIALS.map((tutorial) => (
                      <Row
                        key={tutorial.id}
                        icon={GraduationCap}
                        label={`Tutorial: ${tutorial.title}`}
                        keywords={["help", "learn"]}
                        onSelect={() => {
                          close();
                          void startTutorial(tutorial.id);
                        }}
                      />
                    ))}
                  </Command.Group>
                  {departments.length === 0 ? null : (
                    <Command.Group heading="Departments">
                      {departments.map((department) => (
                        <Row
                          key={department.id}
                          icon={Users}
                          label={department.name}
                          value={`department ${department.id}`}
                          onSelect={() => {
                            close();
                            selectRoom(department.id);
                          }}
                        />
                      ))}
                    </Command.Group>
                  )}
                  {members.length === 0 ? null : (
                    <Command.Group heading="Members">
                      {members.map((member) => (
                        <Row
                          key={member.id}
                          icon={UserRound}
                          label={member.name}
                          value={`member ${member.id}`}
                          keywords={[member.department]}
                          hint={member.department}
                          onSelect={() => {
                            close();
                            selectAgent(member.id);
                          }}
                        />
                      ))}
                    </Command.Group>
                  )}
                  {workspaces.length === 0 ? null : (
                    <Command.Group heading="Workspaces">
                      {workspaces.map((workspace) => (
                        <Row
                          key={workspace.id}
                          icon={FolderGit2}
                          label={workspace.name}
                          value={`workspace ${workspace.id}`}
                          onSelect={() => go({ name: "workspace", workspaceId: workspace.id })}
                        />
                      ))}
                    </Command.Group>
                  )}
                  {templates.length === 0 ? null : (
                    <Command.Group heading="Start from a template">
                      {templates.map((template) => (
                        <Row
                          key={template.id}
                          icon={SwatchBook}
                          label={template.name}
                          value={`template ${template.id}`}
                          onSelect={() => go({ name: "new-task", templateId: template.id })}
                        />
                      ))}
                    </Command.Group>
                  )}
                  {harnesses.length === 0 ? null : (
                    <Command.Group heading="Providers">
                      {harnesses.map((harness) => (
                        <Row
                          key={harness.harness}
                          icon={Bot}
                          label={harness.name}
                          value={`provider ${harness.harness}`}
                          onSelect={() => go({ name: "provider", harness: harness.harness })}
                        />
                      ))}
                    </Command.Group>
                  )}
                  {apps.length === 0 ? null : (
                    <Command.Group heading="Apps">
                      {apps.map((group) => {
                        const [first] = group.routes;
                        return first === undefined ? null : (
                          <Row
                            key={group.key}
                            icon={Plug}
                            leading={<AppLogo app={group.logo} size="xs" />}
                            label={group.name}
                            value={`connector ${group.key}`}
                            keywords={group.routes.map(({ setup }) => setup.name)}
                            onSelect={() => go({ name: "connector", connectorId: first.id })}
                          />
                        );
                      })}
                    </Command.Group>
                  )}
                </>
              )}
              {typed === "" || found.length === 0 ? null : (
                <Command.Group heading="Tasks">
                  {found.map((task) => (
                    <Row
                      key={task.id}
                      icon={List}
                      label={taskName(task)}
                      value={`${FOUND_VALUE}${task.id}`}
                      onSelect={() => go({ name: "task", taskId: task.id })}
                    />
                  ))}
                </Command.Group>
              )}
              {typed === "" ? null : (
                <Command.Group>
                  <Command.Item
                    value={START_VALUE}
                    className={menu.item}
                    onSelect={() => go({ name: "new-task", prompt: typed })}
                  >
                    <CornerDownLeft size={15} className={styles.icon} aria-hidden />
                    <span className={`${menu.itemText} ${styles.typed}`}>
                      Start a task: {typed}
                    </span>
                  </Command.Item>
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
