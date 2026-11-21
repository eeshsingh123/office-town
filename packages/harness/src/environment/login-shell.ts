import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

const READ_TIMEOUT_MS = 5000;
// Belong to the shell or the terminal that printed them, not to the user's setup.
const SKIPPED = new Set([
  "PWD",
  "OLDPWD",
  "SHLVL",
  "_",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_SESSION_ID",
  "COLORTERM",
  "ELECTRON_RUN_AS_NODE",
]);

let failureLogged = false;

function runLoginShell(command: string): Promise<string> {
  const shell = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve, reject) => {
    const child = execFile(
      shell,
      ["-i", "-l", "-c", command],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        timeout: READ_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
    );
    child.stdin?.end();
  });
}

// An app opened from the Dock, Finder or a desktop menu gets launchd's or the session's bare
// PATH, without Homebrew, npm or nvm folders, so CLIs installed for Terminal are not found. The
// login shell's environment is taken whole, as code editors do. Started from a terminal, the
// environment is already the user's.
export async function readLoginShellEnvironment(): Promise<void> {
  if (process.platform === "win32" || process.env.TERM !== undefined) return;
  const marker = randomBytes(8).toString("hex");
  // Single quotes only around the script, and none inside, so zsh, bash and fish read it alike.
  const script = `process.stdout.write("${marker}"+JSON.stringify(process.env)+"${marker}")`;
  const command = `'${process.execPath.replaceAll("'", "'\\''")}' -e '${script}'`;
  try {
    const output = await runLoginShell(command);
    const start = output.indexOf(marker);
    const end = output.lastIndexOf(marker);
    if (start === -1 || end <= start) throw new Error("its output had no environment in it");
    const found = JSON.parse(output.slice(start + marker.length, end)) as Record<string, string>;
    for (const [name, value] of Object.entries(found)) {
      if (!SKIPPED.has(name)) process.env[name] = value;
    }
  } catch (error) {
    if (failureLogged) return;
    failureLogged = true;
    process.stderr.write(`Could not read the login shell's environment: ${String(error)}\n`);
  }
}
