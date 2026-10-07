import { stat } from "node:fs/promises";
import path from "node:path";

export class BinaryNotFoundError extends Error {
  readonly binary: string;

  constructor(binary: string, searched = "PATH") {
    super(`"${binary}" was not found on ${searched}. Is it installed?`);
    this.name = "BinaryNotFoundError";
    this.binary = binary;
  }
}

async function isFile(candidate: string): Promise<boolean> {
  const stats = await stat(candidate).catch(() => undefined);
  return stats?.isFile() ?? false;
}

function readVariable(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function executableExtensions(binary: string, env: NodeJS.ProcessEnv): string[] {
  // On Windows npm puts a non-executable shell script beside each .cmd shim, so a bare name is never run.
  if (process.platform !== "win32" || path.extname(binary) !== "") return [""];
  return (readVariable(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
}

export async function findBinary(binary: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (path.isAbsolute(binary)) return binary;
  const directories = (readVariable(env, "PATH") ?? "").split(path.delimiter).filter(Boolean);
  const extensions = executableExtensions(binary, env);
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, binary + extension);
      if (await isFile(candidate)) return candidate;
    }
  }
  throw new BinaryNotFoundError(binary);
}
