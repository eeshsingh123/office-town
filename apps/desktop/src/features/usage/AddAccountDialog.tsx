import {
  type Account,
  type AccountLogin,
  type AccountStatus,
  accountProviders,
  type EnvironmentSpec,
} from "@office-town/contract";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { environmentKey } from "../../api/catalogs.ts";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import dialog from "../../ui/Dialog.module.css";
import { environmentName } from "../../ui/format.ts";
import { useLoaded } from "../../ui/use-loaded.ts";
import { CopyCommand } from "../providers/InstallSheet.tsx";
import { checkHarnesses, useHarnessStatuses } from "../providers/providers.ts";
import { sameEnvironment } from "./limits.ts";
import styles from "./Usage.module.css";
import { reloadAccounts } from "./use-usage.ts";

type Step = "tool" | "name" | "sign-in" | "use";

const STEP_NAMES: [Step, string][] = [
  ["tool", "Tool"],
  ["name", "Name"],
  ["sign-in", "Sign in"],
  ["use", "Use it for"],
];

const POLL_MS = 1500;

interface AddAccountDialogProps {
  // Set to sign an account in again, which skips the first two steps.
  again?: Account | undefined;
  // Set when the AI app is already chosen, as on its Providers page, which skips the first step.
  harness?: string;
  onClose: () => void;
}

// A code the CLI shows, to type on its sign-in page.
function SignInCode({ code }: { code: string }) {
  return (
    <div className={styles.signInCode}>
      <CopyCommand command={code} />
    </div>
  );
}

const message = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

export function AddAccountDialog({ again, harness: preset, onClose }: AddAccountDialogProps) {
  const harnesses = useApp((state) => state.harnesses);
  const statuses = useHarnessStatuses();
  // Only an app that keeps several logins apart, and is installed here.
  const choices = harnesses.filter(
    (known) => known.manyAccounts && (statuses === undefined || statuses[known.harness]?.installed),
  );
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const environments = useLoaded("environments", api.listEnvironments);
  const [step, setStep] = useState<Step>(
    again !== undefined ? "sign-in" : preset !== undefined ? "name" : "tool",
  );
  const [harness, setHarness] = useState(
    again?.harness ?? preset ?? choices[0]?.harness ?? harnesses[0]?.harness ?? "claude",
  );
  const [environment, setEnvironment] = useState<EnvironmentSpec>(
    again?.environment ?? { kind: "native" },
  );
  const [name, setName] = useState("");
  const [account, setAccount] = useState<Account | undefined>(again);
  const [login, setLogin] = useState<AccountLogin>();
  const [code, setCode] = useState("");
  const [provider, setProvider] = useState<string>(accountProviders[0].id);
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<AccountStatus>();
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const description = harnesses.find((known) => known.harness === harness);
  const harnessName = description?.name ?? harness;
  const signsInWithKey = description?.signIn === "key";

  // "Sign in again" starts right away.
  useEffect(() => {
    const signIn = useApp.getState().harnesses.find((known) => known.harness === again?.harness);
    if (again === undefined || signIn?.signIn === "key") return;
    api
      .startSignIn(again.id)
      .then(setLogin)
      .catch((failure: unknown) => setError(message(failure)));
  }, [again]);

  // While the CLI waits for the browser, ask it how the sign-in went.
  useEffect(() => {
    if (account === undefined || login?.state !== "waiting") return;
    const timer = setInterval(() => {
      api
        .readSignIn(account.id)
        .then(async (next) => {
          setLogin(next);
          if (next.state === "done") {
            setStatus((await api.readAccountStatus(account.id)) ?? undefined);
            setStep("use");
            void checkHarnesses({ now: true }).catch(() => {});
          }
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [account, login?.state]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  const startSignIn = (target: Account) =>
    run(async () => {
      setLogin(await api.startSignIn(target.id));
    });

  const create = () =>
    run(async () => {
      const created = await api.createAccount({ harness, environment, name: name.trim() });
      setAccount(created);
      setStep("sign-in");
      await reloadAccounts();
      if (!signsInWithKey) setLogin(await api.startSignIn(created.id));
    });

  const saveKey = () =>
    run(async () => {
      if (account === undefined) return;
      const provided = accountProviders.find((one) => one.id === provider) ?? accountProviders[0];
      setStatus(await api.saveAccountKey(account.id, { provider: provided.id, key }));
      setKey("");
      setStep("use");
    });

  // An account left without a sign-in is removed, so no empty account stays behind.
  const close = async () => {
    if (account !== undefined && again === undefined && step === "sign-in") {
      await api.deleteAccount(account.id).catch(() => {});
      await reloadAccounts().catch(() => {});
    } else if (account !== undefined && login?.state === "waiting") {
      await api.cancelSignIn(account.id).catch(() => {});
    }
    onClose();
  };

  const finish = () =>
    run(async () => {
      if (account !== undefined && team !== "") {
        const members = Object.values(agents).filter(
          (agent) =>
            agent.departmentId === team &&
            agent.settings.harness === account.harness &&
            sameEnvironment(agent.settings.environment, account.environment),
        );
        for (const agent of members) {
          await api.updateAgent(agent.id, {
            colour: agent.colour,
            purpose: agent.purpose ?? "",
            settings: { ...agent.settings, accountId: account.id },
          });
        }
      }
      await reloadAccounts();
      onClose();
    });

  const teams = Object.values(departments).filter((department) =>
    Object.values(agents).some(
      (agent) => agent.departmentId === department.id && agent.settings.harness === harness,
    ),
  );

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) void close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={dialog.content}>
          <Dialog.Title className={dialog.title}>
            {again === undefined ? "Add account" : `Sign in to ${again.name}`}
          </Dialog.Title>
          <Dialog.Description className="visually-hidden">
            Connect another {harnessName} sign-in for your agents to use.
          </Dialog.Description>
          {again === undefined ? (
            <ol className={styles.steps} aria-label="Steps">
              {STEP_NAMES.filter(([value]) => preset === undefined || value !== "tool").map(
                ([value, label]) => (
                  <li key={value} aria-current={value === step ? "step" : undefined}>
                    {label}
                  </li>
                ),
              )}
            </ol>
          ) : null}

          {step === "tool" ? (
            <fieldset className={styles.choices}>
              <legend className="visually-hidden">Tool</legend>
              {choices.map((known) => (
                <button
                  key={known.harness}
                  type="button"
                  className={styles.choice}
                  aria-pressed={known.harness === harness}
                  onClick={() => setHarness(known.harness)}
                >
                  <span>
                    <strong>{known.name}</strong>
                    <small>
                      {known.signIn === "key"
                        ? `Signed in with a key from your ${known.name} console`
                        : `${known.needs}, signed in through your browser`}
                    </small>
                  </span>
                </button>
              ))}
            </fieldset>
          ) : null}

          {step === "name" ? (
            <>
              <label className={dialog.label}>
                Name
                <input
                  className={dialog.input}
                  value={name}
                  maxLength={40}
                  placeholder="Work, Personal, Side project"
                  // biome-ignore lint/a11y/noAutofocus: the dialog's only field
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {(environments.value?.length ?? 0) > 1 ? (
                <div>
                  <ChoiceMenu
                    label="Runs on"
                    value={environmentKey(environment)}
                    choices={(environments.value ?? []).map((known) => ({
                      value: environmentKey(known),
                      label: environmentName(known),
                    }))}
                    onChange={(next) => {
                      const found = environments.value?.find(
                        (known) => environmentKey(known) === next,
                      );
                      if (found !== undefined) setEnvironment(found);
                    }}
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {step === "sign-in" && signsInWithKey ? (
            <>
              <ChoiceMenu
                label="Plan"
                value={provider}
                choices={accountProviders.map((one) => ({ value: one.id, label: one.label }))}
                onChange={setProvider}
              />
              <label className={dialog.label}>
                Key
                <input
                  className={dialog.input}
                  type="password"
                  value={key}
                  autoComplete="off"
                  placeholder="Paste the key from opencode.ai"
                  onChange={(event) => setKey(event.target.value)}
                />
              </label>
              <p className={styles.muted}>
                OpenCode keeps it in this account's own folder.{" "}
                <a href="https://opencode.ai/auth" target="_blank" rel="noreferrer">
                  Get a key
                </a>
              </p>
            </>
          ) : null}

          {step === "sign-in" && !signsInWithKey ? (
            login?.state === "failed" ? (
              <p className={dialog.error} role="alert">
                {login.message ?? "Sign-in did not finish."}
              </p>
            ) : (
              <>
                <div className={styles.waiting} role="status">
                  <span className={styles.spin} aria-hidden />
                  <div>
                    <strong>Finish signing in in your browser</strong>
                    <br />
                    <span>
                      {login?.code === undefined
                        ? `${harnessName}'s sign-in page opened.`
                        : "Enter this code on the page that opened."}{" "}
                      {account?.folder === undefined
                        ? ""
                        : `This account stays separate from your other ${harnessName} sign-ins.`}
                    </span>
                  </div>
                </div>
                {login?.code === undefined ? null : <SignInCode code={login.code} />}
                {login?.code !== undefined ? null : (
                  <label className={dialog.label}>
                    Code, if the page shows one
                    <div className={styles.codeRow}>
                      <input
                        className={dialog.input}
                        value={code}
                        autoComplete="off"
                        onChange={(event) => setCode(event.target.value)}
                      />
                      <Button
                        disabled={busy || code.trim() === "" || account === undefined}
                        onClick={() =>
                          void run(async () => {
                            if (account === undefined) return;
                            await api.sendSignInCode(account.id, code);
                            setCode("");
                          })
                        }
                      >
                        Send code
                      </Button>
                    </div>
                  </label>
                )}
              </>
            )
          ) : null}

          {step === "use" ? (
            <>
              <p className={styles.done} role="status">
                Signed in{status?.email === undefined ? "" : ` as ${status.email}`}
                {status?.plan === undefined ? "" : ` · ${status.plan}`}
              </p>
              {again === undefined && teams.length > 0 ? (
                <fieldset className={styles.choices}>
                  <legend className="visually-hidden">Use it for</legend>
                  <button
                    type="button"
                    className={styles.choice}
                    aria-pressed={team === ""}
                    onClick={() => setTeam("")}
                  >
                    <span>
                      <strong>Nothing yet</strong>
                      <small>Pick it per team or agent later</small>
                    </span>
                  </button>
                  {teams.map((department) => (
                    <button
                      key={department.id}
                      type="button"
                      className={styles.choice}
                      aria-pressed={team === department.id}
                      onClick={() => setTeam(department.id)}
                    >
                      <span>
                        <strong>{department.name}</strong>
                        <small>
                          Its {harnessName} agents use this account from their next task
                        </small>
                      </span>
                    </button>
                  ))}
                </fieldset>
              ) : null}
            </>
          ) : null}

          {error === undefined ? null : (
            <p className={dialog.error} role="alert">
              {error}
            </p>
          )}

          <div className={dialog.actions}>
            {step === "use" ? null : (
              <Button variant="ghost" disabled={busy} onClick={() => void close()}>
                Cancel
              </Button>
            )}
            {step === "tool" ? (
              <Button variant="primary" onClick={() => setStep("name")}>
                Next
              </Button>
            ) : step === "name" ? (
              <Button
                variant="primary"
                disabled={busy || name.trim() === ""}
                onClick={() => void create()}
              >
                {signsInWithKey ? "Next" : "Sign in"}
              </Button>
            ) : step === "sign-in" && signsInWithKey ? (
              <Button
                variant="primary"
                disabled={busy || key.trim().length < 8}
                onClick={() => void saveKey()}
              >
                Save key
              </Button>
            ) : step === "sign-in" ? (
              <>
                {login?.url === undefined ? null : (
                  <a className={styles.muted} href={login.url} target="_blank" rel="noreferrer">
                    Open the page again
                  </a>
                )}
                {login?.state === "failed" && account !== undefined ? (
                  <Button variant="primary" onClick={() => void startSignIn(account)}>
                    Try again
                  </Button>
                ) : null}
              </>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void finish()}>
                Done
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
