import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const outputDirectory = "dist";
const manifestPath = join(outputDirectory, "precache-manifest.json");
const entries = JSON.parse(await readFile(manifestPath, "utf8"));

if (!Array.isArray(entries) || entries.length === 0 || entries.some((entry) => typeof entry !== "string")) {
  throw new Error("The generated precache manifest must contain asset paths.");
}

for (const assetPath of entries) {
  // Fail the build if a manifest path is stale or the matching output was not emitted.
  await access(join(outputDirectory, assetPath.replace(/^\//, "")));
}

if (!entries.some((assetPath) => assetPath.endsWith(".js")) || !entries.some((assetPath) => assetPath.endsWith(".css"))) {
  throw new Error("The precache manifest must include the app's JavaScript and CSS bundles.");
}

// Die App erkennt neue Versionen über dist/version.json. Fehlt sie oder hat sie ein unbrauchbares
// Format, würde der Update-Hinweis still ausfallen; deshalb scheitert schon der Build.
const version = JSON.parse(await readFile(join(outputDirectory, "version.json"), "utf8"));
if (typeof version?.revision !== "string" || !/^[a-z0-9]{4,32}$/u.test(version.revision)) {
  throw new Error("dist/version.json must contain a lowercase alphanumeric revision.");
}

console.log(`Precache manifest verified (${entries.length} app assets).`);
