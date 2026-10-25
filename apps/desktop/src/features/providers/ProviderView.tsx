import type { EnvironmentSpec, HarnessModel } from "@office-town/contract";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { environmentKey, readCatalog } from "../../api/catalogs.ts";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { Crumbs } from "../../ui/Crumbs.tsx";
import { environmentName } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { useLoaded } from "../../ui/use-loaded.ts";
import { effortName } from "../new-task/ModelChip.tsx";
import { AccountGrid, useSpend } from "../usage/AccountGrid.tsx";
import { AddAccountDialog } from "../usage/AddAccountDialog.tsx";
import { reloadAccounts, useLiveLimits } from "../usage/use-usage.ts";
import { CopyCommand, InstallSheet } from "./InstallSheet.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";
import styles from "./Providers.module.css";
import { defaultLogin, isReady, useHarnessStatuses } from "./providers.ts";

const ACCESS: Record<NonNullable<HarnessModel["access"]>, string> = {
  free: "Free",
  plan: "In your plan",
  paid: "Paid per use",
};
// Enough to see what it offers; the rest wait behind "Show all".
const MODELS_SHOWN = 12;

function modelLine(model: HarnessModel): string {
  const first = model.efforts[0];
  const last = model.efforts.at(-1);
  return [
    model.access === undefined ? undefined : ACCESS[model.access],
    first === undefined || last === undefined
      ? undefined
      : first === last
        ? `${effortName(first)} effort`
        : `${effortName(first)} to ${effortName(last)} effort`,
    model.inputs?.includes("image") ? "sees images" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Models({ harness, signedIn }: { harness: string; signedIn: boolean | undefined }) {
  const catalog = useLoaded(`${harness}|${signedIn}`, () =>
    readCatalog(harness, { kind: "native" }),
  );
  const [all, setAll] = useState(false);
  const models = catalog.value?.models;
  if (catalog.error !== undefined) {
    return (
      <p className={styles.muted}>
        {signedIn === false
          ? "Sign in to see its models."
          : `Could not read its models: ${catalog.error}`}
      </p>
    );
  }
  if (models === undefined) return <p className={styles.muted}>Reading its models…</p>;
  if (models.length === 0)
    return <p className={styles.muted}>It lists its models once you sign in.</p>;
  const shown = all ? models : models.slice(0, MODELS_SHOWN);
  return (
    <>
      <ul className={styles.models} aria-label="Models">
        {shown.map((model) => (
          <li key={model.id} className={styles.modelRow}>
            <span className={styles.modelName}>{model.name}</span>
            <span className={styles.muted}>{modelLine(model)}</span>
          </li>
        ))}
      </ul>
      {models.length > shown.length ? (
        <Button variant="ghost" onClick={() => setAll(true)}>
          Show all {models.length}
        </Button>
      ) : null}
    </>
  );
}

// Where it can run: this computer, and each WSL distro, which the user installs it in by hand.
function RunsOn({ harness }: { harness: string }) {
  const environments = useLoaded("environments", api.listEnvironments).value ?? [];
  return (
    <ul className={styles.models} aria-label="Runs on">
      {environments.map((environment) => (
        <Place key={environmentKey(environment)} harness={harness} environment={environment} />
      ))}
    </ul>
  );
}

function Place({ harness, environment }: { harness: string; environment: EnvironmentSpec }) {
  const native = environment.kind === "native";
  const here = useHarnessStatuses()?.[harness];
  const there = useLoaded(native ? undefined : `${harness}|${environmentKey(environment)}`, () =>
    api.readHarnessStatusIn(harness, environment),
  ).value;
  const status = native ? here : there;
  const name = native ? "This PC" : environmentName(environment);
  return (
    <li className={styles.place}>
      <div className={styles.placeHead}>
        <span className={styles.placeName}>{name}</span>
        {status === undefined ? (
          <span className={styles.muted}>Checking…</span>
        ) : isReady(status) ? (
          <span className={`${styles.chip} ${styles.chipOk}`}>Ready</span>
        ) : status.installed ? (
          <span className={`${styles.chip} ${styles.chipWarn}`}>Not signed in</span>
        ) : (
          <span className={styles.chip}>Not installed</span>
        )}
      </div>
      {native ||
      status === undefined ||
      status.installed ||
      status.installCommand === undefined ? null : (
        <>
          <CopyCommand command={status.installCommand} />
          <span className={styles.muted}>Run it in {name}, then come back here.</span>
        </>
      )}
    </li>
  );
}

type Sheet = "install" | "sign-in" | "add";

// One AI app: whether it is ready, its accounts, its models and where it runs (D-76).
export function ProviderView({ harness }: { harness: string }) {
  const description = useApp((state) => state.harnesses.find((one) => one.harness === harness));
  const accounts = useApp((state) => state.accounts);
  const status = useHarnessStatuses()?.[harness];
  const spend = useSpend();
  useLiveLimits();
  const [sheet, setSheet] = useState<Sheet>();
  useEffect(() => {
    void reloadAccounts().catch(() => {});
  }, []);
  if (description === undefined) {
    return (
      <section className={page.page}>
        <p className={styles.muted}>This AI app is not known here.</p>
      </section>
    );
  }
  const mine = accounts.filter((account) => account.harness === harness);
  const login = defaultLogin(accounts, harness);
  const ready = isReady(status);
  const installed = status?.installed === true;

  return (
    <section className={page.page} aria-labelledby="provider-title">
      <div className={styles.column}>
        <div className={page.header}>
          <Crumbs
            items={[
              { label: "Providers", view: { name: "providers" } },
              { label: description.name },
            ]}
          />
          <div className={styles.head}>
            <ProviderLogo harness={harness} size="lg" />
            <div className={styles.headText}>
              <div className={styles.headTitle}>
                <h1 id="provider-title" className={page.title}>
                  {description.name}
                </h1>
                {status === undefined ? null : ready ? (
                  <span className={`${styles.chip} ${styles.chipOk}`}>Ready</span>
                ) : installed ? (
                  <span className={`${styles.chip} ${styles.chipWarn}`}>Not signed in</span>
                ) : (
                  <span className={styles.chip}>Not installed</span>
                )}
              </div>
              <span className={styles.muted}>
                Official, by {description.maker}
                {status?.version ? ` · version ${status.version}` : ""} · {description.needs}
              </span>
            </div>
            {status === undefined ? null : !installed ? (
              <Button variant="primary" onClick={() => setSheet("install")}>
                Install
              </Button>
            ) : !ready && login !== undefined ? (
              <Button variant="primary" onClick={() => setSheet("sign-in")}>
                Sign in
              </Button>
            ) : null}
          </div>
          <p className={page.lead}>{description.summary}</p>
        </div>

        {!installed ? null : (
          <>
            <div className={page.section}>
              <div className={page.sectionHead}>
                <h2 className={page.sectionTitle}>
                  Accounts <span className={styles.count}>{mine.length}</span>
                </h2>
                {description.manyAccounts ? (
                  <Button onClick={() => setSheet("add")}>
                    <Plus size={14} aria-hidden />
                    Add account
                  </Button>
                ) : null}
              </div>
              <AccountGrid accounts={mine} spend={spend} showLeft={false} />
            </div>

            {description.capabilities.modelList ? (
              <div className={page.section}>
                <div className={page.sectionHead}>
                  <h2 className={page.sectionTitle}>Models</h2>
                </div>
                <Models harness={harness} signedIn={status?.signedIn} />
              </div>
            ) : null}
          </>
        )}

        <div className={page.section}>
          <div className={page.sectionHead}>
            <h2 className={page.sectionTitle}>Runs on</h2>
          </div>
          <RunsOn harness={harness} />
        </div>
      </div>

      {sheet === "install" ? (
        <InstallSheet
          harness={harness}
          onSignIn={() => setSheet("sign-in")}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet === "sign-in" && login !== undefined ? (
        <AddAccountDialog again={login} onClose={() => setSheet(undefined)} />
      ) : null}
      {sheet === "add" ? (
        <AddAccountDialog harness={harness} onClose={() => setSheet(undefined)} />
      ) : null}
    </section>
  );
}
