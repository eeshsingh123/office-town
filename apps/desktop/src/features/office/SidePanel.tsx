import { Tabs } from "radix-ui";
import type { ReactNode } from "react";
import { ChatTab } from "../chat/ChatTab.tsx";
import { chooseTab, type PanelKind, useOffice } from "./office-state.ts";
import styles from "./SidePanel.module.css";

interface SidePanelProps {
  kind: PanelKind;
  label: string;
  // Whose conversation the Chat tab shows: the agent, a department's lead, or the chief.
  chatAgentId: string;
  overview: ReactNode;
  work: ReactNode;
}

// The right panel for whatever is selected: Overview, Chat and Work (D-49). The tab chosen last
// for each kind of selection stays chosen.
export function SidePanel({ kind, label, chatAgentId, overview, work }: SidePanelProps) {
  const tab = useOffice((state) => state.tabs[kind]);
  return (
    <Tabs.Root
      className={styles.panel}
      value={tab}
      onValueChange={(next) => {
        if (next === "overview" || next === "chat" || next === "work") chooseTab(kind, next);
      }}
      aria-label={label}
      asChild
    >
      <aside>
        <Tabs.List className={styles.tabs} aria-label="Show">
          <Tabs.Trigger value="overview" className={styles.tab}>
            Overview
          </Tabs.Trigger>
          <Tabs.Trigger value="chat" className={styles.tab}>
            Chat
          </Tabs.Trigger>
          <Tabs.Trigger value="work" className={styles.tab}>
            Work
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="overview" className={styles.content}>
          {overview}
        </Tabs.Content>
        <Tabs.Content value="chat" className={styles.chat}>
          <ChatTab agentId={chatAgentId} />
        </Tabs.Content>
        <Tabs.Content value="work" className={styles.content}>
          {work}
        </Tabs.Content>
      </aside>
    </Tabs.Root>
  );
}
