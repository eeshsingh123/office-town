import { type Autonomy, agentColours, type NewAgent } from "@office-town/contract";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { useTemplates } from "../../store/templates.ts";
import { useWorkspaces } from "../../store/workspaces.ts";
import { AutonomyChoice } from "../../ui/AutonomyChoice.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import page from "../../ui/Page.module.css";
import { selectRoom } from "../office/office-state.ts";
import { AiLine } from "../profiles/AiLine.tsx";
import { useModelLine } from "../profiles/model-line.ts";
import { type ChipSettings, SettingsChips } from "../profiles/SettingsChips.tsx";
import { WorkspacePicker } from "../workspaces/WorkspacePicker.tsx";
import styles from "./NewDepartment.module.css";
import { type TeamRow, TeamRows, toRoles } from "./TeamRows.tsx";
import { teamLine } from "./team-line.ts";

// No template id can take this, since an id starts with a letter or digit.
const BLANK = "~blank";

// Starting points; each stays editable once added.
const ROLE_TEMPLATES = [
  { role: "Researcher", purpose: "Finds and reads sources, then sums up what matters" },
  { role: "Writer", purpose: "Drafts and edits text" },
  { role: "Developer", purpose: "Writes and fixes code" },
  { role: "Reviewer", purpose: "Checks the work and points out problems" },
  { role: "Tester", purpose: "Tries the result and reports what breaks" },
];

const LEAD_COLOUR = agentColours[3].value;
const memberColour = (index: number) =>
  agentColours[(index + 4) % agentColours.length]?.value ?? LEAD_COLOUR;

// A department built by hand, the same record a lead's approved proposal makes.
export function NewDepartmentView() {
  const harnesses = useApp((state) => state.harnesses);
  const workspaces = useWorkspaces() ?? [];
  const templates = useTemplates() ?? [];
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [autonomy, setAutonomy] = useState<Autonomy>("full");
  const [leadTemplate, setLeadTemplate] = useState(BLANK);
  const defaults: ChipSettings = {
    harness: harnesses[0]?.harness ?? "claude",
    environment: { kind: "native" },
  };
  const [leadSettings, setLeadSettings] = useState<ChipSettings>();
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const gate = useBypassGate(autonomy, setAutonomy, name.trim() || "the department");

  const workspace = workspaces.find((known) => known.id === (workspaceId ?? workspaces[0]?.id));
  const template = templates.find((known) => known.id === leadTemplate);
  const leadSummary = useModelLine(leadSettings ?? defaults);
  const title = name.trim() || "Your new department";
  const missing =
    name.trim() === ""
      ? "Give the department a name."
      : workspace === undefined
        ? "Choose the workspace it works in."
        : rows.some((row) => row.role.trim() === "")
          ? "Give every team member a role."
          : undefined;

  const addTemplate = (template: (typeof ROLE_TEMPLATES)[number]) =>
    setRows([
      ...rows,
      {
        key: Math.max(-1, ...rows.map((row) => row.key)) + 1,
        ...template,
        settings: leadSettings ?? defaults,
      },
    ]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (missing !== undefined || workspace === undefined || saving) return;
    setSaving(true);
    setError(undefined);
    // A template fills in the lead's choices; its notes come with it through its id.
    const lead: NewAgent = {
      settings: leadSettings ?? defaults,
      ...(template === undefined ? {} : { profileId: template.id }),
    };
    try {
      const department = await api.createDepartment({
        team: { name: name.trim(), roles: toRoles(rows) },
        workspaceId: workspace.id,
        autonomy,
        lead,
      });
      selectRoom(department.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  return (
    <section className={page.page} aria-labelledby="new-department-title">
      <form className={page.layout} onSubmit={create}>
        <div className={page.main}>
          <header className={page.header}>
            <button type="button" className={page.back} onClick={() => navigate({ name: "home" })}>
              ← Home
            </button>
            <h1 id="new-department-title" className={page.title}>
              Build a department
            </h1>
          </header>

          <div className={styles.pair}>
            <section className={page.section}>
              <label htmlFor="department-name" className={page.sectionTitle}>
                Name
              </label>
              <input
                id="department-name"
                className={page.input}
                value={name}
                onChange={(change) => setName(change.target.value)}
                placeholder="For example: Website"
                // biome-ignore lint/a11y/noAutofocus: the view exists to take this text
                autoFocus
              />
            </section>
            <section className={page.section}>
              <WorkspacePicker value={workspace?.id} onChange={setWorkspaceId} warnShared />
            </section>
          </div>

          <section className={page.section}>
            <div className={page.sectionHead}>
              <h2 className={page.sectionTitle}>Team</h2>
              <span className={page.hint}>Members are optional</span>
            </div>
            <div className={styles.lead}>
              <Avatar name="Lead" colour={LEAD_COLOUR} size={36} />
              <div className={styles.leadText}>
                <strong>Lead</strong>
                <span className={page.hint}>Splits each task among the team</span>
                <AiLine
                  summary={
                    template === undefined ? leadSummary : `${template.name} · ${leadSummary}`
                  }
                >
                  {templates.length === 0 ? null : (
                    <ChoiceMenu
                      label="Template"
                      value={leadTemplate}
                      choices={[
                        { value: BLANK, label: "None, choose below" },
                        ...templates.map((known) => ({
                          value: known.id,
                          label: known.name,
                          description: known.role,
                        })),
                      ]}
                      onChange={(next) => {
                        setLeadTemplate(next);
                        const picked = templates.find((known) => known.id === next);
                        if (picked === undefined) return;
                        const { instructions: _, autonomy: __, ...settings } = picked.settings;
                        setLeadSettings(settings);
                      }}
                    />
                  )}
                  <SettingsChips value={leadSettings ?? defaults} onChange={setLeadSettings} />
                </AiLine>
              </div>
            </div>
            <TeamRows
              rows={rows}
              onChange={setRows}
              lead={undefined}
              departmentId={undefined}
              defaults={leadSettings ?? defaults}
            />
            <div className={styles.templates}>
              <span className={page.hint}>Add a role:</span>
              {ROLE_TEMPLATES.map((template) => (
                <button
                  key={template.role}
                  type="button"
                  className={styles.template}
                  onClick={() => addTemplate(template)}
                >
                  <Plus size={13} aria-hidden />
                  {template.role}
                </button>
              ))}
            </div>
          </section>

          <section className={page.section}>
            <h2 className={page.sectionTitle}>Permissions</h2>
            <AutonomyChoice name="department-level" value={autonomy} onChoose={gate.choose} />
          </section>
        </div>

        <aside className={page.aside}>
          <section className={`${page.panel} ${styles.card}`} aria-label="Your new team">
            <span className={page.eyebrow}>Your new team</span>
            <div className={styles.cardLead}>
              <Avatar name={title} colour={LEAD_COLOUR} size={56} />
              <strong className={styles.cardName}>{title}</strong>
              <span className={page.hint}>
                {teamLine(rows.length)}
                {workspace === undefined ? "" : ` · ${workspace.name}`}
              </span>
            </div>
            {rows.length === 0 ? null : (
              <ul className={styles.members}>
                {rows.map((row, index) => (
                  <li key={row.key}>
                    <Avatar name={row.role || "?"} colour={memberColour(index)} size={36} />
                    <span>{row.role || "New role"}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.cardNote}>{AUTONOMY[autonomy].label}</p>
          </section>
          <Button
            type="submit"
            variant="primary"
            className={page.start}
            disabled={missing !== undefined || saving}
          >
            {saving ? "Creating…" : `Create ${name.trim() || "department"}`}
          </Button>
          {missing === undefined ? null : (
            <span className={`${page.hint} ${page.center}`}>{missing}</span>
          )}
          {error === undefined ? null : (
            <p className={page.error} role="alert">
              {error}
            </p>
          )}
        </aside>
      </form>
      {gate.confirm}
    </section>
  );
}
