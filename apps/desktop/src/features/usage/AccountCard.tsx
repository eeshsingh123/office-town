import type { Account, AccountLimits, AccountStatus, UsageLimit } from "@office-town/contract";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import type { Agent } from "../../store/agents.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ago, compactCount } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import {
  clock,
  currentLimits,
  fullest,
  inTime,
  paceOf,
  percent,
  type Tone,
  toneOf,
  windowLabel,
} from "./limits.ts";
import styles from "./Usage.module.css";

const BAR_TONE: Record<Tone, string | undefined> = {
  calm: undefined,
  near: styles.barNear,
  high: styles.barHigh,
};

const WINDOW_ORDER = ["five_hour", "seven_day"];
const order = (limit: UsageLimit) => {
  const at = WINDOW_ORDER.indexOf(limit.id);
  return at === -1 ? WINDOW_ORDER.length : at;
};

// Drawn only: the percentage is always written beside it.
export function Meter({
  usedFraction,
  tick,
  thin = false,
  neutral = false,
}: {
  usedFraction: number;
  // Where an even pace would be, from 0 to 1.
  tick?: number | undefined;
  thin?: boolean;
  // A share, not a limit, so it never turns amber or red.
  neutral?: boolean;
}) {
  const width = Math.min(100, usedFraction * 100);
  return (
    <div
      className={[styles.bar, !neutral && BAR_TONE[toneOf(usedFraction)], thin && styles.thin]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    >
      <i style={{ width: `${width}%` }} />
      {tick === undefined ? null : (
        <span className={styles.tick} style={{ left: `${tick * 100}%` }} aria-hidden />
      )}
    </div>
  );
}

function Window({ limit, showLeft, now }: { limit: UsageLimit; showLeft: boolean; now: number }) {
  const pace = paceOf(limit, now);
  const resetsAt = limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt);
  const full = limit.usedFraction >= 1;
  const shown = showLeft ? Math.max(0, 1 - limit.usedFraction) : limit.usedFraction;
  const name = windowLabel(limit);
  return (
    <div className={styles.window}>
      <div className={styles.windowLine}>
        <span className={styles.windowName}>{name}</span>
        <span className={styles.windowValue}>
          <strong>
            {percent(shown)} {showLeft ? "left" : "used"}
          </strong>
          {resetsAt === undefined ? "" : ` · resets ${clock(resetsAt, now)}`}
        </span>
      </div>
      <Meter usedFraction={limit.usedFraction} tick={pace?.elapsed} />
      {full && resetsAt !== undefined ? (
        <span className={`${styles.pace} ${styles.paceHigh}`}>Back {inTime(resetsAt, now)}</span>
      ) : pace?.runsOutAt !== undefined ? (
        <span
          className={`${styles.pace} ${toneOf(limit.usedFraction) === "calm" ? "" : styles.paceHigh}`}
        >
          At this pace, runs out {clock(pace.runsOutAt, now)}
        </span>
      ) : pace !== undefined && pace.elapsed >= 0.03 ? (
        <span className={`${styles.pace} ${styles.paceOk}`}>Lasts until reset</span>
      ) : null}
    </div>
  );
}

interface AccountCardProps {
  account: Account;
  harnessName: string;
  reportsLimits: boolean;
  limits: AccountLimits | undefined;
  // Agents that use it, by their own pick or their last session.
  users: readonly Agent[];
  working: number;
  tokens: { today: number; week: number };
  showLeft: boolean;
  now: number;
  onRename: (account: Account) => void;
  onSignIn: (account: Account) => void;
  onRemove: (account: Account) => void;
}

const PLAN_NAMES: Record<string, string> = {
  pro: "Pro plan",
  max: "Max plan",
  team: "Team plan",
  enterprise: "Enterprise plan",
};

export function AccountCard(props: AccountCardProps) {
  const { account, harnessName, reportsLimits, limits, users, working, tokens, showLeft, now } =
    props;
  const [status, setStatus] = useState<AccountStatus | null>();
  useEffect(() => {
    let current = true;
    api
      .readAccountStatus(account.id)
      .then((next) => current && setStatus(next))
      .catch(() => current && setStatus(null));
    return () => {
      current = false;
    };
  }, [account.id]);

  const windows = currentLimits(limits, now).toSorted((a, b) => order(a) - order(b));
  const top = fullest(limits, now)?.usedFraction ?? 0;
  const tone = toneOf(top);
  const added = account.folder !== undefined;
  const signedOut = status?.signedIn === false;
  const plan = status?.plan === undefined ? undefined : (PLAN_NAMES[status.plan] ?? status.plan);
  const sub = [status?.email, plan].filter(Boolean).join(" · ") || `Your ${harnessName} sign-in`;

  return (
    <article
      className={[
        styles.card,
        tone === "high" && styles.cardHigh,
        tone === "near" && styles.cardNear,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`${harnessName} · ${account.name}`}
    >
      <div className={styles.cardHead}>
        <span className={styles.initial} aria-hidden>
          {account.name.charAt(0).toUpperCase()}
        </span>
        <div className={styles.who}>
          <div className={styles.name}>
            {account.name}
            {signedOut ? (
              <span className={`${styles.chip} ${styles.chipMuted}`}>Not signed in</span>
            ) : top >= 1 ? (
              <span className={`${styles.chip} ${styles.chipHigh}`}>Limit reached</span>
            ) : tone === "high" ? (
              <span className={`${styles.chip} ${styles.chipHigh}`}>Near limit</span>
            ) : !reportsLimits ? (
              <span className={`${styles.chip} ${styles.chipMuted}`}>No limit data</span>
            ) : null}
          </div>
          <span className={styles.sub}>{sub}</span>
        </div>
        {added ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                variant="ghost"
                icon
                className={styles.more}
                aria-label={`More for ${account.name}`}
              >
                <MoreHorizontal size={16} aria-hidden />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menu.surface} align="end" sideOffset={4}>
                <DropdownMenu.Item className={menu.item} onSelect={() => props.onRename(account)}>
                  Rename
                </DropdownMenu.Item>
                <DropdownMenu.Item className={menu.item} onSelect={() => props.onSignIn(account)}>
                  Sign in again
                </DropdownMenu.Item>
                <DropdownMenu.Item className={menu.item} onSelect={() => props.onRemove(account)}>
                  Remove
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : null}
      </div>

      {signedOut && added ? (
        <Button variant="primary" onClick={() => props.onSignIn(account)}>
          Sign in
        </Button>
      ) : reportsLimits ? (
        windows.length === 0 ? (
          <p className={styles.info}>
            Usage shows here after an agent's first reply on this account.
          </p>
        ) : (
          windows.map((limit) => (
            <Window key={limit.id} limit={limit} showLeft={showLeft} now={now} />
          ))
        )
      ) : (
        <>
          <div className={styles.tokens}>
            <div>
              <strong>{compactCount(tokens.today)}</strong>
              <span>tokens today</span>
            </div>
            <div>
              <strong>{compactCount(tokens.week)}</strong>
              <span>tokens this week</span>
            </div>
          </div>
          <p className={styles.info}>
            {harnessName} doesn't share plan usage with other apps.{" "}
            {account.harness === "opencode" ? (
              <a href="https://opencode.ai/auth" target="_blank" rel="noreferrer">
                See it on opencode.ai
              </a>
            ) : null}
          </p>
        </>
      )}

      <div className={styles.cardFoot}>
        <span className={styles.users}>
          {users.length === 0 ? (
            "No agents yet"
          ) : (
            <>
              <span className={styles.stack}>
                {users.slice(0, 4).map((agent) => (
                  <Avatar key={agent.id} name={agent.name} colour={agent.colour} size={22} />
                ))}
              </span>
              {users.length === 1 ? users[0]?.name : `${users.length} agents`}
              {working > 0 ? ` · ${working} working` : ""}
            </>
          )}
        </span>
        <span className={styles.muted}>
          {limits === undefined
            ? reportsLimits
              ? ""
              : "Counted by Office Town"
            : `Updated ${ago(limits.reportedAt, now)}`}
        </span>
      </div>
    </article>
  );
}
