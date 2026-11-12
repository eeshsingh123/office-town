import { providerOf } from "@office-town/contract";
import { CircleAlert } from "lucide-react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { AppLogo } from "./AppLogo.tsx";
import styles from "./Connectors.module.css";
import {
  type AppGroup,
  groupApps,
  setUpThrough,
  tagsOf,
  useCatalog,
  useConnectors,
} from "./connectors.ts";
import { ProviderTags } from "./ProviderTags.tsx";

const given = (group: AppGroup, departmentId: string) =>
  group.routes.some(({ audience }) => audience.departmentIds.includes(departmentId));

// A provider the team uses that can sign in to the app itself, to set it up there.
function providerToAdd(group: AppGroup, harnesses: string[]): string | undefined {
  const entry = group.entry;
  if (entry === undefined) return undefined;
  const ways = [providerOf(entry.setup.kind), ...entry.signIn].filter(
    (way): way is string => way !== undefined,
  );
  return ways.find((way) => harnesses.includes(way));
}

// The apps given to a department by name, and a warning for one that only a provider no member
// uses can reach (D-96). Apps given to everyone are on the Connectors page.
export function DepartmentApps({
  departmentId,
  harnesses,
  warnOnly = false,
}: {
  departmentId: string;
  harnesses: string[];
  // In the team builder, only what needs the user shows.
  warnOnly?: boolean;
}) {
  const connectors = useConnectors();
  const catalog = useCatalog();
  const names = useApp((state) => state.harnesses);
  const groups = groupApps(connectors, catalog?.entries).filter((group) =>
    given(group, departmentId),
  );
  const unreachable = groups.filter((group) =>
    group.routes.every((route) => {
      const provider = providerOf(route.setup.kind);
      return provider !== undefined && !harnesses.includes(provider);
    }),
  );
  const nameOf = (harness: string) =>
    names.find((known) => known.harness === harness)?.name ?? harness;
  if (groups.length === 0 || (warnOnly && unreachable.length === 0)) return null;
  return (
    <div className={styles.deptApps}>
      {warnOnly
        ? null
        : groups.map((group) => {
            const [first] = group.routes;
            return (
              <button
                key={group.key}
                type="button"
                className={styles.appRow}
                onClick={() =>
                  first === undefined
                    ? undefined
                    : navigate({ name: "connector", connectorId: first.id })
                }
              >
                <AppLogo app={group.logo} size="sm" />
                <span>{group.name}</span>
                <ProviderTags tags={tagsOf(group.routes)} />
              </button>
            );
          })}
      {unreachable.map((group) => {
        const only = [...new Set(group.routes.flatMap(({ setup }) => providerOf(setup.kind) ?? []))]
          .map(nameOf)
          .join(" or ");
        const provider = providerToAdd(group, harnesses);
        return (
          <div key={`warn-${group.key}`} className={styles.teamWarn}>
            <CircleAlert size={14} aria-hidden />
            <span>
              {group.name} works only with {only}, which no one here uses.
            </span>
            {provider === undefined ? null : (
              <Button
                onClick={() =>
                  setUpThrough(provider, group.entry?.setup.slug ?? group.name).catch(
                    (failure: unknown) => showToast(String(failure)),
                  )
                }
              >
                Set up for {nameOf(provider)}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
