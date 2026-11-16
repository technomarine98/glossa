import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(root, "public/manifest.json"), "utf8"));
if (pkg.version !== manifest.version) throw new Error("Package and extension versions must match.");

await import("./build.mjs");
const directory = resolve(root, "releases");
await mkdir(directory, { recursive: true });
const archive = resolve(directory, `selection-translator-${pkg.version}.zip`);
// Create a fresh archive on stdout so old files cannot remain from an earlier build.
const contents = execFileSync("zip", ["-q", "-r", "-", "."], { cwd: resolve(root, "dist"), maxBuffer: 16 * 1024 * 1024 });
await writeFile(archive, contents);
console.log(`Created ${archive} (unsigned; load temporarily or submit to Mozilla for signing).`);
