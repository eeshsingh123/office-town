import type { SeenEvent } from "../../store/automation-events-store.ts";
import { type EventSource, lookEvery, MINUTE_MS, plainText } from "./source.ts";

const EVERY_MS = 5 * MINUTE_MS;
const TIMEOUT_MS = 20_000;
const BODY_CHARS = 2_000;

interface GitHubState {
  lookedAt: number;
  etag?: string;
}

interface Issue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  body?: string | null;
  created_at: string;
  user?: { login?: string } | null;
  pull_request?: unknown;
}

// New issues or pull requests in one repository (D-128). The newest 50 are read every 5 minutes;
// a look that finds nothing new is answered "not modified" and costs nothing of GitHub's limit.
export const githubSource: EventSource<"github"> = {
  kind: "github",
  start(config, context) {
    const look = async () => {
      const token = context.keysOf(config.connectorId).Authorization;
      if (token === undefined) {
        context.fail("The GitHub app has no key. Add one in Connectors.");
        return;
      }
      const state = context.state<GitHubState>();
      const response = await fetch(
        `https://api.github.com/repos/${config.repo}/issues?state=all&sort=created&direction=desc&per_page=50`,
        {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "user-agent": "Office Town",
            "x-github-api-version": "2022-11-28",
            ...(state?.etag === undefined ? {} : { "if-none-match": state.etag }),
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (response.status === 304) {
        context.setState({ ...state, lookedAt: Date.now() });
        context.looked(0);
        return;
      }
      if (response.status === 401) {
        context.fail("GitHub didn't accept the app's key. Add a new one in Connectors.");
        return;
      }
      if (response.status === 404) {
        context.fail(`GitHub can't find ${config.repo}, or the key can't read it.`);
        return;
      }
      if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
      const issues = (await response.json()) as Issue[];
      const events: SeenEvent[] = issues
        .filter((issue) => {
          const pull = issue.pull_request !== undefined;
          return config.watch === "both" || (config.watch === "pulls") === pull;
        })
        .map((issue) => {
          const kind = issue.pull_request === undefined ? "Issue" : "Pull request";
          const by = issue.user?.login === undefined ? "" : ` by ${issue.user.login}`;
          return {
            key: String(issue.id),
            at: Date.parse(issue.created_at),
            text: [
              `${kind} #${issue.number}${by}: ${issue.title}`,
              issue.html_url,
              plainText(issue.body ?? "", BODY_CHARS),
            ]
              .filter((part) => part !== "")
              .join("\n"),
          };
        });
      const found = context.seen(events, { startPoint: state === undefined });
      context.looked(found);
      const etag = response.headers.get("etag");
      context.setState({
        lookedAt: Date.now(),
        ...(etag === null ? {} : { etag }),
      } satisfies GitHubState);
    };
    return lookEvery(EVERY_MS, context.state<GitHubState>()?.lookedAt, look, (error, failures) => {
      if (failures === 1) {
        console.error(`Could not read GitHub for ${context.automation.name}.`, error);
      }
    });
  },
};
