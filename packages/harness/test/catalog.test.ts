import { PassThrough, Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Adapter } from "../src/adapter.ts";
import { CatalogError, readCatalog } from "../src/catalog.ts";
import type { Environment, LaunchRequest } from "../src/environment/environment.ts";

// A harness process that prints the given lines, then exits with the given code once its input closes.
function environmentPrinting(lines: string[], code: number, stderr = "") {
  const launches: LaunchRequest[] = [];
  const written: string[] = [];
  const environment: Environment = {
    async launch(request) {
      launches.push(request);
      const exited = Promise.withResolvers<{ code: number; signal: null }>();
      const stdin = new Writable({
        write(chunk: Buffer, _encoding, done) {
          written.push(chunk.toString().trim());
          done();
        },
      });
      stdin.on("finish", () => exited.resolve({ code, signal: null }));
      const stderrStream = new PassThrough();
      stderrStream.end(stderr);
      return {
        stdin,
        stdout: Readable.from(lines.map((line) => `${line}\n`)),
        stderr: stderrStream,
        exited: exited.promise,
        killTree: async () => {},
      };
    },
    toEnvironmentPath: (path) => path,
    toHostPath: (path) => path,
    reach: () => {
      throw new Error("A catalog query attaches no tool server.");
    },
  };
  return { environment, launches, written };
}

const adapter: Adapter = {
  harness: "listed",
  name: "Listed",
  capabilities: {
    reasoning: false,
    plan: false,
    effort: true,
    modelList: true,
    resume: false,
    usageLimits: false,
  },
  catalog: {
    command: { binary: "listed", args: ["models"] },
    input: ["describe yourself"],
    parse: (output) => ({
      models: output.map((id) => ({ id, name: id.toUpperCase(), efforts: ["low", "high"] })),
    }),
  },
  buildCommand: () => ({ binary: "listed", args: [] }),
  createTranslator: () => {
    throw new Error("Not used by these tests.");
  },
};

describe("catalog", () => {
  it("runs the adapter's query to its end and returns what the adapter reads from it", async () => {
    const { environment, launches, written } = environmentPrinting(["small", "large"], 0);

    const catalog = await readCatalog(adapter, environment);

    expect(launches).toEqual([{ binary: "listed", args: ["models"] }]);
    expect(written).toEqual(["describe yourself"]);
    expect(catalog.models).toEqual([
      { id: "small", name: "SMALL", efforts: ["low", "high"] },
      { id: "large", name: "LARGE", efforts: ["low", "high"] },
    ]);
  });

  it("fails with the harness's own words when the query fails", async () => {
    const { environment } = environmentPrinting([], 1, "Not logged in");

    await expect(readCatalog(adapter, environment)).rejects.toThrow(
      new CatalogError('The "listed" harness failed to list its models: Not logged in'),
    );
  });
});
