import type { ServerResponse } from "node:http";
import type { Change } from "@office-town/contract";
import type { PublishedEvent, SessionRegistry } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";

const PAGE_SIZE = 500;
// A client this far behind is dropped and catches up from the store, so no backlog is unbounded.
const MAX_BEHIND_BYTES = 4 * 1024 * 1024;
const MAX_HELD_EVENTS = 10_000;

export interface StreamSource {
  registry: SessionRegistry;
  store: Store;
}

export interface StreamQuery {
  after?: number | undefined;
  session?: string | undefined;
  follow: boolean;
}

// Live only: a reconnecting client reads its records again.
interface ChangeFrame {
  change: Change;
}

type Frame = PublishedEvent | ChangeFrame;

// Fragments and changes carry no id, so a reconnecting client skips them.
function format(frame: Frame): string {
  if ("change" in frame) return `event: change\ndata: ${JSON.stringify(frame.change)}\n\n`;
  const id = frame.position === undefined ? "" : `id: ${frame.position}\n`;
  return `${id}data: ${JSON.stringify(frame.event)}\n\n`;
}

function drainedOrClosed(response: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      response.off("drain", done);
      response.off("close", done);
      resolve();
    };
    response.once("drain", done);
    response.once("close", done);
  });
}

// Live events are held while the store is read; positions already sent are skipped.
export async function streamEvents(
  response: ServerResponse,
  { registry, store }: StreamSource,
  { after, session, follow }: StreamQuery,
): Promise<void> {
  if (session !== undefined && store.getSession(session) === undefined) {
    throw new RecordNotFoundError("session", session);
  }
  let sent = after ?? 0;
  let held: Frame[] | undefined = after === undefined && follow ? undefined : [];
  const deliver = (frame: Frame): boolean => {
    if ("event" in frame && frame.position !== undefined) {
      if (frame.position <= sent) return true;
      sent = frame.position;
    }
    return response.write(format(frame));
  };

  const listen = (frame: Frame): void => {
    if (response.destroyed) return;
    if (session !== undefined && "event" in frame && frame.event.sessionId !== session) return;
    if (held !== undefined) {
      held.push(frame);
      if (held.length > MAX_HELD_EVENTS) response.destroy();
      return;
    }
    if (!deliver(frame) && response.writableLength > MAX_BEHIND_BYTES) response.destroy();
  };
  if (follow) response.on("close", registry.subscribe(listen));
  if (follow && session === undefined) {
    response.on(
      "close",
      store.subscribe((change) => listen({ change })),
    );
  }
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  response.flushHeaders();
  if (held === undefined) return;

  const sessionId = session === undefined ? {} : { sessionId: session };
  while (!response.destroyed) {
    const page = store.readEvents({ after: sent, limit: PAGE_SIZE, ...sessionId });
    const flowing = page.map(deliver).every(Boolean);
    if (page.length < PAGE_SIZE) break;
    if (!flowing) await drainedOrClosed(response);
  }
  if (!follow) {
    response.end();
    return;
  }
  if (response.destroyed) return;
  const caughtUp = held;
  held = undefined;
  for (const frame of caughtUp) deliver(frame);
}
