import {
  type Autonomy,
  autonomySchema,
  type StartTaskRequest,
  type WorkspaceRecord,
} from "@office-town/contract";
import { Plus, User, Users } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { type KeyboardEvent, useState } from "react";
import { environmentKey, readCatalog } from "../../api/catalogs.ts";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { track } from "../../store/live.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import { type Choice, ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { FolderField } from "../../ui/FolderField.tsx";
import { profileSummary } from "../../ui/format.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import { useLoaded } from "../../ui/use-loaded.ts";
import { SettingsChips } from "../profiles/SettingsChips.tsx";
import { DEFAULT_CHOICES, type HarnessChoices, loadRemembered, remember } from "./choices.ts";
import styles from "./NewTaskView.module.css";
import { PROPOSE, TeamChoice } from "./TeamChoice.tsx";
import { WorkspaceDialog } from "./WorkspaceDialog.tsx";

const LEVELS: Choice<Autonomy>[] = autonomySchema.options.map((level) => ({
  value: level,
  ...AUTONOMY[level],
}));
// A value no profile id can take, since an id starts with a letter or digit.
const LAST_CHOICES = "~last";

export function NewTaskView() {
  const harnesses = useApp((state) => state.harnesses);
  const [remembered] = useState(loadRemembered);
  const [harness, setHarness] = useState(remembered.harness);
  const [profileId, setProfileId] = useState(remembered.profileId);
  const [who, setWho] = useState<"one" | "team">(remembered.team ? "team" : "one");
  const [departmentId, setDepartmentId] = useState(PROPOSE);
  const [teamAutonomy, setTeamAutonomy] = useState<Autonomy>("trusted");
  const [choices, setChoices] = useState<HarnessChoices>(
    (remembered.harness && remembered.byHarness[remembered.harness]) || DEFAULT_CHOICES,
  );
  const [prompt, setPrompt] = useState("");
  const [place, setPlace] = useState<"workspace" | "folder">(
    remembered.workspaceId === undefined ? "folder" : "workspace",
  );
  const [workspaceId, setWorkspaceId] = useState(remembered.workspaceId);
  const [chosenFolder, setChosenFolder] = useState<string>();
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  const description = harnesses.find((known) => known.harness === harness) ?? harnesses[0];
  const listed = useLoaded("workspaces", api.listWorkspaces);
  const [created, setCreated] = useState<WorkspaceRecord[]>([]);
  const workspaces = [...created, ...(listed.value ?? [])];
  const settings = useLoaded("settings", api.readSettings);
  const profiles = useLoaded("profiles", api.listProfiles);
  const profile = profiles.value?.find((known) => known.id === profileId);
  const outputFolder = chosenFolder ?? settings.value?.outputFolder;
  // Read once and cached, so this shares the model list the chips load.
  const catalog = useLoaded(
    description?.capabilities.modelList
      ? `${description.harness}|${environmentKey(choices.environment)}`
      : undefined,
    () => readCatalog(description?.harness ?? "", choices.environment),
  );
  const model = catalog.value?.models.find((known) => known.id === choices.model);
  const workspace = workspaces.find((known) => known.id === workspaceId);
  const where =
    place === "workspace"
      ? workspace && { workspaceId: workspace.id }
      : outputFolder && { outputFolder };
  const fromProfile = profile !== undefined;
  const soloAutonomy = choices.autonomy ?? "supervised";
  const soloGate = useBypassGate(
    soloAutonomy,
    (autonomy) => setChoices({ ...choices, autonomy }),
    "this agent",
  );
  const teamGate = useBypassGate(teamAutonomy, setTeamAutonomy, "the team");
  const team = who === "team";
  const proposing = team && departmentId === PROPOSE;
  const placed = team ? !proposing || workspace !== undefined : Boolean(where);
  const ready = (fromProfile || description !== undefined) && prompt.trim() !== "" && placed;

  const start = async () => {
    if (!ready || starting || description === undefined) return;
    setStarting(true);
    setError(undefined);
    const { environment, model: chosenModel, effort } = choices;
    const agent: StartTaskRequest["agent"] = fromProfile
      ? { profileId: profile.id }
      : {
          settings: {
            harness: description.harness,
            environment,
            ...(chosenModel === undefined ? {} : { model: chosenModel }),
            ...(effort === undefined ? {} : { effort }),
          },
        };
    const goal = prompt.trim();
    try {
      const session = team
        ? await api.startTeamTask({
            goal,
            team:
              proposing && workspace !== undefined
                ? { lead: agent, workspaceId: workspace.id, autonomy: teamAutonomy }
                : { departmentId },
          })
        : await api.startTask({
            prompt: goal,
            agent,
            autonomy: soloAutonomy,
            ...(where || {}),
          });
      remember(
        description.harness,
        choices,
        place === "workspace" || team ? workspace?.id : undefined,
        profile?.id,
        team,
      );
      await track(session.taskId);
      navigate({ name: "task", taskId: session.taskId });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStarting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void start();
    }
  };

  return (
    <section className={styles.page} aria-labelledby="new-task-title">
      <div className={styles.column}>
        <div className={styles.titleRow}>
          <h1 id="new-task-title" className={styles.title}>
            {team ? "What should the team do?" : "What should the agent do?"}
          </h1>
          <ToggleGroup.Root
            type="single"
            className={styles.segments}
            value={who}
            onValueChange={(next) => {
              if (next === "one" || next === "team") setWho(next);
            }}
            aria-label="Who works on it"
          >
            <ToggleGroup.Item value="one" className={styles.segment}>
              <User size={14} aria-hidden />
              One agent
            </ToggleGroup.Item>
            <ToggleGroup.Item value="team" className={styles.segment}>
              <Users size={14} aria-hidden />A team
            </ToggleGroup.Item>
          </ToggleGroup.Root>
        </div>
        <p className={styles.lead}>
          {team
            ? "Describe the goal. A lead hands the work to its team and puts it together; the lead's first step is a team proposal you approve."
            : "Describe the task in your own words. You can answer its questions and approve its actions as it works."}
        </p>

        <div className={styles.composer}>
          <label htmlFor="task-prompt" className="visually-hidden">
            Task
          </label>
          <textarea
            id="task-prompt"
            className={styles.prompt}
            rows={4}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="For example: summarise the support tickets in tickets.csv into the five most common problems"
            // biome-ignore lint/a11y/noAutofocus: the view exists to take this text
            autoFocus
          />
          <div className={styles.options}>
            {(profiles.value ?? []).length === 0 || (team && !proposing) ? null : (
              <ChoiceMenu
                label={team ? "Lead" : "Agent"}
                value={profile?.id ?? LAST_CHOICES}
                choices={[
                  { value: LAST_CHOICES, label: "Your last choices" },
                  ...(profiles.value ?? []).map((known) => ({
                    value: known.id,
                    label: known.name,
                    description: profileSummary(known, harnesses),
                  })),
                ]}
                onChange={(next) => setProfileId(next === LAST_CHOICES ? undefined : next)}
              />
            )}
            {fromProfile || description === undefined || (team && !proposing) ? null : (
              <SettingsChips
                value={{
                  harness: description.harness,
                  environment: choices.environment,
                  ...(choices.model === undefined ? {} : { model: choices.model }),
                  ...(choices.effort === undefined ? {} : { effort: choices.effort }),
                }}
                recentModels={choices.recentModels}
                onChange={({ harness: next, environment, model: nextModel, effort }) => {
                  if (next !== description.harness) {
                    setHarness(next);
                    setChoices(loadRemembered().byHarness[next] ?? DEFAULT_CHOICES);
                    return;
                  }
                  const { autonomy, recentModels } = choices;
                  setChoices({
                    environment,
                    recentModels,
                    ...(autonomy === undefined ? {} : { autonomy }),
                    ...(nextModel === undefined ? {} : { model: nextModel }),
                    ...(effort === undefined ? {} : { effort }),
                  });
                }}
              />
            )}
            {team ? null : (
              <ChoiceMenu
                label="Autonomy"
                value={soloAutonomy}
                choices={LEVELS}
                onChange={soloGate.choose}
              />
            )}
            {team && !proposing ? (
              <span className={styles.hint}>The department's own lead takes the goal.</span>
            ) : null}
          </div>
        </div>

        {team ? (
          <TeamChoice
            departmentId={departmentId}
            onDepartment={setDepartmentId}
            workspaces={workspaces}
            workspaceId={workspace?.id}
            onWorkspace={setWorkspaceId}
            onNewWorkspace={() => setCreatingWorkspace(true)}
            autonomy={teamAutonomy}
            onAutonomy={teamGate.choose}
          />
        ) : (
          <div className={styles.where}>
            <h2 className={styles.heading}>Where it works</h2>
            <ToggleGroup.Root
              type="single"
              className={styles.segments}
              value={place}
              onValueChange={(next) => {
                if (next === "workspace" || next === "folder") setPlace(next);
              }}
              aria-label="Where it works"
            >
              <ToggleGroup.Item value="workspace" className={styles.segment}>
                A workspace
              </ToggleGroup.Item>
              <ToggleGroup.Item value="folder" className={styles.segment}>
                A new folder
              </ToggleGroup.Item>
            </ToggleGroup.Root>
            {place === "workspace" ? (
              <div className={styles.workspace}>
                {workspaces.length > 0 ? (
                  <ChoiceMenu
                    label="Workspace"
                    value={workspace?.id ?? ""}
                    choices={workspaces.map((known) => ({
                      value: known.id,
                      label: known.name,
                      description: known.folders.join(" · "),
                    }))}
                    onChange={setWorkspaceId}
                  />
                ) : (
                  <span className={styles.hint}>No saved workspace yet.</span>
                )}
                <Button variant="ghost" onClick={() => setCreatingWorkspace(true)}>
                  <Plus size={14} aria-hidden />
                  New workspace
                </Button>
              </div>
            ) : (
              <FolderField
                label="output folder"
                value={outputFolder}
                onChange={setChosenFolder}
                hint="The task gets its own folder inside, named by the date and your first words."
              />
            )}
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="primary" onClick={start} disabled={!ready || starting}>
            {starting ? "Starting…" : team ? "Start" : "Start task"}
          </Button>
          <span className={styles.hint}>
            <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd>
          </span>
          {!fromProfile && model?.access === "free" && !(team && !proposing) ? (
            <span className={styles.note}>Free model</span>
          ) : null}
          {proposing ? (
            <span className={styles.hint}>
              The lead's first step is the team proposal. It waits for you in Needs you.
            </span>
          ) : null}
        </div>
        {error === undefined ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
      {soloGate.confirm}
      {teamGate.confirm}
      <WorkspaceDialog
        open={creatingWorkspace}
        onOpenChange={setCreatingWorkspace}
        onCreated={(added) => {
          setCreated([added, ...created]);
          setWorkspaceId(added.id);
        }}
      />
    </section>
  );
}
