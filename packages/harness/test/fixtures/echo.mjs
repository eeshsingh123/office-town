import { createInterface } from "node:readline";

process.stdout.write(`args:${JSON.stringify(process.argv.slice(2))}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  if (line === "fail") {
    process.stderr.write("something broke\n");
    process.exit(3);
  }
  process.stdout.write(`echo:${line}\r\n`);
});
