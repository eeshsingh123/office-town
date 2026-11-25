import type { Account, HarnessDescription, HarnessStatus } from "@office-town/contract";
import { ChevronRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { Count } from "../../ui/Count.tsx";
import { environmentName } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { AddAccountDialog } from "../usage/AddAccountDialog.tsx";
import { type Spend, useSpend } from "../usage/accounts.tsx";
import { accountLabel, useIdentities } from "../usage/identity.ts";
import { reloadAccounts, useLiveLimits } from "../usage/use-usage.ts";
import { AccountRows } from "./AccountRows.tsx";
import { InstallSheet } from "./InstallSheet.tsx";
import { ProviderCard } from "./ProviderCard.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";
import styles from "./Providers.module.css";
import { defaultLogin, isReady, useHarnessStatuses } from "./providers.ts";

// Search shows once there are more accounts than fit on a screen.
const SEARCH_FROM = 8;

// Where its accounts run: always this PC, and each WSL distro an account was added in.
function placesOf(accounts: readonly Account[]): string {
  const wsl = new Set(
    accounts.flatMap((account) =>
      account.environment.kind === "wsl" ? [environmentName(account.environment)] : [],
    ),
  );
  return ["This PC", ...wsl].join(", ");
}

function ProviderBlock(props: {
  description: HarnessDescription;
  status: HarnessStatus;
  accounts: Account[];
  spend: Spend | undefined;
  // One row of a shared card, as the providers to sign in are listed.
  grouped?: boolean;
  onSignIn: () => void;
  onAdd: () => void;
}) {
  const { description, status, accounts } = props;
  const ready = isReady(status);
  const { version } = status;
  const sub = ready
    ? [version && `Version ${version}`, placesOf(accounts)]
    : ["Installed", version && `version ${version}`, "This PC"];
  return (
    <li className={props.grouped ? styles.pgroupRow : styles.pblock}>
      <div className={styles.pblockHead}>
        <button
          type="button"
          className={styles.pblockLink}
          onClick={() => navigate({ name: "provider", harness: description.harness })}
        >
          <ProviderLogo harness={description.harness} />
          <span className={styles.rowText}>
            <span className={styles.rowName}>{description.name}</span>
            <span className={styles.rowSub}>{sub.filter(Boolean).join(" · ")}</span>
          </span>
        </button>
        <span className={styles.pblockAction}>
          {!ready ? (
            <Button variant="primary" onClick={props.onSignIn}>
              Sign in
            </Button>
          ) : description.manyAccounts ? (
            <Button onClick={props.onAdd}>
              <Plus size={14} aria-hidden />
              Add account
            </Button>
          ) : null}
        </span>
        <ChevronRight size={16} className={styles.go} aria-hidden />
      </div>
      {ready ? (
        <AccountRows description={description} accounts={accounts} spend={props.spend} />
      ) : null}
    </li>
  );
}

type Sheet =
  | { kind: "install"; harness: string }
  | { kind: "sign-in"; account: Account }
  | { kind: "add"; harness: string };

// Where the user gets ready: install, sign in and accounts (D-76). How much is left is on Usage.
export function ProvidersView() {
  const harnesses = useApp((state) => state.harnesses);
  const accounts = useApp((state) => state.accounts);
  const identities = useIdentities();
  const statuses = useHarnessStatuses({ recheckOnFocus: true });
  const spend = useSpend();
  useLiveLimits();
  const [sheet, setSheet] = useState<Sheet>();
  const [query, setQuery] = useState("");
  useEffect(() => {
    void reloadAccounts().catch(() => {});
  }, []);

  const statusOf = (harness: string) => statuses?.[harness];
  const installed = harnesses.filter((known) => statusOf(known.harness)?.installed);
  // Signed in first, with their accounts; those to sign in after, so they never push them down.
  const ready = installed.filter((known) => isReady(statusOf(known.harness)));
  const toSignIn = installed.filter((known) => !isReady(statusOf(known.harness)));
  const missing = harnesses.filter((known) => statusOf(known.harness)?.installed === false);
  // Each provider shows once its own check is in.
  const unchecked = harnesses.filter((known) => statusOf(known.harness) === undefined);
  const needle = query.trim().toLowerCase();
  const accountsOf = (description: HarnessDescription) =>
    accounts.filter(
      (account) =>
        account.harness === description.harness &&
        (needle === "" ||
          `${description.name} ${accountLabel(account, identities[account.id])} ${account.name}`
            .toLowerCase()
            .includes(needle)),
    );
  const signIn = (harness: string) => {
    const account = defaultLogin(accounts, harness);
    setSheet(account === undefined ? undefined : { kind: "sign-in", account });
  };
  const shown = ready.filter((description) => needle === "" || accountsOf(description).length > 0);
  const block = (description: HarnessDescription, grouped = false) => {
    const status = statusOf(description.harness);
    if (status === undefined) return null;
    return (
      <ProviderBlock
        key={description.harness}
        description={description}
        status={status}
        accounts={accountsOf(description)}
        spend={spend}
        grouped={grouped}
        onSignIn={() => signIn(description.harness)}
        onAdd={() => setSheet({ kind: "add", harness: description.harness })}
      />
    );
  };

  return (
    <section className={page.page} aria-labelledby="providers-title">
      <div className={styles.column}>
        <PageHeader
          id="providers-title"
          title="Providers"
          lead="The programs your agents run on, and your accounts on them."
        />

        {statuses === undefined ? (
          <p className={styles.muted}>Checking this computer</p>
        ) : (
          <>
            <div className={page.section}>
              {ready.length === 0 ? null : (
                <div className={page.sectionHead}>
                  <h2 className={page.sectionTitle}>
                    Ready <Count value={ready.length} />
                  </h2>
                  {accounts.length > SEARCH_FROM ? (
                    <SearchBox value={query} onChange={setQuery} label="Search accounts" />
                  ) : null}
                </div>
              )}
              {installed.length === 0 && unchecked.length === 0 ? (
                <p className={styles.muted}>None yet. Install one below to get started.</p>
              ) : shown.length === 0 ? (
                needle === "" ? null : (
                  <p className={styles.muted}>No accounts match.</p>
                )
              ) : (
                <ul className={styles.pblocks} aria-label="Your providers">
                  {shown.map((description) => block(description))}
                </ul>
              )}
              {unchecked.length === 0 ? null : (
                <p className={styles.muted} role="status">
                  Checking {unchecked.map((known) => known.name).join(", ")}
                </p>
              )}
            </div>

            {toSignIn.length === 0 || needle !== "" ? null : (
              <div className={page.section}>
                <div className={page.sectionHead}>
                  <h2 className={page.sectionTitle}>
                    Not signed in <Count value={toSignIn.length} />
                  </h2>
                </div>
                <ul className={styles.pgroup} aria-label="Providers to sign in">
                  {toSignIn.map((description) => block(description, true))}
                </ul>
              </div>
            )}

            {missing.length === 0 ? null : (
              <div className={page.section}>
                <div className={page.sectionHead}>
                  <h2 className={page.sectionTitle}>
                    Get more <Count value={missing.length} />
                  </h2>
                </div>
                <ul className={styles.grid} aria-label="Providers to install">
                  {missing.map((description) => (
                    <ProviderCard
                      key={description.harness}
                      description={description}
                      status={statusOf(description.harness)}
                      onInstall={() => setSheet({ kind: "install", harness: description.harness })}
                      onSignIn={() => signIn(description.harness)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {sheet?.kind === "install" ? (
        <InstallSheet
          harness={sheet.harness}
          onSignIn={() => signIn(sheet.harness)}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet?.kind === "sign-in" ? (
        <AddAccountDialog again={sheet.account} onClose={() => setSheet(undefined)} />
      ) : null}
      {sheet?.kind === "add" ? (
        <AddAccountDialog harness={sheet.harness} onClose={() => setSheet(undefined)} />
      ) : null}
    </section>
  );
}
