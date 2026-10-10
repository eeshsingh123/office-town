import { type KeyboardEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { track } from "../../store/live.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { useLoaded } from "../../ui/use-loaded.ts";
import { loadRemembered } from "../new-task/choices.ts";
import { selectAgent } from "../office/office-state.ts";
import styles from "./Home.module.css";
import { soloRequest } from "./quick-task.ts";

// No department id can take these, since an id starts with a letter or digit.
const CHIEF = "~chief";
const SOLO = "~solo";

// Quick assignment; anything it cannot start by itself goes on to New task with the text.
export function QuickTask() {
  const chiefId = useApp((state) => state.chiefId);
  const departments = useApp((state) => state.departments);
  const harnesses = useApp((state) => state.harnesses);
  const settings = useLoaded("settings", api.readSettings);
  const [remembered] = useState(loadRemembered);
  const [prompt, setPrompt] = useState("");
  const [chosen, setChosen] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  const sorted = Object.values(departments).toSorted((a, b) => a.name.localeCompare(b.name));
  // A team by default, since that is what the app is for.
  const target = chosen ?? (chiefId === undefined ? (sorted[0]?.id ?? SOLO) : CHIEF);
  const goal = prompt.trim();
  const solo = soloRequest(goal, remembered, harnesses, settings.value?.outputFolder);
  const handOver = target === SOLO && solo === undefined;
  const soloHarness = harnesses.find(
    (known) => known.harness === (remembered.harness ?? harnesses[0]?.harness),
  );

  const moreOptions = () =>
    navigate({
      name: "new-task",
      prompt,
      who: target === CHIEF ? "chief" : target === SOLO ? "one" : "team",
      ...(target === CHIEF || target === SOLO ? {} : { departmentId: target }),
    });

  const start = async () => {
    if (goal === "" || starting) return;
    if (handOver) {
      moreOptions();
      return;
    }
    setStarting(true);
    setError(undefined);
    try {
      if (target === CHIEF && chiefId !== undefined) {
        const { task } = await api.startChiefTask(goal);
        await track(task.id);
        selectAgent(chiefId);
        return;
      }
      const session =
        target === SOLO && solo !== undefined
          ? await api.startTask(solo)
          : await api.startTeamTask({ goal, team: { departmentId: target } });
      await track(session.taskId);
      navigate({ name: "task", taskId: session.taskId });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStarting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void start();
    }
  };

  const soloNote =
    solo === undefined
      ? "Pick where it works in New task"
      : `${remembered.profileId === undefined ? (soloHarness?.name ?? "Agent") : "From a template"} · ${AUTONOMY[solo.autonomy].label}`;

  return (
    <div className={styles.composer}>
      <label htmlFor="quick-task" className="visually-hidden">
        Task
      </label>
      <textarea
        id="quick-task"
        className={styles.prompt}
        rows={2}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="What should your team do? For example: fix the failing tests in my-app"
      />
      <div className={styles.composerBar}>
        <ChoiceMenu
          label="Goes to"
          value={target}
          choices={[
            ...(chiefId === undefined
              ? []
              : [{ value: CHIEF, label: "Chief", description: "Splits it across departments" }]),
            ...sorted.map((department) => ({
              value: department.id,
              label: department.name,
              description: "Its lead hands out the work",
            })),
            { value: SOLO, label: "Solo agent", description: soloNote },
          ]}
          onChange={setChosen}
        />
        {target === SOLO ? <span className={styles.hint}>{soloNote}</span> : null}
        <span className={styles.spacer} />
        <Button variant="ghost" onClick={moreOptions}>
          More options
        </Button>
        <Button variant="primary" onClick={start} disabled={goal === "" || starting}>
          {starting ? "Starting…" : handOver ? "Continue" : "Start"}
        </Button>
      </div>
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
