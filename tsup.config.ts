import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  dts: false,
  sourcemap: false,
  clean: true,
  bundle: true,
  minify: false,
  target: "node22",
  external: ["node:sqlite"],
  outExtension: () => ({ js: ".cjs" }),
  noExternal: ["@inquirer/prompts", "picocolors", "string-width"],
});
