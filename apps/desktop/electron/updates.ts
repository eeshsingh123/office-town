import electronUpdater from "electron-updater";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

// What Settings' About says. "latest" is only said after a check that found nothing newer.
export type UpdateStatus =
  | { state: "unknown" }
  | { state: "checking" }
  | { state: "latest" }
  | { state: "downloading"; version: string }
  | { state: "ready"; version: string }
  | { state: "failed" };

export interface Updates {
  // The version downloaded and waiting to install, if any.
  ready(): string | undefined;
  status(): UpdateStatus;
  // Resolves once the check has an answer; a found update then downloads in the background.
  check(): Promise<UpdateStatus>;
  install(): void;
}

// A beta follows betas and a release follows releases, by the channel built into it (D-75). The
// update downloads in the background and installs on quit, once the core has stopped its agents.
export function followUpdates(onReady: (version: string) => void): Updates {
  const { autoUpdater } = electronUpdater;
  let status: UpdateStatus = { state: "unknown" };
  const isReady = () => status.state === "ready";
  autoUpdater.on("checking-for-update", () => {
    if (!isReady()) status = { state: "checking" };
  });
  autoUpdater.on("update-not-available", () => {
    if (!isReady()) status = { state: "latest" };
  });
  autoUpdater.on("update-available", ({ version }) => {
    if (!isReady()) status = { state: "downloading", version };
  });
  autoUpdater.on("update-downloaded", ({ version }) => {
    status = { state: "ready", version };
    onReady(version);
  });
  autoUpdater.on("error", (error) => {
    console.error("Could not check for an update.", error);
    if (!isReady()) status = { state: "failed" };
  });
  // The error event above has logged any failure already.
  const check = async (): Promise<UpdateStatus> => {
    await autoUpdater.checkForUpdates().catch(() => undefined);
    return status;
  };
  void check();
  setInterval(() => void check(), CHECK_EVERY_MS);
  return {
    ready: () => (status.state === "ready" ? status.version : undefined),
    status: () => status,
    check,
    install: () => autoUpdater.quitAndInstall(),
  };
}
