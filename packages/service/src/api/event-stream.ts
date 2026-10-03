import type { ServerResponse } from "node:http";
import type { PublishedEvent, SessionRegistry } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";

const PAGE_SIZE = 500;
// A client this far behind is dropped: it reconnects from its last id and catches up from the
// store, so the core never holds an unbounded backlog for it.
const MAX_BEHIND_BYTES = 4 * 1024 * 1024;

export interface StreamSource {
  registry: SessionRegistry;
  store: Store;
}

export interface StreamQuery {
  after?: number | undefined;
  session?: string | undefined;
}

// A text fragment has no position, so it carries no id and a reconnecting client skips it.
function format({ position, event }: PublishedEvent): string {
  const id = position === undefined ? "" : `id: ${position}\n`;
  return `${id}data: ${JSON.stringify(event)}\n\n`;
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

// Live events are subscribed to before the store is read and held until the stored ones are
// sent, so none is missed in between; positions already sent are skipped, so none is repeated.
export async function streamEvents(
  response: ServerResponse,
  { registry, store }: StreamSource,
  { after, session }: StreamQuery,
): Promise<void> {
  if (session !== undefined && store.getSession(session) === undefined) {
    throw new RecordNotFoundError("session", session);
  }
  let sent = after ?? 0;
  let held: PublishedEvent[] | undefined = after === undefined ? undefined : [];
  const deliver = (published: PublishedEvent): boolean => {
    if (published.position !== undefined) {
      if (published.position <= sent) return true;
      sent = published.position;
    }
    return response.write(format(published));
  };

  const stopListening = registry.subscribe((published) => {
    if (response.destroyed) return;
    if (session !== undefined && published.event.sessionId !== session) return;
    if (held !== undefined) {
      held.push(published);
      return;
    }
    if (!deliver(published) && response.writableLength > MAX_BEHIND_BYTES) response.destroy();
  });
  response.on("close", stopListening);
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
  const caughtUp = held;
  held = undefined;
  for (const published of caughtUp) deliver(published);
}
