import type { TeamContext } from "../team/members.ts";
import { startQueuedGoal } from "./goals.ts";

// Starts what can start: the chief's next queued goal. Runs once at a time, so two triggers
// never start the same thing twice.
export class Scheduler {
  readonly #context: TeamContext;
  #running: Promise<void> = Promise.resolve();

  constructor(context: TeamContext) {
    this.#context = context;
    context.store.subscribe((change) => {
      if (change.type === "task" && change.task.state === "ended") void this.advance();
    });
  }

  advance(): Promise<void> {
    this.#running = this.#running
      .then(() => this.#advance())
      .catch((error: unknown) => console.error("Could not start the next work.", error));
    return this.#running;
  }

  async #advance(): Promise<void> {
    await startQueuedGoal(this.#context);
  }
}
