import path from "node:path";
import { museAdapter } from "../src/adapters/muse/adapter.ts";
import { describeAdapterConformance } from "./support/conformance.ts";
import { loadRecording } from "./support/replay.ts";

const recording = (name: string) =>
  loadRecording(path.join(import.meta.dirname, "fixtures", "muse", `${name}.jsonl`));

// echo-turn is a real `muse serve --provider echo` run; the others follow its schema.
describeAdapterConformance(museAdapter, {
  "echo-turn": recording("echo-turn"),
  "tool-approved": recording("tool-approved"),
  "question-answered": recording("question-answered"),
});
