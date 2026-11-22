import type {
  AutomationPreview,
  AutomationTask,
  Schedule,
  ScheduleEnd,
  Trigger,
} from "@office-town/contract";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { useAutomations } from "../../store/automations.ts";
import form from "../../ui/Form.module.css";
import page from "../../ui/Page.module.css";
import { CalendarField, today } from "./CalendarField.tsx";
import styles from "./NewAutomation.module.css";
import { useWhenText } from "./parts.tsx";
import { DAY_NAMES, localZone, runTime } from "./words.ts";

export interface WhenForm {
  mode: "schedule" | "after";
  preset: Schedule["repeat"];
  time: string;
  days: number[];
  day: number | "last";
  every: number;
  from: string;
  until: string | undefined;
  date: string;
  timeZone: string;
  starts: string | undefined;
  ends: ScheduleEnd;
  afterId: string | undefined;
  outcome: "done" | "any";
}

export const blankWhen = (): WhenForm => ({
  mode: "schedule",
  preset: "weekdays",
  time: "09:00",
  days: [1],
  day: 1,
  every: 2,
  from: "08:00",
  until: "18:00",
  date: today(),
  timeZone: localZone(),
  starts: undefined,
  ends: { kind: "never" },
  afterId: undefined,
  outcome: "done",
});

export function scheduleOf(when: WhenForm): Schedule {
  switch (when.preset) {
    case "daily":
    case "weekdays":
      return { repeat: when.preset, time: when.time };
    case "weekly":
      return { repeat: "weekly", days: when.days.length === 0 ? [1] : when.days, time: when.time };
    case "monthly":
      return { repeat: "monthly", day: when.day, time: when.time };
    case "hours":
      return {
        repeat: "hours",
        every: when.every,
        from: when.from,
        ...(when.until === undefined ? {} : { until: when.until }),
      };
    case "once":
      return { repeat: "once", date: when.date, time: when.time };
  }
}

export function triggerOf(when: WhenForm): Trigger | undefined {
  if (when.mode === "after") {
    return when.afterId === undefined
      ? undefined
      : { kind: "after", automationId: when.afterId, outcome: when.outcome };
  }
  const once = when.preset === "once";
  return {
    kind: "schedule",
    schedule: scheduleOf(when),
    timeZone: when.timeZone,
    ...(when.starts === undefined || once ? {} : { starts: when.starts }),
    ends: once ? { kind: "never" } : when.ends,
  };
}

export function whenOf(trigger: Trigger): WhenForm {
  const blank = blankWhen();
  if (trigger.kind === "after") {
    return { ...blank, mode: "after", afterId: trigger.automationId, outcome: trigger.outcome };
  }
  const { schedule } = trigger;
  const base = {
    ...blank,
    preset: schedule.repeat,
    timeZone: trigger.timeZone,
    starts: trigger.starts,
    ends: trigger.ends,
  };
  switch (schedule.repeat) {
    case "daily":
    case "weekdays":
      return { ...base, time: schedule.time };
    case "weekly":
      return { ...base, time: schedule.time, days: schedule.days };
    case "monthly":
      return { ...base, time: schedule.time, day: schedule.day };
    case "hours":
      return { ...base, every: schedule.every, from: schedule.from, until: schedule.until };
    case "once":
      return { ...base, date: schedule.date, time: schedule.time };
  }
}

const PRESETS: { value: Schedule["repeat"]; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "hours", label: "Every few hours" },
  { value: "once", label: "Once" },
];

const PREVIEW_DELAY_MS = 250;

// The next runs and what Save would say, read from the core as the When changes.
export function usePreview(
  id: string | undefined,
  task: AutomationTask | undefined,
  trigger: Trigger | undefined,
): AutomationPreview | undefined {
  const [preview, setPreview] = useState<AutomationPreview>();
  const key = JSON.stringify([trigger, task === undefined ? null : task]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key holds the trigger and task
  useEffect(() => {
    if (trigger === undefined) {
      setPreview(undefined);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      api
        .previewAutomation({
          ...(id === undefined ? {} : { id }),
          ...(task === undefined ? {} : { task }),
          trigger,
        })
        .then((answer) => {
          if (current) setPreview(answer);
        })
        .catch((failure: unknown) => console.warn("Could not preview the automation.", failure));
    }, PREVIEW_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, id]);
  return preview;
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (time: string) => void;
}) {
  return (
    <input
      type="time"
      className={styles.time}
      aria-label={label}
      value={value}
      step={300}
      onChange={(event) => {
        if (event.target.value !== "") onChange(event.target.value);
      }}
    />
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button type="button" className={form.chip} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

function Sentence({
  trigger,
  preview,
}: {
  trigger: Trigger;
  preview: AutomationPreview | undefined;
}) {
  const text = useWhenText({ trigger });
  return (
    <div className={styles.sentence} aria-live="polite">
      <strong>{text}</strong>
      {preview?.problem !== undefined ? (
        <span className={page.error}>{preview.problem}</span>
      ) : preview !== undefined && preview.nextRuns.length > 0 ? (
        <span className={styles.next}>
          Next: {preview.nextRuns.map((at) => runTime(at)).join(", ")}
        </span>
      ) : null}
    </div>
  );
}

export function WhenStep({
  id,
  value,
  onChange,
  task,
}: {
  id: string | undefined;
  value: WhenForm;
  onChange: (next: WhenForm) => void;
  task: AutomationTask | undefined;
}) {
  const others = (useAutomations() ?? []).filter((one) => one.id !== id);
  const set = (change: Partial<WhenForm>) => onChange({ ...value, ...change });
  const trigger = triggerOf(value);
  const preview = usePreview(id, task, trigger);
  const timed = value.preset !== "hours";
  return (
    <div className={styles.step}>
      <div className={styles.chipRow}>
        <Chip pressed={value.mode === "schedule"} onClick={() => set({ mode: "schedule" })}>
          On a schedule
        </Chip>
        <Chip pressed={value.mode === "after"} onClick={() => set({ mode: "after" })}>
          After another automation
        </Chip>
      </div>

      {value.mode === "after" ? (
        others.length === 0 ? (
          <p className={page.hint}>
            Save another automation first; this one can then run after it.
          </p>
        ) : (
          <div className={styles.lines}>
            <p className={styles.rule}>
              Run after{" "}
              <select
                className={styles.inline}
                aria-label="The automation it runs after"
                value={value.afterId ?? ""}
                onChange={(event) => set({ afterId: event.target.value || undefined })}
              >
                <option value="">choose one</option>
                {others.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
              </select>{" "}
              <select
                className={styles.inline}
                aria-label="How it must end"
                value={value.outcome}
                onChange={(event) => set({ outcome: event.target.value as "done" | "any" })}
              >
                <option value="done">finishes well</option>
                <option value="any">ends, however it went</option>
              </select>
              .
            </p>
          </div>
        )
      ) : (
        <>
          <div className={styles.chipRow}>
            {PRESETS.map((preset) => (
              <Chip
                key={preset.value}
                pressed={value.preset === preset.value}
                onClick={() => set({ preset: preset.value })}
              >
                {preset.label}
              </Chip>
            ))}
          </div>
          <div className={styles.lines}>
            {value.preset === "weekly" ? (
              <div className={styles.chipRow}>
                {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                  <Chip
                    key={day}
                    pressed={value.days.includes(day)}
                    onClick={() =>
                      set({
                        days: value.days.includes(day)
                          ? value.days.filter((each) => each !== day)
                          : [...value.days, day],
                      })
                    }
                  >
                    {DAY_NAMES[day]?.slice(0, 3) ?? ""}
                  </Chip>
                ))}
              </div>
            ) : null}
            {value.preset === "monthly" ? (
              <p className={styles.rule}>
                On the{" "}
                <select
                  className={styles.inline}
                  aria-label="Day of the month"
                  value={String(value.day)}
                  onChange={(event) =>
                    set({
                      day: event.target.value === "last" ? "last" : Number(event.target.value),
                    })
                  }
                >
                  {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                  <option value="last">last day</option>
                </select>{" "}
                of each month
              </p>
            ) : null}
            {value.preset === "once" ? (
              <p className={styles.rule}>
                On{" "}
                <CalendarField label="Date" value={value.date} onChange={(date) => set({ date })} />
              </p>
            ) : null}
            {value.preset === "hours" ? (
              <p className={styles.rule}>
                Every{" "}
                <select
                  className={styles.inline}
                  aria-label="Hours between runs"
                  value={value.every}
                  onChange={(event) => set({ every: Number(event.target.value) })}
                >
                  {[1, 2, 3, 4, 6, 8, 12].map((hours) => (
                    <option key={hours} value={hours}>
                      {hours === 1 ? "hour" : `${hours} hours`}
                    </option>
                  ))}
                </select>{" "}
                from{" "}
                <TimeField
                  label="First run"
                  value={value.from}
                  onChange={(from) => set({ from })}
                />{" "}
                to{" "}
                <TimeField
                  label="Last run"
                  value={value.until ?? "23:00"}
                  onChange={(until) => set({ until })}
                />
              </p>
            ) : null}
            {timed ? (
              <p className={styles.rule}>
                At <TimeField label="Time" value={value.time} onChange={(time) => set({ time })} />
                {value.timeZone === localZone() ? null : (
                  <span className={page.hint}> ({value.timeZone})</span>
                )}
              </p>
            ) : null}
            {value.preset === "once" ? null : (
              <>
                <p className={styles.rule}>
                  Starts{" "}
                  <select
                    className={styles.inline}
                    aria-label="Starts"
                    value={value.starts === undefined ? "now" : "on"}
                    onChange={(event) =>
                      set({ starts: event.target.value === "now" ? undefined : today() })
                    }
                  >
                    <option value="now">now</option>
                    <option value="on">on a date</option>
                  </select>
                  {value.starts === undefined ? null : (
                    <>
                      {" "}
                      <CalendarField
                        label="Start date"
                        value={value.starts}
                        onChange={(starts) => set({ starts })}
                      />
                    </>
                  )}
                </p>
                <p className={styles.rule}>
                  Ends{" "}
                  <select
                    className={styles.inline}
                    aria-label="Ends"
                    value={value.ends.kind}
                    onChange={(event) => {
                      const kind = event.target.value;
                      set({
                        ends:
                          kind === "on"
                            ? { kind: "on", date: value.starts ?? today() }
                            : kind === "after"
                              ? { kind: "after", runs: 10 }
                              : { kind: "never" },
                      });
                    }}
                  >
                    <option value="never">never</option>
                    <option value="on">on a date</option>
                    <option value="after">after a number of runs</option>
                  </select>
                  {value.ends.kind === "on" ? (
                    <>
                      {" "}
                      <CalendarField
                        label="End date"
                        value={value.ends.date}
                        from={value.starts ?? today()}
                        onChange={(date) => set({ ends: { kind: "on", date } })}
                      />
                    </>
                  ) : value.ends.kind === "after" ? (
                    <>
                      {" "}
                      <input
                        type="number"
                        className={styles.count}
                        aria-label="Runs"
                        min={1}
                        max={1000}
                        value={value.ends.runs}
                        onChange={(event) =>
                          set({
                            ends: {
                              kind: "after",
                              runs: Math.min(1000, Math.max(1, Number(event.target.value) || 1)),
                            },
                          })
                        }
                      />{" "}
                      runs
                    </>
                  ) : null}
                </p>
              </>
            )}
          </div>
        </>
      )}
      {trigger === undefined ? null : <Sentence trigger={trigger} preview={preview} />}
    </div>
  );
}
