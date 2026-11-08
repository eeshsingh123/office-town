import { type Keep, useKept } from "../../store/kept.ts";

// Past this many departments, ones the user never opened start folded.
const FOLD_PAST = 4;

// Which departments on the Team page are folded to their header, remembered across launches.
const FOLDS: Keep<Record<string, boolean>> = { name: "team-folds", lasts: "saved", start: {} };

export function useTeamFolds(count: number) {
  const [folds, setFolds] = useKept(FOLDS);
  const folded = (id: string) => folds[id] ?? count > FOLD_PAST;
  const toggle = (id: string) => setFolds({ ...folds, [id]: !folded(id) });
  return { folded, toggle };
}
