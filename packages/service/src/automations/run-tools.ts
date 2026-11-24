import { NOTES_CHARS } from "@office-town/contract";
import { z } from "zod";
import type { Store } from "../store/store.ts";
import { topSession } from "../team/task-state.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";

// The run an automation's agent in charge is working on: the assistant, the lead or the chief.
function runOf(store: Store, caller: Caller) {
  const task = store.getTask(caller.taskId);
  if (task?.origin?.kind !== "automation") return undefined;
  const top = topSession(task, store.listSessions(task.id));
  if (top?.agentId !== caller.agentId) return undefined;
  return store.automations.getRun(task.origin.runId);
}

// A run that found nothing new ends quietly: no alert, no send, no review, and the next run still
// sees the last real result (D-131).
export function reportNothingNew(store: Store) {
  return defineTool({
    name: "report_nothing_new",
    description:
      "In an automation's run: say there is nothing new worth telling the user since the last " +
      "run. The run then ends quietly, with no message and nothing to review. Call it instead of " +
      "writing a result, then end your turn.",
    input: z.object({}),
    offeredTo: (caller) => runOf(store, caller) !== undefined,
    call: (_, caller) => {
      const run = runOf(store, caller);
      if (run === undefined) throw new ToolError("Only an automation's run can report this.");
      store.automations.updateRun(run.id, { quiet: true });
      return "Noted: nothing new. End your turn now, with no summary.";
    },
  });
}

// What the agent in charge keeps from run to run, on the automation, given to the next run as
// data. The user can read, edit and clear it (D-133).
export function keepNotes(store: Store) {
  return defineTool({
    name: "keep_notes",
    description:
      "In an automation's run: replace the notes you keep for its next runs, such as what you " +
      `have already reported. Send the whole new text, at most ${NOTES_CHARS.toLocaleString("en")} ` +
      "characters; an empty text clears them.",
    input: z.object({ notes: z.string() }),
    offeredTo: (caller) => runOf(store, caller) !== undefined,
    call: ({ notes }, caller) => {
      const run = runOf(store, caller);
      if (run === undefined) throw new ToolError("Only an automation's run can keep notes.");
      if (notes.length > NOTES_CHARS) {
        throw new ToolError(
          `These notes are ${notes.length.toLocaleString("en")} characters; the most is ` +
            `${NOTES_CHARS.toLocaleString("en")}. Shorten them and call keep_notes again.`,
        );
      }
      if (store.automations.get(run.automationId) === undefined) {
        throw new ToolError("This automation was deleted, so its notes are gone.");
      }
      store.automations.setNotes(run.automationId, notes);
      return notes.trim() === "" ? "Notes cleared." : "Notes kept for the next run.";
    },
  });
}
