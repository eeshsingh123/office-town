import type { FeedPost } from "@office-town/contract";
import {
  Check,
  EyeOff,
  FileText,
  MessageSquareReply,
  PowerOff,
  Sparkles,
  SquareArrowOutUpRight,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { writeDraft } from "../../store/drafts.ts";
import { knowAgents, useTraces } from "../../store/live.ts";
import { waitingKey } from "../../store/records.ts";
import { progressOf, stageOf } from "../../trace/progress.ts";
import { MoreMenu } from "../../ui/ActionMenu.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { Count } from "../../ui/Count.tsx";
import { ago } from "../../ui/format.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { TARGET_DRAFT } from "../new-task/targets.ts";
import { RequestCard } from "../requests/RequestCard.tsx";
import { RequestContext } from "../requests/RequestContext.tsx";
import styles from "./Feed.module.css";
import { ReplyBox } from "./ReplyBox.tsx";

interface Author {
  name: string;
  line: string | undefined;
  face: (size: number) => ReactNode;
}

const tile = (icon: ReactNode, small: boolean) => (
  <span className={`${styles.tile} ${small ? styles.tileSmall : ""}`} aria-hidden>
    {icon}
  </span>
);

// An agent by name and place in the team; an automation or Office Town by a plain mark.
export function useAuthor(post: FeedPost): Author {
  const agentId = post.by.kind === "agent" ? post.by.agentId : undefined;
  const agent = useApp((state) => (agentId === undefined ? undefined : state.agents[agentId]));
  const department = useApp((state) =>
    agent?.departmentId === undefined ? undefined : state.departments[agent.departmentId],
  );
  const isChief = useApp((state) => agentId !== undefined && state.chiefId === agentId);
  useEffect(() => {
    if (agentId !== undefined && agent === undefined) void knowAgents([agentId]);
  }, [agentId, agent]);
  if (post.by.kind === "automation") {
    return {
      name: post.by.name,
      line: "Automation",
      face: (size) => tile(<Zap size={size / 2} />, size < 30),
    };
  }
  if (post.by.kind === "app") {
    return {
      name: post.kind === "suggested" ? "Suggested for you" : "Office Town",
      line: post.suggestion?.why,
      face: (size) => tile(<Sparkles size={size / 2} />, size < 30),
    };
  }
  const name = agent?.name ?? "An agent";
  const role =
    department?.leadAgentId === agent?.id ? "Lead" : (agent?.role ?? (isChief ? "" : "Member"));
  const line = isChief
    ? "Chief"
    : department === undefined
      ? "Assistant"
      : `${department.name} · ${role}`;
  return {
    name,
    line,
    face: (size) => <Avatar name={name} colour={agent?.colour ?? "#8a8a8a"} size={size} />,
  };
}

const KIND: Record<FeedPost["kind"], { label: string; tone?: string | undefined }> = {
  "needs-you": { label: "Needs you", tone: styles.kindNeeds },
  living: { label: "Working", tone: styles.kindLive },
  result: { label: "Result", tone: styles.kindResult },
  milestone: { label: "Milestone", tone: styles.kindResult },
  stopped: { label: "Stopped", tone: styles.kindBad },
  automation: { label: "Automation" },
  "heads-up": { label: "Heads-up" },
  suggested: { label: "Suggested" },
};

const STOPPED: Record<NonNullable<FeedPost["stopped"]>, string> = {
  failed: "Failed",
  usage: "Paused",
  closed: "Stopped",
};

function Head({ post, author, now }: { post: FeedPost; author: Author; now: number }) {
  const kind = KIND[post.kind];
  const label = post.stopped === undefined ? kind.label : STOPPED[post.stopped];
  return (
    <div className={styles.head}>
      {author.face(30)}
      <div className={styles.who}>
        <span className={styles.name}>{author.name}</span>
        {author.line === undefined || author.line === "" ? null : (
          <span className={styles.role}>{author.line}</span>
        )}
      </div>
      <div className={styles.meta}>
        <span className={`${styles.kind} ${kind.tone ?? ""}`}>
          {post.kind === "living" ? <span className={styles.pulse} aria-hidden /> : null}
          {label}
        </span>
        <time className={styles.when} dateTime={post.createdAt}>
          {ago(post.createdAt, now)}
        </time>
      </div>
    </div>
  );
}

function TaskLink({ post }: { post: FeedPost }) {
  const task = useApp((state) =>
    post.taskId === undefined ? undefined : state.tasks[post.taskId]?.task,
  );
  if (post.taskId === undefined || task === undefined) return null;
  const taskId = post.taskId;
  return (
    <div className={styles.from}>
      From
      <button
        type="button"
        className={styles.link}
        onClick={() => navigate({ name: "task", taskId })}
      >
        {task.title ?? task.prompt.split("\n")[0]}
      </button>
    </div>
  );
}

// Who a reply goes to: the agent that posted, or the one whose session the post follows.
function useReplyTo(post: FeedPost): string | undefined {
  const sessionAgent = useApp((state) =>
    post.sessionId === undefined ? undefined : state.sessions[post.sessionId]?.agentId,
  );
  return post.by.kind === "agent" ? post.by.agentId : sessionAgent;
}

function useReply(post: FeedPost) {
  const [open, setOpen] = useState(false);
  const agentId = useReplyTo(post);
  const button =
    agentId === undefined || post.taskId === undefined ? null : (
      // Alone on a heads-up it gets a frame, so it lines up with the text above it.
      <Button
        variant={post.kind === "heads-up" ? "secondary" : "ghost"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MessageSquareReply size={14} aria-hidden />
        Reply
      </Button>
    );
  const box =
    open && agentId !== undefined && post.taskId !== undefined ? (
      <ReplyBox
        postId={post.id}
        agentId={agentId}
        taskId={post.taskId}
        onSent={() => setOpen(false)}
      />
    ) : null;
  return { button, box };
}

const openTask = (taskId: string | undefined) => {
  if (taskId !== undefined) navigate({ name: "task", taskId });
};

function LivingProgress({ post }: { post: FeedPost }) {
  const sessionId = post.sessionId ?? "";
  useTraces(post.sessionId === undefined ? [] : [sessionId]);
  const trace = useApp((state) => state.traces[sessionId]);
  const session = useApp((state) => state.sessions[sessionId]);
  if (trace === undefined || session === undefined) return null;
  const progress = progressOf(trace);
  const stage = stageOf(session.status === "starting" ? "starting" : "working", trace);
  const now = progress.current?.title ?? stage;
  const steps = Array.from({ length: Math.min(progress.stepCount, 12) }, (_, index) =>
    index < progress.stepsDone
      ? styles.stepDone
      : index === (progress.step?.number ?? 0) - 1
        ? styles.stepNow
        : "",
  );
  if (progress.step === undefined && now === undefined) return null;
  return (
    <div className={styles.progress}>
      {steps.length === 0 ? null : (
        <div
          className={styles.steps}
          role="img"
          aria-label={`${progress.stepsDone} of ${progress.stepCount} steps done`}
        >
          {steps.map((tone, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps have no ids of their own.
            <span key={index} className={`${styles.step} ${tone}`} />
          ))}
        </div>
      )}
      {progress.step === undefined ? null : (
        <div className={styles.stepLine}>
          <span title={`Step ${progress.step.number} of ${progress.stepCount}`}>
            <Count value={`${progress.step.number}/${progress.stepCount}`} />
          </span>
          <span className={styles.stepTitle}>{progress.step.title}</span>
        </div>
      )}
      {now === undefined || now === progress.step?.title ? null : (
        <span className={styles.now}>{now}</span>
      )}
    </div>
  );
}

const FILES_SHOWN = 4;

function ResultFiles({ taskId }: { taskId: string }) {
  const all = useApp((state) => state.outputs);
  const outputs = useMemo(
    () => Object.values(all).filter((output) => output.taskId === taskId),
    [all, taskId],
  );
  if (outputs.length === 0) return null;
  const hidden = outputs.length - FILES_SHOWN;
  return (
    <div className={styles.files}>
      {outputs.slice(0, FILES_SHOWN).map((output) => (
        <button
          key={output.id}
          type="button"
          className={styles.file}
          onClick={() => navigate({ name: "task", taskId, tab: "outputs", output: output.id })}
        >
          <FileText size={13} aria-hidden />
          {output.title}
        </button>
      ))}
      {hidden <= 0 ? null : (
        <button
          type="button"
          className={styles.file}
          onClick={() => navigate({ name: "task", taskId, tab: "outputs" })}
        >
          All files
          <Count value={outputs.length} />
        </button>
      )}
    </div>
  );
}

function ResultActions({ post, reply }: { post: FeedPost; reply: ReactNode }) {
  // A result the user has not marked done waits for review, as Tasks shows it.
  const review = useApp(
    (state) =>
      post.kind === "result" &&
      post.taskId !== undefined &&
      state.tasks[post.taskId]?.task.reviewedAt === undefined,
  );
  return (
    <div className={styles.actions}>
      <Button variant="primary" onClick={() => openTask(post.taskId)}>
        <SquareArrowOutUpRight size={14} aria-hidden />
        {review ? "Review" : "Open"}
      </Button>
      {reply}
    </div>
  );
}

function Suggested({ post, author, now }: { post: FeedPost; author: Author; now: number }) {
  const suggestion = post.suggestion;
  if (suggestion === undefined) return null;
  const setUp = () => {
    const { open } = suggestion;
    if (open.kind === "automation") {
      navigate({ name: "new-automation", describe: open.describe });
      return;
    }
    if (open.departmentId !== undefined) writeDraft(TARGET_DRAFT, open.departmentId);
    navigate({ name: "new-task", prompt: open.prompt });
  };
  const dismiss = () =>
    api.dismissSuggestion(post.id).catch(() => showToast("It could not be dismissed. Try again."));
  return (
    <article className={`${styles.post} ${styles.suggested}`} aria-label={post.title}>
      <Head post={post} author={author} now={now} />
      <h3 className={styles.title}>{post.title}</h3>
      {post.body === undefined ? null : <p className={styles.text}>{post.body}</p>}
      <div className={styles.actions}>
        <Button onClick={setUp}>Set it up</Button>
        <Button variant="ghost" onClick={() => void dismiss()}>
          Not now
        </Button>
        <span className={styles.push}>
          <MoreMenu
            label="More for this suggestion"
            menu={() => ({
              actions: [
                {
                  label: "Fewer like this",
                  icon: EyeOff,
                  run: async () => {
                    await api.fewerSuggestions(post.id);
                    showToast("You'll see fewer suggestions like this for 30 days.");
                  },
                },
                {
                  label: "Turn off suggestions",
                  icon: PowerOff,
                  run: async () => {
                    await api.setSuggestions(false);
                    await api.dismissSuggestion(post.id);
                    useApp.setState({ suggestions: false });
                    showToast("Suggestions are off. Turn them on in Settings.");
                  },
                },
              ],
            })}
          />
        </span>
      </div>
    </article>
  );
}

// One line for what is folded or settled.
function Row({ post, author, now }: { post: FeedPost; author: Author; now: number }) {
  return (
    <div className={styles.row}>
      {post.kind === "needs-you" ? (
        tile(<Check size={13} />, true)
      ) : (
        <span aria-hidden>{author.face(26)}</span>
      )}
      {/* An ask's title already names who asked. */}
      <span className={styles.rowText}>
        {post.kind === "needs-you" ? (
          <>
            <strong className={styles.rowTitle}>{post.title}</strong>
            <span className={styles.answered}>Answered</span>
          </>
        ) : (
          <>
            <strong className={styles.rowName}>{author.name}</strong>
            <span className={styles.rowTitle}>{post.title}</span>
          </>
        )}
      </span>
      <time className={styles.rowTime} dateTime={post.createdAt}>
        {ago(post.createdAt, now)}
      </time>
      {post.taskId === undefined ? null : (
        <Button variant="ghost" onClick={() => openTask(post.taskId)}>
          Open
        </Button>
      )}
    </div>
  );
}

function NeedsYou({ post, author, now }: { post: FeedPost; author: Author; now: number }) {
  const waiting = useApp((state) =>
    post.sessionId === undefined || post.requestId === undefined
      ? undefined
      : state.waiting[waitingKey(post.sessionId, post.requestId)],
  );
  // The same card as in Needs you, so an answer here closes it there too.
  if (waiting !== undefined && post.sessionId !== undefined) {
    return (
      <RequestCard event={waiting.event} context={<RequestContext sessionId={post.sessionId} />} />
    );
  }
  return <Row post={post} author={author} now={now} />;
}

interface FeedItemProps {
  post: FeedPost;
  now: number;
  older: boolean;
  arrived: boolean;
}

export function FeedItem({ post, now, older, arrived }: FeedItemProps) {
  const author = useAuthor(post);
  const reply = useReply(post);
  if (post.kind === "needs-you") return <NeedsYou post={post} author={author} now={now} />;
  if (post.kind === "suggested") return <Suggested post={post} author={author} now={now} />;
  if (post.kind === "milestone" || (post.kind === "automation" && post.body === undefined)) {
    return <Row post={post} author={author} now={now} />;
  }
  const classes = [styles.post, older ? styles.older : "", arrived ? styles.arrived : ""];
  return (
    <article className={classes.join(" ")} aria-label={post.title}>
      <Head post={post} author={author} now={now} />
      <h3 className={styles.title}>{post.title}</h3>
      {post.kind === "living" ? <LivingProgress post={post} /> : null}
      {post.kind === "living" && post.note !== undefined ? (
        <p className={styles.note}>
          {author.name}: {post.note}
        </p>
      ) : null}
      {post.body === undefined ? null : post.kind === "result" || post.kind === "automation" ? (
        <div className={styles.preview}>
          <Markdown text={post.body} />
        </div>
      ) : (
        <p className={styles.text}>{post.body}</p>
      )}
      {post.kind === "heads-up" ? <TaskLink post={post} /> : null}
      {post.kind === "result" && post.taskId !== undefined ? (
        <ResultFiles taskId={post.taskId} />
      ) : null}
      {post.kind === "result" || post.kind === "automation" ? (
        <ResultActions post={post} reply={reply.button} />
      ) : (
        <div className={styles.actions}>
          {post.kind === "stopped" || post.kind === "living" ? (
            <Button
              variant={post.kind === "stopped" ? "primary" : "secondary"}
              onClick={() => openTask(post.taskId)}
            >
              <SquareArrowOutUpRight size={14} aria-hidden />
              {post.kind === "living" ? "Watch" : "Open task"}
            </Button>
          ) : null}
          {reply.button}
        </div>
      )}
      {reply.box}
    </article>
  );
}
