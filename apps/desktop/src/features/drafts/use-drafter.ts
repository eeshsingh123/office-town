import type { RoleSettings } from "@office-town/contract";
import { useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { useCatalog } from "../profiles/model-line.ts";

const KEY = "office-town.drafter";

function load(): RoleSettings | undefined {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === null ? undefined : (JSON.parse(saved) as RoleSettings);
  } catch {
    return undefined;
  }
}

// The model that writes drafts: Opus on Claude Code until the user picks another, which is kept.
export function useDrafter(): [RoleSettings, (next: RoleSettings) => void] {
  const harnesses = useApp((state) => state.harnesses);
  const [chosen, setChosen] = useState(load);
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
  const choose = (next: RoleSettings) => {
    setChosen(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Remembering this is a convenience only.
    }
  };
  return [drafter, choose];
}
