import type { SessionEvent, SessionEventBody, SessionRecord } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import type { StreamedEvent } from "../src/api/event-stream.ts";
import { applyToRecords, type Records, waitingKey } from "../src/store/records.ts";

const session: SessionRecord = {
  id: "s1",
  taskId: "t1",
  options: { harness: "claude", environment: { kind: "native" }, permissionMode: "ask" },
  status: "starting",
  createdAt: "2026-10-04T12:00:00.000Z",
};

let position = 0;
function streamed(body: SessionEventBody): StreamedEvent {
  position += 1;
  const event = {
    id: `e${position}`,
    sessionId: "s1",
    sequence: position,
    timestamp: "2026-10-04T12:00:01.000Z",
    ...body,
  } as SessionEvent;
  return { position, event };
}

const asked = (requestId: string) =>
  streamed({
    type: "question.requested",
    payload: {
      requestId,
      questions: [{ questionId: "1", text: "Red or blue?", options: [], multiSelect: false }],
    },
  });

describe("records", () => {
  it("moves a session's status only forward, and drops a request once answered or ended", () => {
    const records: Records = { tasks: {}, sessions: { s1: session }, waiting: {} };
    const started = streamed({ type: "session.started", payload: { harnessSessionId: "h1" } });
    const ended = streamed({ type: "session.ended", payload: { reason: "exited", exitCode: 0 } });

    const running = applyToRecords(records, [started, asked("q1"), asked("q2")]);
    expect(running.sessions.s1?.status).toBe("running");
    expect(Object.keys(running.waiting)).toEqual([waitingKey("s1", "q1"), waitingKey("s1", "q2")]);

    const answered = applyToRecords(running, [
      streamed({ type: "question.resolved", payload: { requestId: "q1", outcome: "answered" } }),
    ]);
    expect(Object.keys(answered.waiting)).toEqual([waitingKey("s1", "q2")]);

    // Applied again after a newer record arrived, an older start must not reopen the session.
    const done = applyToRecords(applyToRecords(answered, [ended]), [started]);
    expect(done.sessions.s1).toMatchObject({ status: "exited", endedAt: ended.event.timestamp });
    expect(done.waiting).toEqual({});
  });
});
