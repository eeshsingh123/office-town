import {
  agentCommandSchema,
  agentMessageRequestSchema,
  chiefRequestSchema,
  chiefTaskRequestSchema,
  continueTaskRequestSchema,
  departmentSettingsSchema,
  environmentSpecSchema,
  newDepartmentRequestSchema,
  profileRequestSchema,
  renameAgentRequestSchema,
  resumeSessionRequestSchema,
  roomPositionSchema,
  secondOpinionRequestSchema,
  sessionPageQuerySchema,
  startTaskRequestSchema,
  startTeamTaskRequestSchema,
  taskListQuerySchema,
  teamSchema,
  workspaceRequestSchema,
} from "@office-town/contract";
import { listEnvironments, listHarnesses } from "@office-town/harness";
import { z } from "zod";
import { createAgent, settingsOf } from "../agents/agents.ts";
import { soloMessage } from "../agents/briefs.ts";
import { sessionOptionsFor } from "../agents/options.ts";
import { chiefOf, isChiefTask, saveChief } from "../chief/chief.ts";
import { startChiefGoal, stopChiefGoal } from "../chief/goals.ts";
import { RecordNotFoundError, TaskActiveError } from "../store/store.ts";
import { chooseTaskFolders, requireFolders } from "../task-folders.ts";
import { startFirstAgent } from "../task-start.ts";
import { changeTeam, createDepartment, updateDepartment } from "../team/departments.ts";
import { messageAgent } from "../team/direct-message.ts";
import type { TeamContext } from "../team/members.ts";
import { removeCopies, secondOpinion, workspaceEntries } from "../team/outsource.ts";
import { claimDepartment, continueTeam, startTeamTask, stopTeam } from "../team/team-tasks.ts";
import { removeWorktrees } from "../team/worktrees.ts";
import { RequestError } from "./errors.ts";

const isRunning = (session: { status: string }) =>
  session.status === "starting" || session.status === "running";

export interface RouteRequest {
  // A path parameter; the router only calls a route when all of them are present.
  param(name: string): string;
  query: URLSearchParams;
  body(): Promise<unknown>;
}

export type Reply =
  | { status: 200 | 201; json: unknown }
  | { status: 200; text: string }
  | { status: 204 };

export interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  // Segments starting with ":" are parameters.
  path: string;
  reply(request: RouteRequest): Reply | Promise<Reply>;
}

const NO_CONTENT = { status: 204 } as const;

const sequenceSchema = z.coerce.number().int().positive();

export function apiRoutes(team: TeamContext): Route[] {
  const { registry, store, readCatalog } = team;
  return [
    {
      method: "POST",
      path: "/tasks",
      reply: async ({ body }) => {
        const request = startTaskRequestSchema.parse(await body());
        const folders = chooseTaskFolders(store, request);
        const agent = createAgent(store, request.agent, { autonomy: request.autonomy });
        const task = store.createTask(request.prompt);
        const session = await startFirstAgent(store, task.id, () =>
          registry.start({
            taskId: task.id,
            agentId: agent.id,
            options: sessionOptionsFor(store, agent, folders),
            message: soloMessage(request.prompt, settingsOf(store, agent)),
          }),
        );
        return { status: 201, json: session };
      },
    },
    {
      method: "POST",
      path: "/tasks/team",
      reply: async ({ body }) => ({
        status: 201,
        json: await startTeamTask(team, startTeamTaskRequestSchema.parse(await body())),
      }),
    },
    {
      method: "POST",
      path: "/tasks/chief",
      reply: async ({ body }) => ({
        status: 201,
        json: await startChiefGoal(team, chiefTaskRequestSchema.parse(await body()).goal),
      }),
    },
    {
      method: "GET",
      path: "/tasks",
      reply: ({ query }) => {
        const { limit, cursor, active } = taskListQuerySchema.parse(Object.fromEntries(query));
        if (active) return { status: 200, json: { tasks: store.listActiveTasks() } };
        return {
          status: 200,
          json: store.listTasks(cursor === undefined ? { limit } : { limit, cursor }),
        };
      },
    },
    {
      method: "GET",
      path: "/tasks/:id",
      reply: ({ param }) => {
        const id = param("id");
        const task = store.getTask(id);
        if (task === undefined) throw new RecordNotFoundError("task", id);
        return { status: 200, json: { task, sessions: store.listSessions(id) } };
      },
    },
    {
      method: "DELETE",
      path: "/tasks/:id",
      reply: async ({ param }) => {
        if (store.listSessions(param("id")).some(isRunning)) {
          throw new TaskActiveError(param("id"));
        }
        await removeWorktrees(team, param("id"));
        removeCopies(team, param("id"));
        await store.deleteTask(param("id"));
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: "/tasks/:id/stop",
      reply: async ({ param }) => {
        if (isChiefTask(store, param("id"))) await stopChiefGoal(team, param("id"));
        else await stopTeam(team, param("id"));
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: "/tasks/:id/second-opinion",
      reply: async ({ param, body }) => ({
        status: 201,
        json: await secondOpinion(
          team,
          param("id"),
          secondOpinionRequestSchema.parse(await body()),
        ),
      }),
    },
    {
      method: "GET",
      path: "/tasks/:id/plan",
      reply: ({ param }) => ({ status: 200, json: store.listPieces(param("id")) }),
    },
    {
      method: "GET",
      path: "/tasks/:id/delegations",
      reply: ({ param }) => ({ status: 200, json: store.listDelegations(param("id")) }),
    },
    {
      method: "POST",
      path: "/tasks/:id/reviewed",
      reply: ({ param }) => {
        const task = store.getTask(param("id"));
        if (task === undefined) throw new RecordNotFoundError("task", param("id"));
        if (task.state !== "ended") {
          throw new RequestError(409, "conflict", "Only a finished goal can be marked reviewed.");
        }
        return { status: 200, json: store.markReviewed(task.id) };
      },
    },
    {
      method: "GET",
      path: "/tasks/:id/files",
      reply: ({ param, query }) => ({
        status: 200,
        json: workspaceEntries(team, param("id"), query.get("agent") ?? undefined),
      }),
    },
    {
      method: "POST",
      path: "/tasks/:id/continue",
      reply: async ({ param, body }) => {
        const { prompt } = continueTaskRequestSchema.parse(await body());
        return { status: 201, json: await continueTeam(team, param("id"), prompt) };
      },
    },
    {
      method: "GET",
      path: "/sessions/:id",
      reply: ({ param }) => {
        const session = store.getSession(param("id"));
        if (session === undefined) throw new RecordNotFoundError("session", param("id"));
        return { status: 200, json: session };
      },
    },
    {
      method: "POST",
      path: "/sessions/:id/resume",
      reply: async ({ param, body }) => {
        const { prompt } = resumeSessionRequestSchema.parse(await body());
        const taskId = store.getSession(param("id"))?.taskId;
        const resume = () => registry.resume(param("id"), { text: prompt });
        const json =
          taskId === undefined
            ? await resume()
            : await claimDepartment(team, store.getTask(taskId)?.departmentId, taskId, resume);
        return { status: 201, json };
      },
    },
    {
      method: "POST",
      path: "/sessions/:id/commands",
      reply: async ({ param, body }) => {
        await registry.send(param("id"), agentCommandSchema.parse(await body()));
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: "/sessions/:id/stop",
      reply: async ({ param }) => {
        await registry.stop(param("id"));
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: "/sessions/:id/results/:sequence",
      reply: ({ param }) => ({
        status: 200,
        text: store.readOverflow(param("id"), sequenceSchema.parse(param("sequence"))),
      }),
    },
    {
      method: "GET",
      path: "/pending-requests",
      reply: () => ({ status: 200, json: store.listPendingRequests() }),
    },
    {
      method: "GET",
      path: "/agents",
      reply: () => ({ status: 200, json: store.listAgents() }),
    },
    {
      method: "GET",
      path: "/agents/:id",
      reply: ({ param }) => {
        const agent = store.getAgent(param("id"));
        if (agent === undefined) throw new RecordNotFoundError("agent", param("id"));
        return { status: 200, json: agent };
      },
    },
    {
      method: "GET",
      path: "/agents/:id/sessions",
      reply: ({ param, query }) => {
        const { limit, before } = sessionPageQuerySchema.parse(Object.fromEntries(query));
        return {
          status: 200,
          json: store.listAgentSessions(
            param("id"),
            before === undefined ? { limit } : { limit, before },
          ),
        };
      },
    },
    {
      method: "POST",
      path: "/agents/:id/messages",
      reply: async ({ param, body }) => {
        const { text, taskId } = agentMessageRequestSchema.parse(await body());
        await messageAgent(team, param("id"), text, taskId);
        return NO_CONTENT;
      },
    },
    {
      method: "PUT",
      path: "/agents/:id/name",
      reply: async ({ param, body }) => {
        const { name } = renameAgentRequestSchema.parse(await body());
        return { status: 200, json: store.renameAgent(param("id"), name) };
      },
    },
    {
      method: "GET",
      path: "/chief",
      reply: () => {
        const chief = chiefOf(store);
        if (chief === undefined) throw new RecordNotFoundError("agent", "chief");
        return { status: 200, json: chief };
      },
    },
    {
      method: "PUT",
      path: "/chief",
      reply: async ({ body }) => ({
        status: 200,
        json: saveChief(store, chiefRequestSchema.parse(await body()).settings),
      }),
    },
    {
      method: "GET",
      path: "/departments",
      reply: () => ({ status: 200, json: store.listDepartments() }),
    },
    {
      method: "POST",
      path: "/departments",
      reply: async ({ body }) => ({
        status: 201,
        json: createDepartment(team, newDepartmentRequestSchema.parse(await body())),
      }),
    },
    {
      method: "PUT",
      path: "/departments/:id",
      reply: async ({ param, body }) => ({
        status: 200,
        json: updateDepartment(team, param("id"), departmentSettingsSchema.parse(await body())),
      }),
    },
    {
      method: "PUT",
      path: "/departments/:id/team",
      reply: async ({ param, body }) => ({
        status: 200,
        json: await changeTeam(team, param("id"), teamSchema.parse(await body())),
      }),
    },
    {
      method: "POST",
      path: "/profiles",
      reply: async ({ body }) => ({
        status: 201,
        json: store.createProfile(profileRequestSchema.parse(await body())),
      }),
    },
    {
      method: "GET",
      path: "/profiles",
      reply: () => ({ status: 200, json: store.listProfiles() }),
    },
    {
      method: "PUT",
      path: "/profiles/:id",
      reply: async ({ param, body }) => ({
        status: 200,
        json: store.updateProfile(param("id"), profileRequestSchema.parse(await body())),
      }),
    },
    {
      method: "DELETE",
      path: "/profiles/:id",
      reply: ({ param }) => {
        store.deleteProfile(param("id"));
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: "/workspaces",
      reply: async ({ body }) => {
        const workspace = workspaceRequestSchema.parse(await body());
        requireFolders(workspace.folders);
        return { status: 201, json: store.createWorkspace(workspace) };
      },
    },
    {
      method: "GET",
      path: "/workspaces",
      reply: () => ({ status: 200, json: store.listWorkspaces() }),
    },
    {
      method: "PUT",
      path: "/workspaces/:id",
      reply: async ({ param, body }) => {
        const workspace = workspaceRequestSchema.parse(await body());
        requireFolders(workspace.folders);
        return { status: 200, json: store.updateWorkspace(param("id"), workspace) };
      },
    },
    {
      method: "DELETE",
      path: "/workspaces/:id",
      reply: ({ param }) => {
        store.deleteWorkspace(param("id"));
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: "/settings",
      reply: () => ({ status: 200, json: store.readSettings() }),
    },
    {
      method: "PUT",
      path: "/room-positions/:roomId",
      reply: async ({ param, body }) => {
        const roomId = param("roomId");
        if (roomId !== "chief" && store.getDepartment(roomId) === undefined) {
          throw new RecordNotFoundError("department", roomId);
        }
        const position = roomPositionSchema.parse(await body());
        const positions = store.readSettings().roomPositions ?? {};
        store.saveSettings({ roomPositions: { ...positions, [roomId]: position } });
        return NO_CONTENT;
      },
    },
    {
      method: "DELETE",
      path: "/room-positions/:roomId",
      reply: ({ param }) => {
        const positions = Object.entries(store.readSettings().roomPositions ?? {});
        const kept = positions.filter(([roomId]) => roomId !== param("roomId"));
        store.saveSettings({ roomPositions: Object.fromEntries(kept) });
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: "/harnesses",
      reply: () => ({ status: 200, json: listHarnesses() }),
    },
    {
      method: "GET",
      path: "/environments",
      reply: async () => ({ status: 200, json: await listEnvironments() }),
    },
    {
      method: "GET",
      path: "/harnesses/:harness/catalog",
      reply: async ({ param, query }) => {
        const environment = environmentSpecSchema.parse({
          kind: query.get("environment") ?? "native",
          distro: query.get("distro") ?? undefined,
        });
        return { status: 200, json: await readCatalog(param("harness"), environment) };
      },
    },
    {
      method: "GET",
      path: "/limits",
      reply: () => ({ status: 200, json: store.listLimits() }),
    },
    {
      method: "GET",
      path: "/storage",
      reply: async () => ({ status: 200, json: await store.size() }),
    },
  ];
}
