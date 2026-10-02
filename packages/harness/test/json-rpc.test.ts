import { describe, expect, it } from "vitest";
import { JsonRpcPeer } from "../src/json-rpc.ts";

describe("JsonRpcPeer", () => {
  it("pairs a response with the method that was requested", () => {
    const peer = new JsonRpcPeer();
    const first = JSON.parse(peer.request("a/first", { x: 1 }));
    const second = JSON.parse(peer.request("a/second", {}));

    expect(first).toEqual({ jsonrpc: "2.0", id: 1, method: "a/first", params: { x: 1 } });
    expect(peer.parse(JSON.stringify({ jsonrpc: "2.0", id: second.id, result: "ok" }))).toEqual({
      kind: "result",
      method: "a/second",
      result: "ok",
    });
    const failure = { jsonrpc: "2.0", id: first.id, error: { code: 1, message: "no" } };
    expect(peer.parse(JSON.stringify(failure))).toEqual({
      kind: "error",
      method: "a/first",
      message: "no",
    });
  });

  it("tells requests from notifications by the presence of an id", () => {
    const peer = new JsonRpcPeer();

    expect(peer.parse('{"jsonrpc":"2.0","id":0,"method":"ask","params":{"a":1}}')).toEqual({
      kind: "request",
      id: 0,
      method: "ask",
      params: { a: 1 },
    });
    expect(peer.parse('{"jsonrpc":"2.0","method":"tell"}')).toEqual({
      kind: "notification",
      method: "tell",
      params: undefined,
    });
  });

  it("rejects a response nobody asked for and anything that is not JSON-RPC", () => {
    const peer = new JsonRpcPeer();

    expect(() => peer.parse('{"jsonrpc":"2.0","id":9,"result":1}')).toThrow();
    expect(() => peer.parse('{"hello":"world"}')).toThrow();
  });
});
