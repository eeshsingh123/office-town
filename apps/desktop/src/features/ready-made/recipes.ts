import { FILL_INS } from "@office-town/contract";
import { blankEvent } from "../automations/EventFields.tsx";
import type { WhenForm } from "../automations/WhenStep.tsx";

export interface Recipe {
  id: string;
  name: string;
  youGet: string;
  // The card's When line.
  when: string;
  prompt: string;
  schedule: Partial<WhenForm>;
  // A claude.ai app it reads, so it runs on Claude Code (app sign-in goes through Claude).
  app?: { key: string; name: string; logo: string };
  // The one thing only the user can give; the recipe opens on the step that asks it.
  asks?: "folder" | "project";
  // One line on Review about what to make the user's own.
  tip?: string;
}

// Hand-picked automations, one click from Review (D-136). Each runs on the assistant.
export const RECIPES: Recipe[] = [
  {
    id: "morning-brief",
    name: "Morning brief",
    youGet: "The five news stories that matter on your topics, with links",
    when: "Weekdays at 8:00",
    prompt: [
      `Write the morning brief for ${FILL_INS.date} on these topics: AI, software and tech startups.`,
      "Search the web for the most important news from the last 24 hours. If you cannot search, read the front pages of well-known news sites.",
      "Pick the five stories that matter most. For each: a short headline, two sentences on what happened and why it matters, and the link.",
      "Keep the whole brief under 300 words.",
    ].join("\n"),
    schedule: { mode: "schedule", preset: "weekdays", time: "08:00" },
    tip: "Change the topics in the task to your own.",
  },
  {
    id: "inbox-digest",
    name: "Inbox digest",
    youGet: "What needs your reply first, then the rest in one line each",
    when: "Weekdays at 8:30",
    prompt: [
      "Use Gmail to read the emails that reached my inbox in the last 24 hours. Skip newsletters, promotions and automatic notifications.",
      "First list the emails that need a reply or an action from me: the sender, the subject and one line on what is needed. Then anything else worth knowing, one line each.",
      "If no new emails arrived, report that there is nothing new.",
      "Never send, reply to, label, archive or delete an email.",
    ].join("\n"),
    schedule: { mode: "schedule", preset: "weekdays", time: "08:30" },
    app: { key: "gmail", name: "Gmail", logo: "gmail" },
  },
  {
    id: "meetings-prep",
    name: "Tomorrow's meetings",
    youGet: "Each meeting tomorrow with who is coming and what to prepare",
    when: "Sunday to Thursday at 18:00",
    prompt: [
      "Use Google Calendar to list my meetings for tomorrow.",
      "For each one: the time, the title, who is attending, and from the invite one line on what it is about and anything I should prepare.",
      "End with any clashes or meetings back to back.",
      "If I have no meetings tomorrow, report that there is nothing new.",
      "Never create, change, accept or decline an event.",
    ].join("\n"),
    schedule: { mode: "schedule", preset: "weekly", time: "18:00", days: [0, 1, 2, 3, 4] },
    app: { key: "googlecalendar", name: "Google Calendar", logo: "google-calendar" },
  },
  {
    id: "summarise-new-files",
    name: "Summarise new files",
    youGet: "A short summary of every file that lands in a folder",
    when: "When a file is added to a folder you pick",
    prompt: [
      `A new file arrived: ${FILL_INS.event}`,
      "Read it and write a short summary: what it is, its key points in three to five bullets, and any dates, numbers or actions it mentions.",
      "If it cannot be read, say so in one line.",
    ].join("\n"),
    schedule: { mode: "event", event: { ...blankEvent(), source: "folder" } },
    asks: "folder",
  },
  {
    id: "nightly-test-check",
    name: "Nightly test check",
    youGet: "A note only when a test breaks, with what failed and the likely cause",
    when: "Every night at 2:00",
    prompt: [
      "Run this project's test suite the way the project says to (its README, package scripts or Makefile).",
      "If every test passes, report that there is nothing new.",
      "If any fail: list each failing test, the error in one or two lines, and the most likely cause from the recent commits (git log). Do not change any files.",
    ].join("\n"),
    schedule: { mode: "schedule", preset: "daily", time: "02:00" },
    asks: "project",
  },
];
