import { setTimeout as sleep } from "node:timers/promises";
import { BrowserWindow, type Session, session } from "electron";

// The shape of the viewer's own picture, so a card looks the same whichever took it.
const PAGE = { width: 1280, height: 800 };
// The load event is rarely a page's finished look.
const SETTLE_MS = 1500;
const GIVE_UP_MS = 15_000;

// One at a time, so a chat full of new results stays light on the machine.
let lastTurn: Promise<unknown> = Promise.resolve();
let guarded: Session | undefined;

const isLocalAddress = (url: string) => {
  if (!URL.canParse(url)) return false;
  const { protocol, hostname, port } = new URL(url);
  return (
    (protocol === "http:" || protocol === "https:") &&
    (hostname === "127.0.0.1" || hostname === "localhost") &&
    port !== ""
  );
};

// In memory and apart from the app's own session, for pages an agent made (M8).
function guardedSession(): Session {
  if (guarded !== undefined) return guarded;
  guarded = session.fromPartition("page-pictures");
  guarded.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  guarded.setPermissionCheckHandler(() => false);
  guarded.on("will-download", (event) => event.preventDefault());
  return guarded;
}

async function take(url: string, width: number): Promise<Buffer> {
  const hidden = new BrowserWindow({
    ...PAGE,
    useContentSize: true,
    show: false,
    webPreferences: {
      session: guardedSession(),
      sandbox: true,
      disableDialogs: true,
      backgroundThrottling: false,
    },
  });
  const page = hidden.webContents;
  page.setAudioMuted(true);
  // No one is looking, so the page stays where it was opened.
  page.setWindowOpenHandler(() => ({ action: "deny" }));
  page.on("will-navigate", (event) => event.preventDefault());
  let status = 200;
  page.once("did-navigate", (_event, _url, code) => {
    status = code;
  });
  const load = async () => {
    await page.loadURL(url);
    if (status >= 400) throw new Error("The page did not load.");
    await sleep(SETTLE_MS);
    const image = await page.capturePage(undefined, { stayHidden: true });
    if (image.isEmpty()) throw new Error("The page drew nothing.");
    return image.getSize().width > width ? image.resize({ width }).toPNG() : image.toPNG();
  };
  const giveUp = async () => {
    await sleep(GIVE_UP_MS);
    throw new Error("The page took too long.");
  };
  try {
    return await Promise.race([load(), giveUp()]);
  } finally {
    hidden.destroy();
  }
}

// A PNG of a local page or site, loaded where the user cannot see it, at most `width` wide.
export function pictureOfPage(url: string, width: number): Promise<Buffer> {
  if (!isLocalAddress(url)) return Promise.reject(new Error("Only a local page can be pictured."));
  const turn = lastTurn.then(() => take(url, width));
  lastTurn = turn.catch(() => undefined);
  return turn;
}
