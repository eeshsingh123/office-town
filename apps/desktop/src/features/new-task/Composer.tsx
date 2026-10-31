import type {
  Autonomy,
  ProfileRecord,
  RoleSettings,
  StartTaskRequest,
} from "@office-town/contract";
import { CornerDownLeft, LayoutTemplate, ShieldCheck, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp, type View } from "../../store/app-store.ts";
import { clearDrafts, fits, ignoreDraft, useDraft } from "../../store/drafts.ts";
import { track } from "../../store/live.ts";
import { useTemplates } from "../../store/templates.ts";
import { defaultWorkspace, useWorkspaces } from "../../store/workspaces.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import { taskTitle } from "../../ui/format.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import fileStyles from "../attachments/Attachments.module.css";
import { sizeText, typeLabel } from "../attachments/kinds.ts";
import { AttachButton, PickedFiles } from "../attachments/PickedFiles.tsx";
import { useAttachments } from "../attachments/use-attachments.ts";
import { useSeesImages } from "../attachments/use-sees-images.ts";
import { useChief } from "../chief/use-chief.ts";
import { keptLevel } from "../departments/team-form.ts";
import { useLibrary } from "../library/library.ts";
import { selectAgent } from "../office/office-state.ts";
import { useSharedWith, WorkspacePicker } from "../workspaces/WorkspacePicker.tsx";
import { AskChip } from "./AskChip.tsx";
import styles from "./Composer.module.css";
import {
  DEFAULT_CHOICES,
  type HarnessChoices,
  keepChoices,
  loadRemembered,
  remember,
} from "./choices.ts";
import { DepartmentWorkspaceChip } from "./DepartmentWorkspaceChip.tsx";
import { GoesToChip, targetIcon } from "./GoesToChip.tsx";
import { ModelChip } from "./ModelChip.tsx";
import { Suggestions } from "./Suggestions.tsx";
import { CHIEF, type Mention, mentionAt, PROPOSE, SOLO, withoutMention } from "./targets.ts";
import { useBusyDepartments } from "./use-targets.ts";

const MAX_HEIGHT = 320;
const DRAFT = "task";

// Bypass never comes back without its warning.
function keptChoices(saved: unknown): HarnessChoices | undefined {
  if (!fits(saved, { environment: { kind: "" }, recentModels: [] })) return undefined;
  const { autonomy, ...choices } = saved as HarnessChoices;
  return autonomy === undefined ? choices : { ...choices, autonomy: keptLevel(autonomy) };
}

type Handed = Extract<View, { name: "new-task" }>;

// What another page asked for, such as a department's "Give a goal".
function handedTarget(handed: Handed | undefined): string | undefined {
  if (handed?.who === "chief") return CHIEF;
  if (handed?.who === "team") return handed.departmentId ?? PROPOSE;
  if (handed?.who === "one") return SOLO;
  return undefined;
}

interface Option {
  id: string;
  name: string;
  note: string;
}

const LIST_NAMES: Record<Mention["kind"], string> = {
  "@": "Who does it",
  "#": "From the Library",
  "/": "Use a template",
};

interface ComposerProps {
  // Home lists its own recent tasks, so the box comes alone there.
  home?: boolean;
}

// The one box a task starts from, on New task and on Home. Every choice is a chip filled with
// the last one used, so most tasks need only the text.
export function Composer({ home = false }: ComposerProps) {
  const harnesses = useApp((state) => state.harnesses);
  const departments = useApp((state) => state.departments);
  const handed = useApp((state) => (state.view.name === "new-task" ? state.view : undefined));
  const [remembered] = useState(loadRemembered);
  // What another page handed over wins over what was left in the box.
  const handedTo = handedTarget(handed);
  const [chosen, setChosen] = useDraft(
    `${DRAFT}.target`,
    handedTo ?? remembered.target ?? SOLO,
    handedTo === undefined ? undefined : ignoreDraft,
  );
  const [harness, setHarness] = useDraft(`${DRAFT}.harness`, remembered.harness);
  const [profileId, setProfileId] = useDraft(
    `${DRAFT}.profileId`,
    handed?.templateId ?? remembered.profileId,
  );
  const [choices, setChoices] = useDraft<HarnessChoices>(
    `${DRAFT}.choices`,
    (remembered.harness && remembered.byHarness[remembered.harness]) || DEFAULT_CHOICES,
    keptChoices,
  );
  const [teamAutonomy, setTeamAutonomy] = useDraft<Autonomy>(
    `${DRAFT}.teamAutonomy`,
    "full",
    (saved) => (typeof saved === "string" ? keptLevel(saved as Autonomy) : undefined),
  );
  const [prompt, setPrompt] = useDraft(
    `${DRAFT}.prompt`,
    handed?.prompt ?? "",
    handed?.prompt === undefined ? undefined : ignoreDraft,
  );
  const [workspaceId, setWorkspaceId] = useDraft(`${DRAFT}.workspaceId`, remembered.workspaceId);
  const [departmentWorkspaceId, setDepartmentWorkspaceId] = useDraft<string | undefined>(
    `${DRAFT}.departmentWorkspaceId`,
    undefined,
  );
  const [mention, setMention] = useState<Mention>();
  const [highlight, setHighlight] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const box = useRef<HTMLTextAreaElement>(null);
  const attached = useAttachments(`${DRAFT}.files`);
  const agents = useApp((state) => state.agents);

  const chief = useChief();
  const busy = useBusyDepartments();
  const templates = useTemplates();
  const workspaces = useWorkspaces() ?? [];

  // A department removed since it was last chosen falls back to an assistant.
  const target =
    chosen === SOLO || chosen === CHIEF || chosen === PROPOSE || departments[chosen] !== undefined
      ? chosen
      : SOLO;
  const department = departments[target];
  const proposing = target === PROPOSE;
  // The user picks the AI of an assistant, or of the lead that proposes a team.
  const picksAgent = target === SOLO || proposing;
  const description = harnesses.find((known) => known.harness === harness) ?? harnesses[0];
  const profile = templates?.find((known) => known.id === profileId);
  // A department's goal runs in its default unless the user picks another of its workspaces.
  const goalWorkspaceId =
    department === undefined
      ? undefined
      : department.workspaceIds.includes(departmentWorkspaceId ?? "")
        ? (departmentWorkspaceId ?? department.workspaceId)
        : department.workspaceId;
  const workspace =
    department === undefined
      ? defaultWorkspace(workspaces, workspaceId)
      : workspaces.find((known) => known.id === goalWorkspaceId);
  const sharedWith = useSharedWith(proposing ? workspace?.id : undefined);
  const soloAutonomy = choices.autonomy ?? "full";
  const level = proposing ? teamAutonomy : soloAutonomy;
  const gate = useBypassGate(
    level,
    (next) => (proposing ? setTeamAutonomy(next) : setChoices({ ...choices, autonomy: next })),
    proposing ? "the team" : "this assistant",
  );
  const settings: RoleSettings | undefined =
    description === undefined
      ? undefined
      : {
          harness: description.harness,
          environment: choices.environment,
          ...(choices.model === undefined ? {} : { model: choices.model }),
          ...(choices.effort === undefined ? {} : { effort: choices.effort }),
        };
  const goal = prompt.trim();
  // Whoever reads the task first: the chosen AI, a department's lead, or the chief.
  const reader =
    target === CHIEF
      ? chief?.record.settings
      : department !== undefined
        ? agents[department.leadAgentId]?.settings
        : settings;
  const seesImages = useSeesImages(
    reader === undefined
      ? undefined
      : {
          harness: reader.harness,
          environment: reader.environment,
          ...(reader.model === undefined ? {} : { model: reader.model }),
        },
  );
  const files = attached.ids.length === 0 ? {} : { attachments: attached.ids };
  // A chief's goal has no workspace of its own.
  const library = useLibrary(target === CHIEF ? undefined : workspace?.id);

  const missing =
    target === CHIEF
      ? chief === undefined
        ? "Set up your chief first."
        : undefined
      : department !== undefined
        ? busy.has(department.id)
          ? `${department.name} is busy with another task. It takes one at a time.`
          : undefined
        : description === undefined
          ? "No AI app is installed yet."
          : workspace === undefined
            ? "Choose a workspace."
            : undefined;
  const ready = goal !== "" && missing === undefined && !starting && !attached.adding;

  // The box grows with the text instead of showing a resize handle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again whenever the text changes
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  }, [prompt]);

  const start = async () => {
    if (!ready) return;
    setStarting(true);
    setError(undefined);
    try {
      const keep = () => {
        clearDrafts(DRAFT);
        if (description === undefined) return;
        remember({
          harness: description.harness,
          choices,
          target,
          workspaceId: department === undefined ? workspace?.id : workspaceId,
          profileId: profile?.id,
        });
      };
      if (target === CHIEF) {
        if (chief === undefined) return;
        const { task } = await api.startChiefTask(goal, attached.ids);
        keep();
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
      const session =
        department !== undefined
          ? await api.startTeamTask({
              goal,
              team: { departmentId: department.id, workspaceId: goalWorkspaceId },
              ...files,
            })
          : workspace === undefined
            ? undefined
            : proposing
              ? await api.startTeamTask({
                  goal,
                  team: { lead: agent, workspaceId: workspace.id, autonomy: teamAutonomy },
                  ...files,
                })
              : await api.startTask({
                  prompt: goal,
                  agent,
                  autonomy: soloAutonomy,
                  workspaceId: workspace.id,
                  ...files,
                });
      if (session === undefined) return;
      keep();
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
  // A template handed in, such as from its card's Use button, fills the choices once it is loaded.
  const handedLoaded = templates?.find((known) => known.id === handed?.templateId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fill once, when it first loads
  useEffect(() => {
    if (handedLoaded !== undefined) pickTemplate(handedLoaded);
  }, [handedLoaded?.id]);

  const changeSettings = (next: RoleSettings) => {
    if (next.harness !== settings?.harness) {
      if (settings !== undefined) keepChoices(settings.harness, choices);
      setHarness(next.harness);
      setChoices(loadRemembered().byHarness[next.harness] ?? DEFAULT_CHOICES);
      return;
    }
    const { autonomy, recentModels } = choices;
    setChoices({
      environment: next.environment,
      recentModels,
      ...(autonomy === undefined ? {} : { autonomy }),
      ...(next.model === undefined ? {} : { model: next.model }),
      ...(next.effort === undefined ? {} : { effort: next.effort }),
    });
  };

  // "@" lists who can take the task, "/" the templates.
  const people: Option[] = [
    { id: SOLO, name: "An assistant", note: "One agent" },
    ...Object.values(departments)
      .filter((known) => !busy.has(known.id))
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((known) => ({ id: known.id, name: known.name, note: "Department" })),
    { id: PROPOSE, name: "A new department", note: "Propose a new department for this task" },
    ...(chief === undefined
      ? []
      : [
          {
            id: CHIEF,
            name: chief.record.name,
            note: "Plans across departments for you to approve",
          },
        ]),
  ];
  const libraryOptions: Option[] = library.map(({ id, file }) => ({
    id,
    name: file.name,
    note: file.kind === "folder" ? "Linked folder" : sizeText(file.bytes ?? 0),
  }));
  const optionsOf = (kind: Mention["kind"]): Option[] =>
    kind === "@"
      ? people
      : kind === "#"
        ? libraryOptions
        : (templates ?? []).map((known) => ({ id: known.id, name: known.name, note: known.role }));
  const matching = (found: Mention) =>
    optionsOf(found.kind).filter((option) => option.name.toLowerCase().includes(found.query));
  const listed: Option[] = mention === undefined ? [] : matching(mention);
  const active = Math.min(highlight, listed.length - 1);
  const listId = useId();
  const noTemplates = mention?.kind === "/" && (templates ?? []).length === 0;

  const pickMention = (id: string) => {
    const element = box.current;
    if (mention === undefined || element === null) return;
    setPrompt(withoutMention(prompt, mention, element.selectionStart));
    if (mention.kind === "@") setChosen(id);
    else if (mention.kind === "#") {
      const item = library.find((known) => known.id === id);
      if (item !== undefined) attached.addFromLibrary(item);
    } else {
      pickTemplate(templates?.find((known) => known.id === id));
      if (!picksAgent) setChosen(SOLO);
    }
    setMention(undefined);
    element.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // An open list with nothing to pick only closes, so Enter never starts "/" as a task.
    if (mention !== undefined && listed.length === 0) {
      if (event.key === "Enter" || event.key === "Tab" || event.key === "Escape") {
        event.preventDefault();
        setMention(undefined);
        return;
      }
    }
    if (listed.length > 0) {
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step !== 0) {
        event.preventDefault();
        setHighlight((active + step + listed.length) % listed.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const option = listed[active];
        if (option !== undefined) pickMention(option.id);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(undefined);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void start();
    }
  };

  const fill = (text: string, next: string) => {
    setPrompt(text);
    setChosen(next);
    box.current?.focus();
  };

  const targetLabel =
    target === SOLO
      ? "Assistant"
      : target === CHIEF
        ? (chief?.record.name ?? "Chief")
        : proposing
          ? "New department"
          : (department?.name ?? "");
  let plan: ReactNode = null;
  if (target === CHIEF) {
    plan =
      chief === undefined ? null : chief.busy && chief.current !== undefined ? (
        <>
          <b>{chief.record.name}</b> is busy with "{taskTitle(chief.current.prompt)}". This goal
          starts after it.
        </>
      ) : (
        <>You approve the plan before any work starts.</>
      );
  } else if (proposing) {
    plan = (
      <>
        You approve the team before any work starts.
        {sharedWith.length > 0
          ? ` ${sharedWith.join(" and ")} also ${sharedWith.length === 1 ? "works" : "work"} in ${workspace?.name}.`
          : ""}
      </>
    );
  }

  return (
    <div className={styles.composerArea}>
      <div
        className={`${styles.composer} ${attached.dragging ? fileStyles.dropping : ""}`}
        data-tour="composer"
        {...attached.dropHandlers}
      >
        <div className={styles.writing}>
          <label htmlFor="task-prompt" className="visually-hidden">
            Your task
          </label>
          <textarea
            ref={box}
            id="task-prompt"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={mention !== undefined}
            aria-controls={mention === undefined ? undefined : listId}
            aria-activedescendant={
              mention === undefined || listed.length === 0 ? undefined : `${listId}-${active}`
            }
            className={styles.prompt}
            rows={home ? 2 : 3}
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              const found = mentionAt(event.target.value, event.target.selectionStart);
              // "#" with no Library file to match is plain text, such as "issue #12".
              setMention(found?.kind === "#" && matching(found).length === 0 ? undefined : found);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setMention(undefined)}
            onPaste={attached.onPaste}
            placeholder="Describe the task. Type @ to choose who does it, / to use a template."
            // biome-ignore lint/a11y/noAutofocus: New task exists to take this text
            autoFocus={!home}
          />
          {mention !== undefined ? (
            <div
              id={listId}
              className={styles.mentions}
              role="listbox"
              aria-label={LIST_NAMES[mention.kind]}
            >
              <div className={styles.menuHeading} role="presentation">
                {LIST_NAMES[mention.kind]}
              </div>
              {listed.length === 0 ? (
                <div className={styles.mentionEmpty} role="status">
                  {noTemplates
                    ? "No templates yet."
                    : mention.kind === "/"
                      ? "No template matches."
                      : "No match."}
                  {noTemplates ? (
                    <button
                      type="button"
                      className={styles.link}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => navigate({ name: "templates" })}
                    >
                      Go to Templates
                    </button>
                  ) : null}
                </div>
              ) : null}
              {listed.map((option, index) => (
                <button
                  key={option.id}
                  id={`${listId}-${index}`}
                  type="button"
                  tabIndex={-1}
                  role="option"
                  aria-selected={index === active}
                  className={styles.mention}
                  // Keeps the caret in the box.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickMention(option.id)}
                >
                  <span className={styles.itemIcon}>
                    {mention.kind === "@" ? (
                      targetIcon(option.id)
                    ) : mention.kind === "#" ? (
                      <span className={styles.fileIcon}>
                        {typeLabel(
                          option.name,
                          library.find((known) => known.id === option.id)?.file.kind ?? "file",
                        )}
                      </span>
                    ) : (
                      <LayoutTemplate size={14} aria-hidden />
                    )}
                  </span>
                  <span className={styles.mentionText}>
                    {option.name}
                    <span>{option.note}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <PickedFiles files={attached} seesImages={seesImages} className={styles.files} />
        {profile !== undefined && picksAgent ? (
          <div className={styles.tokens}>
            <span className={styles.token}>
              <LayoutTemplate size={13} aria-hidden />
              {profile.name} template
              <button
                type="button"
                aria-label={`Stop using the ${profile.name} template`}
                onClick={() => setProfileId(undefined)}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          </div>
        ) : null}
        <div className={styles.bar}>
          <div className={styles.chips}>
            <AttachButton files={attached} library={library} className={fileStyles.attach} />
            <GoesToChip
              value={target}
              label={targetLabel}
              hasChief={chief !== undefined}
              onChange={setChosen}
            />
            {target === CHIEF ? null : department !== undefined ? (
              <DepartmentWorkspaceChip
                department={department}
                workspaces={workspaces}
                value={workspace?.id ?? department.workspaceId}
                onChange={setDepartmentWorkspaceId}
              />
            ) : (
              <WorkspacePicker
                value={workspace?.id}
                onChange={setWorkspaceId}
                chipClassName={styles.chip}
              />
            )}
            {picksAgent && settings !== undefined ? (
              <ModelChip value={settings} recent={choices.recentModels} onChange={changeSettings} />
            ) : null}
            {picksAgent ? (
              <AskChip value={level} onChoose={gate.choose} />
            ) : department !== undefined ? (
              <span className={`${styles.chip} ${styles.fixed}`} title="Set by the department">
                <ShieldCheck size={14} aria-hidden />
                <span className={styles.chipText}>{AUTONOMY[department.autonomy].short}</span>
              </span>
            ) : null}
          </div>
          <Button variant="primary" className={styles.start} disabled={!ready} onClick={start}>
            {starting ? "Starting…" : "Start"}
            <CornerDownLeft size={14} aria-hidden />
          </Button>
        </div>
      </div>
      <div className={styles.below}>
        {missing === undefined ? (
          <span>{plan}</span>
        ) : (
          <span className={styles.missing}>
            {missing}
            {target === CHIEF && chief === undefined ? (
              <button
                type="button"
                className={styles.link}
                onClick={() => navigate({ name: "chief" })}
              >
                Set up your chief
              </button>
            ) : null}
          </span>
        )}
        <span className={styles.keys}>
          <Kbd>@</Kbd> who · <Kbd>#</Kbd> Library file · <Kbd>/</Kbd> template · <Kbd>Enter</Kbd>{" "}
          start · <Kbd>Shift</Kbd> <Kbd>Enter</Kbd> new line
        </span>
      </div>
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {home ? null : <Suggestions onUse={fill} />}
      {gate.confirm}
    </div>
  );
}
