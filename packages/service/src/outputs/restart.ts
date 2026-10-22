import type { OutputRecord } from "@office-town/contract";
import { sessionOptionsFor } from "../agents/options.ts";
import { RecordNotFoundError } from "../store/store.ts";
import { messageAgent } from "../team/direct-message.ts";
import { latestSession } from "../team/lead.ts";
import type { TeamContext } from "../team/members.ts";
import { claimDepartment } from "../team/team-tasks.ts";

// Starting a server takes a few steps; a fresh conversation keeps each of them from reading a
// long one again (owner). The command comes from the records, so nothing needs a summary.
export async function restartSite(
  context: TeamContext,
  output: OutputRecord,
  fresh: boolean,
  command: string | undefined,
): Promise<void> {
  const { store, registry } = context;
  if (output.target.kind !== "site") throw new RecordNotFoundError("output", output.id);
  const agent = store.getAgent(output.agentId);
  if (agent === undefined) throw new RecordNotFoundError("agent", output.agentId);
  const { title, target } = output;
  const how =
    command === undefined
      ? "Start its server again the way you did before"
      : `Start its server again; last time you ran \`${command}\``;
  const ask = `${how}, keep it running in the background, and call show_result with the title "${title}" and its address once it answers.`;
  if (!fresh) {
    await messageAgent(
      context,
      agent.id,
      `I want to look at "${title}" (${target.url}) again, but it is not running. ${ask}`,
      output.taskId,
    );
    return;
  }
  const latest = latestSession(context, output.taskId, agent.id);
  if (latest === undefined) throw new RecordNotFoundError("session", output.sessionId);
  const { workspacePath, additionalPaths = [], readOnlyPaths = [] } = latest.options;
  const departmentId = store.getTask(output.taskId)?.departmentId;
  await claimDepartment(context, departmentId, output.taskId, () =>
    registry.start({
      taskId: output.taskId,
      agentId: agent.id,
      options: sessionOptionsFor(store, agent, { workspacePath, additionalPaths, readOnlyPaths }),
      message: {
        text: `You worked on this task in an earlier conversation, which grew long, so this one starts fresh. The user wants to look at "${title}" (${target.url}) again, but it is not running. ${ask} Do only that, then say in one line that it is up.`,
        origin: { kind: "brief", summary: `Start "${title}" again` },
      },
    }),
  );
}
