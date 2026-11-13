import type { TokenUsage } from "@office-town/contract";
import { z } from "zod";
import type { RecountSupport } from "../../adapter.ts";

const tokensSchema = z.looseObject({
  input: z.number(),
  output: z.number(),
  reasoning: z.number().optional(),
  cache: z.looseObject({ read: z.number(), write: z.number() }).optional(),
});
type Tokens = z.infer<typeof tokensSchema>;

function totalOf(steps: Tokens[]): TokenUsage {
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  for (const { input, output, reasoning, cache } of steps) {
    usage.inputTokens += input + (cache?.read ?? 0) + (cache?.write ?? 0);
    usage.outputTokens += output + (reasoning ?? 0);
    usage.cachedInputTokens += cache?.read ?? 0;
  }
  return usage;
}

// Anything it logs comes before the JSON.
const jsonOf = (text: string): unknown => JSON.parse(text.slice(text.indexOf("{")));

const exportSchema = z.looseObject({
  messages: z.array(
    z.looseObject({
      info: z.looseObject({ role: z.string(), tokens: tokensSchema.optional() }),
      parts: z.array(z.looseObject({ type: z.string() })).optional(),
    }),
  ),
});
const childSchema = z.looseObject({
  tool: z.literal("task"),
  state: z.looseObject({ metadata: z.looseObject({ sessionId: z.string().min(1) }) }),
});

// Every model step is its own assistant message, while a turn's ACP result reports only the last
// one, so the whole conversation is read back from its export. Sub-agents ran in sessions of their
// own, named by their task tool calls.
export const recount: RecountSupport = {
  command: (conversationId) => ({ binary: "opencode", args: ["export", conversationId] }),
  parse(text) {
    const { messages } = exportSchema.parse(jsonOf(text));
    const steps = messages.flatMap(({ info }) =>
      info.role === "assistant" && info.tokens !== undefined ? [info.tokens] : [],
    );
    const children = messages.flatMap(({ parts = [] }) =>
      parts.flatMap((part) => {
        const child = childSchema.safeParse(part);
        return child.success ? [child.data.state.metadata.sessionId] : [];
      }),
    );
    return { usage: totalOf(steps), children };
  },
};

const export2Schema = z.looseObject({
  messages: z.array(
    z.looseObject({
      type: z.string(),
      tokens: tokensSchema.optional(),
      content: z.array(z.looseObject({ type: z.string() })).optional(),
    }),
  ),
});
const child2Schema = z.looseObject({
  name: z.literal("subagent"),
  state: z.looseObject({ metadata: z.looseObject({ sessionID: z.string().min(1) }) }),
});

// OpenCode 2 names sub-agents' sessions on its subagent tool calls. A private server, so the call
// neither starts nor reaches the user's background one (D-97).
export const recount2: RecountSupport = {
  command: (conversationId) => ({
    binary: "opencode",
    args: ["session", "export", conversationId, "--standalone"],
  }),
  parse(text) {
    const { messages } = export2Schema.parse(jsonOf(text));
    const steps = messages.flatMap(({ type, tokens }) =>
      type === "assistant" && tokens !== undefined ? [tokens] : [],
    );
    const children = messages.flatMap(({ content = [] }) =>
      content.flatMap((part) => {
        const child = child2Schema.safeParse(part);
        return child.success ? [child.data.state.metadata.sessionID] : [];
      }),
    );
    return { usage: totalOf(steps), children };
  },
};
