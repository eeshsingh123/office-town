import { execFile } from "node:child_process";

// Long enough for the user to answer the Keychain's own "allow access" prompt.
const READ_TIMEOUT_MS = 30_000;
// `security` exits 44 when no item has that service.
const NOT_FOUND = 44;

// A service the user refused, or whose prompt timed out, is not asked again until the next launch.
const refused = new Set<string>();
const reading = new Map<string, Promise<string | undefined>>();

function read(service: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-w"],
      { encoding: "utf8", timeout: READ_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error === null) return resolve(stdout.trim());
        // The error holds no secret: only its exit code is kept.
        if (error.code !== NOT_FOUND) refused.add(service);
        resolve(undefined);
      },
    );
  });
}

// Read only, on a Mac: another program's item, such as a CLI's sign-in. The text is the caller's
// for that one use; it is never logged, stored or put in an error.
export function readKeychainSecret(service: string): Promise<string | undefined> {
  if (process.platform !== "darwin" || refused.has(service)) return Promise.resolve(undefined);
  const running = reading.get(service);
  if (running !== undefined) return running;
  const started = read(service).finally(() => reading.delete(service));
  reading.set(service, started);
  return started;
}
