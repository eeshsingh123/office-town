import type { CheckRecord, CheckResult } from "@office-town/contract";
import { CircleCheck, CircleMinus, CircleX, ListChecks } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { type Agent, stateOf, useWaitingSessions } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { OPEN_CHECK, useChecks } from "../../store/checks.ts";
import { type Keep, readKept, useKept, writeKept } from "../../store/kept.ts";
import { markDone } from "../../store/reviewers.ts";
import { isBusy } from "../../trace/progress.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import checks from "../checks/Checks.module.css";
import { RequestCard } from "../requests/RequestCard.tsx";
import { statusOfTask } from "../tasks/task-list.ts";
import styles from "./ReviewOffer.module.css";

const idList = (name: string): Keep<string[]> => ({ name, lasts: "saved", start: [] });
export const FIXES_SENT = idList("check-fixes-sent");

function remember(keep: Keep<string[]>, id: string) {
  writeKept(keep, [...readKept(keep), id]);
}

interface ReviewOfferProps {
  // The lead, or the solo agent, whose finished work is offered for a check.
  agent: Agent;
  // Everyone on the task, so a running team is not interrupted.
  members: readonly Agent[];
  onReview: () => void;
  // Shows a checker's work; only a team view can.
  onShow?: ((agentId: string) => void) | undefined;
}

// Only the failing items, with how to see each fail, so the team fixes nothing else (D-73).
function fixMessage(check: CheckRecord): string {
  const results = new Map(check.results?.map((result) => [result.id, result]));
  const failing = check.items.flatMap((item) => {
    const result = results.get(item.id);
    if (result?.outcome !== "fail") return [];
    return [
      `- ${item.check}\n  Expected: ${item.expected}\n  Steps: ${result.steps ?? ""}\n  What happened: ${result.got ?? ""}`,
    ];
  });
  return `The check of your work (round ${check.round}) found ${failing.length === 1 ? "this item" : "these items"} failing:
${failing.join("\n")}

Fix only these, with the smallest change. Do not change what passes, and never edit a test or a check to make it pass. When you are done, say what you changed for each.`;
}

// Only the failing items go back, and the check remembers they went.
export async function sendFixes(check: CheckRecord): Promise<void> {
  await api.messageAgent(check.ownerAgentId, fixMessage(check), check.taskId);
  remember(FIXES_SENT, check.id);
}

export const failingCount = (check: CheckRecord) =>
  (check.results ?? []).filter((result) => result.outcome === "fail").length;

const ICONS = { pass: CircleCheck, fail: CircleX, not_run: CircleMinus } as const;

function Outcome({
  check,
  result,
  before,
}: {
  check: CheckRecord["items"][number];
  result: CheckResult | undefined;
  before: CheckResult | undefined;
}) {
  const outcome = result?.outcome ?? "not_run";
  const Icon = ICONS[outcome];
  const change =
    before === undefined || before.outcome === outcome
      ? undefined
      : outcome === "pass" && before.outcome === "fail"
        ? "fixed"
        : outcome === "fail" && before.outcome === "pass"
          ? "broke"
          : undefined;
  return (
    <li className={checks.outcome} data-outcome={outcome}>
      <Icon size={16} className={checks.outcomeIcon} aria-label={outcome.replace("_", " ")} />
      <div className={checks.outcomeText}>
        <span>
          {check.check}
          {change === undefined ? null : (
            <>
              {" "}
              <span className={checks.change} data-change={change}>
                {change === "fixed" ? "Fixed" : "Broke since last round"}
              </span>
            </>
          )}
        </span>
        {outcome === "fail" ? (
          <>
            <span className={checks.outcomeDetail}>Expected: {check.expected}</span>
            <span className={checks.outcomeDetail}>What happened: {result?.got}</span>
            <span className={checks.outcomeDetail}>Steps: {result?.steps}</span>
          </>
        ) : outcome === "not_run" ? (
          <span className={checks.outcomeDetail}>Not run: {result?.evidence ?? "no result"}</span>
        ) : null}
      </div>
    </li>
  );
}

function Results({
  check,
  before,
  agent,
  onReview,
  onShow,
}: {
  check: CheckRecord;
  before: CheckRecord | undefined;
  agent: Agent;
  onReview: () => void;
  onShow?: ((agentId: string) => void) | undefined;
}) {
  const checker = useApp((state) => state.agents[check.checkerAgentId]);
  const sent = useKept(FIXES_SENT)[0].includes(check.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const results = new Map(check.results?.map((result) => [result.id, result]));
  const earlier = new Map(before?.results?.map((result) => [result.id, result]));
  const count = (outcome: CheckResult["outcome"]) =>
    check.items.filter((item) => results.get(item.id)?.outcome === outcome).length;
  const failed = count("fail");
  const notRun = count("not_run");
  const finished = useApp((state) => statusOfTask(state, agent.taskId) === "review");
  const accepted = agent.task.reviewedAt !== undefined;

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const fixes = () => act(() => sendFixes(check));

  const summary =
    failed === 0
      ? notRun === 0
        ? `All ${check.items.length} checks pass.`
        : `${check.items.length - notRun} of ${check.items.length} pass, ${notRun} not run.`
      : `${check.items.length - failed - notRun} of ${check.items.length} pass, ${failed} failed${notRun === 0 ? "" : `, ${notRun} not run`}.`;
  return (
    <section className={checks.results} aria-label="Check results">
      <div className={checks.resultsHead}>
        <ListChecks size={18} className={styles.icon} aria-hidden />
        <div className={checks.resultsTitle}>
          <strong>
            Round {check.round} · {summary}
          </strong>
          <span>
            {accepted
              ? "You accepted this work."
              : sent
                ? `Fixes went to ${agent.name}. Check again once it is done.`
                : `Checked by ${checker?.name ?? "a fresh agent"} on a temporary copy.`}
          </span>
        </div>
      </div>
      <ul className={checks.outcomes}>
        {check.items.map((item) => (
          <Outcome
            key={item.id}
            check={item}
            result={results.get(item.id)}
            before={earlier.get(item.id)}
          />
        ))}
      </ul>
      {check.notes === undefined ? null : (
        <div>
          <div className={checks.sectionLabel}>Also noticed, not on the list</div>
          <ul className={checks.notes}>
            {check.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={checks.actions}>
        {failed > 0 && !sent && !accepted ? (
          <Button variant="primary" disabled={busy} onClick={() => void fixes()}>
            Send fixes to the team
          </Button>
        ) : null}
        <Button variant={sent ? "primary" : "secondary"} disabled={busy} onClick={onReview}>
          Check again
        </Button>
        {finished && !accepted ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void act(() => markDone(check.taskId))}
          >
            {failed === 0 ? "Accept" : "Accept as is"}
          </Button>
        ) : null}
        {onShow === undefined ? null : (
          <Button variant="ghost" onClick={() => onShow(check.checkerAgentId)}>
            Read the check
          </Button>
        )}
      </div>
      {error === undefined ? null : (
        <p className={checks.outcomeDetail} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

// The end of the chat: a check under way, then its results. The bar above the box offers it (D-73).
export function ReviewOffer({ agent, members, onReview, onShow }: ReviewOfferProps) {
  const traces = useApp((state) => state.traces);
  const waitingRequests = useApp((state) => state.waiting);
  const agents = useApp((state) => state.agents);
  const waiting = useWaitingSessions();
  const all = useChecks(agent.taskId);
  const states = new Map(
    members.map((member) => [member.id, stateOf(member, traces, waiting.has(member.latest.id))]),
  );
  const busy = (member: Agent) => {
    const state = states.get(member.id);
    return state !== undefined && (isBusy(state) || state === "waiting");
  };
  const latest = all.at(-1);

  if (latest !== undefined && OPEN_CHECK.has(latest.status)) {
    const name = agents[latest.checkerAgentId]?.name ?? "The checker";
    const asked = Object.values(waitingRequests).find(
      ({ event }) =>
        event.sessionId === latest.checkerSessionId && event.type === "checklist.requested",
    );
    if (latest.status === "approving" && asked !== undefined) {
      return <RequestCard event={asked.event} />;
    }
    return (
      <div className={styles.card} role="status">
        <Avatar name={name} colour={agents[latest.checkerAgentId]?.colour ?? ""} size={22} />
        <p className={styles.text}>
          <strong>
            {latest.status === "running"
              ? `${name} is running ${latest.items.length} checks · round ${latest.round}.`
              : `${name} is writing the checklist.`}
          </strong>
          <span>
            {latest.status === "running"
              ? "The results will appear here."
              : "You approve it here before anything runs."}
          </span>
        </p>
        {onShow === undefined ? null : (
          <Button variant="ghost" onClick={() => onShow(latest.checkerAgentId)}>
            Watch
          </Button>
        )}
      </div>
    );
  }
  if (members.some(busy)) return null;
  const done = all.filter((check) => check.status === "done");
  const shown = done.at(-1);
  if (shown !== undefined) {
    const before = done.findLast((check) => check.round === shown.round - 1);
    return (
      <Results check={shown} before={before} agent={agent} onReview={onReview} onShow={onShow} />
    );
  }
  return null;
}
