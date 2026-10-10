import { Tabs } from "radix-ui";
import type { ReactNode } from "react";
import { ChatTab } from "../chat/ChatTab.tsx";
import { chooseTab, type PanelKind, useOffice } from "./office-state.ts";
import styles from "./SidePanel.module.css";

interface SidePanelProps {
  kind: PanelKind;
  label: string;
  // The agent, a department's lead, or the chief.
  chatAgentId: string;
  overview: ReactNode;
  work: ReactNode;
  // An agent's own settings; the chief and departments have their own pages.
  profile?: ReactNode;
}

// The tab chosen last for each kind of selection stays chosen.
export function SidePanel({ kind, label, chatAgentId, overview, work, profile }: SidePanelProps) {
  const chosen = useOffice((state) => state.tabs[kind]);
  const tab = chosen === "profile" && profile === undefined ? "overview" : chosen;
  return (
    <Tabs.Root
      className={styles.panel}
      value={tab}
      onValueChange={(next) => {
        if (next === "overview" || next === "chat" || next === "work" || next === "profile") {
          chooseTab(kind, next);
        }
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
          {profile === undefined ? null : (
            <Tabs.Trigger value="profile" className={styles.tab}>
              Profile
            </Tabs.Trigger>
          )}
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
        {profile === undefined ? null : (
          <Tabs.Content value="profile" className={styles.content}>
            {profile}
          </Tabs.Content>
        )}
      </aside>
    </Tabs.Root>
  );
}
