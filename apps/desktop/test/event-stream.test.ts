import { describe, expect, it, vi } from "vitest";
import { parseFrames } from "../src/api/event-stream.ts";

const event = (sequence: number, type: string, payload: object) =>
  JSON.stringify({
    id: crypto.randomUUID(),
    sessionId: "session-1",
    sequence,
    timestamp: "2026-10-04T12:00:00.000Z",
    type,
    payload,
  });

describe("event stream", () => {
  it("reads frames cut anywhere across chunks, and skips one it cannot read", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const text = [
      `id: 7\ndata: ${event(1, "turn.started", { turnId: "t1" })}\n\n`,
      `data: ${event(2, "message.delta", { text: "Hi" })}\n\n`,
      `id: 8\ndata: ${event(3, "no.such.type", {})}\n\n`,
      `id: 9\ndata: ${event(4, "turn.ended", { turnId: "t1", outcome: "completed" })}\n\n`,
    ].join("");

    const positions: (number | undefined)[] = [];
    let rest = "";
    for (let start = 0; start < text.length; start += 37) {
      const parsed = parseFrames(rest + text.slice(start, start + 37));
      rest = parsed.rest;
      positions.push(...parsed.frames.map((frame) => frame.position));
    }

    expect(positions).toEqual([7, undefined, 9]);
    expect(rest).toBe("");
  });
});
