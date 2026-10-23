import electronUpdater from "electron-updater";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export interface Updates {
  // The version downloaded and waiting to install, if any.
  ready(): string | undefined;
  install(): void;
}

// A beta follows betas and a release follows releases, by the channel built into it (D-75). The
// update downloads in the background and installs on quit, once the core has stopped its agents.
export function followUpdates(onReady: (version: string) => void): Updates {
  const { autoUpdater } = electronUpdater;
  let ready: string | undefined;
  autoUpdater.on("update-downloaded", ({ version }) => {
    ready = version;
    onReady(version);
  });
  autoUpdater.on("error", (error) => console.error("Could not check for an update.", error));
  // The error event above has logged any failure already.
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, CHECK_EVERY_MS);
  return { ready: () => ready, install: () => autoUpdater.quitAndInstall() };
}
