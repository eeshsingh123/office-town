import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { build as makeInstaller } from "electron-builder";
import { build as bundle } from "vite";

// The installer's only build step (D-75): development keeps running the sources (D-19).
const { values } = parseArgs({
  options: {
    beta: { type: "string", default: "0" },
    stable: { type: "boolean", default: false },
  },
});
if (!/^\d+$/.test(values.beta)) throw new Error(`--beta must be a number, got "${values.beta}".`);

const DESKTOP = join(import.meta.dirname, "..");
const REPO = join(DESKTOP, "..", "..");
const OUT = join(DESKTOP, "out", "package");
const APP = join(OUT, "app");
const CORE = join(OUT, "core");
// Native code and a file WSL runs by its Windows path, so it stays outside the archive.
const KEYRING = "@napi-rs/keyring";

const manifest = JSON.parse(await readFile(join(DESKTOP, "package.json"), "utf8"));
// A beta's number only grows, so the owner's app always sees the newest one as newer.
const version: string = values.stable
  ? manifest.version
  : `${manifest.version}-beta.${values.beta}`;

// Node will not strip types in an installed app, so the shell, the core and the bridge become plain JS.
async function bundleForNode(entry: string, outDir: string, fileName: string): Promise<void> {
  await bundle({
    configFile: false,
    logLevel: "warn",
    build: {
      ssr: entry,
      outDir,
      emptyOutDir: false,
      target: "node24",
      rollupOptions: {
        external: ["electron", KEYRING],
        output: {
          format: "es",
          entryFileNames: fileName,
          paths: { [KEYRING]: "./keyring/index.js" },
        },
      },
    },
    ssr: { noExternal: true, target: "node" },
  });
}

// The keyring loads its binary from its own folder first, so the one built for this platform goes
// there. Not node_modules: electron-builder leaves those out of extra resources.
async function copyKeyring(): Promise<void> {
  const require = createRequire(join(REPO, "packages", "service", "package.json"));
  const keyring = dirname(require.resolve(`${KEYRING}/package.json`));
  const target = join(CORE, "keyring");
  await cp(keyring, target, { recursive: true, dereference: true });
  const { optionalDependencies } = JSON.parse(
    await readFile(join(keyring, "package.json"), "utf8"),
  );
  const fromKeyring = createRequire(join(keyring, "package.json"));
  for (const name of Object.keys(optionalDependencies)) {
    const found = installedFolder(fromKeyring, name);
    if (found === undefined) continue;
    for (const file of await readdir(found)) {
      if (file.endsWith(".node")) await cp(join(found, file), join(target, file));
    }
  }
}

// Only the binary package for this platform is installed; the others are not there to find.
function installedFolder(require: NodeJS.Require, name: string): string | undefined {
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    return undefined;
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(APP, { recursive: true });

await bundle({
  configFile: join(DESKTOP, "vite.config.ts"),
  logLevel: "warn",
  build: { outDir: join(APP, "dist") },
});
await bundleForNode(join(DESKTOP, "electron", "main.ts"), join(APP, "electron"), "main.js");
for (const file of ["preload.cjs", "icon.png"]) {
  await cp(join(DESKTOP, "electron", file), join(APP, "electron", file));
}
// `.mjs`, because nothing above the installed core says it is a module.
await bundleForNode(join(REPO, "packages", "service", "src", "main.ts"), CORE, "main.mjs");
await bundleForNode(
  join(REPO, "packages", "harness", "src", "environment", "tool-bridge.ts"),
  CORE,
  "tool-bridge.mjs",
);
await copyKeyring();

await writeFile(
  join(APP, "package.json"),
  JSON.stringify(
    {
      name: "office-town",
      productName: "Office Town",
      version,
      description: "A team of AI agents on your own computer.",
      author: "Office Town",
      type: "module",
      main: "electron/main.js",
    },
    null,
    2,
  ),
);

await makeInstaller({
  projectDir: DESKTOP,
  publish: "never",
  config: {
    // Never changes: updates and the data folder follow it across renames (D-75).
    appId: "town.office.desktop",
    productName: "Office Town",
    directories: { app: APP, output: join(OUT, "installers") },
    // Everything the app needs is bundled; without this the workspace's node_modules come along.
    files: ["**/*", "!node_modules/**"],
    extraResources: [{ from: CORE, to: "core", filter: ["**/*"] }],
    icon: join(import.meta.dirname, "icon.png"),
    npmRebuild: false,
    win: { target: "nsis" },
    // One click, for this user only: no admin rights and no questions.
    nsis: {
      oneClick: true,
      perMachine: false,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder fills these in.
      artifactName: "Office-Town-Setup-${version}.${ext}",
    },
    linux: {
      target: "AppImage",
      category: "Development",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder fills these in.
      artifactName: "Office-Town-${version}.${ext}",
    },
    // Where the installed app looks for updates; CI uploads the files (P4).
    publish: {
      provider: "github",
      owner: "eeshsingh123",
      repo: "office-town",
      releaseType: values.stable ? "release" : "prerelease",
      // Names the update file the app reads: a beta follows beta.yml, a release latest.yml.
      channel: values.stable ? "latest" : "beta",
    },
  },
});
console.log(`Built Office Town ${version} in ${join(OUT, "installers")}`);
