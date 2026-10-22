import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { MAX_PREVIEW_BYTES } from "@office-town/contract";
import { canonicalPath, inside } from "../autonomy/policy.ts";
import { contentTypeOf } from "./content-types.ts";

// Pages opened in one run of the app; the oldest grant goes first.
const MAX_GRANTS = 200;

export interface PreviewGrant {
  // Everything under it may load, as a page's own styles and images do.
  root: string;
  // Served at `path` (relative, with forward slashes) in place of the file there: an older version.
  entry?: { path: string; file: string };
}

// Hidden files, such as .env or .git, never load, and neither does anything outside the root.
function segmentsOf(rest: string): string[] | undefined {
  const segments = rest.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return ".";
    }
  });
  const safe = segments.every(
    (segment, index) =>
      (segment !== "" || index === segments.length - 1) &&
      !segment.startsWith(".") &&
      !/[\\:\0]/.test(segment),
  );
  return safe ? segments : undefined;
}

function refuse(response: ServerResponse, status: number): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end();
}

// The app's own origin and the core's API sit on other ports, so a page shown here reaches
// neither (M8). It reads only what a grant names.
export class PreviewServer {
  readonly url: string;
  readonly #server: ReturnType<typeof createServer>;
  readonly #grants = new Map<string, PreviewGrant>();

  private constructor(server: ReturnType<typeof createServer>, url: string) {
    this.#server = server;
    this.url = url;
  }

  static async start(): Promise<PreviewServer> {
    let preview: PreviewServer | undefined;
    const server = createServer((request, response) => {
      preview?.handle(request, response).catch((error: unknown) => {
        console.error("Could not serve a preview.", error);
        if (response.headersSent) response.destroy();
        else refuse(response, 500);
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    preview = new PreviewServer(server, `http://127.0.0.1:${port}`);
    return preview;
  }

  get port(): number {
    return Number(new URL(this.url).port);
  }

  // An address for `path` under the grant's root.
  grant(grant: PreviewGrant, path: string): string {
    const token = randomBytes(18).toString("base64url");
    this.#grants.set(token, grant);
    if (this.#grants.size > MAX_GRANTS) {
      const [oldest] = this.#grants.keys();
      if (oldest !== undefined) this.#grants.delete(oldest);
    }
    return `${this.url}/${token}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") return refuse(response, 405);
    const { pathname } = new URL(request.url ?? "/", this.url);
    const [, token = "", ...rest] = pathname.split("/");
    const grant = this.#grants.get(token);
    const segments = segmentsOf(rest.join("/"));
    if (grant === undefined || segments === undefined) return refuse(response, 404);
    const asked = segments.join("/");
    let file =
      grant.entry !== undefined && asked === grant.entry.path
        ? grant.entry.file
        : join(grant.root, ...segments);
    if (file !== grant.entry?.file && !inside(canonicalPath(grant.root), canonicalPath(file))) {
      return refuse(response, 404);
    }
    let found = await stat(file).catch(() => undefined);
    if (found?.isDirectory()) {
      file = join(file, "index.html");
      found = await stat(file).catch(() => undefined);
    }
    if (found === undefined || !found.isFile()) return refuse(response, 404);
    if (found.size > MAX_PREVIEW_BYTES) return refuse(response, 413);
    response.writeHead(200, {
      "content-type": contentTypeOf(file),
      "content-length": found.size,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(file).pipe(response);
  }

  async close(): Promise<void> {
    const closed = once(this.#server, "close");
    this.#server.close();
    this.#server.closeAllConnections();
    await closed;
  }
}
