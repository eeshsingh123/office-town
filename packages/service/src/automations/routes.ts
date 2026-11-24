import {
  type AutomationList,
  automationDraftRequestSchema,
  automationPreviewRequestSchema,
  automationRequestSchema,
  enabledRequestSchema,
  notesRequestSchema,
  runPageQuerySchema,
} from "@office-town/contract";
import { RequestError } from "../api/errors.ts";
import type { Route } from "../api/routes.ts";
import { draftAutomation } from "../drafts/automations.ts";
import { RecordNotFoundError } from "../store/store.ts";
import type { TeamContext } from "../team/members.ts";
import { keepFiles, preview, problemWith } from "./checks.ts";
import type { Runner } from "./runner.ts";

export function automationRoutes(context: TeamContext, runner: Runner): Route[] {
  const { store } = context;
  const { automations } = store;
  const found = (id: string) => {
    const automation = automations.get(id);
    if (automation === undefined) throw new RecordNotFoundError("automation");
    return automation;
  };
  const checked = async (body: () => Promise<unknown>, id?: string) => {
    const fields = automationRequestSchema.parse(await body());
    const problem = problemWith(store, id, fields.trigger, fields.task);
    if (problem !== undefined) throw new RequestError(400, "invalid_request", problem);
    return fields;
  };
  return [
    {
      method: "GET",
      path: "/automations",
      reply: () => {
        const list: AutomationList = { automations: automations.list() };
        return { status: 200, json: list };
      },
    },
    {
      method: "POST",
      path: "/automations",
      reply: async ({ body }) => {
        const fields = await checked(body);
        const created = automations.create(fields, keepFiles(store, fields));
        runner.refreshNext(created.id);
        return { status: 201, json: automations.get(created.id) };
      },
    },
    {
      method: "POST",
      path: "/automations/login-offered",
      // Open at login is offered once, when the first automation is saved.
      reply: () => {
        store.saveSettings({ loginOffered: true });
        return { status: 204 };
      },
    },
    {
      method: "POST",
      path: "/automations/preview",
      reply: async ({ body }) => ({
        status: 200,
        json: preview(store, automationPreviewRequestSchema.parse(await body())),
      }),
    },
    {
      method: "POST",
      path: "/drafts/automations",
      reply: async ({ body }) => ({
        status: 200,
        json: await draftAutomation(context, automationDraftRequestSchema.parse(await body())),
      }),
    },
    {
      method: "GET",
      path: "/automations/:id",
      reply: ({ param }) => ({ status: 200, json: found(param("id")) }),
    },
    {
      method: "PUT",
      path: "/automations/:id",
      // Edits apply from the next run; a run at work finishes as it began.
      reply: async ({ param, body }) => {
        const id = found(param("id")).id;
        const fields = await checked(body, id);
        automations.update(id, fields, keepFiles(store, fields));
        automations.setPaused(id, undefined);
        automations.setFailures(id, 0);
        if (!fields.enabled) runner.cancelWaiting(id, "It was turned off.");
        runner.refreshNext(id);
        return { status: 200, json: automations.get(id) };
      },
    },
    {
      method: "POST",
      path: "/automations/:id/enabled",
      // Turning it on again clears a pause; its next run is from now.
      reply: async ({ param, body }) => {
        const { enabled } = enabledRequestSchema.parse(await body());
        const id = found(param("id")).id;
        automations.setEnabled(id, enabled);
        if (enabled) {
          automations.setPaused(id, undefined);
          automations.setFailures(id, 0);
        } else runner.cancelWaiting(id, "It was turned off.");
        runner.refreshNext(id);
        return { status: 200, json: automations.get(id) };
      },
    },
    {
      method: "DELETE",
      path: "/automations/:id",
      // A run at work finishes; its task keeps the automation's name.
      reply: ({ param }) => {
        const id = found(param("id")).id;
        runner.cancelWaiting(id, "Its automation was deleted.");
        automations.remove(id);
        return { status: 204 };
      },
    },
    {
      method: "PUT",
      path: "/automations/:id/notes",
      // The user reads, edits and clears what its runs keep (D-133).
      reply: async ({ param, body }) => {
        const { notes } = notesRequestSchema.parse(await body());
        const id = found(param("id")).id;
        automations.setNotes(id, notes);
        return { status: 200, json: automations.get(id) };
      },
    },
    {
      method: "POST",
      path: "/automations/:id/run",
      reply: ({ param }) => {
        const run = runner.runNow(found(param("id")).id);
        if (run === undefined)
          throw new RequestError(409, "conflict", "It is already running now.");
        return { status: 201, json: run };
      },
    },
    {
      method: "GET",
      path: "/automations/:id/runs",
      reply: ({ param, query }) => ({
        status: 200,
        json: automations.runs(
          found(param("id")).id,
          runPageQuerySchema.parse(Object.fromEntries(query)),
        ),
      }),
    },
    {
      method: "POST",
      path: "/automation-runs/:id/cancel",
      reply: ({ param }) => {
        if (automations.getRun(param("id")) === undefined) {
          throw new RecordNotFoundError("run");
        }
        runner.cancel(param("id"));
        return { status: 204 };
      },
    },
  ];
}
