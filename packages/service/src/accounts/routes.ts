import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  type Account,
  type AccountLogin,
  accountKeyRequestSchema,
  accountProviders,
  accountUsageQuerySchema,
  newAccountRequestSchema,
  renameAccountRequestSchema,
  resumeAtRequestSchema,
} from "@office-town/contract";
import {
  type AccountSignIn,
  listHarnesses,
  readAccountLimits,
  readAccountStatus,
  saveAccountKey,
  startAccountSignIn,
} from "@office-town/harness";
import { z } from "zod";
import { RequestError } from "../api/errors.ts";
import type { Route } from "../api/routes.ts";
import { RecordNotFoundError } from "../store/store.ts";
import { messageAgent } from "../team/direct-message.ts";
import type { TeamContext } from "../team/members.ts";
import { allAccounts, hasSignIn } from "./accounts.ts";

const NO_CONTENT = { status: 204 } as const;
// A sign-in left open in a closed browser tab ends on its own.
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
// Reads closer together than this reuse the last one, so opening pages cannot flood the vendor.
const LIMITS_FLOOR_MS = 15_000;
// Longer than a plan's weekly reset, so a typo cannot park an agent for good.
const LONGEST_WAIT_MS = 8 * 24 * 3600_000;

interface SignIn {
  login: AccountLogin;
  process?: AccountSignIn;
}

// Routes for the accounts on the Usage page (D-61).
export function accountRoutes(team: TeamContext): Route[] {
  const { store, dataFolder } = team;
  const accountsFolder = join(dataFolder, "accounts");
  const signIns = new Map<string, SignIn>();
  const waits = new Map<string, NodeJS.Timeout>();
  let refreshing: Promise<void> | undefined;
  let refreshedAt = 0;

  // Asks each signed-in account's harness for its plan usage now; one that cannot keeps its last.
  const refreshLimits = async () => {
    const accounts = allAccounts(store, listHarnesses()).filter(
      (account) => account.signedIn !== false,
    );
    await Promise.all(
      accounts.map(async (account) => {
        const limits = await readAccountLimits(
          account.harness,
          account.environment,
          account.folder,
        ).catch(() => undefined);
        if (limits === undefined || limits.length === 0) return;
        const { id: accountId, harness } = account;
        store.saveLimits({ accountId, harness, limits, reportedAt: new Date().toISOString() });
      }),
    );
  };

  const added = (id: string): Account => {
    const account = store.getAccount(id);
    if (account?.folder === undefined) throw new RecordNotFoundError("account", id);
    return account;
  };

  const anyAccount = (id: string): Account => {
    const account = allAccounts(store, listHarnesses()).find((one) => one.id === id);
    if (account === undefined) throw new RecordNotFoundError("account", id);
    return account;
  };

  // Only ever a folder this route made, so a bad record can never remove anything else.
  const removeFolder = async (folder: string) => {
    const inside = relative(accountsFolder, resolve(folder));
    if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return;
    await rm(folder, { recursive: true, force: true });
  };

  return [
    {
      method: "GET",
      path: "/accounts",
      reply: () => ({ status: 200, json: allAccounts(store, listHarnesses()) }),
    },
    {
      method: "POST",
      path: "/accounts",
      reply: async ({ body }) => {
        const request = newAccountRequestSchema.parse(await body());
        if (!listHarnesses().some(({ harness }) => harness === request.harness)) {
          throw new RequestError(400, "invalid_request", `Unknown tool "${request.harness}".`);
        }
        const id = randomUUID();
        const folder = join(accountsFolder, id);
        await mkdir(folder, { recursive: true });
        const account = { id, ...request, folder, createdAt: new Date().toISOString() };
        return { status: 201, json: store.createAccount(account) };
      },
    },
    {
      method: "PUT",
      path: "/accounts/:id",
      reply: async ({ param, body }) => {
        const { name } = renameAccountRequestSchema.parse(await body());
        return { status: 200, json: store.renameAccount(added(param("id")).id, name) };
      },
    },
    {
      method: "DELETE",
      path: "/accounts/:id",
      reply: async ({ param }) => {
        const account = added(param("id"));
        await signIns.get(account.id)?.process?.stop();
        signIns.delete(account.id);
        // Agents that used it go back to Automatic.
        for (const agent of store.listAgents()) {
          if (agent.settings.accountId !== account.id) continue;
          const { accountId: _, ...settings } = agent.settings;
          const { colour, role, purpose, departmentId, autonomy, profileId } = agent;
          store.updateAgent(agent.id, {
            colour,
            role,
            purpose,
            departmentId,
            autonomy,
            profileId,
            settings,
          });
        }
        store.deleteAccount(account.id);
        if (account.folder !== undefined) await removeFolder(account.folder);
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: "/accounts/:id/status",
      reply: async ({ param }) => {
        const account = anyAccount(param("id"));
        // Without a status command, an added account is signed in once its sign-in file exists.
        if (account.harness === "opencode" && account.folder !== undefined) {
          return { status: 200, json: { signedIn: hasSignIn(account) } };
        }
        const status = await readAccountStatus(
          account.harness,
          account.environment,
          account.folder,
        ).catch(() => undefined);
        return { status: 200, json: status ?? null };
      },
    },
    {
      method: "POST",
      path: "/accounts/:id/key",
      reply: async ({ param, body }) => {
        const account = added(param("id"));
        if (account.folder === undefined || account.harness !== "opencode") {
          throw new RequestError(400, "invalid_request", "This account signs in another way.");
        }
        const { provider, key } = accountKeyRequestSchema.parse(await body());
        const saved = await saveAccountKey(
          account.harness,
          account.environment,
          account.folder,
          provider,
          key,
        );
        if (!saved || !hasSignIn(account)) {
          throw new RequestError(
            400,
            "invalid_request",
            "OpenCode did not take the key. Try again.",
          );
        }
        const plan = accountProviders.find((one) => one.id === provider)?.label;
        return { status: 200, json: { signedIn: true, ...(plan && { plan }) } };
      },
    },
    {
      method: "POST",
      path: "/accounts/:id/sign-in",
      reply: async ({ param }) => {
        // A default login signs in too, as setup does for a CLI that is not signed in yet.
        const account = anyAccount(param("id"));
        const running = signIns.get(account.id);
        if (running?.login.state === "waiting") return { status: 200, json: running.login };
        const signIn: SignIn = { login: { state: "waiting" } };
        signIns.set(account.id, signIn);
        const process = await startAccountSignIn(
          account.harness,
          account.environment,
          account.folder,
          (line) => {
            const url = line.match(/https:\/\/\S+/)?.[0];
            if (url !== undefined && signIn.login.url === undefined) {
              signIn.login = { ...signIn.login, url };
            }
          },
        );
        if (process === undefined) {
          signIns.delete(account.id);
          throw new RequestError(400, "invalid_request", "This account signs in with a key.");
        }
        signIn.process = process;
        const timer = setTimeout(() => void process.stop(), SIGN_IN_TIMEOUT_MS);
        void process.exited.then((code) => {
          clearTimeout(timer);
          signIn.login =
            code === 0
              ? { state: "done" }
              : { state: "failed", message: "Sign-in did not finish. Try again." };
        });
        return { status: 200, json: signIn.login };
      },
    },
    {
      method: "GET",
      path: "/accounts/:id/sign-in",
      reply: ({ param }) => {
        const signIn = signIns.get(param("id"));
        if (signIn === undefined) throw new RecordNotFoundError("account", param("id"));
        return { status: 200, json: signIn.login };
      },
    },
    {
      method: "POST",
      path: "/accounts/:id/sign-in/code",
      reply: async ({ param, body }) => {
        const { code } = z.object({ code: z.string().trim().min(1) }).parse(await body());
        const process = signIns.get(param("id"))?.process;
        if (process === undefined) {
          throw new RequestError(400, "invalid_request", "No sign-in is waiting for a code.");
        }
        process.sendCode(code);
        return NO_CONTENT;
      },
    },
    {
      method: "DELETE",
      path: "/accounts/:id/sign-in",
      reply: async ({ param }) => {
        await signIns.get(param("id"))?.process?.stop();
        signIns.delete(param("id"));
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: "/limits/refresh",
      reply: async () => {
        if (refreshing === undefined && Date.now() - refreshedAt >= LIMITS_FLOOR_MS) {
          refreshing = refreshLimits().finally(() => {
            refreshing = undefined;
            refreshedAt = Date.now();
          });
        }
        await refreshing;
        return { status: 200, json: store.listLimits() };
      },
    },
    {
      method: "GET",
      path: "/usage",
      reply: ({ query }) => {
        const { since } = accountUsageQuerySchema.parse({ since: query.get("since") });
        return { status: 200, json: store.accountUsageSince(since) };
      },
    },
    {
      method: "POST",
      path: "/agents/:id/resume-at",
      reply: async ({ param, body }) => {
        const agentId = param("id");
        if (store.getAgent(agentId) === undefined) throw new RecordNotFoundError("agent", agentId);
        const { at } = resumeAtRequestSchema.parse(await body());
        // A minute late, so the plan has surely reset.
        const wait = Math.min(LONGEST_WAIT_MS, Math.max(0, Date.parse(at) + 60_000 - Date.now()));
        clearTimeout(waits.get(agentId));
        // Held in memory only: closing the app drops the wait, and the agent stays stopped.
        const resume = () => {
          waits.delete(agentId);
          void messageAgent(
            team,
            agentId,
            "Your plan has reset. Carry on where you stopped.",
          ).catch(() => {});
        };
        waits.set(agentId, setTimeout(resume, wait));
        return NO_CONTENT;
      },
    },
  ];
}
