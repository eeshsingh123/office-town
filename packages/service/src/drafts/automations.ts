import {
  type AutomationDraft,
  type AutomationDraftReply,
  type AutomationDraftRequest,
  CHECK_MINUTES,
  type EventSourceConfig,
  FILL_INS,
  scheduleSchema,
} from "@office-town/contract";
import { z } from "zod";
import { chiefOf } from "../chief/chief.ts";
import type { TeamContext } from "../team/members.ts";
import { askForJson } from "./run.ts";
import { ASKING, asked, numbered, writtenReplyShape } from "./written.ts";

const writtenSchema = z.object({
  ...writtenReplyShape,
  automation: z
    .object({
      name: z.string().trim().min(1),
      prompt: z.string().trim().min(1),
      who: z.string().trim().min(1),
      // A schedule preset, or the name of the automation it runs after.
      schedule: scheduleSchema.optional(),
      after: z.string().trim().min(1).optional(),
      after_outcome: z.enum(["done", "any"]).default("done"),
      event: z
        .discriminatedUnion("kind", [
          z.object({ kind: z.literal("folder"), path: z.string().trim().min(1) }),
          z.object({ kind: z.literal("feed"), url: z.url() }),
          z.object({
            kind: z.literal("github"),
            repo: z.string().trim().min(3),
            watch: z.enum(["issues", "pulls", "both"]).default("issues"),
          }),
          z.object({
            kind: z.literal("check"),
            look: z.string().trim().min(1),
            every_minutes: z.number().int().min(CHECK_MINUTES.least).optional(),
          }),
        ])
        .optional(),
      decisions: z.enum(["ask", "auto"]).optional(),
      review: z.boolean().optional(),
      save_result: z.boolean().optional(),
    })
    .optional(),
});

const SCHEDULES = `{"repeat":"daily","time":"09:00"} | {"repeat":"weekdays","time":"09:00"} | {"repeat":"weekly","days":[1],"time":"09:00"} (0 is Sunday) | {"repeat":"monthly","day":1,"time":"09:00"} (day 1 to 28, or "last") | {"repeat":"hours","every":2,"from":"08:00","until":"18:00"} (every 1 to 12 hours) | {"repeat":"once","date":"2026-12-01","time":"14:00"}`;

const EVENTS = `{"kind":"folder","path":"the folder's full path"} | {"kind":"feed","url":"https://example.com/feed.xml"} | {"kind":"github","repo":"owner/name","watch":"issues"} (or "pulls" or "both") | {"kind":"check","look":"new emails with an invoice attached","every_minutes":60} (at least ${CHECK_MINUTES.least})`;

type WrittenEvent = NonNullable<NonNullable<z.infer<typeof writtenSchema>["automation"]>["event"]>;

// A GitHub watch needs the GitHub app; without one, the When step is left for the user.
function eventTrigger({ store }: TeamContext, event: WrittenEvent) {
  let source: EventSourceConfig | undefined;
  switch (event.kind) {
    case "folder":
      source = { kind: "folder", path: event.path, subfolders: true };
      break;
    case "feed":
      source = { kind: "feed", url: event.url };
      break;
    case "check":
      source = {
        kind: "check",
        look: event.look,
        everyMinutes: event.every_minutes ?? CHECK_MINUTES.first,
      };
      break;
    case "github": {
      const app = store.listConnectors().find((connector) => connector.setup.slug === "github");
      if (app !== undefined) {
        source = { kind: "github", connectorId: app.id, repo: event.repo, watch: event.watch };
      }
      break;
    }
  }
  return source === undefined ? {} : { trigger: { kind: "event" as const, source } };
}

function promptFor(context: TeamContext, request: AutomationDraftRequest): string {
  const { store } = context;
  const teams = [
    `- "assistant": one agent working alone`,
    ...store
      .listDepartments()
      .map(
        (department) =>
          `- "${department.id}": ${department.name}${department.purpose ? `, ${department.purpose}` : ""}`,
      ),
    ...(chiefOf(store) === undefined ? [] : [`- "chief": the chief, who plans across departments`]),
  ].join("\n");
  const others =
    store.automations
      .list()
      .map((each) => `- ${each.name}`)
      .join("\n") || "none";
  const draft =
    request.current === undefined
      ? ""
      : `\n\nThe current draft; change only what the user asks:\n${JSON.stringify(request.current)}`;
  return `You help a user of Office Town set up an automation: a task that starts on its own, on a schedule or after another automation finishes. Each run is an ordinary task given to an assistant, a department or the chief.

Write the automation the user describes. Reply with one JSON object and nothing else:
{"questions":[{"question":"...","options":["..."]}],"suggestions":["..."],"automation":{"name":"...","prompt":"...","who":"...","schedule":SCHEDULE,"after":"...","after_outcome":"done","event":EVENT,"decisions":"ask","review":false,"save_result":false}}
SCHEDULE is one of ${SCHEDULES}
EVENT is one of ${EVENTS}

- name: a short name for the automation, such as "Weekly sales report".
- prompt: the task each run starts with, written to whoever does it, complete on its own. Write ${FILL_INS.date} where today's date belongs and ${FILL_INS.lastResult} where the last run's result belongs, only when the task needs them.
- who: one of the ids below. Pick the department whose work it is; "assistant" for a small task; "chief" only for work across departments.
- schedule: when it runs, in the user's time zone (${request.timeZone}). The shortest repeat is every hour. Leave it out and set "after" to the name of another automation when it should run after that one; after_outcome "any" runs it however that one ended. Set "event" instead when something arriving should start it: a file landing in a folder, new posts in a feed, new GitHub issues or pull requests, or a "check" that looks through the agent's apps (such as email) every few minutes; write ${FILL_INS.event} in the prompt where what arrived belongs.
- decisions: "auto" only when the user wants it to run without asking them anything; else leave it out.
- review: true only when the user wants to look at each run's result before it counts as done. save_result: true when they want each result kept in the Library.
${ASKING}

Who can do it:
${teams}

Other automations:
${others}${draft}

What the user said, in order:
${numbered(request.notes)}`;
}

export async function draftAutomation(
  context: TeamContext,
  request: AutomationDraftRequest,
): Promise<AutomationDraftReply> {
  const written = await askForJson(
    context,
    request.drafter,
    promptFor(context, request),
    writtenSchema,
  );
  const reply = asked(written);
  const one = written.automation;
  if (one === undefined) return reply;
  const { store } = context;
  const known = one.who === "assistant" || one.who === "chief" || store.getDepartment(one.who);
  const after =
    one.after === undefined
      ? undefined
      : store.automations
          .list()
          .find((each) => each.name.toLowerCase() === one.after?.toLowerCase());
  const automation: AutomationDraft = {
    name: one.name,
    prompt: one.prompt,
    who: known ? one.who : "assistant",
    ...(after !== undefined
      ? { trigger: { kind: "after", automationId: after.id, outcome: one.after_outcome } }
      : one.event !== undefined
        ? eventTrigger(context, one.event)
        : one.schedule !== undefined
          ? {
              trigger: {
                kind: "schedule",
                schedule: one.schedule,
                timeZone: request.timeZone,
                ends: { kind: "never" },
              },
            }
          : {}),
    rules: {
      ...(one.decisions === undefined ? {} : { decisions: one.decisions }),
      ...(one.review === undefined ? {} : { review: one.review }),
      ...(one.save_result === undefined ? {} : { saveResult: one.save_result }),
    },
  };
  return { ...reply, automation };
}
