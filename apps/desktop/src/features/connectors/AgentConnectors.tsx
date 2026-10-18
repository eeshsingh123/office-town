import type { AgentRecord } from "@office-town/contract";
import { navigate } from "../../store/app-store.ts";
import { PanelSection } from "../office/SidePanel.tsx";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import { permissionTitle, usableBy, useConnectors } from "./connectors.ts";

// The apps an agent may use now, in its side panel.
export function AgentConnectors({ agent }: { agent: AgentRecord }) {
  const usable = usableBy(useConnectors(), agent);
  if (usable.length === 0) return null;
  return (
    <PanelSection title="Connectors">
      {usable.map(({ id, setup, permission }) => (
        <button
          key={id}
          type="button"
          className={styles.appRow}
          onClick={() => navigate({ name: "connector", connectorId: id })}
        >
          <AppLogo app={setup.slug} size="sm" />
          <span>{setup.name}</span>
          <span className={styles.when}>{permissionTitle(permission)}</span>
        </button>
      ))}
    </PanelSection>
  );
}
