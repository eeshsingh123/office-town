// The two ways a task treats a long chat, with the same words wherever they are picked (D-94).
export const MODE_CHOICES = [
  { value: "one", label: "One place" },
  { value: "efficient", label: "Efficient" },
] as const;

export const modeNote = (efficient: boolean) =>
  efficient
    ? "A long chat carries on in a new session with a complete handover, so it uses fewer tokens. You still see one chat."
    : "Each agent keeps one chat for the whole task.";
