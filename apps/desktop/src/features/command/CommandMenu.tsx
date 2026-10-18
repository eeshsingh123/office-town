import { Command, defaultFilter } from "cmdk";
import {
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
  SwatchBook,
  UserRound,
  Users,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { useTasksWithAgents } from "../../store/agents.ts";
import { navigate, useApp, type View } from "../../store/app-store.ts";
import dialog from "../../ui/Dialog.module.css";
import { taskTitle } from "../../ui/format.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import menu from "../../ui/Menu.module.css";
import { useConnectors } from "../connectors/connectors.ts";
import picker from "../new-task/ModelPicker.module.css";
import { startTutorial } from "../onboarding/tutorial-state.ts";
import { TUTORIALS } from "../onboarding/tutorials.ts";
import styles from "./CommandMenu.module.css";
import { setCommandMenuOpen, useCommandMenu } from "./command-menu.ts";

const RECENT_TASKS = 8;
// No label starts with "~", so the typed-task row never collides with another.
const START_VALUE = "~start";
// The typed task always shows, after anything that matches, so Enter on "templ" opens Templates.
const filter = (value: string, search: string, keywords?: string[]) =>
  value === START_VALUE ? Number.MIN_VALUE : defaultFilter(value, search, keywords);

function Row(props: {
  icon: LucideIcon;
  label: string;
  value?: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  const Icon = props.icon;
  return (
    <Command.Item
      value={props.value ?? props.label}
      keywords={[props.label]}
      className={menu.item}
      onSelect={props.onSelect}
    >
      <Icon size={15} className={styles.icon} aria-hidden />
      <span className={menu.itemText}>{props.label}</span>
      {props.shortcut === undefined ? null : <Kbd>{props.shortcut}</Kbd>}
    </Command.Item>
  );
}

// Ctrl+K: start a task with what was typed, or jump to any page, department or recent task.
export function CommandMenu() {
  const open = useCommandMenu((state) => state.open);
  const [search, setSearch] = useState("");
  const departments = useApp((state) => state.departments);
  const connectors = useConnectors();
  const chief = useApp((state) =>
    state.chiefId === undefined ? undefined : state.agents[state.chiefId],
  );
  const tasks = useTasksWithAgents()
    .filter((entry) => entry.task.parentTaskId === undefined)
    .slice(0, RECENT_TASKS);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setCommandMenuOpen(!useCommandMenu.getState().open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (view: View) => {
    setCommandMenuOpen(false);
    setSearch("");
    navigate(view);
  };
  const typed = search.trim();

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
              </Command.Group>
              <Command.Group heading="Go to">
                <Row icon={House} label="Home" onSelect={() => go({ name: "home" })} />
                <Row
                  icon={LayoutPanelLeft}
                  label="Office"
                  onSelect={() => go({ name: "office" })}
                />
                <Row icon={Users} label="Team" onSelect={() => go({ name: "team" })} />
                <Row icon={Inbox} label="Needs you" onSelect={() => go({ name: "needs-you" })} />
                <Row icon={List} label="Tasks" onSelect={() => go({ name: "tasks" })} />
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
                <Row icon={Plug} label="Connectors" onSelect={() => go({ name: "connectors" })} />
                <Row icon={Gauge} label="Usage" onSelect={() => go({ name: "usage" })} />
                <Row
                  icon={Network}
                  label={chief === undefined ? "Set up your chief" : `Chief · ${chief.name}`}
                  onSelect={() => go({ name: "chief" })}
                />
                <Row icon={UserRound} label="Your profile" onSelect={() => go({ name: "you" })} />
              </Command.Group>
              <Command.Group heading="Learn">
                {TUTORIALS.map((tutorial) => (
                  <Row
                    key={tutorial.id}
                    icon={GraduationCap}
                    label={`Tutorial: ${tutorial.title}`}
                    onSelect={() => {
                      setCommandMenuOpen(false);
                      setSearch("");
                      void startTutorial(tutorial.id);
                    }}
                  />
                ))}
                <Row
                  icon={CircleHelp}
                  label="Help"
                  shortcut="F1"
                  onSelect={() => go({ name: "help" })}
                />
              </Command.Group>
              {Object.keys(departments).length === 0 ? null : (
                <Command.Group heading="Departments">
                  {Object.values(departments)
                    .toSorted((a, b) => a.name.localeCompare(b.name))
                    .map((department) => (
                      <Row
                        key={department.id}
                        icon={Users}
                        label={department.name}
                        value={`department ${department.id}`}
                        onSelect={() => go({ name: "office", room: department.id })}
                      />
                    ))}
                </Command.Group>
              )}
              {connectors.length === 0 ? null : (
                <Command.Group heading="Connectors">
                  {connectors.map((connector) => (
                    <Row
                      key={connector.id}
                      icon={Plug}
                      label={connector.setup.name}
                      value={`connector ${connector.id}`}
                      onSelect={() => go({ name: "connector", connectorId: connector.id })}
                    />
                  ))}
                </Command.Group>
              )}
              {tasks.length === 0 ? null : (
                <Command.Group heading="Recent tasks">
                  {tasks.map(({ task }) => (
                    <Row
                      key={task.id}
                      icon={List}
                      label={taskTitle(task.prompt)}
                      value={`task ${task.id}`}
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
