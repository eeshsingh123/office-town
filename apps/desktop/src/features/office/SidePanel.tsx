import { Settings, X } from "lucide-react";
import { Tabs } from "radix-ui";
import { type ReactNode, useState } from "react";
import type { AgentState } from "../../trace/progress.ts";
import { type PaneSize, usePaneWidth } from "../../ui/pane.ts";
import { ResizeHandle } from "../../ui/ResizeHandle.tsx";
import { STATE_LABELS } from "../../ui/StatusIcon.tsx";
import { ChatTab } from "../chat/ChatTab.tsx";
import { chooseTab, type PanelKind, setPanelOpen, useOffice } from "./office-state.ts";
import styles from "./SidePanel.module.css";

const SIZE: PaneSize = { initial: 360, min: 300, max: 560 };

// Slides off the right edge whole, so its content never squeezes while it moves.
export function PanelFrame({ children }: { children: ReactNode }) {
  const open = useOffice((state) => state.panelOpen);
  const [width, resize] = usePaneWidth("office-panel", SIZE);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`${styles.frame} ${dragging ? styles.dragging : ""}`}
      style={{ width, marginRight: open ? 0 : -width }}
      inert={!open}
    >
      {children}
      <ResizeHandle
        label="Resize side panel"
        width={width}
        size={SIZE}
        edge="left"
        onResize={resize}
        onDragging={setDragging}
      />
    </div>
  );
}

export function StateChip({ state }: { state: AgentState }) {
  const tone =
    state === "waiting"
      ? styles.chipWaiting
      : state === "working" || state === "starting"
        ? styles.chipWorking
        : state === "failed"
          ? styles.chipFailed
          : "";
  return <span className={`${styles.chip} ${tone}`}>{STATE_LABELS[state]}</span>;
}

export function PanelSection({
  title,
  action,
  children,
}: {
  title: string;
  // A small button beside the title, such as "Change".
  action?: ReactNode;
  children: ReactNode;
}) {
  const heading = <h3 className={styles.sectionTitle}>{title}</h3>;
  return (
    <section className={styles.section} aria-label={title}>
      {action === undefined ? (
        heading
      ) : (
        <div className={styles.sectionHead}>
          {heading}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function SectionAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.sectionAction} onClick={onClick}>
      {label}
    </button>
  );
}

export function Facts({ facts }: { facts: readonly ReactNode[] }) {
  return (
    <div className={styles.facts}>
      {facts
        .filter((fact) => fact !== undefined && fact !== null && fact !== "")
        .map((fact, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed per panel
          <span key={index} className={styles.fact}>
            {fact}
          </span>
        ))}
    </div>
  );
}

interface PanelHeaderProps {
  picture: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}

export function PanelSettings({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Settings size={16} aria-hidden />
    </button>
  );
}

export function PanelHeader({ picture, title, subtitle, status, actions }: PanelHeaderProps) {
  return (
    <div className={styles.header}>
      {picture}
      <div className={styles.headerText}>
        <strong>{title}</strong>
        {subtitle === undefined ? null : <span>{subtitle}</span>}
      </div>
      {status}
      {actions}
      <button
        type="button"
        className={styles.iconButton}
        onClick={() => setPanelOpen(false)}
        aria-label="Hide side panel"
        title="Hide side panel"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

interface SidePanelProps {
  kind: PanelKind;
  label: string;
  header: ReactNode;
  // The agent, a department's lead, or the chief.
  chatAgentId: string;
  now: ReactNode;
  activity: ReactNode;
  // An agent's own settings; the chief and departments have their own pages.
  profile?: ReactNode;
  // Stays in view under Now and Activity.
  footer?: ReactNode;
}

// The tab chosen last for each kind of selection stays chosen.
export function SidePanel(props: SidePanelProps) {
  const { kind, label, header, chatAgentId, now, activity, profile, footer } = props;
  const chosen = useOffice((state) => state.tabs[kind]);
  const tab = chosen === "profile" && profile === undefined ? "now" : chosen;
  return (
    <Tabs.Root
      className={styles.panel}
      value={tab}
      onValueChange={(next) => {
        if (next === "now" || next === "activity" || next === "chat" || next === "profile") {
          chooseTab(kind, next);
        }
      }}
      aria-label={label}
      asChild
    >
      <aside>
        {header}
        <Tabs.List className={styles.tabs} aria-label="Show">
          <Tabs.Trigger value="now" className={styles.tab}>
            Now
          </Tabs.Trigger>
          <Tabs.Trigger value="activity" className={styles.tab}>
            Activity
          </Tabs.Trigger>
          <Tabs.Trigger value="chat" className={styles.tab}>
            Chat
          </Tabs.Trigger>
          {profile === undefined ? null : (
            <Tabs.Trigger value="profile" className={styles.tab}>
              Profile
            </Tabs.Trigger>
          )}
        </Tabs.List>
        <Tabs.Content value="now" className={styles.content}>
          {now}
        </Tabs.Content>
        <Tabs.Content value="activity" className={styles.content}>
          {activity}
        </Tabs.Content>
        <Tabs.Content value="chat" className={styles.chat}>
          <ChatTab agentId={chatAgentId} named={kind !== "agent"} />
        </Tabs.Content>
        {profile === undefined ? null : (
          <Tabs.Content value="profile" className={styles.content}>
            {profile}
          </Tabs.Content>
        )}
        {footer === undefined || tab === "chat" || tab === "profile" ? null : (
          <div className={styles.footer}>{footer}</div>
        )}
      </aside>
    </Tabs.Root>
  );
}
