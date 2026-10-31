import {
  agentCommandSchema,
  agentMessageRequestSchema,
  agentProfileRequestSchema,
  answerPermissionsRequestSchema,
  checkRequestSchema,
  chiefDraftRequestSchema,
  chiefRequestSchema,
  chiefTaskRequestSchema,
  connectorDraftRequestSchema,
  continueTaskRequestSchema,
  defaultAccountId,
  departmentDraftRequestSchema,
  departmentSettingsSchema,
  displaySchema,
  type EnvironmentSpec,
  environmentSpecSchema,
  type HarnessStatus,
  linkFolderRequestSchema,
  MAX_ATTACHMENT_BYTES,
  newDepartmentRequestSchema,
  onboardingSchema,
  profileRequestSchema,
  renameAgentRequestSchema,
  resumePausedRequestSchema,
  resumeSessionRequestSchema,
  roomPositionSchema,
  sessionPageQuerySchema,
  startTaskRequestSchema,
  startTeamTaskRequestSchema,
  taskListQuerySchema,
  teamSchema,
  userProfileSchema,
  workspaceRequestSchema,
} from "@office-town/contract";
import { listEnvironments, listHarnesses, readHarnessStatus } from "@office-town/harness";
import { z } from "zod";
import { rememberedSignIns } from "../accounts/accounts.ts";
import { accountRoutes } from "../accounts/routes.ts";
import { createAgent } from "../agents/agents.ts";
import { instructionsFor, soloMessage } from "../agents/briefs.ts";
import { sessionOptionsFor } from "../agents/options.ts";
import { fileKindOf, resolveAttachments } from "../attachments/attachments.ts";
import { chiefOf, isChiefTask, removeChief, saveChief } from "../chief/chief.ts";
import { startChiefGoal, stopChiefGoal } from "../chief/goals.ts";
import type { ConnectorHub } from "../connectors/hub.ts";
import { connectorRoutes } from "../connectors/routes.ts";
import { draftChief } from "../drafts/chief.ts";
import { draftConnector } from "../drafts/connectors.ts";
import { draftDepartments } from "../drafts/departments.ts";
import { libraryRoutes } from "../library/routes.ts";
import { type OutputServices, outputRoutes } from "../outputs/routes.ts";
import type { PriceList } from "../prices/prices.ts";
import { answerPermissions } from "../registry/answer-permissions.ts";
import { RecordNotFoundError, TaskActiveError } from "../store/store.ts";
import { foldersForTask, requireFolders, requireWorkspaceFolders } from "../task-folders.ts";
import { startFirstAgent } from "../task-start.ts";
import { modelChangedByUser } from "../team/change-worker.ts";
import type { Checks } from "../team/checks.ts";
import {
  changeTeam,
  createDepartment,
  removeDepartment,
  updateDepartment,
} from "../team/departments.ts";
import { messageAgent } from "../team/direct-message.ts";
import type { TeamContext } from "../team/members.ts";
import {
  claimDepartment,
  continueTeam,
  deleteTask,
  startTeamTask,
  stopTeam,
} from "../team/team-tasks.ts";
import type { UsagePauses } from "../team/usage-pause.ts";
import { workspaceUsage } from "../workspace-usage.ts";
import { RequestError } from "./errors.ts";
import { installRoutes } from "./install-routes.ts";

const isRunning = (session: { status: string }) =>
  session.status === "starting" || session.status === "running";

export interface RouteRequest {
  // A path parameter; the router only calls a route when all of them are present.
  param(name: string): string;
  query: URLSearchParams;
  body(): Promise<unknown>;
  // The raw body, refused past `limit` bytes.
  bytes(limit: number): Promise<Buffer>;
}

export type Reply =
  | { status: 200 | 201; json: unknown }
  | { status: 200; text: string }
  | { status: 200; bytes: Buffer; type: string; headers?: Record<string, string> }
  | { status: 204 };

export interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  // Segments starting with ":" are parameters.
  path: string;
  reply(request: RouteRequest): Reply | Promise<Reply>;
}

const NO_CONTENT = { status: 204 } as const;

const sequenceSchema = z.coerce.number().int().positive();

export function apiRoutes(
  team: TeamContext,
  connectors: ConnectorHub,
  pauses: UsagePauses,
  checks: Checks,
  outputs: OutputServices,
  prices: PriceList,
): Route[] {
  const { registry, store, readCatalog } = team;
  // A CLI that cannot say whether it is signed in counts as signed in once the app saw its
  // default login sign in, and as not signed in before, where it signs in through the browser.
  const withSeenSignIn = (status: HarnessStatus, environment: EnvironmentSpec) => {
    if (!status.installed || status.signedIn !== undefined) return status;
    const seen = rememberedSignIns(store).includes(defaultAccountId(status.harness, environment));
    if (seen) return { ...status, signedIn: true };
    const signIn = listHarnesses().find(({ harness }) => harness === status.harness)?.signIn;
    return signIn === "browser" ? { ...status, signedIn: false } : status;
  };
  return [
    ...accountRoutes(team, prices),
    ...installRoutes(),
    {
      method: "POST",
      path: "/accounts/:id/resume-paused",
      reply: async ({ param, body }) => {
        const { at } = resumePausedRequestSchema.parse(await body());
        await pauses.resume(param("id"), at);
        return NO_CONTENT;
      },
    },
    ...libraryRoutes(store),
    ...outputRoutes(team, outputs),
    ...connectorRoutes(store, connectors),
    {
      method: "POST",
      path: "/tasks",
      reply: async ({ body }) => {
        const request = startTaskRequestSchema.parse(await body());
        const attachments = resolveAttachments(store, request.attachments);
        const folders = foldersForTask(store, request.workspaceId);
        const agent = createAgent(store, request.agent, { autonomy: request.autonomy });
        const task = store.createTask(request.prompt, undefined, {
          workspaceId: request.workspaceId,
        });
        const session = await startFirstAgent(store, task.id, () =>
          registry.start({
            taskId: task.id,
            agentId: agent.id,
            options: sessionOptionsFor(store, agent, folders),
            message: {
              ...soloMessage(request.prompt, instructionsFor(store, agent), folders.scratch),
              attachments,
            },
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
      reply: async ({ body }) => {
        const { goal, attachments } = chiefTaskRequestSchema.parse(await body());
        return {
          status: 201,
          json: await startChiefGoal(team, goal, resolveAttachments(store, attachments)),
        };
      },
    },
    {
      method: "GET",
      path: "/tasks",
      reply: ({ query }) => {
        const { limit, cursor, active } = taskListQuerySchema.parse(Object.fromEntries(query));
        if (active) {
          // A paused task waits on the user as much as a running one.
          const running = store.listActiveTasks();
          const paused = store
            .listPausedTasks()
            .filter((task) => !running.some(({ id }) => id === task.id));
          return { status: 200, json: { tasks: [...running, ...paused] } };
        }
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
      // A chief's goal also waits for its pieces, or their results would reach no one.
      reply: async ({ param }) => {
        const pieceTasks = store
          .listPieces(param("id"))
          .flatMap((piece) => piece.pieceTaskId ?? []);
        if ([param("id"), ...pieceTasks].some((id) => store.listSessions(id).some(isRunning))) {
          throw new TaskActiveError(param("id"));
        }
        await deleteTask(team, param("id"));
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
      path: "/tasks/:id/checks",
      reply: async ({ param, body }) => ({
        status: 201,
        json: await checks.start(param("id"), checkRequestSchema.parse(await body())),
      }),
    },
    {
      method: "GET",
      path: "/tasks/:id/checks",
      reply: ({ param }) => ({ status: 200, json: store.listChecks(param("id")) }),
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
      method: "POST",
      path: "/tasks/:id/continue",
      reply: async ({ param, body }) => {
        const { prompt, attachments } = continueTaskRequestSchema.parse(await body());
        const given = resolveAttachments(store, attachments);
        return { status: 201, json: await continueTeam(team, param("id"), prompt, given) };
      },
    },
    {
      method: "POST",
      path: "/attachments",
      reply: async ({ query, bytes }) => {
        const name = query.get("name")?.trim() ?? "";
        if (name === "") throw new RequestError(400, "invalid_request", "A file needs a name.");
        const content = await bytes(MAX_ATTACHMENT_BYTES);
        return { status: 201, json: store.saveFile({ ...fileKindOf(name), name, content }) };
      },
    },
    {
      method: "POST",
      path: "/attachments/folder",
      reply: async ({ body }) => {
        const { path } = linkFolderRequestSchema.parse(await body());
        requireFolders([path]);
        return { status: 201, json: store.linkFolder(path) };
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
        const { prompt, attachments } = resumeSessionRequestSchema.parse(await body());
        const given = resolveAttachments(store, attachments);
        const taskId = store.getSession(param("id"))?.taskId;
        const resume = () => registry.resume(param("id"), { text: prompt, attachments: given });
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
      method: "POST",
      path: "/pending-requests/answer",
      reply: async ({ body }) => {
        const request = answerPermissionsRequestSchema.parse(await body());
        return { status: 200, json: await answerPermissions(registry, store, request) };
      },
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
        const { text, taskId, attachments } = agentMessageRequestSchema.parse(await body());
        const given = resolveAttachments(store, attachments);
        await messageAgent(team, param("id"), text, taskId, given);
        return NO_CONTENT;
      },
    },
    {
      method: "PUT",
      path: "/agents/:id",
      reply: async ({ param, body }) => {
        const agent = store.getAgent(param("id"));
        if (agent === undefined) throw new RecordNotFoundError("agent", param("id"));
        const { colour, purpose, settings } = agentProfileRequestSchema.parse(await body());
        const saved = store.updateAgent(agent.id, {
          ...agent,
          colour,
          purpose: purpose === "" ? undefined : purpose,
          settings,
        });
        const { model, effort } = agent.settings;
        if (settings.model !== model || settings.effort !== effort) {
          await modelChangedByUser(team, saved);
        }
        return { status: 200, json: saved };
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
      method: "DELETE",
      path: "/chief",
      reply: () => {
        removeChief(store);
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: "/drafts/departments",
      reply: async ({ body }) => ({
        status: 200,
        json: await draftDepartments(team, departmentDraftRequestSchema.parse(await body())),
      }),
    },
    {
      method: "POST",
      path: "/drafts/chief",
      reply: async ({ body }) => ({
        status: 200,
        json: await draftChief(team, chiefDraftRequestSchema.parse(await body())),
      }),
    },
    {
      method: "POST",
      path: "/drafts/connectors",
      reply: async ({ body }) => ({
        status: 200,
        json: await draftConnector(team, connectorDraftRequestSchema.parse(await body())),
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
      method: "DELETE",
      path: "/departments/:id",
      // ?history=delete also deletes its tasks and the agents that worked on nothing else.
      reply: async ({ param, query }) => {
        await removeDepartment(team, param("id"), query.get("history") === "delete");
        return NO_CONTENT;
      },
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
        requireWorkspaceFolders(workspace);
        return { status: 201, json: store.createWorkspace(workspace) };
      },
    },
    {
      method: "GET",
      path: "/workspaces",
      reply: () => ({ status: 200, json: store.listWorkspaces() }),
    },
    {
      method: "GET",
      path: "/workspaces/usage",
      reply: () => ({
        status: 200,
        json: store.listWorkspaces().map((workspace) => workspaceUsage(team, workspace)),
      }),
    },
    {
      method: "PUT",
      path: "/workspaces/:id",
      reply: async ({ param, body }) => {
        const workspace = workspaceRequestSchema.parse(await body());
        requireWorkspaceFolders(workspace);
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
      path: "/you",
      reply: async ({ body }) => {
        const you = userProfileSchema.parse(await body());
        store.saveSettings({ you });
        return { status: 200, json: you };
      },
    },
    {
      method: "PUT",
      path: "/onboarding",
      reply: async ({ body }) => {
        const onboarding = onboardingSchema.parse(await body());
        store.saveSettings({ onboarding });
        return { status: 200, json: onboarding };
      },
    },
    {
      method: "PUT",
      path: "/display",
      reply: async ({ body }) => {
        const display = displaySchema.parse(await body());
        store.saveSettings({ display });
        return { status: 200, json: display };
      },
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
      path: "/harnesses/status",
      reply: async () => {
        const native = { kind: "native" } as const;
        const statuses = await Promise.all(
          listHarnesses().map(({ harness }) => readHarnessStatus(harness, native)),
        );
        return { status: 200, json: statuses.map((status) => withSeenSignIn(status, native)) };
      },
    },
    {
      method: "GET",
      path: "/harnesses/:harness/status",
      reply: async ({ param, query }) => {
        const environment = environmentSpecSchema.parse({
          kind: query.get("environment") ?? "native",
          distro: query.get("distro") ?? undefined,
        });
        const status = await readHarnessStatus(param("harness"), environment);
        return { status: 200, json: withSeenSignIn(status, environment) };
      },
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
