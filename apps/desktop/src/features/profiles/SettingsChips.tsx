import type { RoleSettings } from "@office-town/contract";
import { useApp } from "../../store/app-store.ts";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import menu from "../../ui/Menu.module.css";
import { ModelChip } from "../new-task/ModelChip.tsx";
import { fullest, percent, roomiest, sameEnvironment } from "../usage/limits.ts";

export type ChipSettings = RoleSettings;

interface SettingsChipsProps {
  value: ChipSettings;
  onChange: (next: ChipSettings) => void;
}

const AUTOMATIC = "~automatic";

// Shown once there is more than one account to pick from (D-61).
function AccountChip({
  value,
  onChange,
}: {
  value: ChipSettings;
  onChange: (next: ChipSettings) => void;
}) {
  const accounts = useApp((state) => state.accounts);
  const limits = useApp((state) => state.limits);
  const mine = accounts.filter(
    (account) =>
      account.harness === value.harness && sameEnvironment(account.environment, value.environment),
  );
  if (mine.length < 2) return null;
  const room = (accountId: string) => {
    const full = fullest(limits[accountId]);
    if (full === undefined) return undefined;
    return full.usedFraction >= 1 ? "At its limit" : `${percent(full.usedFraction)} used`;
  };
  const best = roomiest(mine, limits);
  return (
    <ChoiceMenu
      label="Account"
      value={value.accountId ?? AUTOMATIC}
      choices={[
        {
          value: AUTOMATIC,
          label: "Automatic",
          ...(best === undefined
            ? {}
            : { description: `The one with the most room, now ${best.name}` }),
        },
        ...mine.map((account) => {
          const description = room(account.id);
          return {
            value: account.id,
            label: account.name,
            ...(description === undefined ? {} : { description }),
          };
        }),
      ]}
      onChange={(next) => {
        const { accountId: _, ...rest } = value;
        onChange(next === AUTOMATIC ? rest : { ...rest, accountId: next });
      }}
    />
  );
}

export function SettingsChips({ value, onChange }: SettingsChipsProps) {
  return (
    <>
      <ModelChip value={value} recent={[]} onChange={onChange} triggerClassName={menu.chip} />
      <AccountChip value={value} onChange={onChange} />
    </>
  );
}
