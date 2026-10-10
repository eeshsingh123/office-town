import type {
  Autonomy,
  ProfileRecord,
  StartTaskRequest,
  WorkspaceRecord,
} from "@office-town/contract";
import { Network, User, Users } from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { track } from "../../store/live.ts";
import { useTemplates } from "../../store/templates.ts";
import { AutonomyChoice } from "../../ui/AutonomyChoice.tsx";
import { Button } from "../../ui/Button.tsx";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import { type CardOption, OptionCards } from "../../ui/Choice.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { NextSteps } from "../../ui/NextSteps.tsx";
import page from "../../ui/Page.module.css";
import { useLoaded } from "../../ui/use-loaded.ts";
import { selectAgent } from "../office/office-state.ts";
import { AiLine, useAiSummary } from "../profiles/AiLine.tsx";
import { SettingsChips } from "../profiles/SettingsChips.tsx";
import { TemplatePicker } from "../profiles/TemplatePicker.tsx";
import { ChiefChoice, useChief } from "./ChiefChoice.tsx";
import { DEFAULT_CHOICES, type HarnessChoices, loadRemembered, remember } from "./choices.ts";
import styles from "./NewTaskView.module.css";
import { nextSteps, type Who } from "./next-steps.ts";
import { PlaceChoice } from "./PlaceChoice.tsx";
import { PROPOSE, TeamChoice } from "./TeamChoice.tsx";
import { WorkspaceDialog } from "./WorkspaceDialog.tsx";

const WHO: CardOption<Who>[] = [
  {
    value: "one",
    title: "One assistant",
    best: "Best for quick, single jobs",
    detail: "Summarise a file, fix a bug, draft an email.",
    icon: <User size={22} />,
  },
  {
    value: "team",
    title: "A department",
    best: "Best for bigger work in one project",
    detail: "A lead splits the work between its team and puts it together.",
    icon: <Users size={22} />,
  },
  {
    value: "chief",
    title: "Your chief",
    best: "Best for big goals across teams",
    detail: "Plans the work across your departments. You approve the plan first.",
    icon: <Network size={22} />,
  },
];

export function NewTaskView() {
  const harnesses = useApp((state) => state.harnesses);
  const departments = useApp((state) => state.departments);
  const handed = useApp((state) => (state.view.name === "new-task" ? state.view : undefined));
  const [remembered] = useState(loadRemembered);
  const [harness, setHarness] = useState(remembered.harness);
  const [profileId, setProfileId] = useState(handed?.templateId ?? remembered.profileId);
  const [who, setWho] = useState<Who>(handed?.who ?? (remembered.team ? "team" : "one"));
  const [departmentId, setDepartmentId] = useState(handed?.departmentId ?? PROPOSE);
  const [teamAutonomy, setTeamAutonomy] = useState<Autonomy>("trusted");
  const [choices, setChoices] = useState<HarnessChoices>(
    (remembered.harness && remembered.byHarness[remembered.harness]) || DEFAULT_CHOICES,
  );
  const [prompt, setPrompt] = useState(handed?.prompt ?? "");
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
  const templates = useTemplates();
  const profile = templates?.find((known) => known.id === profileId);
  const outputFolder = chosenFolder ?? settings.value?.outputFolder;
  const workspace = workspaces.find((known) => known.id === workspaceId) ?? workspaces[0];
  const where =
    place === "workspace"
      ? workspace && { workspaceId: workspace.id }
      : outputFolder && { outputFolder };
  const soloAutonomy = choices.autonomy ?? "supervised";
  const soloGate = useBypassGate(
    soloAutonomy,
    (autonomy) => setChoices({ ...choices, autonomy }),
    "this assistant",
  );
  const teamGate = useBypassGate(teamAutonomy, setTeamAutonomy, "the team");
  const chief = useChief();
  const team = who === "team";
  const proposing = team && departmentId === PROPOSE;
  const department = team && !proposing ? departments[departmentId] : undefined;
  const chipSettings =
    description === undefined
      ? undefined
      : {
          harness: description.harness,
          environment: choices.environment,
          ...(choices.model === undefined ? {} : { model: choices.model }),
          ...(choices.effort === undefined ? {} : { effort: choices.effort }),
        };
  const aiSummary = useAiSummary(chipSettings);
  const goal = prompt.trim();

  const missing =
    goal === ""
      ? "Describe the task first."
      : who === "chief"
        ? chief === undefined
          ? "Set up your chief first."
          : undefined
        : description === undefined
          ? "No AI app is installed yet."
          : team
            ? proposing && workspace === undefined
              ? "Choose the project the team works in."
              : undefined
            : where
              ? undefined
              : place === "workspace"
                ? "Choose a project."
                : "Choose a folder.";
  const ready = missing === undefined;

  const steps = nextSteps({
    who,
    autonomy: team ? (department?.autonomy ?? teamAutonomy) : soloAutonomy,
    departmentName: department?.name,
    chiefName: chief?.record.name,
    chiefBusy: chief?.busy ?? false,
    folder:
      place === "workspace" ? workspace?.name : outputFolder?.split(/[\\/]/).filter(Boolean).at(-1),
  });

  const start = async () => {
    if (!ready || starting) return;
    setStarting(true);
    setError(undefined);
    try {
      if (who === "chief") {
        if (chief === undefined) return;
        const { task } = await api.startChiefTask(goal);
        await track(task.id);
        selectAgent(chief.record.id);
        return;
      }
      if (description === undefined) return;
      const { environment, model, effort } = choices;
      // A template fills in the choices; its notes come with it through its id.
      const agent: StartTaskRequest["agent"] = {
        settings: {
          harness: description.harness,
          environment,
          ...(model === undefined ? {} : { model }),
          ...(effort === undefined ? {} : { effort }),
        },
        ...(profile === undefined ? {} : { profileId: profile.id }),
      };
      const session = team
        ? await api.startTeamTask({
            goal,
            team:
              proposing && workspace !== undefined
                ? { lead: agent, workspaceId: workspace.id, autonomy: teamAutonomy }
                : { departmentId },
          })
        : await api.startTask({ prompt: goal, agent, autonomy: soloAutonomy, ...(where || {}) });
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

  // Fills in the AI choices; the template's notes come along when the task starts.
  const pickTemplate = (template: ProfileRecord | undefined) => {
    setProfileId(template?.id);
    if (template === undefined) return;
    const { harness: next, environment, model, effort } = template.settings;
    setHarness(next);
    const { autonomy, recentModels } = loadRemembered().byHarness[next] ?? DEFAULT_CHOICES;
    setChoices({
      environment,
      recentModels,
      ...(autonomy === undefined ? {} : { autonomy }),
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    });
  };
  // A template handed in, such as from its card's Use button, fills the form once it is loaded.
  const handedTemplate = handed?.templateId;
  const handedLoaded = templates?.find((known) => known.id === handedTemplate);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fill once, when it first loads
  useEffect(() => {
    if (handedLoaded !== undefined) pickTemplate(handedLoaded);
  }, [handedLoaded?.id]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void start();
    }
  };

  const aiChoices =
    who === "chief" || (team && !proposing) ? null : (
      <AiLine lead={team ? "The lead thinks with" : "Thinks with"} summary={aiSummary}>
        {chipSettings === undefined ? null : (
          <SettingsChips
            value={chipSettings}
            recentModels={choices.recentModels}
            onChange={({ harness: next, environment, model, effort }) => {
              if (next !== chipSettings.harness) {
                setHarness(next);
                setChoices(loadRemembered().byHarness[next] ?? DEFAULT_CHOICES);
                return;
              }
              const { autonomy, recentModels } = choices;
              setChoices({
                environment,
                recentModels,
                ...(autonomy === undefined ? {} : { autonomy }),
                ...(model === undefined ? {} : { model }),
                ...(effort === undefined ? {} : { effort }),
              });
            }}
          />
        )}
      </AiLine>
    );

  return (
    <section className={page.page} aria-labelledby="new-task-title">
      <div className={page.layout}>
        <div className={page.main}>
          <header className={page.header}>
            <h1 id="new-task-title" className={page.title}>
              What do you need done?
            </h1>
            <p className={page.lead}>
              Write it the way you would ask a colleague. You can change anything below before it
              starts.
            </p>
          </header>

          <div className={styles.composer}>
            <label htmlFor="task-prompt" className="visually-hidden">
              Your task
            </label>
            <textarea
              id="task-prompt"
              className={styles.prompt}
              rows={4}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="For example: go through tickets.csv and list the five problems customers mention most"
              // biome-ignore lint/a11y/noAutofocus: the view exists to take this text
              autoFocus
            />
            {aiChoices === null ? null : <div className={styles.composerFoot}>{aiChoices}</div>}
          </div>

          {who === "one" || proposing ? (
            <TemplatePicker
              chosen={profile?.id}
              who={team ? "the lead" : "this agent"}
              title={team ? "Start the lead from a template" : "Start from a template"}
              onPick={pickTemplate}
            />
          ) : null}

          <section className={page.section}>
            <h2 className={page.sectionTitle}>Who should handle it?</h2>
            <OptionCards
              name="who"
              label="Who should handle it"
              value={who}
              options={WHO}
              onChange={setWho}
            />
          </section>

          {who === "chief" ? (
            <ChiefChoice />
          ) : team ? (
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
            <>
              <section className={page.section}>
                <h2 className={page.sectionTitle}>How much can it do without asking you?</h2>
                <AutonomyChoice name="solo-level" value={soloAutonomy} onChoose={soloGate.choose} />
              </section>
              <PlaceChoice
                place={place}
                onPlace={setPlace}
                workspaces={workspaces}
                workspaceId={workspace?.id}
                onWorkspace={setWorkspaceId}
                onNewWorkspace={() => setCreatingWorkspace(true)}
                folder={outputFolder}
                onFolder={setChosenFolder}
              />
            </>
          )}
        </div>

        <aside className={page.aside}>
          <NextSteps title={steps.title} steps={steps.steps} />
          <Button
            variant="primary"
            className={page.start}
            onClick={start}
            disabled={!ready || starting}
          >
            {starting ? "Starting…" : steps.action}
          </Button>
          <span className={`${page.hint} ${page.center}`}>
            {missing ?? (
              <>
                or press <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd>
              </>
            )}
          </span>
          {error === undefined ? null : (
            <p className={page.error} role="alert">
              {error}
            </p>
          )}
        </aside>
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
