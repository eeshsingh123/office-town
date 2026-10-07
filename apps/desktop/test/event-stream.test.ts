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
  it("reads frames cut anywhere across chunks, tells changes from events, and skips one it cannot read", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const text = [
      `id: 7\ndata: ${event(1, "turn.started", { turnId: "t1" })}\n\n`,
      `data: ${event(2, "message.delta", { text: "Hi" })}\n\n`,
      `event: change\ndata: ${JSON.stringify({ type: "task.deleted", taskId: "task-1" })}\n\n`,
      `id: 8\ndata: ${event(3, "no.such.type", {})}\n\n`,
      `id: 9\ndata: ${event(4, "turn.ended", { turnId: "t1", outcome: "completed" })}\n\n`,
    ].join("");

    const read: (number | string | undefined)[] = [];
    let rest = "";
    for (let start = 0; start < text.length; start += 37) {
      const parsed = parseFrames(rest + text.slice(start, start + 37));
      rest = parsed.rest;
      read.push(
        ...parsed.frames.map((frame) => ("change" in frame ? frame.change.type : frame.position)),
      );
    }

    expect(read).toEqual([7, undefined, "task.deleted", 9]);
    expect(rest).toBe("");
  });
});
