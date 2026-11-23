import type { AutomationRecord } from "@office-town/contract";
import { CalendarClock, FileText, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { useAutomations } from "../../store/automations.ts";
import { ContextMenu, MoreMenu } from "../../ui/ActionMenu.tsx";
import { Button } from "../../ui/Button.tsx";
import { Guide, type GuideStep } from "../../ui/Guide.tsx";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { Switch } from "../../ui/Switch.tsx";
import { TabRow } from "../../ui/TabRow.tsx";
import styles from "./Automations.module.css";
import {
  AutomationStatus,
  automationMenu,
  turn,
  useWhenText,
  useWho,
  WhoAvatar,
} from "./parts.tsx";
import { stateOf } from "./words.ts";

type Tab = "all" | "needs" | "paused" | "off";

// Search and filters only once the list is long (owner's layout feedback).
const SEARCH_PAST = 8;

const STEPS: GuideStep[] = [
  {
    title: "Say what and when",
    text: "Describe it in your own words, or set it up by hand: a task and when it runs.",
    picture: (
      <span className={styles.picture}>
        <Sparkles size={14} aria-hidden />
        Every Monday, sum up last week's sales
      </span>
    ),
  },
  {
    title: "It starts on its own",
    text: "Each run is an ordinary task for an assistant, a department or the chief.",
    picture: (
      <span className={styles.picture}>
        <CalendarClock size={14} aria-hidden />
        Next Mon 9:00
      </span>
    ),
  },
  {
    title: "See every run",
    text: "Each run shows its task's status and why it waited or was skipped.",
    picture: (
      <span className={styles.picture}>
        <FileText size={14} aria-hidden />
        Run 12 · Done
      </span>
    ),
  },
];

function Row({ automation }: { automation: AutomationRecord }) {
  const who = useWho(automation.task);
  const when = useWhenText(automation);
  const menu = () => automationMenu(automation, false);
  return (
    <ContextMenu menu={menu}>
      <li className={styles.row}>
        <WhoAvatar task={automation.task} />
        <span className={styles.name}>
          <button
            type="button"
            className={styles.open}
            onClick={() => navigate({ name: "automation", automationId: automation.id })}
          >
            {automation.name}
          </button>
          <span className={styles.line}>
            {who.name} · {when}
          </span>
        </span>
        <span
          className={`${styles.status} ${stateOf(automation) === "needs" || stateOf(automation) === "paused" ? styles.needs : ""}`}
        >
          <AutomationStatus automation={automation} />
        </span>
        <Switch
          label={`${automation.name} on`}
          on={automation.enabled}
          onChange={(on) => void turn(automation, on)}
        />
        <MoreMenu label={`More for ${automation.name}`} menu={menu} />
      </li>
    </ContextMenu>
  );
}

const inTab = (automation: AutomationRecord, tab: Tab) => {
  const state = stateOf(automation);
  if (tab === "needs") return state === "needs" || state === "paused";
  if (tab === "paused") return state === "paused";
  if (tab === "off") return !automation.enabled;
  return true;
};

export function AutomationsView() {
  const automations = useAutomations();
  const departments = useApp((state) => state.departments);
  const [tab, setTab] = useState<Tab>("all");
  const [text, setText] = useState("");
  const [hideGuide, setHideGuide] = useState(false);
  const all = automations ?? [];
  const searching = all.length > SEARCH_PAST;
  const needle = text.trim().toLowerCase();
  const shown = all.filter((automation) => {
    if (!inTab(automation, tab)) return false;
    if (needle === "") return true;
    const team =
      automation.task.kind === "department"
        ? (departments[automation.task.request.team.departmentId]?.name ?? "")
        : automation.task.kind;
    return `${automation.name} ${team}`.toLowerCase().includes(needle);
  });
  const count = (one: Tab) =>
    automations === undefined ? undefined : all.filter((each) => inTab(each, one)).length;

  return (
    <div className={page.page}>
      <section className={page.list} aria-labelledby="automations-title">
        <PageHeader
          id="automations-title"
          title="Automations"
          lead="Tasks that start on their own: on a schedule, when something arrives, or after another one."
          actions={
            <Button variant="primary" onClick={() => navigate({ name: "new-automation" })}>
              <Plus size={15} aria-hidden />
              New automation
            </Button>
          }
        />
        {automations !== undefined && all.length === 0 && !hideGuide ? (
          <Guide
            id="automations-guide"
            title="How automations work"
            intro="An automation is a task you would start yourself, saved with when it runs."
            steps={STEPS}
            onHide={() => setHideGuide(true)}
          />
        ) : null}
        {all.length === 0 ? null : (
          <div className={styles.tools}>
            <TabRow
              label="Automations by status"
              value={tab}
              onChange={setTab}
              tabs={[
                { value: "all", label: "All", count: count("all") },
                {
                  value: "needs",
                  label: "Needs you",
                  count: count("needs"),
                  urgent: (count("needs") ?? 0) > 0,
                },
                { value: "paused", label: "Paused", count: count("paused") },
                { value: "off", label: "Off", count: count("off") },
              ]}
            />
            {searching ? (
              <div className={styles.filters}>
                <SearchBox value={text} onChange={setText} label="Find an automation" />
              </div>
            ) : null}
          </div>
        )}
        {all.length === 0 ? null : shown.length === 0 ? (
          <p className={styles.empty}>
            {needle === "" ? "None here." : `No automation matches "${text.trim()}".`}
          </p>
        ) : (
          <ul className={styles.rows} aria-label="Automations">
            {shown.map((automation) => (
              <Row key={automation.id} automation={automation} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
