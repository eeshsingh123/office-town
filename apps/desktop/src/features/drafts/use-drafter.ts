import type { RoleSettings } from "@office-town/contract";
import { useApp } from "../../store/app-store.ts";
import { SETTINGS_SHAPE, shaped } from "../../store/drafts.ts";
import { type Keep, useKept } from "../../store/kept.ts";
import { useCatalog } from "../profiles/model-line.ts";

// Unset until the user picks one.
export const DRAFTER: Keep<RoleSettings | undefined> = {
  name: "drafter",
  lasts: "saved",
  start: undefined,
  parse: shaped<RoleSettings>(SETTINGS_SHAPE),
};

// The model that writes drafts: Opus on Claude Code until the user picks another, which is kept.
export function useDrafter(): [RoleSettings, (next: RoleSettings) => void] {
  const harnesses = useApp((state) => state.harnesses);
  const [chosen, choose] = useKept(DRAFTER);
  const claude = harnesses.find((known) => known.harness === "claude") ?? harnesses[0];
  const base: RoleSettings = {
    harness: claude?.harness ?? "claude",
    environment: { kind: "native" },
  };
  const { models } = useCatalog(chosen === undefined ? claude : undefined, base.environment);
  const opus =
    models?.find((model) => model.id === "opus") ??
    models?.find((model) => /^opus/i.test(model.name));
  const drafter = chosen ?? (opus === undefined ? base : { ...base, model: opus.id });
  return [drafter, choose];
}
