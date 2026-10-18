import type { z } from "zod";

// Known from the token its session was given.
export interface Caller {
  sessionId: string;
  agentId: string;
  taskId: string;
}

// An MCP tool result; a connector's is passed on as its app made it.
export interface ToolResult {
  content: unknown[];
  isError?: boolean;
  structuredContent?: unknown;
}

// Returns at once; an outcome that waits on someone reaches the caller later as a message (D-39).
export interface Tool<Input = unknown> {
  name: string;
  description: string;
  input: z.ZodType<Input>;
  offeredTo(caller: Caller): boolean;
  call(input: Input, caller: Caller): string | ToolResult | Promise<string | ToolResult>;
}

// A tool as `tools/list` names it.
export interface ListedTool {
  name: string;
  description?: string;
  inputSchema: unknown;
  annotations?: unknown;
  title?: string;
}

// One MCP server on the tool server: the team's, the hub's, or a connector's (D-67).
export interface Endpoint {
  name: string;
  list(caller: Caller): ListedTool[];
  call(name: string, input: Record<string, unknown>, caller: Caller): Promise<ToolResult>;
}

// A refusal the agent can act on; it reads the message.
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function defineTool<Input>(tool: Tool<Input>): Tool {
  return tool as Tool;
}
