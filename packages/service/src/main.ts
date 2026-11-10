import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import type { CoreReady } from "@office-town/contract";
import {
  addInstallFoldersToPath,
  canRecount,
  createSession,
  listHarnesses,
  recountUsage,
  stopQueries,
} from "@office-town/harness";
import { permissionModeOf } from "./agents/options.ts";
import { HarnessStatuses } from "./api/harness-statuses.ts";
import { startApiServer } from "./api/server.ts";
import { imageSight } from "./attachments/attachments.ts";
import { autonomyGuard } from "./autonomy/policy.ts";
import { messageLead } from "./chief/message-lead.ts";
import { proposePlan } from "./chief/propose-plan.ts";
import { Scheduler } from "./chief/scheduler.ts";
import { appsOf } from "./connectors/access.ts";
import { ConnectorHub } from "./connectors/hub.ts";
import { AppRequests } from "./connectors/request-app.ts";
import { openSecrets } from "./connectors/secrets.ts";
import { defaultDataFolder } from "./data-folder.ts";
import { imageDescriber } from "./drafts/image-description.ts";
import { titlesFor } from "./drafts/title.ts";
import { goalTools } from "./goal/tools.ts";
import { referenceOf } from "./library/library.ts";
import { addToLibrary, changeLibrary } from "./library/library-tools.ts";
import { followLibraryUses } from "./library/library-uses.ts";
import { PreviewServer } from "./outputs/preview-server.ts";
import { showResult } from "./outputs/show-result.ts";
import { TaskFiles } from "./outputs/task-files.ts";
import { PriceList } from "./prices/prices.ts";
import { SessionActivity } from "./registry/activity.ts";
import { stopIdleAgents } from "./registry/idle-stop.ts";
import { followRecounts } from "./registry/recount.ts";
import { SessionRegistry } from "./registry/session-registry.ts";
import { openStore } from "./store/sqlite-store.ts";
import { cachedCatalogs } from "./team/catalogs.ts";
import { changeWorker } from "./team/change-worker.ts";
import { removeAllSandboxes } from "./team/check-sandbox.ts";
import { Checks } from "./team/checks.ts";
import { delegate, teamStatus } from "./team/delegate.ts";
import { Handovers } from "./team/handover.ts";
import { proposeChange } from "./team/propose-change.ts";
import { proposeTeam } from "./team/propose-team.ts";
import { recoverLeads, reportResults } from "./team/results.ts";
import { resumeWork, stopWork } from "./team/stop-work.ts";
import { TaskStates } from "./team/task-state.ts";
import { UsagePauses } from "./team/usage-pause.ts";
import { cleanUpWorktrees } from "./team/worktrees.ts";
import { askUser } from "./tools/ask-user.ts";
import { startToolServer } from "./tools/tool-server.ts";

const { values } = parseArgs({
  options: {
    "data-folder": { type: "string" },
    port: { type: "string", default: "0" },
    "stop-when-stdin-closes": { type: "boolean", default: false },
    // Test runs only: a lower size for Efficient mode's handover, so a live run stays short.
    "hand-over-at": { type: "string" },
  },
});

// Agents must not inherit Electron's Node mode, or an Electron app they start would run as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;
addInstallFoldersToPath();

const handOverAt =
  values["hand-over-at"] === undefined ? undefined : Number(values["hand-over-at"]);
if (handOverAt !== undefined && !(Number.isInteger(handOverAt) && handOverAt > 0)) {
  throw new Error(`--hand-over-at must be a number of tokens, got "${values["hand-over-at"]}".`);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`--port must be a port number, got "${values.port}".`);
}

// Only the installed app runs the core as built JS; anything run from the sources is development.
const dataFolder = values["data-folder"] ?? defaultDataFolder(import.meta.filename.endsWith(".ts"));
const store = openStore(dataFolder);
const taskStates = new TaskStates(store);
// Files picked but never sent are kept a day, in case the message is still being written.
await store.deleteUnsentAttachments(new Date(Date.now() - 24 * 60 * 60 * 1000));
const toolServer = await startToolServer(store);
const readCatalog = cachedCatalogs();
const registry = new SessionRegistry(store, {
  createSession,
  tools: toolServer,
  guard: autonomyGuard(store),
  permissionModeOf: (agentId) => permissionModeOf(store, agentId),
  seesImages: imageSight(readCatalog),
  describeImages: imageDescriber({ store, readCatalog, dataFolder, createSession }),
  referenceOf: referenceOf(store),
  appsOf: appsOf(store),
  appGuard: (session, request) => connectors.claudeApps.decide(session, request),
});
const connectors = new ConnectorHub(store, registry, openSecrets(dataFolder));
toolServer.offerApps({
  hub: connectors.gateway.hubTools(),
  endpointOf: (slug) => connectors.gateway.endpointOf(slug),
});
followLibraryUses(registry, store);
const team = { store, registry, readCatalog, dataFolder, createSession };
const activity = new SessionActivity(registry);
void followRecounts(
  registry,
  store,
  listHarnesses()
    .map((one) => one.harness)
    .filter(canRecount),
  ({ options, harnessSessionId }) =>
    harnessSessionId === undefined
      ? Promise.resolve(undefined)
      : recountUsage(options.harness, options.environment, options.accountFolder, harnessSessionId),
);
const stopIdle = stopIdleAgents(registry, store, activity);
const handovers = new Handovers(team, handOverAt === undefined ? {} : { handOverAt });
reportResults(team, activity, (sessionId) => handovers.isHandingOver(sessionId));
recoverLeads(team, activity);
taskStates.follow(registry);
const pauses = new UsagePauses(team);
cleanUpWorktrees(team);
const checks = new Checks(team);
// No checker survives a restart, and neither does its sandbox (D-73).
store.stopOpenChecks();
await removeAllSandboxes(store, dataFolder);
const scheduler = new Scheduler(team);
toolServer.offer([
  askUser(registry),
  proposeTeam(team),
  delegate(team),
  teamStatus(team, activity),
  stopWork(team, activity),
  resumeWork(team),
  changeWorker(team),
  proposeChange(team),
  ...goalTools(team),
  handovers.tool(),
  checks.writeChecklistTool(),
  checks.proposeChecksTool(),
  checks.reportCheckTool(),
  proposePlan(team, scheduler),
  messageLead(team),
  addToLibrary(team),
  changeLibrary(team),
  new AppRequests(store, registry).tool(),
  showResult(team),
]);
// After a restart, queued work may be free to start.
void scheduler.advance();
const token = randomBytes(32).toString("base64url");
const preview = await PreviewServer.start();
const ownPorts = new Set([preview.port, Number(new URL(toolServer.url).port)]);
const prices = new PriceList();
const statuses = new HarnessStatuses(store, readCatalog);
const server = await startApiServer({
  team,
  connectors,
  pauses,
  checks,
  outputs: { preview, files: new TaskFiles(store), ownPorts },
  prices,
  statuses,
  nameTask: titlesFor(team),
  token,
  port,
});
ownPorts.add(Number(new URL(server.url).port));
// Claude apps connected on claude.ai since the last run show up without a click.
void connectors.claudeApps.refresh();
// Each provider's status and models, ready before a page asks; the reads take their turn with the
// other CLI queries (D-92).
void statuses.checkAll();
// Offline, the copy from the last run prices the usage estimate.
prices.load(dataFolder).catch((error: unknown) => {
  process.stderr.write(`Could not read API prices: ${String(error)}\n`);
});
const ready: CoreReady = { url: server.url, token };
// Stdout carries only this line, for whoever started the core; logs go to stderr.
process.stdout.write(`${JSON.stringify(ready)}\n`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  statuses.stop();
  stopQueries();
  stopIdle();
  await server.close();
  await preview.close();
  try {
    await registry.close();
  } finally {
    await toolServer.close();
    await connectors.close();
    store.close();
  }
}
process.on("SIGTERM", shutdown);
// Ctrl+C in a Windows console reaches the core as well; a core with a parent stops when it says so.
process.on("SIGINT", values["stop-when-stdin-closes"] ? () => undefined : shutdown);
// Windows cannot send a child SIGTERM, and a closed pipe also stops the core when the app crashes.
if (values["stop-when-stdin-closes"]) {
  process.stdin.on("close", shutdown);
  process.stdin.resume();
}
