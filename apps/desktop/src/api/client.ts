import {
  type AgentCommand,
  type ApiError,
  apiErrorSchema,
  type EnvironmentList,
  type EnvironmentSpec,
  environmentListSchema,
  type HarnessCatalog,
  type HarnessDescription,
  harnessCatalogSchema,
  harnessDescriptionSchema,
  type PendingRequestList,
  pendingRequestListSchema,
  type SessionRecord,
  type Settings,
  type StartTaskRequest,
  sessionRecordSchema,
  settingsSchema,
  type TaskDetail,
  type TaskPage,
  taskDetailSchema,
  taskPageSchema,
  type WorkspaceRecord,
  type WorkspaceRequest,
  workspaceRecordSchema,
} from "@office-town/contract";

interface Schema<T> {
  parse(data: unknown): T;
}

function listOf<T>(schema: Schema<T>): Schema<T[]> {
  return {
    parse: (data) => {
      if (!Array.isArray(data))
        throw new Error("The core answered with something other than a list.");
      return data.map((item) => schema.parse(item));
    },
  };
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiError["error"];

  constructor(status: number, { error, message }: ApiError) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = error;
  }
}

// The page calls its own origin; the shell, or Vite in browser mode, forwards to the core (D-36).
async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.ok) return response;
  const error = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
  throw new ApiRequestError(
    response.status,
    error.success
      ? error.data
      : { error: "internal", message: `The core answered ${response.status}.` },
  );
}

async function read<T>(path: string, schema: Schema<T>): Promise<T> {
  return schema.parse(await (await call("GET", path)).json());
}

async function write<T>(method: string, path: string, body: unknown, schema: Schema<T>) {
  return schema.parse(await (await call(method, path, body)).json());
}

async function send(method: string, path: string, body?: unknown): Promise<void> {
  await call(method, path, body);
}

const id = encodeURIComponent;

function environmentQuery(environment: EnvironmentSpec): string {
  return environment.kind === "wsl"
    ? `environment=wsl&distro=${id(environment.distro)}`
    : "environment=native";
}

export const api = {
  listTasks: (cursor?: string): Promise<TaskPage> =>
    read(`/tasks${cursor === undefined ? "" : `?cursor=${id(cursor)}`}`, taskPageSchema),
  listActiveTasks: (): Promise<TaskPage> => read("/tasks?active=true", taskPageSchema),
  getTask: (taskId: string): Promise<TaskDetail> => read(`/tasks/${id(taskId)}`, taskDetailSchema),
  getSession: (sessionId: string): Promise<SessionRecord> =>
    read(`/sessions/${id(sessionId)}`, sessionRecordSchema),
  resume: (sessionId: string, prompt: string): Promise<SessionRecord> =>
    write("POST", `/sessions/${id(sessionId)}/resume`, { prompt }, sessionRecordSchema),
  command: (sessionId: string, command: AgentCommand): Promise<void> =>
    send("POST", `/sessions/${id(sessionId)}/commands`, command),
  stop: (sessionId: string): Promise<void> => send("POST", `/sessions/${id(sessionId)}/stop`),
  readResult: async (sessionId: string, sequence: number): Promise<string> =>
    (await call("GET", `/sessions/${id(sessionId)}/results/${sequence}`)).text(),
  listPendingRequests: (): Promise<PendingRequestList> =>
    read("/pending-requests", pendingRequestListSchema),
  startTask: (request: StartTaskRequest): Promise<SessionRecord> =>
    write("POST", "/tasks", request, sessionRecordSchema),
  listHarnesses: (): Promise<HarnessDescription[]> =>
    read("/harnesses", listOf(harnessDescriptionSchema)),
  readCatalog: (harness: string, environment: EnvironmentSpec): Promise<HarnessCatalog> =>
    read(
      `/harnesses/${id(harness)}/catalog?${environmentQuery(environment)}`,
      harnessCatalogSchema,
    ),
  listEnvironments: (): Promise<EnvironmentList> => read("/environments", environmentListSchema),
  listWorkspaces: (): Promise<WorkspaceRecord[]> =>
    read("/workspaces", listOf(workspaceRecordSchema)),
  createWorkspace: (workspace: WorkspaceRequest): Promise<WorkspaceRecord> =>
    write("POST", "/workspaces", workspace, workspaceRecordSchema),
  readSettings: (): Promise<Settings> => read("/settings", settingsSchema),
};
