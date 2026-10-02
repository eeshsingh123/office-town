import { z } from "zod";

const idSchema = z.union([z.string(), z.number()]);
export type JsonRpcId = z.infer<typeof idSchema>;

const messageSchema = z.looseObject({
  jsonrpc: z.literal("2.0"),
  id: idSchema.nullish(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.looseObject({ code: z.number(), message: z.string() }).optional(),
});

export type JsonRpcIncoming =
  | { kind: "request"; id: JsonRpcId; method: string; params: unknown }
  | { kind: "notification"; method: string; params: unknown }
  | { kind: "result"; method: string; result: unknown }
  | { kind: "error"; method: string; message: string };

export const METHOD_NOT_FOUND = -32601;

// Encodes and decodes JSON-RPC 2.0 lines and pairs responses with the requests that caused them.
// It does no I/O: the caller writes the returned lines and feeds it the lines it reads.
export class JsonRpcPeer {
  #nextId = 1;
  readonly #pendingMethods = new Map<JsonRpcId, string>();

  request(method: string, params: unknown): string {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#pendingMethods.set(id, method);
    return JSON.stringify({ jsonrpc: "2.0", id, method, params });
  }

  notify(method: string, params: unknown): string {
    return JSON.stringify({ jsonrpc: "2.0", method, params });
  }

  respond(id: JsonRpcId, result: unknown): string {
    return JSON.stringify({ jsonrpc: "2.0", id, result });
  }

  reject(id: JsonRpcId, code: number, message: string): string {
    return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  }

  parse(line: string): JsonRpcIncoming {
    const message = messageSchema.parse(JSON.parse(line));
    const { id, method } = message;
    if (method !== undefined) {
      return id === undefined || id === null
        ? { kind: "notification", method, params: message.params }
        : { kind: "request", id, method, params: message.params };
    }
    const requested = id === undefined || id === null ? undefined : this.#pendingMethods.get(id);
    if (id === undefined || id === null || requested === undefined) {
      throw new Error("Received a response to a request that was never sent.");
    }
    this.#pendingMethods.delete(id);
    return message.error === undefined
      ? { kind: "result", method: requested, result: message.result }
      : { kind: "error", method: requested, message: message.error.message };
  }
}
