import { cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const [name, entry] of [
  ["background", "src/background/index.ts"],
  ["content", "src/content/index.ts"],
]) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      outDir: "dist",
      emptyOutDir: name === "background",
      target: "es2022",
      lib: {
        entry: resolve(root, entry),
        name: `ZenTranslation${name}`,
        formats: ["iife"],
        fileName: () => `${name}.js`,
      },
    },
  });
}

await build({
  configFile: false,
  root: resolve(root, "src/options"),
  base: "./",
  publicDir: false,
  build: {
    outDir: resolve(root, "dist/options"),
    emptyOutDir: false,
    target: "es2022",
  },
});

await cp(resolve(root, "public"), resolve(root, "dist"), { recursive: true });
