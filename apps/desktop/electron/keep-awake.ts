import { type CoreReady, keepAwakeSchema } from "@office-town/contract";
import { net, powerSaveBlocker } from "electron";

const ASK_EVERY_MS = 60_000;
const ASK_TIMEOUT_MS = 3_000;

// While agents work, the computer is kept from sleeping, on battery too, never the display; one
// call on every system, which also keeps macOS from napping the app (D-123). The core says when.
export class KeepAwake {
  readonly #core: () => CoreReady | undefined;
  readonly #wanted: () => boolean;
  #blocker: number | undefined;
  #timer: NodeJS.Timeout | undefined;
  #asking = false;

  constructor(core: () => CoreReady | undefined, wanted: () => boolean) {
    this.#core = core;
    this.#wanted = wanted;
  }

  start(): void {
    this.#timer = setInterval(() => void this.check(), ASK_EVERY_MS);
    void this.check();
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#release();
  }

  async check(): Promise<void> {
    const ready = this.#core();
    if (!this.#wanted() || ready === undefined) {
      this.#release();
      return;
    }
    if (this.#asking) return;
    this.#asking = true;
    try {
      const response = await net.fetch(`${ready.url}/keep-awake`, {
        headers: { authorization: `Bearer ${ready.token}` },
        signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
      });
      const { awake } = keepAwakeSchema.parse(await response.json());
      if (awake && this.#wanted()) this.#hold();
      else this.#release();
    } catch (error) {
      // A busy core keeps the last answer until the next ask.
      console.error("Could not ask the core whether agents work.", error);
    } finally {
      this.#asking = false;
    }
  }

  #hold(): void {
    if (this.#blocker !== undefined && powerSaveBlocker.isStarted(this.#blocker)) return;
    this.#blocker = powerSaveBlocker.start("prevent-app-suspension");
  }

  #release(): void {
    if (this.#blocker === undefined) return;
    powerSaveBlocker.stop(this.#blocker);
    this.#blocker = undefined;
  }
}
