import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { CoreReady } from "@office-town/contract";
import { net, protocol } from "electron";

export const APP_ORIGIN = "app://office";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// Agents write text that the page shows, so the page may load nothing from anywhere else.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

// Must run before the app is ready. `stream` lets the event stream through unbuffered.
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

// The UI calls `/api/...` on its own origin; the token is added here, so it never reaches the page.
export function serveApp(uiFolder: string, core: () => CoreReady): void {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return forward(request, url, core());
    return serveFile(uiFolder, url.pathname);
  });
}

function forward(
  request: Request,
  url: URL,
  { url: coreUrl, token }: CoreReady,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return net.fetch(`${coreUrl}${url.pathname.slice("/api".length)}${url.search}`, {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
  } as RequestInit);
}

async function serveFile(folder: string, pathname: string): Promise<Response> {
  const file = resolve(
    folder,
    `.${pathname === "/" ? "/index.html" : decodeURIComponent(pathname)}`,
  );
  const type = CONTENT_TYPES[extname(file)];
  if (!file.startsWith(folder + sep) || type === undefined) {
    return new Response("Not found", { status: 404 });
  }
  const body = await readFile(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (body === undefined) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: { "content-type": type, "content-security-policy": CONTENT_SECURITY_POLICY },
  });
}
