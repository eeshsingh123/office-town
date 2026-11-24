import type { NameTask } from "../drafts/title.ts";
import type { Notifier } from "../notify/notifier.ts";
import { AdmissionQueue, resumeWait } from "../queue/admission-queue.ts";
import type { Store } from "../store/store.ts";
import type { StoppedLeads } from "../team/lead-stopped.ts";
import type { TeamContext } from "../team/members.ts";
import type { SharedFiles } from "../team/shared-files.ts";
import { resumeTask } from "../team/stopped-tasks.ts";
import { decideOnAuto } from "./auto-decisions.ts";
import { Runner } from "./runner.ts";
import { AgentChecks } from "./sources/check.ts";
import { feedSource } from "./sources/feed.ts";
import { folderSource } from "./sources/folder.ts";
import { githubSource } from "./sources/github.ts";
import type { Writer } from "./sources/source.ts";
import { EventWatch } from "./sources/watch.ts";

type FileChanges = Pick<SharedFiles, "lastChange">;

// The automation run whose agent last changed this file, as the core saw it.
function writerOf(store: Store, sharedFiles: FileChanges, path: string): Writer | undefined {
  const change = sharedFiles.lastChange(path);
  const session = change === undefined ? undefined : store.getSession(change.sessionId);
  const task = session === undefined ? undefined : store.getTask(session.taskId);
  const goal = task?.parentTaskId === undefined ? task : store.getTask(task.parentTaskId);
  const origin = goal?.origin;
  if (origin?.kind !== "automation") return undefined;
  return {
    automationId: origin.automationId,
    depth: store.automations.getRun(origin.runId)?.depth ?? 0,
  };
}

// The one door every unattended start goes through (D-121), with the automations that feed it
// (D-125): a resume after a close, or an automation's run.
export function startAutomations(
  context: TeamContext,
  notifier: Notifier,
  stoppedLeads: StoppedLeads,
  nameTask: NameTask,
  launch: string,
  files: { shared: FileChanges; keysOf: (connectorId: string) => Record<string, string> },
): { runner: Runner; queue: AdmissionQueue; watch: EventWatch; checks: AgentChecks } {
  const { store, registry } = context;
  const runner = new Runner(context, notifier, nameTask);
  const resumeWaits = resumeWait(store);
  const queue = new AdmissionQueue(store, registry, launch, {
    waitFor: (what) => (what.kind === "run" ? runner.waitFor(what.runId) : resumeWaits(what)),
    start: (what) =>
      what.kind === "run" ? runner.start(what.runId) : resumeTask(context, what.taskId),
  });
  decideOnAuto(context, stoppedLeads);
  runner.use(queue);
  const checks = new AgentChecks(context);
  const watch = new EventWatch(
    context,
    runner,
    [folderSource, feedSource, githubSource, checks.source()],
    { writerOf: (path) => writerOf(store, files.shared, path), keysOf: files.keysOf },
  );
  watch.start();
  return { runner, queue, watch, checks };
}
