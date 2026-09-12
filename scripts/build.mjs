import { execFileSync } from "node:child_process";
import { build } from "vite-plus";
import { build as bundle } from "esbuild";
import { resolve } from "node:path";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { sites } from "../packages/contracts/src/index.ts";
for (const site of sites) {
  const root = resolve("apps", site.id);
  await build({ root, configFile: resolve(root, "vite.config.ts") });
}
execFileSync(process.execPath, ["apps/docs/node_modules/@docusaurus/core/bin/docusaurus.mjs", "build", "apps/docs", "--out-dir", "../../dist/docs"], { stdio: "inherit" });
await mkdir("dist/docs/explorer", { recursive: true });
await cp("apps/docs/explorer", "dist/docs/explorer", { recursive: true });
for (const asset of ["swagger-ui.css", "swagger-ui-bundle.js", "LICENSE", "NOTICE"]) {
  await cp(resolve("node_modules/swagger-ui-dist", asset), resolve("dist/docs/explorer", asset));
}
const handbook = [];
for (const name of (await readdir("apps/docs/content")).sort()) {
  if (!/\.mdx?$/.test(name)) continue;
  const source = await readFile(resolve("apps/docs/content", name), "utf8");
  const slug = source.match(/^slug:\s*(.+)$/m)?.[1] ?? name.replace(/\.mdx?$/, "");
  handbook.push({
    title: source.match(/^title:\s*(.+)$/m)?.[1] ?? name,
    url: slug === "/" ? "/docs/" : `/docs/${slug.replace(/^\/+|\/+$/g, "")}/`,
    format: name.endsWith(".mdx") ? "mdx" : "markdown",
    content: source.replace(/^---\n[\s\S]*?\n---\n/, "").trim(),
  });
}
await writeFile("dist/docs/handbook.json", JSON.stringify({ openapi: "/api/openapi.json", pages: handbook }, null, 2));
await bundle({
  entryPoints: ["apps/server/src/index.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
});
await bundle({
  entryPoints: ["scripts/verify-genomic-coverage.mjs"],
  outfile: "dist/verify-genomic-coverage.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
});
console.log("Built all sites and the single-port application server.");
