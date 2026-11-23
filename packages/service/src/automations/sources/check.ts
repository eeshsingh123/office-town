import {
  type AutomationRecord,
  checkFindingsSchema,
  type EventSourceConfig,
  type NewAgent,
  type TaskRecord,
} from "@office-town/contract";
import { chiefOf } from "../../chief/chief.ts";
import { accountOf, waitOn } from "../../queue/admission.ts";
import { startSoloTask } from "../../task-start.ts";
import type { TeamContext } from "../../team/members.ts";
import { stopTeam } from "../../team/team-tasks.ts";
import { defineTool, ToolError } from "../../tools/tools.ts";
import { readerOf } from "../run-task.ts";
import { statusOf } from "../runner.ts";
import { type EventSource, lookEvery, MINUTES, type SourceContext } from "./source.ts";

type CheckConfig = Extract<EventSourceConfig, { kind: "check" }>;

const FAILURES_TO_PAUSE = 3;
const OVER = new Set(["review", "done", "failed", "stopped"]);

interface CheckState {
  lookedAt?: number;
  // The check at work, so one cut off by a close is cleared at the next start.
  openTaskId?: string;
  // The last check that never said what it found, kept so it can be opened.
  failedTaskId?: string;
  failures?: number;
}

interface OpenCheck {
  automationId: string;
  startedAt: number;
  answered: boolean;
}

const clock = (at: number) =>
  new Date(at).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

// The check is done by whoever does the task, on its model and account, without its role's
// instructions, which are for the task and not the look.
function checkerOf(team: TeamContext, automation: AutomationRecord): NewAgent | undefined {
  const { task } = automation;
  if (task.kind === "assistant") return task.request.agent;
  const settings = readerOf(team.store, automation) ?? chiefOf(team.store)?.settings;
  if (settings === undefined) return undefined;
  const { instructions: _, ...rest } = settings;
  return { settings: rest };
}

function workspaceOf({ store }: TeamContext, automation: AutomationRecord): string | undefined {
  const { task } = automation;
  if (task.kind === "assistant") return task.request.workspaceId;
  if (task.kind === "department") {
    return (
      task.request.team.workspaceId ??
      store.getDepartment(task.request.team.departmentId)?.workspaceId
    );
  }
  return store.listWorkspaces().find((workspace) => workspace.kind === "scratch")?.id;
}

function levelOf({ store }: TeamContext, automation: AutomationRecord) {
  const { task } = automation;
  const level =
    task.kind === "assistant"
      ? task.request.autonomy
      : task.kind === "department"
        ? (store.getDepartment(task.request.team.departmentId)?.autonomy ?? "supervised")
        : "supervised";
  // Event-triggered work never runs at No safety checks (D-118).
  return level === "bypass" ? "full" : level;
}

function briefOf(automation: AutomationRecord, config: CheckConfig, since: number | undefined) {
  const newer =
    since === undefined
      ? "Count only what is from the last day."
      : `Count only what is newer than ${clock(since)}.`;
  return [
    `This is a check for the automation "${automation.name}". Using your apps, look for: ${config.look}`,
    "",
    `${newer} Only look: do not act on what you find, reply to anyone or change anything.`,
    "",
    "Then call report_found once: found false when nothing is new; otherwise found true with each " +
      "new thing as an item, with a key that stays the same if you see it again (its id or link) " +
      "and a short text with what someone acting on it needs. At most 50 items. Then stop.",
  ].join("\n");
}

// An agent check (D-128): a short task that looks through the apps of whoever does the work,
// every so often, and says what is new with `report_found`. A check that answered is deleted, so
// only runs that found something stay in Tasks; one that never answered is kept to be opened.
export class AgentChecks {
  readonly #team: TeamContext;
  readonly #open = new Map<string, OpenCheck>();
  readonly #contexts = new Map<string, SourceContext>();

  constructor(team: TeamContext) {
    this.#team = team;
    team.store.subscribe((change) => {
      if (change.type === "task" && change.task.origin?.kind === "check") this.#follow(change.task);
    });
  }

  source(): EventSource<"check"> {
    return {
      kind: "check",
      start: (config, context) => {
        const { id } = context.automation;
        this.#contexts.set(id, context);
        this.#clearCutOff(context);
        const stop = lookEvery(
          config.everyMinutes * MINUTES,
          context.state<CheckState>()?.lookedAt,
          () => this.#check(config, context),
          (error, failures) => {
            if (failures === 1) {
              console.error(`Could not start the check of ${context.automation.name}.`, error);
            }
          },
        );
        return () => {
          stop();
          if (this.#contexts.get(id) === context) this.#contexts.delete(id);
        };
      },
    };
  }

  tool() {
    const { store } = this.#team;
    return defineTool({
      name: "report_found",
      description:
        "Say what an automation's check found: found false when nothing is new, or found true " +
        "with each new thing as an item. Call it once, at the end of the check.",
      input: checkFindingsSchema,
      offeredTo: (caller) => store.getTask(caller.taskId)?.origin?.kind === "check",
      call: (findings, caller) => {
        const origin = store.getTask(caller.taskId)?.origin;
        if (origin?.kind !== "check") throw new ToolError("Only an automation's check can report.");
        const open = this.#open.get(caller.taskId);
        if (open?.answered === true) throw new ToolError("This check has already reported.");
        if (open !== undefined) open.answered = true;
        const context = this.#contexts.get(origin.automationId);
        if (context === undefined) return "Noted. The automation is off now, so stop here.";
        const now = Date.now();
        const found = findings.found
          ? context.seen(
              findings.items.map((item) => ({ key: item.key, at: now, text: item.text })),
            )
          : 0;
        context.looked(found);
        return found === 0 ? "Noted: nothing new. Stop here." : `Noted ${found} new. Stop here.`;
      },
    });
  }

  async #check(config: CheckConfig, context: SourceContext): Promise<void> {
    const { store } = this.#team;
    // Read afresh: its last look changes after every check.
    const automation = store.automations.get(context.automation.id) ?? context.automation;
    const state = context.state<CheckState>() ?? {};
    const working = [...this.#open].find(([, open]) => open.automationId === automation.id);
    if (working !== undefined) {
      // A check that takes longer than its gap, such as one waiting on you, gives way.
      const [taskId, open] = working;
      if (Date.now() - open.startedAt >= config.everyMinutes * MINUTES)
        await stopTeam(this.#team, taskId);
      return;
    }
    const agent = checkerOf(this.#team, automation);
    const workspaceId = workspaceOf(this.#team, automation);
    if (agent === undefined || workspaceId === undefined) {
      context.fail("Nobody is left to do its check.");
      return;
    }
    const settings = "settings" in agent ? agent.settings : undefined;
    const accountId = accountOf(store, settings);
    // No room on its account: this check is skipped, the next one tries again.
    if (waitOn(store, { accountId, verb: "checked", since: Date.now() }, undefined, 0)) {
      context.setState({ ...state, lookedAt: Date.now() });
      return;
    }
    const session = await startSoloTask(
      this.#team,
      {
        prompt: briefOf(
          automation,
          config,
          automation.lastLook === undefined ? undefined : Date.parse(automation.lastLook.at),
        ),
        agent,
        autonomy: levelOf(this.#team, automation),
        workspaceId,
      },
      { kind: "check", automationId: automation.id, name: automation.name },
    );
    store.setTaskTitle(session.taskId, `Check: ${automation.name}`);
    this.#open.set(session.taskId, {
      automationId: automation.id,
      startedAt: Date.now(),
      answered: false,
    });
    context.setState({ ...state, lookedAt: Date.now(), openTaskId: session.taskId });
  }

  #follow(task: TaskRecord): void {
    const open = this.#open.get(task.id);
    if (open === undefined) return;
    if (task.state !== "ended" && !OVER.has(statusOf(this.#team, task))) return;
    this.#open.delete(task.id);
    const context = this.#contexts.get(open.automationId);
    const state = context?.state<CheckState>() ?? {};
    if (open.answered) {
      context?.setState({ ...state, openTaskId: undefined, failures: 0 });
      void this.#remove(task.id);
      return;
    }
    const failures = (state.failures ?? 0) + 1;
    if (state.failedTaskId !== undefined) void this.#remove(state.failedTaskId);
    context?.setState({ ...state, openTaskId: undefined, failedTaskId: task.id, failures });
    if (failures >= FAILURES_TO_PAUSE) {
      context?.fail(`Its check failed ${FAILURES_TO_PAUSE} times in a row.`, "turn-on");
    }
  }

  // A check cut off by a close has nothing to resume: the next check looks again.
  #clearCutOff(context: SourceContext): void {
    const state = context.state<CheckState>();
    if (state?.openTaskId === undefined || this.#open.has(state.openTaskId)) return;
    const { openTaskId, ...rest } = state;
    context.setState(rest);
    void this.#remove(openTaskId);
  }

  async #remove(taskId: string): Promise<void> {
    const { store } = this.#team;
    if (store.getTask(taskId) === undefined) return;
    try {
      await stopTeam(this.#team, taskId);
      await store.deleteTask(taskId);
    } catch (error) {
      console.error("Could not remove a finished check.", error);
    }
  }
}
