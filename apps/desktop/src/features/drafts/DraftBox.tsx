import type { DraftQuestion, RoleSettings } from "@office-town/contract";
import { ArrowUp, LoaderCircle, Plus, Sparkles } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import composer from "../new-task/Composer.module.css";
import { ModelChip } from "../new-task/ModelChip.tsx";
import styles from "./DraftBox.module.css";
import { useDrafter } from "./use-drafter.ts";

export interface DraftAnswer {
  questions: DraftQuestion[];
  suggestions: string[];
}

interface DraftBoxProps {
  label: string;
  placeholder: string;
  action: string;
  // Once there is a draft, the box asks for changes to it.
  drafted: boolean;
  // Handed over from another screen and drafted at once.
  initial?: string;
  run: (notes: string[], drafter: RoleSettings) => Promise<DraftAnswer>;
}

const DRAFT_ANYWAY = "Draft it now. Choose sensibly where I did not say.";

// Describe it in your own words; the model may ask what would change the draft, and suggests what was missed.
export function DraftBox({ label, placeholder, action, drafted, initial, run }: DraftBoxProps) {
  const [drafter, setDrafter] = useDrafter();
  const [notes, setNotes] = useState<string[]>([]);
  const [text, setText] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const started = useRef(false);

  const send = async (added: string[]) => {
    const next = [...notes, ...added.map((note) => note.trim()).filter(Boolean)];
    if (next.length === notes.length || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const answer = await run(next, drafter);
      setNotes(next);
      setText("");
      setQuestions(answer.questions);
      setAnswers({});
      setSuggestions(answer.suggestions);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: drafts the handed-over text once
  useEffect(() => {
    if (started.current || initial === undefined || initial.trim() === "") return;
    started.current = true;
    void send([initial]);
  }, []);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    void send([text]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };
  const answered = questions.flatMap((question, index) => {
    const answer = answers[index]?.trim();
    return answer ? [`Q: ${question.question} A: ${answer}`] : [];
  });

  return (
    <div className={styles.box} data-tour="draft">
      <form className={composer.composer} onSubmit={submit}>
        <label className="visually-hidden" htmlFor="draft-text">
          {label}
        </label>
        <textarea
          id="draft-text"
          className={`${composer.prompt} ${styles.text}`}
          value={text}
          rows={drafted ? 1 : 3}
          placeholder={
            drafted
              ? "Change something, for example: make the reviewer use a free model"
              : placeholder
          }
          disabled={busy}
          onChange={(change) => setText(change.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={composer.bar}>
          <div className={composer.chips} title="The model that writes the draft">
            <ModelChip value={drafter} recent={[]} onChange={setDrafter} />
            {busy ? (
              <span className={styles.busy} role="status">
                <LoaderCircle size={14} className="spin" aria-hidden />
                Drafting. This can take a minute.
              </span>
            ) : null}
          </div>
          <Button type="submit" variant="primary" disabled={busy || text.trim() === ""}>
            {drafted ? <ArrowUp size={15} aria-hidden /> : <Sparkles size={15} aria-hidden />}
            {drafted ? "Update draft" : action}
          </Button>
        </div>
      </form>

      {error === undefined ? null : (
        <p className={form.hint} role="alert">
          <span className={styles.error}>{error}</span>
        </p>
      )}

      {questions.length === 0 || busy ? null : (
        <section className={styles.questions} aria-label="Questions about your draft">
          {questions.map((question, index) => (
            <div key={question.question} className={styles.question}>
              <strong>{question.question}</strong>
              <div className={styles.options}>
                {question.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={form.chip}
                    aria-pressed={answers[index] === option}
                    onClick={() => setAnswers({ ...answers, [index]: option })}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <input
                className={form.input}
                aria-label={`Your own answer to: ${question.question}`}
                placeholder="Or write your own answer"
                value={
                  question.options.includes(answers[index] ?? "") ? "" : (answers[index] ?? "")
                }
                onChange={(change) => setAnswers({ ...answers, [index]: change.target.value })}
              />
            </div>
          ))}
          <div className={styles.questionActions}>
            <Button variant="ghost" onClick={() => void send([DRAFT_ANYWAY])}>
              Draft without answering
            </Button>
            <Button
              variant="primary"
              disabled={answered.length === 0}
              onClick={() => void send(answered)}
            >
              Continue
            </Button>
          </div>
        </section>
      )}

      {suggestions.length === 0 || busy || questions.length > 0 ? null : (
        <div className={styles.suggestions}>
          <span className={form.hint}>You may have missed:</span>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className={styles.suggestion}
              onClick={() => void send([suggestion])}
            >
              <Plus size={13} aria-hidden />
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
