import type { ActionKind, PermissionOption, PlanStep, Question } from "@office-town/contract";
import {
  type AdapterEvent,
  type AnsweredQuestion,
  attachedTool,
  type Translation,
  type Translator,
} from "../../adapter.ts";
import {
  type AskedQuestion,
  assistantSchema,
  controlCancelSchema,
  controlRequestSchema,
  headerSchema,
  initSchema,
  type PermissionSuggestion,
  permissionRequestSchema,
  permissionSuggestionSchema,
  questionsInputSchema,
  rateLimitSchema,
  resultSchema,
  streamEventSchema,
  type TaskUpdateInput,
  type ToolResult,
  type ToolResultContent,
  type ToolUse,
  taskCreatedSchema,
  taskCreateInputSchema,
  taskNotificationSchema,
  taskStartedSchema,
  taskUpdatedSchema,
  taskUpdateFieldsSchema,
  taskUpdateInputSchema,
  textBlockSchema,
  thinkingBlockSchema,
  toolResultSchema,
  toolUseSchema,
  userSchema,
} from "./messages.ts";

interface PendingPermission {
  input: Record<string, unknown>;
  standingChanges: StandingChange[];
  isQuestion: boolean;
}

// A change the CLI offers to make so that it stops asking, with what it means for the user.
interface StandingChange {
  suggestion: unknown;
  description: string;
}

const ACTION_KINDS: Record<string, ActionKind> = {
  Read: "read",
  Write: "edit",
  Edit: "edit",
  NotebookEdit: "edit",
  Glob: "search",
  Grep: "search",
  ToolSearch: "search",
  Bash: "execute",
  PowerShell: "execute",
  WebFetch: "fetch",
  WebSearch: "fetch",
  Agent: "delegate",
  Task: "delegate",
};

const PLAN_TOOLS = new Set(["TaskCreate", "TaskUpdate"]);
const QUESTION_TOOL = "AskUserQuestion";
const LOCATION_FIELDS = ["file_path", "notebook_path", "path"];
const TITLE_FIELDS = ["description", "file_path", "pattern", "command", "url", "query"];
const STEP_STATUSES = new Set<string>(["pending", "in_progress", "completed"]);

const PERMISSION_OPTIONS = {
  allow: { optionId: "allow", label: "Allow once", kind: "allow_once" },
  deny: { optionId: "deny", label: "Deny", kind: "reject_once" },
} satisfies Record<string, PermissionOption>;

function describeSuggestion(suggestion: PermissionSuggestion): string | undefined {
  if (suggestion.type === "setMode" && suggestion.mode !== undefined) {
    return suggestion.mode === "acceptEdits"
      ? "allow all file edits"
      : `switch to "${suggestion.mode}" mode`;
  }
  if (suggestion.type === "addRules" && suggestion.behavior === "allow" && suggestion.rules) {
    const rules = suggestion.rules.map((rule) =>
      rule.ruleContent === undefined ? rule.toolName : `${rule.toolName} (${rule.ruleContent})`,
    );
    return `always allow ${rules.join(", ")}`;
  }
  if (suggestion.type === "addDirectories" && suggestion.directories) {
    return `allow access to ${suggestion.directories.join(", ")}`;
  }
  return undefined;
}

// Only changes that end with the session and that we can put into words are offered: a change
// written to a settings file would outlive the session, and the user must know what they accept.
function standingChangesOf(suggestions: unknown[]): StandingChange[] {
  return suggestions.flatMap((suggestion) => {
    const parsed = permissionSuggestionSchema.safeParse(suggestion);
    if (!parsed.success || parsed.data.destination !== "session") return [];
    const description = describeSuggestion(parsed.data);
    return description === undefined ? [] : [{ suggestion, description }];
  });
}

function allowAlwaysOption(changes: StandingChange[]): PermissionOption {
  const descriptions = changes.map((change) => change.description).join(", and ");
  const label = `${descriptions.charAt(0).toUpperCase()}${descriptions.slice(1)} for this session`;
  return { optionId: "allow_always", label, kind: "allow_always" };
}

function titleOf(name: string, input: Record<string, unknown>): string {
  const detail = TITLE_FIELDS.map((field) => input[field]).find((v) => typeof v === "string");
  return detail === undefined ? name : `${name}: ${detail}`;
}

function locationsOf(input: Record<string, unknown>): { locations?: string[] } {
  const locations = LOCATION_FIELDS.map((field) => input[field]).filter(
    (v) => typeof v === "string",
  );
  return locations.length > 0 ? { locations } : {};
}

function textOf(content: ToolResultContent | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content.map((part) => part.text ?? `[${part.type}]`).join("\n");
}

function parentOf(parentToolUseId: string | null | undefined): { parentActionId?: string } {
  return typeof parentToolUseId === "string" ? { parentActionId: parentToolUseId } : {};
}

function questionOf(question: AskedQuestion, index: number): Question {
  return {
    questionId: String(index + 1),
    text: question.question,
    ...(question.header === undefined ? {} : { header: question.header }),
    options: (question.options ?? []).map(({ label, description }) => ({
      label,
      ...(description === undefined ? {} : { description }),
    })),
    multiSelect: question.multiSelect ?? false,
  };
}

function translated(events: AdapterEvent[], outgoing: string[] = []): Translation {
  return { events, outgoing };
}

export class ClaudeTranslator implements Translator {
  readonly #toolServers: readonly { name: string }[];
  #sessionStarted = false;
  #interrupts = 0;
  #steps: PlanStep[] = [];
  readonly #planCalls = new Map<string, ToolUse>();
  readonly #backgroundActions = new Set<string>();
  readonly #pendingPermissions = new Map<string, PendingPermission>();

  readonly #handlers: Record<string, (message: unknown) => Translation> = {
    "system/init": (message) => this.#init(message),
    "system/task_started": (message) => this.#taskStarted(message),
    "system/task_notification": (message) => this.#taskNotification(message),
    stream_event: (message) => this.#streamEvent(message),
    assistant: (message) => this.#assistant(message),
    user: (message) => this.#user(message),
    control_request: (message) => this.#controlRequest(message),
    control_cancel_request: (message) => this.#controlCancel(message),
    rate_limit_event: (message) => this.#rateLimit(message),
    result: (message) => this.#result(message),
  };

  constructor(toolServers: readonly { name: string }[] = []) {
    this.#toolServers = toolServers;
  }

  open(): string[] {
    return [];
  }

  receive(line: string): Translation {
    const message: unknown = JSON.parse(line);
    const { type, subtype } = headerSchema.parse(message);
    const handler = this.#handlers[`${type}/${subtype}`] ?? this.#handlers[type];
    return handler === undefined ? translated([]) : handler(message);
  }

  prompt(text: string): Translation {
    return translated(
      [],
      [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: text },
          parent_tool_use_id: null,
          session_id: "",
        }),
      ],
    );
  }

  answerPermission(requestId: string, option: PermissionOption): Translation {
    const pending = this.#pendingPermissions.get(requestId);
    if (pending === undefined) throw new Error(`Unknown permission request "${requestId}".`);
    this.#pendingPermissions.delete(requestId);
    const allow = { behavior: "allow", updatedInput: pending.input };
    const decisions: Record<PermissionOption["kind"], object> = {
      allow_once: allow,
      allow_always: {
        ...allow,
        updatedPermissions: pending.standingChanges.map((change) => change.suggestion),
      },
      reject_once: { behavior: "deny", message: "The user denied this action." },
      reject_always: { behavior: "deny", message: "The user denied this action." },
    };
    return translated(
      [],
      [
        JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: decisions[option.kind],
          },
        }),
      ],
    );
  }

  // The CLI asks a question as a tool it needs permission for, and takes the answers as part of
  // the allowed input: question text to chosen labels.
  answerQuestion(requestId: string, answered: AnsweredQuestion[]): Translation {
    const pending = this.#pendingPermissions.get(requestId);
    if (pending === undefined) throw new Error(`Unknown question "${requestId}".`);
    this.#pendingPermissions.delete(requestId);
    const answers = Object.fromEntries(
      answered.map(({ question, selected }) => [question.text, selected.join(", ")]),
    );
    const response = { behavior: "allow", updatedInput: { ...pending.input, answers } };
    return translated(
      [],
      [
        JSON.stringify({
          type: "control_response",
          response: { subtype: "success", request_id: requestId, response },
        }),
      ],
    );
  }

  interrupt(): Translation {
    this.#interrupts += 1;
    return translated(
      [],
      [
        JSON.stringify({
          type: "control_request",
          request_id: `interrupt-${this.#interrupts}`,
          request: { subtype: "interrupt" },
        }),
      ],
    );
  }

  // The CLI reports init at the start of every turn, not only the first.
  #init(message: unknown): Translation {
    const init = initSchema.parse(message);
    const events: AdapterEvent[] = [];
    if (!this.#sessionStarted) {
      this.#sessionStarted = true;
      events.push({
        type: "session.started",
        payload: {
          harnessSessionId: init.session_id,
          ...(init.model === undefined ? {} : { model: init.model }),
        },
      });
    }
    events.push({ type: "turn.started" });
    return translated(events);
  }

  // Every streamed line, tool input included, is repeated whole by the `assistant` line after it.
  #streamEvent(message: unknown): Translation {
    return { events: this.#fragments(message), outgoing: [], partial: true };
  }

  #fragments(message: unknown): AdapterEvent[] {
    const { event, parent_tool_use_id } = streamEventSchema.parse(message);
    if (event.type !== "content_block_delta") return [];
    const parent = parentOf(parent_tool_use_id);
    const { text, thinking } = event.delta ?? {};
    if (text) return [{ type: "message.delta", payload: { text, ...parent } }];
    if (thinking) return [{ type: "reasoning.delta", payload: { text: thinking, ...parent } }];
    return [];
  }

  #assistant(message: unknown): Translation {
    const { message: body, parent_tool_use_id } = assistantSchema.parse(message);
    const parent = parentOf(parent_tool_use_id);
    const events: AdapterEvent[] = [];
    for (const block of body.content) {
      if (block.type === "text") {
        const { text } = textBlockSchema.parse(block);
        events.push({ type: "message", payload: { role: "assistant", text, ...parent } });
      } else if (block.type === "thinking") {
        const { thinking } = thinkingBlockSchema.parse(block);
        if (thinking !== "")
          events.push({ type: "reasoning", payload: { text: thinking, ...parent } });
      } else if (block.type === "tool_use") {
        events.push(...this.#toolUse(toolUseSchema.parse(block), parent));
      }
    }
    return translated(events);
  }

  #toolUse(block: ToolUse, parent: { parentActionId?: string }): AdapterEvent[] {
    if (PLAN_TOOLS.has(block.name)) {
      this.#planCalls.set(block.id, block);
      return [];
    }
    const tool = attachedTool(block.name, this.#toolServers, (server) => `mcp__${server}__`);
    return [
      {
        type: "action.started",
        payload: {
          actionId: block.id,
          kind: ACTION_KINDS[block.name] ?? "other",
          title: titleOf(block.name, block.input),
          input: block.input,
          ...locationsOf(block.input),
          ...parent,
          ...(tool === undefined ? {} : { tool }),
        },
      },
    ];
  }

  #user(message: unknown): Translation {
    const { message: body, tool_use_result: recorded } = userSchema.parse(message);
    if (typeof body.content === "string") return translated([]);
    const events: AdapterEvent[] = [];
    for (const block of body.content) {
      if (block.type === "tool_result") {
        events.push(...this.#toolResult(toolResultSchema.parse(block), recorded));
      }
    }
    return translated(events);
  }

  #toolResult(block: ToolResult, recorded: unknown): AdapterEvent[] {
    const planCall = this.#planCalls.get(block.tool_use_id);
    if (planCall !== undefined) {
      this.#planCalls.delete(block.tool_use_id);
      return block.is_error ? [] : this.#applyPlanCall(planCall, textOf(block.content), recorded);
    }
    // A background sub-agent's tool result only confirms the launch; it ends on its notification.
    if (this.#backgroundActions.has(block.tool_use_id)) return [];
    return [
      {
        type: "action.ended",
        payload: {
          actionId: block.tool_use_id,
          outcome: block.is_error ? "failed" : "completed",
          result: textOf(block.content),
        },
      },
    ];
  }

  #applyPlanCall(call: ToolUse, result: string, recorded: unknown): AdapterEvent[] {
    if (call.name === "TaskCreate") {
      const created = taskCreatedSchema.safeParse(recorded);
      const { id, subject } = created.success
        ? created.data.task
        : {
            id: /#(\d+)/.exec(result)?.[1] ?? String(this.#steps.length + 1),
            subject: taskCreateInputSchema.parse(call.input).subject,
          };
      this.#steps = [...this.#steps, { id, title: subject, status: "pending" }];
    } else {
      const update = this.#taskUpdate(call.input, recorded);
      this.#steps = this.#steps
        .filter((step) => !(step.id === update.taskId && update.status === "deleted"))
        .map((step) => (step.id === update.taskId ? this.#updatedStep(step, update) : step));
    }
    return [{ type: "plan.updated", payload: { steps: this.#steps } }];
  }

  #taskUpdate(input: unknown, recorded: unknown): TaskUpdateInput {
    const updated = taskUpdatedSchema.safeParse(recorded);
    if (!updated.success) return taskUpdateInputSchema.parse(input);
    const { status, subject } = taskUpdateFieldsSchema.parse(input);
    return {
      taskId: updated.data.taskId,
      status: updated.data.statusChange?.to ?? status,
      subject,
    };
  }

  #updatedStep(step: PlanStep, update: TaskUpdateInput): PlanStep {
    const status = STEP_STATUSES.has(update.status ?? "") ? update.status : step.status;
    return { ...step, title: update.subject ?? step.title, status: status as PlanStep["status"] };
  }

  #taskStarted(message: unknown): Translation {
    const task = taskStartedSchema.parse(message);
    if (task.is_backgrounded && task.tool_use_id !== undefined) {
      this.#backgroundActions.add(task.tool_use_id);
    }
    return translated([]);
  }

  #taskNotification(message: unknown): Translation {
    const task = taskNotificationSchema.parse(message);
    if (task.tool_use_id === undefined || !this.#backgroundActions.delete(task.tool_use_id)) {
      return translated([]);
    }
    return translated([
      {
        type: "action.ended",
        payload: {
          actionId: task.tool_use_id,
          outcome: task.status === "completed" ? "completed" : "failed",
          result: task.summary ?? task.status,
        },
      },
    ]);
  }

  #controlRequest(message: unknown): Translation {
    const { request_id, request } = controlRequestSchema.parse(message);
    if (request.subtype !== "can_use_tool") {
      const error = `Unsupported control request "${request.subtype}".`;
      const response = { subtype: "error", request_id, error };
      return translated([], [JSON.stringify({ type: "control_response", response })]);
    }
    const permission = permissionRequestSchema.parse(request);
    const action = permission.tool_use_id === undefined ? {} : { actionId: permission.tool_use_id };
    if (permission.tool_name === QUESTION_TOOL) {
      const { questions } = questionsInputSchema.parse(permission.input);
      this.#pendingPermissions.set(request_id, {
        input: permission.input,
        standingChanges: [],
        isQuestion: true,
      });
      const payload = { requestId: request_id, ...action, questions: questions.map(questionOf) };
      return translated([{ type: "question.requested", payload }]);
    }
    const standingChanges = standingChangesOf(permission.permission_suggestions ?? []);
    this.#pendingPermissions.set(request_id, {
      input: permission.input,
      standingChanges,
      isQuestion: false,
    });
    const name = permission.display_name ?? permission.tool_name;
    return translated([
      {
        type: "permission.requested",
        payload: {
          requestId: request_id,
          ...action,
          title: permission.description ? `${name}: ${permission.description}` : name,
          input: permission.input,
          options: [
            PERMISSION_OPTIONS.allow,
            ...(standingChanges.length > 0 ? [allowAlwaysOption(standingChanges)] : []),
            PERMISSION_OPTIONS.deny,
          ],
        },
      },
    ]);
  }

  #controlCancel(message: unknown): Translation {
    const { request_id } = controlCancelSchema.parse(message);
    const pending = this.#pendingPermissions.get(request_id);
    if (pending === undefined) return translated([]);
    this.#pendingPermissions.delete(request_id);
    const type = pending.isQuestion ? "question.resolved" : "permission.resolved";
    return translated([{ type, payload: { requestId: request_id, outcome: "cancelled" } }]);
  }

  // Reported for subscriptions only: the share of each usage window spent, and when it resets.
  #rateLimit(message: unknown): Translation {
    const windows = rateLimitSchema.parse(message).rate_limit_info.unifiedWindows ?? {};
    const limits = Object.entries(windows).map(([id, { utilization, resetsAt }]) => ({
      id,
      label: id.replaceAll("_", " "),
      usedFraction: utilization,
      ...(resetsAt === undefined ? {} : { resetsAt: new Date(resetsAt * 1000).toISOString() }),
    }));
    return translated(limits.length === 0 ? [] : [{ type: "limits.updated", payload: { limits } }]);
  }

  #result(message: unknown): Translation {
    const result = resultSchema.parse(message);
    const interrupted = result.terminal_reason?.startsWith("aborted") ?? false;
    const failed = result.is_error && !interrupted;
    const events: AdapterEvent[] = [];
    if (failed) {
      const text = result.result ?? `The turn ended with "${result.subtype}".`;
      events.push({ type: "error", payload: { message: text, fatal: false } });
    }
    const { usage } = result;
    const cached = usage?.cache_read_input_tokens ?? 0;
    events.push({
      type: "turn.ended",
      payload: {
        outcome: interrupted ? "interrupted" : failed ? "failed" : "completed",
        ...(usage === undefined
          ? {}
          : {
              usage: {
                inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + cached,
                outputTokens: usage.output_tokens,
                cachedInputTokens: cached,
              },
            }),
      },
    });
    return translated(events);
  }
}
