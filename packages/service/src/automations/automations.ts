import type { NameTask } from "../drafts/title.ts";
import type { Notifier } from "../notify/notifier.ts";
import { AdmissionQueue, resumeWait } from "../queue/admission-queue.ts";
import type { StoppedLeads } from "../team/lead-stopped.ts";
import type { TeamContext } from "../team/members.ts";
import { resumeTask } from "../team/stopped-tasks.ts";
import { decideOnAuto } from "./auto-decisions.ts";
import { Runner } from "./runner.ts";

// The one door every unattended start goes through (D-121), with the automations that feed it
// (D-125): a resume after a close, or an automation's run.
export function startAutomations(
  context: TeamContext,
  notifier: Notifier,
  stoppedLeads: StoppedLeads,
  nameTask: NameTask,
  launch: string,
): { runner: Runner; queue: AdmissionQueue } {
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
  return { runner, queue };
}
