const DRIVE_PATH = /^([A-Za-z]):[\\/]*(.*)$/;
const DISTRO_SHARE = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(.*)$/i;
const MOUNTED_DRIVE = /^\/mnt\/([a-z])(\/.*)?$/;

function withForwardSlashes(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function toWslPath(windowsPath: string, distro: string): string {
  const drive = DRIVE_PATH.exec(windowsPath);
  if (drive !== null) {
    const rest = withForwardSlashes(drive[2] ?? "");
    return `/mnt/${drive[1]?.toLowerCase()}${rest === "" ? "" : `/${rest}`}`;
  }
  const share = DISTRO_SHARE.exec(windowsPath);
  if (share !== null && share[1]?.toLowerCase() === distro.toLowerCase()) {
    return withForwardSlashes(share[2] ?? "") || "/";
  }
  return windowsPath;
}

export function toWindowsPath(wslPath: string, distro: string): string {
  const mounted = MOUNTED_DRIVE.exec(wslPath);
  if (mounted !== null) {
    return `${mounted[1]?.toUpperCase()}:${(mounted[2] ?? "/").replaceAll("/", "\\")}`;
  }
  if (wslPath.startsWith("/")) {
    return `\\\\wsl.localhost\\${distro}${wslPath.replaceAll("/", "\\")}`;
  }
  return wslPath;
}
