import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import type { CoreReady } from "@office-town/contract";
import { startApiServer } from "./api/server.ts";
import { defaultDataFolder } from "./data-folder.ts";
import { SessionActivity } from "./registry/activity.ts";
import { stopIdleAgents } from "./registry/idle-stop.ts";
import { SessionRegistry } from "./registry/session-registry.ts";
import { openStore } from "./store/sqlite-store.ts";
import { cachedCatalogs } from "./team/catalogs.ts";
import { delegate, teamStatus } from "./team/delegate.ts";
import { proposeTeam } from "./team/propose-team.ts";
import { reportResults } from "./team/results.ts";
import { askUser } from "./tools/ask-user.ts";
import { startToolServer } from "./tools/tool-server.ts";

const { values } = parseArgs({
  options: {
    "data-folder": { type: "string" },
    port: { type: "string", default: "0" },
    "stop-when-stdin-closes": { type: "boolean", default: false },
  },
});

// The desktop app runs the core on Electron's own Node. Agents must not inherit that, or an
// Electron app they start would run as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`--port must be a port number, got "${values.port}".`);
}

const store = openStore(values["data-folder"] ?? defaultDataFolder());
const toolServer = await startToolServer(store);
const registry = new SessionRegistry(store, undefined, toolServer);
const readCatalog = cachedCatalogs();
const team = { store, registry, readCatalog };
const activity = new SessionActivity(registry);
const stopIdle = stopIdleAgents(registry, store, activity);
reportResults(team, activity);
toolServer.offer([
  askUser(registry),
  proposeTeam(team),
  delegate(team),
  teamStatus(team, activity),
]);
const token = randomBytes(32).toString("base64url");
const server = await startApiServer({ registry, store, readCatalog, token, port });
const ready: CoreReady = { url: server.url, token };
// Stdout carries only this line, for whoever started the core; logs go to stderr.
process.stdout.write(`${JSON.stringify(ready)}\n`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  stopIdle();
  await server.close();
  try {
    await registry.close();
  } finally {
    await toolServer.close();
    store.close();
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, shutdown);
// Windows cannot send a child SIGTERM, so the app stops the core by closing its stdin. A pipe also
// closes when the app crashes, so no core is left running unseen.
if (values["stop-when-stdin-closes"]) {
  process.stdin.on("close", shutdown);
  process.stdin.resume();
}
