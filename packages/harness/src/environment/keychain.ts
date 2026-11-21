import { execFile } from "node:child_process";

// Long enough for the user to answer the Keychain's own "allow access" prompt.
const READ_TIMEOUT_MS = 30_000;

const reading = new Map<string, Promise<string | undefined>>();

function read(service: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-w"],
      { encoding: "utf8", timeout: READ_TIMEOUT_MS, windowsHide: true },
      // Not found, refused or unanswered alike: the error holds no secret and is not kept.
      (error, stdout) => resolve(error === null ? stdout.trim() : undefined),
    );
  });
}

// Read only, on a Mac: another program's item, such as a CLI's sign-in. The text is the caller's
// for that one use; it is never logged, stored or put in an error. macOS may ask the user first,
// so callers read it only when the user asked (D-117).
export function readKeychainSecret(service: string): Promise<string | undefined> {
  if (process.platform !== "darwin") return Promise.resolve(undefined);
  const running = reading.get(service);
  if (running !== undefined) return running;
  const started = read(service).finally(() => reading.delete(service));
  reading.set(service, started);
  return started;
}
