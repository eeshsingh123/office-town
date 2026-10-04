import type {
  EnvironmentSpec,
  HarnessCatalog,
  PermissionMode,
  StartTaskRequest,
  WorkspaceRecord,
} from "@office-town/contract";
import { Plus } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { type KeyboardEvent, useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { track } from "../../store/live.ts";
import { Button } from "../../ui/Button.tsx";
import { type Choice, ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { FolderField } from "../../ui/FolderField.tsx";
import { environmentName } from "../../ui/format.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import { useLoaded } from "../../ui/use-loaded.ts";
import { DEFAULT_CHOICES, type HarnessChoices, loadRemembered, remember } from "./choices.ts";
import { ModelPicker } from "./ModelPicker.tsx";
import styles from "./NewTaskView.module.css";
import { WorkspaceDialog } from "./WorkspaceDialog.tsx";

const PERMISSIONS: Choice<PermissionMode>[] = [
  {
    value: "ask",
    label: "Ask before changes",
    description: "Asks you before it edits files or runs commands",
  },
  {
    value: "acceptEdits",
    label: "Allow edits",
    description: "Edits files freely, asks before it runs commands",
  },
  {
    value: "bypass",
    label: "Allow everything",
    description: "Never asks, so use it only where nothing important can break",
  },
];
// A value no effort can take, since the harness's own words start with a letter or digit.
const DEFAULT_EFFORT = "~default";

// Catalogs come from running the harness's CLI, which takes seconds, so each is read once.
const catalogs = new Map<string, Promise<HarnessCatalog>>();
function readCatalog(harness: string, environment: EnvironmentSpec): Promise<HarnessCatalog> {
  const key = `${harness}|${environmentKey(environment)}`;
  const cached = catalogs.get(key);
  if (cached !== undefined) return cached;
  const reading = api.readCatalog(harness, environment);
  catalogs.set(key, reading);
  reading.catch(() => catalogs.delete(key));
  return reading;
}

const environmentKey = (environment: EnvironmentSpec) =>
  environment.kind === "wsl" ? `wsl:${environment.distro}` : "native";

export function NewTaskView() {
  const harnesses = useApp((state) => state.harnesses);
  const [remembered] = useState(loadRemembered);
  const [harness, setHarness] = useState(remembered.harness);
  const [choices, setChoices] = useState<HarnessChoices>(
    (remembered.harness && remembered.byHarness[remembered.harness]) || DEFAULT_CHOICES,
  );
  const [prompt, setPrompt] = useState("");
  const [place, setPlace] = useState<"workspace" | "folder">(
    remembered.workspaceId === undefined ? "folder" : "workspace",
  );
  const [workspaceId, setWorkspaceId] = useState(remembered.workspaceId);
  const [outputFolder, setOutputFolder] = useState<string>();
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  const description = harnesses.find((known) => known.harness === harness) ?? harnesses[0];
  const environments = useLoaded("environments", api.listEnvironments);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const listed = useLoaded("workspaces", api.listWorkspaces);
  const settings = useLoaded("settings", api.readSettings);
  const catalogKey =
    description === undefined || !description.capabilities.modelList
      ? undefined
      : `${description.harness}|${environmentKey(choices.environment)}`;
  const catalog = useLoaded(catalogKey, () =>
    readCatalog(description?.harness ?? "", choices.environment),
  );

  useEffect(() => {
    if (listed.value !== undefined) setWorkspaces(listed.value);
  }, [listed.value]);
  useEffect(() => {
    if (settings.value?.outputFolder !== undefined) setOutputFolder(settings.value.outputFolder);
  }, [settings.value]);

  const chooseHarness = (next: string) => {
    setHarness(next);
    setChoices(loadRemembered().byHarness[next] ?? DEFAULT_CHOICES);
  };
  const models = catalog.value?.models;
  const model = models?.find((known) => known.id === choices.model);
  const efforts = description?.capabilities.effort ? (model?.efforts ?? []) : [];
  const workspace = workspaces.find((known) => known.id === workspaceId);
  const where =
    place === "workspace"
      ? workspace && { workspaceId: workspace.id }
      : outputFolder && { outputFolder };
  const ready = description !== undefined && prompt.trim() !== "" && Boolean(where);

  const start = async () => {
    if (description === undefined || prompt.trim() === "" || !where || starting) return;
    setStarting(true);
    setError(undefined);
    const { environment, model: chosenModel, effort, permissionMode } = choices;
    const request: StartTaskRequest = {
      prompt: prompt.trim(),
      options: {
        harness: description.harness,
        environment,
        permissionMode,
        ...(chosenModel === undefined ? {} : { model: chosenModel }),
        ...(effort === undefined ? {} : { effort }),
      },
      ...where,
    };
    try {
      const session = await api.startTask(request);
      remember(description.harness, choices, place === "workspace" ? workspace?.id : undefined);
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

  const environmentChoices = (environments.value ?? [choices.environment]).map((environment) => ({
    value: environmentKey(environment),
    label: environmentName(environment),
  }));

  return (
    <section className={styles.page} aria-labelledby="new-task-title">
      <div className={styles.column}>
        <h1 id="new-task-title" className={styles.title}>
          What should the agent do?
        </h1>
        <p className={styles.lead}>
          Describe the task in your own words. You can answer its questions and approve its actions
          as it works.
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
            <ChoiceMenu
              label="Harness"
              value={description?.harness ?? ""}
              choices={harnesses.map((known) => ({ value: known.harness, label: known.name }))}
              onChange={chooseHarness}
            />
            <ChoiceMenu
              label="Runs on"
              value={environmentKey(choices.environment)}
              choices={environmentChoices}
              onChange={(key) => {
                const environment = environments.value?.find((env) => environmentKey(env) === key);
                if (environment !== undefined) setChoices({ ...choices, environment });
              }}
            />
            {description?.capabilities.modelList ? (
              <ModelPicker
                models={models}
                error={catalog.error}
                value={choices.model}
                recent={choices.recentModels}
                onChange={(next) => {
                  const nextEfforts = models?.find((known) => known.id === next)?.efforts ?? [];
                  const { model: _, effort, ...rest } = choices;
                  setChoices({
                    ...rest,
                    ...(next === undefined ? {} : { model: next }),
                    ...(effort !== undefined && nextEfforts.includes(effort) ? { effort } : {}),
                  });
                }}
              />
            ) : null}
            {efforts.length > 0 ? (
              <ChoiceMenu
                label="Effort"
                value={choices.effort ?? DEFAULT_EFFORT}
                choices={[
                  { value: DEFAULT_EFFORT, label: "Default" },
                  ...efforts.map((effort) => ({ value: effort, label: effort })),
                ]}
                onChange={(next) => {
                  const { effort: _, ...rest } = choices;
                  setChoices(next === DEFAULT_EFFORT ? rest : { ...rest, effort: next });
                }}
              />
            ) : null}
            <ChoiceMenu
              label="Permissions"
              value={choices.permissionMode}
              choices={PERMISSIONS}
              onChange={(permissionMode) => setChoices({ ...choices, permissionMode })}
            />
          </div>
        </div>

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
              onChange={setOutputFolder}
              hint="The task gets its own folder inside, named by the date and your first words."
            />
          )}
        </div>

        <div className={styles.actions}>
          <Button variant="primary" onClick={start} disabled={!ready || starting}>
            {starting ? "Starting…" : "Start task"}
          </Button>
          <span className={styles.hint}>
            <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd>
          </span>
          {model?.free === true ? <span className={styles.note}>Free model</span> : null}
        </div>
        {error === undefined ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
      <WorkspaceDialog
        open={creatingWorkspace}
        onOpenChange={setCreatingWorkspace}
        onCreated={(created) => {
          setWorkspaces([created, ...workspaces]);
          setWorkspaceId(created.id);
        }}
      />
    </section>
  );
}
