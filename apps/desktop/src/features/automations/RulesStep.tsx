import { type AutomationRules, automationRulesSchema } from "@office-town/contract";
import { SwitchRow } from "../../ui/Switch.tsx";
import styles from "./NewAutomation.module.css";

export const DEFAULT_RULES: AutomationRules = automationRulesSchema.parse({});

export const hours = (count: number) => (count === 1 ? "1 hour" : `${count} hours`);

function Pick<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      className={styles.inline}
      aria-label={label}
      value={String(value)}
      onChange={(event) => {
        const picked = options.find((option) => String(option.value) === event.target.value);
        if (picked !== undefined) onChange(picked.value);
      }}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// "No limit" stands for null, which a select cannot hold.
const NO_LIMIT = 0;

export function RulesStep({
  value,
  onChange,
  sharesLimits,
  savesResult,
}: {
  value: AutomationRules;
  onChange: (next: AutomationRules) => void;
  // Only where the provider shares limits can a run skip near them.
  sharesLimits: boolean;
  // A chief's goal has no workspace, so no Library to save to.
  savesResult: boolean;
}) {
  const set = (change: Partial<AutomationRules>) => onChange({ ...value, ...change });
  return (
    <div className={styles.step}>
      <div className={styles.lines}>
        <p className={styles.rule}>
          When a decision comes up,{" "}
          <Pick
            label="Decisions"
            value={value.decisions}
            options={[
              { value: "ask", label: "ask me in Needs you" },
              { value: "auto", label: "let Auto decide" },
            ]}
            onChange={(decisions) => set({ decisions })}
          />
          .
        </p>
        {value.decisions === "auto" ? (
          <p className={styles.note}>
            Auto runs it end to end: plans, new departments, questions, changes and stopping workers
            are decided without you, and each decision shows in the task. Permission asks still
            follow its level.
          </p>
        ) : null}
        <p className={styles.rule}>
          If its team is busy, wait up to{" "}
          <Pick
            label="Longest wait"
            value={value.waitHours}
            options={[1, 2, 4, 6, 12].map((count) => ({ value: count, label: hours(count) }))}
            onChange={(waitHours) => set({ waitHours })}
          />
          , then skip the run.
        </p>
        <p className={styles.rule}>
          If Office Town was closed at its time,{" "}
          <Pick
            label="Catch up"
            value={value.catchUpHours}
            options={[
              { value: 0, label: "skip the run" },
              ...[1, 2, 6, 12, 24, 48].map((count) => ({
                value: count,
                label: `run it within ${hours(count)}`,
              })),
            ]}
            onChange={(catchUpHours) => set({ catchUpHours })}
          />
          .
        </p>
        <p className={styles.rule}>
          End a run that waits{" "}
          <Pick
            label="Answer within"
            value={value.answerWithinHours ?? NO_LIMIT}
            options={[
              ...[1, 4, 12, 24, 48, 72, 168].map((count) => ({
                value: count,
                label: count === 168 ? "7 days" : hours(count),
              })),
              { value: NO_LIMIT, label: "as long as it takes" },
            ]}
            onChange={(picked) => set({ answerWithinHours: picked === NO_LIMIT ? null : picked })}
          />{" "}
          for an answer.
        </p>
        {value.answerWithinHours === null ? (
          <p className={styles.note}>Later runs are skipped while one waits for you.</p>
        ) : null}
        {sharesLimits ? (
          <p className={styles.rule}>
            When its account's usage is high,{" "}
            <Pick
              label="High usage"
              value={value.skipAbove === undefined ? "never" : String(value.skipAbove)}
              options={[
                { value: "never", label: "wait until there's room" },
                { value: "0.9", label: "skip the run past 90%" },
                { value: "0.7", label: "skip the run past 70%" },
              ]}
              onChange={(picked) => {
                const { skipAbove: _, ...rest } = value;
                onChange(
                  picked === "never" ? rest : { ...rest, skipAbove: picked === "0.7" ? 0.7 : 0.9 },
                );
              }}
            />
            .
          </p>
        ) : null}
      </div>
      <div className={styles.switches}>
        <SwitchRow
          label="Let me review each run"
          hint="Off: a finished run counts as Done."
          on={value.review}
          onChange={(review) => set({ review })}
        />
        {savesResult ? (
          <SwitchRow
            label="Save each result to the Library"
            hint="In its workspace, given to everyone there."
            on={value.saveResult}
            onChange={(saveResult) => set({ saveResult })}
          />
        ) : null}
      </div>
    </div>
  );
}
