import type { AutomationRecord, AutomationTask } from "@office-town/contract";
import { CalendarClock, Copy, Pencil, Play, Power, Trash2 } from "lucide-react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { keepAutomation, useAutomations } from "../../store/automations.ts";
import { confirmed, type MenuContent } from "../../ui/ActionMenu.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import styles from "../../ui/StatusIcon.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { type AutomationState, stateOf, stateText, whenText } from "./words.ts";

// Who does it: its department, the chief, or an assistant; the lead's colour stands for a team.
export function useWho(task: AutomationTask): { name: string; colour: string } {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const chiefId = useApp((state) => state.chiefId);
  if (task.kind === "chief") {
    const chief = chiefId === undefined ? undefined : agents[chiefId];
    return { name: chief?.name ?? "The chief", colour: chief?.colour ?? "var(--text-3)" };
  }
  if (task.kind === "assistant") return { name: "Assistant", colour: "var(--text-3)" };
  const department = departments[task.request.team.departmentId];
  if (department === undefined) return { name: "Removed department", colour: "var(--text-3)" };
  return {
    name: department.name,
    colour: agents[department.leadAgentId]?.colour ?? "var(--text-3)",
  };
}

export function WhoAvatar({ task, size = 26 }: { task: AutomationTask; size?: number }) {
  const who = useWho(task);
  return <Avatar name={who.name} colour={who.colour} size={size} />;
}

// The When in words, naming the automation a chain follows.
export function useWhenText(automation: Pick<AutomationRecord, "trigger">): string {
  const all = useAutomations();
  return whenText(automation.trigger, (id) => all?.find((one) => one.id === id)?.name);
}

const TONES: Record<AutomationState, string | undefined> = {
  paused: styles.dot,
  needs: styles.dot,
  working: undefined,
  waiting: undefined,
  off: undefined,
  on: undefined,
};

// One status per automation, as words with the dot Needs you uses when it waits on the user.
export function AutomationStatus({ automation }: { automation: AutomationRecord }) {
  const state = stateOf(automation);
  const dot = TONES[state];
  return (
    <span className={styles.hover}>
      {dot === undefined ? null : <span className={dot} aria-hidden />}
      {stateText(automation)}
    </span>
  );
}

export const AutomationIcon = CalendarClock;

const errorText = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

export async function turn(automation: AutomationRecord, enabled: boolean): Promise<void> {
  try {
    keepAutomation(await api.turnAutomation(automation.id, enabled));
  } catch (failure) {
    showToast(errorText(failure));
  }
}

export async function runNow(automation: AutomationRecord): Promise<void> {
  try {
    const run = await api.runAutomation(automation.id);
    showToast(
      run.status === "skipped"
        ? (run.reason ?? "It was skipped.")
        : `Run ${run.number} of ${automation.name} is on its way.`,
    );
  } catch (failure) {
    showToast(errorText(failure));
  }
}

// The same actions for its "…" menu and its right-click menu (D-89).
export function automationMenu(automation: AutomationRecord, onPage: boolean): MenuContent {
  return {
    actions: [
      ...(onPage
        ? []
        : [
            { label: "Run now", icon: Play, run: () => runNow(automation) },
            {
              label: "Edit",
              icon: Pencil,
              run: () => navigate({ name: "new-automation", edit: automation.id }),
            },
          ]),
      {
        label: "Duplicate",
        icon: Copy,
        run: async () => {
          const { name, task, trigger, rules } = automation;
          const copy = await api.createAutomation({
            name: `${name} copy`,
            enabled: false,
            task,
            trigger,
            rules,
          });
          keepAutomation(copy);
          navigate({ name: "automation", automationId: copy.id });
        },
      },
      {
        label: automation.enabled ? "Turn off" : "Turn on",
        icon: Power,
        run: () => turn(automation, !automation.enabled),
      },
      confirmed(
        { label: "Delete", icon: Trash2 },
        {
          title: `Delete ${automation.name}?`,
          description: "It stops running. Its past runs stay in Tasks. A run at work now finishes.",
          confirmLabel: "Delete",
          run: async () => {
            await api.deleteAutomation(automation.id);
            if (onPage) navigate({ name: "automations" });
          },
        },
      ),
    ],
  };
}
