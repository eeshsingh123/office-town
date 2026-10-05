import type { PermissionOption, Question, UserRequestEvent } from "@office-town/contract";
import { CircleHelp, ShieldCheck } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { requestKey } from "../../trace/trace.ts";
import { Button } from "../../ui/Button.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import styles from "./RequestCard.module.css";

const DETAIL_LIMIT = 2000;
const OWN_ANSWER = "~own";

interface RequestCardProps {
  event: UserRequestEvent;
  // Who asks and for which task, where the card stands apart from its trace.
  context?: ReactNode;
}

function useMinutesSince(timestamp: string): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60_000));
}

// The part of a request's input a person needs to decide: the command, else the file, else all.
function detailOf(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const fields = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "url"]) {
    if (typeof fields[key] === "string") return fields[key];
  }
  const text = JSON.stringify(input, null, 2);
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text;
}

const VARIANTS: Record<PermissionOption["kind"], "primary" | "secondary" | "ghost"> = {
  allow_once: "primary",
  allow_always: "secondary",
  reject_once: "ghost",
  reject_always: "ghost",
};

function useAnswer() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (answer: () => Promise<void>) => {
    setSending(true);
    setError(undefined);
    try {
      await answer();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSending(false);
    }
  };
  return { sending, error, run };
}

type PermissionEvent = Extract<UserRequestEvent, { type: "permission.requested" }>;
type QuestionEvent = Extract<UserRequestEvent, { type: "question.requested" }>;

function PermissionBody({ event, context }: { event: PermissionEvent; context: ReactNode }) {
  const { sending, error, run } = useAnswer();
  const { requestId, title, input, options } = event.payload;
  const detail = detailOf(input);
  return (
    <div className={styles.body}>
      {context}
      <strong>{title}</strong>
      {detail === undefined ? null : <pre className={styles.code}>{detail}</pre>}
      <div className={styles.buttons}>
        {options.map((option) => (
          <Button
            key={option.optionId}
            variant={VARIANTS[option.kind]}
            disabled={sending}
            onClick={() =>
              run(() =>
                api.command(event.sessionId, {
                  type: "answerPermission",
                  requestId,
                  optionId: option.optionId,
                }),
              )
            }
          >
            {option.label}
          </Button>
        ))}
      </div>
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function QuestionField({
  question,
  name,
  picked,
  own,
  onPick,
  onOwn,
}: {
  question: Question;
  name: string;
  picked: string[];
  own: string;
  onPick: (picked: string[]) => void;
  onOwn: (text: string) => void;
}) {
  const type = question.multiSelect ? "checkbox" : "radio";
  const toggle = (value: string, checked: boolean) => {
    if (!question.multiSelect) onPick([value]);
    else onPick(checked ? [...picked, value] : picked.filter((item) => item !== value));
  };
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{question.text}</legend>
      {question.options.map((option) => (
        <label key={option.label} className={styles.choice}>
          <input
            type={type}
            name={name}
            checked={picked.includes(option.label)}
            onChange={(change) => toggle(option.label, change.target.checked)}
          />
          <span className={styles.choiceText}>
            <span className={styles.choiceLabel}>{option.label}</span>
            {option.description === undefined ? null : (
              <span className={styles.choiceDescription}>{option.description}</span>
            )}
          </span>
        </label>
      ))}
      <label className={styles.choice}>
        <input
          type={type}
          name={name}
          checked={picked.includes(OWN_ANSWER)}
          onChange={(change) => toggle(OWN_ANSWER, change.target.checked)}
        />
        <span className={styles.choiceText}>
          <span className={styles.choiceLabel}>Your own answer</span>
          <input
            className={styles.own}
            aria-label={`Your own answer to: ${question.text}`}
            placeholder="Type an answer"
            value={own}
            onFocus={() => {
              if (!picked.includes(OWN_ANSWER)) toggle(OWN_ANSWER, true);
            }}
            onChange={(change) => onOwn(change.target.value)}
          />
        </span>
      </label>
    </fieldset>
  );
}

function QuestionBody({ event, context }: { event: QuestionEvent; context: ReactNode }) {
  const { sending, error, run } = useAnswer();
  const { requestId, questions } = event.payload;
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [own, setOwn] = useState<Record<string, string>>({});
  // A pick of "your own answer" counts once its words are typed.
  const answers = questions.map((question) => ({
    questionId: question.questionId,
    selected: (picked[question.questionId] ?? []).flatMap((value) =>
      value === OWN_ANSWER ? own[question.questionId]?.trim() || [] : [value],
    ),
  }));
  const complete = answers.every((answer) => answer.selected.length > 0);
  const submit = (submitted: FormEvent) => {
    submitted.preventDefault();
    if (!complete) return;
    void run(() =>
      api.command(event.sessionId, {
        type: "answerQuestion",
        requestId,
        answers,
      }),
    );
  };
  return (
    <form className={styles.body} onSubmit={submit}>
      {context}
      {questions.map((question) => (
        <QuestionField
          key={question.questionId}
          question={question}
          name={`${event.id}-${question.questionId}`}
          picked={picked[question.questionId] ?? []}
          own={own[question.questionId] ?? ""}
          onPick={(next) => setPicked({ ...picked, [question.questionId]: next })}
          onOwn={(text) => setOwn({ ...own, [question.questionId]: text })}
        />
      ))}
      <div className={styles.buttons}>
        <Button type="submit" variant="primary" disabled={!complete || sending}>
          Send answer
        </Button>
      </div>
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

// One card for a waiting request, wherever it shows: in its trace and in the Needs you queue.
export function RequestCard({ event, context }: RequestCardProps) {
  if (event.type === "proposal.requested") return <ProposalCard event={event} context={context} />;
  return <AskCard event={event} context={context} />;
}

function AskCard({
  event,
  context,
}: {
  event: PermissionEvent | QuestionEvent;
  context?: ReactNode;
}) {
  const minutes = useMinutesSince(event.timestamp);
  const permission = event.type === "permission.requested";
  return (
    <article
      id={requestKey(event.payload.requestId)}
      className={`${styles.card} ${permission ? "" : styles.question}`}
      aria-label={permission ? "Permission request" : "Question"}
    >
      <div className={styles.head}>
        {permission ? <ShieldCheck size={16} aria-hidden /> : <CircleHelp size={16} aria-hidden />}
        {permission ? "Asks your permission" : "Asks you a question"}
        <span className={styles.since}>
          {minutes === 0 ? "just now" : `waiting ${minutes} min`}
        </span>
      </div>
      {event.type === "permission.requested" ? (
        <PermissionBody event={event} context={context} />
      ) : (
        <QuestionBody event={event} context={context} />
      )}
    </article>
  );
}
