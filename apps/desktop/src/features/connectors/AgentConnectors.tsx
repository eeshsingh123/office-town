import { type AgentRecord, providerOf } from "@office-town/contract";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { PanelSection } from "../office/SidePanel.tsx";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import {
  groupApps,
  isOffer,
  permissionTitle,
  setUpThrough,
  stateOf,
  usableBy,
  useCatalog,
  useConnectors,
} from "./connectors.ts";

// The apps an agent may use now, and those its team has that its provider cannot reach, so what
// it is missing is never a silent gap.
export function AgentConnectors({ agent }: { agent: AgentRecord }) {
  const connectors = useConnectors();
  const catalog = useCatalog();
  const harnesses = useApp((state) => state.harnesses);
  const usable = new Set(usableBy(connectors, agent).map(({ id }) => id));
  const groups = groupApps(connectors, catalog?.entries).filter(
    (group) => !group.routes.every(isOffer),
  );
  const nameOf = (harness: string) =>
    harnesses.find((known) => known.harness === harness)?.name ?? harness;
  const given = (audience: (typeof connectors)[number]["audience"]) =>
    audience.everyone ||
    audience.agentIds.includes(agent.id) ||
    (agent.departmentId !== undefined && audience.departmentIds.includes(agent.departmentId));
  const ready = groups.flatMap((group) => {
    const route = group.routes.find(({ id }) => usable.has(id));
    return route === undefined ? [] : [{ group, route }];
  });
  // An app given to this agent or its team by name, or one on its own provider that it cannot use
  // now; an app for everyone that only another provider has is not this agent's gap.
  const missing =
    agent.guest === true
      ? []
      : groups.filter(
          (group) =>
            !group.routes.some(({ id }) => usable.has(id)) &&
            group.routes.some(
              ({ enabled, audience, setup }) =>
                enabled &&
                given(audience) &&
                (!audience.everyone || providerOf(setup.kind) === agent.settings.harness),
            ),
        );
  if (ready.length === 0 && missing.length === 0) return null;
  const harness = agent.settings.harness;
  const reasonOf = (routes: typeof connectors, providers: string[]) => {
    if (!providers.includes(harness)) {
      return providers.length === 0
        ? "Not answering"
        : `Only on ${providers.map(nameOf).join(" and ")}`;
    }
    const own = routes.filter(({ setup }) => providerOf(setup.kind) === harness);
    const state = stateOf(own);
    return state === "renew"
      ? "Needs renewing"
      : state === "failing"
        ? "Not answering"
        : "Not on its account";
  };
  return (
    <PanelSection title="Apps">
      {ready.map(({ group, route }) => (
        <button
          key={group.key}
          type="button"
          className={styles.appRow}
          onClick={() => navigate({ name: "connector", connectorId: route.id })}
        >
          <AppLogo app={group.logo} size="sm" />
          <span>{group.name}</span>
          <span className={styles.when}>{permissionTitle(route.permission)}</span>
        </button>
      ))}
      {missing.length === 0 ? null : (
        <p className={styles.panelNote}>Not available to this agent</p>
      )}
      {missing.map((group) => {
        const providers = [
          ...new Set(group.routes.flatMap(({ setup }) => providerOf(setup.kind) ?? [])),
        ];
        const entry = group.entry;
        const canAdd =
          entry !== undefined &&
          (providerOf(entry.setup.kind) === harness || entry.signIn.includes(harness));
        const [first] = group.routes;
        return (
          <div key={group.key} className={`${styles.appRow} ${styles.dim}`}>
            <AppLogo app={group.logo} size="sm" />
            <button
              type="button"
              className={styles.rowLink}
              onClick={() =>
                first === undefined
                  ? undefined
                  : navigate({ name: "connector", connectorId: first.id })
              }
            >
              {group.name}
              <span className={styles.sub}>{reasonOf(group.routes, providers)}</span>
            </button>
            {canAdd ? (
              <Button
                className={styles.raised}
                onClick={() =>
                  setUpThrough(harness, entry.setup.slug).catch((failure: unknown) =>
                    showToast(failure instanceof Error ? failure.message : String(failure)),
                  )
                }
              >
                Set up for {nameOf(harness)}
              </Button>
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </PanelSection>
  );
}
