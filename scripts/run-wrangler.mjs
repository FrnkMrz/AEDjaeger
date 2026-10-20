import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
const forwardedArguments = process.argv.slice(3);
const temporaryDirectory = join(tmpdir(), "aedjaeger-wrangler");
const wranglerCli = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

// Wrangler stores logs and configuration outside the project by default. Keep local checks
// inside the system temporary directory so sandboxed development does not need home-folder writes.
const environment = {
  ...process.env,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? join(temporaryDirectory, "config"),
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? join(temporaryDirectory, "cache"),
  WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? join(temporaryDirectory, "logs"),
  WRANGLER_SEND_METRICS: "false",
  DO_NOT_TRACK: "1",
};

const argumentsForWrangler =
  command === "check"
    ? ["deploy", "--dry-run", "--outdir", join(temporaryDirectory, "dry-run")]
    : [command, ...forwardedArguments];

if (!command) {
  throw new Error("Bitte einen Wrangler-Befehl angeben, zum Beispiel `check` oder `dev`.");
}

const result = spawnSync(process.execPath, [wranglerCli, ...argumentsForWrangler], { env: environment, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
