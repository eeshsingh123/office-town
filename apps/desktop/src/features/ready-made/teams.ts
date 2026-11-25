import type { AgentColour } from "@office-town/contract";
import { Bug, type LucideIcon, PenLine, ScanSearch, Telescope } from "lucide-react";
import type { Power } from "./models.ts";

export interface ReadyPerson {
  role: string;
  purpose: string;
  instructions: string;
  power: Power;
}

export interface ReadyTeam {
  id: string;
  name: string;
  icon: LucideIcon;
  colour: AgentColour;
  // The card: what it does, who is on it, what you get.
  does: string;
  who: string;
  youGet: string;
  // Works on the user's own code, so it asks for the project folder first.
  needsProject: boolean;
  purpose: string;
  rules: string;
  lead: ReadyPerson;
  members: ReadyPerson[];
}

// Hand-picked starting points (D-136): each one is an ordinary department once created.
export const READY_TEAMS: ReadyTeam[] = [
  {
    id: "research-desk",
    name: "Research desk",
    icon: Telescope,
    colour: "#3A6EA5",
    does: "Looks into a question from several sides and writes up what it found.",
    who: "A lead, two researchers and a writer",
    youGet: "A one-page summary with sources",
    needsProject: false,
    purpose: "Researches a question and writes a short, sourced summary",
    rules: [
      "Cite a source for every claim, with its link.",
      "Say plainly when sources disagree or a fact could not be checked.",
      "Write in plain words; no filler.",
    ].join("\n"),
    lead: {
      role: "Lead",
      purpose: "Splits the question and checks the final summary",
      instructions:
        "Break the question into two parts and give each researcher one. When their notes are in, have the writer turn them into the summary. Read it before it is done: every claim needs a source, and the answer to the question comes first.",
      power: "strong",
    },
    members: [
      {
        role: "Researcher",
        purpose: "Finds and reads sources on one part of the question",
        instructions:
          "Search the web for your part of the question and read the best three to five sources. If you cannot search, read pages from well-known sites directly. Hand back short notes: each finding in one line with its link, and anything that looked doubtful.",
        power: "cheap",
      },
      {
        role: "Researcher",
        purpose: "Finds and reads sources on one part of the question",
        instructions:
          "Search the web for your part of the question and read the best three to five sources. If you cannot search, read pages from well-known sites directly. Hand back short notes: each finding in one line with its link, and anything that looked doubtful.",
        power: "cheap",
      },
      {
        role: "Writer",
        purpose: "Turns the notes into a one-page summary",
        instructions:
          "Write summary.md from the researchers' notes: the answer first in two or three sentences, then a short section per part, then the sources as a list of links. Keep it to one page.",
        power: "cheap",
      },
    ],
  },
  {
    id: "content-team",
    name: "Content team",
    icon: PenLine,
    colour: "#B5602B",
    does: "Turns an idea or rough notes into a polished piece of writing.",
    who: "A lead, a writer and an editor",
    youGet: "A finished, edited post or article",
    needsProject: false,
    purpose: "Writes and edits posts, articles and newsletters",
    rules: [
      "Match the audience and tone the task asks for; default to clear and friendly.",
      "Short paragraphs and plain words.",
      "Never make up facts, quotes or numbers.",
    ].join("\n"),
    lead: {
      role: "Lead",
      purpose: "Sets the angle and signs off the final piece",
      instructions:
        "Decide the angle, audience and length, then brief the writer in a few lines. Send the draft to the editor. Check the edited piece answers the task, then save it as a Markdown file named after its title.",
      power: "strong",
    },
    members: [
      {
        role: "Writer",
        purpose: "Writes the first draft",
        instructions:
          "Write the draft from the lead's brief: a clear title, a strong opening line, short sections with headings, and an ending that says what to do or remember.",
        power: "cheap",
      },
      {
        role: "Editor",
        purpose: "Tightens the draft and fixes mistakes",
        instructions:
          "Edit the draft: cut repetition and filler, fix grammar and spelling, make the opening sharper. Keep the writer's voice. Hand back the edited text and a few lines on what you changed.",
        power: "cheap",
      },
    ],
  },
  {
    id: "code-review-team",
    name: "Code review team",
    icon: ScanSearch,
    colour: "#6553AE",
    does: "Reviews the recent changes in your project and ranks what needs fixing. It changes nothing.",
    who: "A lead, a correctness reviewer and a test checker",
    youGet: "A ranked list of problems, each with where it is and why it matters",
    needsProject: true,
    purpose: "Reviews code changes and reports problems without editing anything",
    rules: [
      "Never edit, create or delete files in the project.",
      "Report real problems only: bugs, security holes, missing tests. No style nitpicks.",
      "Name the file and line for every problem.",
    ].join("\n"),
    lead: {
      role: "Lead",
      purpose: "Picks what to review and ranks the findings",
      instructions:
        "Find what to review: the changes the task names, otherwise the latest commits (git log, git diff). Give the correctness reviewer the changed code and the test checker the changed behaviour. Merge their findings, drop duplicates and anything unproven, and finish with the review as your answer: the most important problems first, each with file and line, what goes wrong and a suggested fix.",
      power: "strong",
    },
    members: [
      {
        role: "Correctness reviewer",
        purpose: "Looks for bugs and security holes in the changes",
        instructions:
          "Read the changed code and what it calls. Look for wrong logic, unhandled errors, edge cases, data loss and security holes. For each problem give the file and line, a concrete case where it goes wrong, and how sure you are. Do not edit anything.",
        power: "cheap",
      },
      {
        role: "Test checker",
        purpose: "Checks the changes are covered by tests",
        instructions:
          "Find the tests for the changed code and run them if the project says how. Report changed behaviour with no test, and tests that fail. Do not edit anything.",
        power: "cheap",
      },
    ],
  },
  {
    id: "bug-fix-team",
    name: "Bug-fix team",
    icon: Bug,
    colour: "#A2456E",
    does: "Finds the cause of a bug you describe, fixes it and proves the fix with a test.",
    who: "A lead, a fixer and a tester",
    youGet: "The fix, a test that shows it works, and a short note on the cause",
    needsProject: true,
    purpose: "Finds, fixes and tests bugs in this project",
    rules: [
      "Change only what the fix needs; no unrelated clean-ups.",
      "A fix is done only when a test shows it and the existing tests still pass.",
      "Follow the project's own style and tools.",
    ].join("\n"),
    lead: {
      role: "Lead",
      purpose: "Finds the cause and checks the fix",
      instructions:
        "Reproduce the bug from the task's description and find its cause. Brief the fixer on the cause and the smallest fix, and the tester on what to prove. When both are done, check the fix answers the bug and finish with a short note: the cause, what changed, and how it was tested.",
      power: "strong",
    },
    members: [
      {
        role: "Fixer",
        purpose: "Makes the smallest change that fixes the bug",
        instructions:
          "Make the fix the lead describes, as small as it can be, in the project's own style. Say which files you changed and why.",
        power: "cheap",
      },
      {
        role: "Tester",
        purpose: "Proves the fix with a test",
        instructions:
          "Write a test that fails without the fix and passes with it, next to the project's existing tests. Run the whole test suite and report the result.",
        power: "cheap",
      },
    ],
  },
];
