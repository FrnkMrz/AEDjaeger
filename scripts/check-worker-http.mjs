import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Ein echter workerd-Abruf gegen einen lokalen HTTP-Server deckt Fehler auf,
// die Node-Mocks übersehen (z. B. Workers' fehlendes redirect: "error").
const tempDirectory = join(tmpdir(), "aedjaeger-http-runtime-check");
process.env.XDG_CONFIG_HOME = join(tempDirectory, "config");
process.env.XDG_CACHE_HOME = join(tempDirectory, "cache");
process.env.WRANGLER_LOG_PATH = join(tempDirectory, "logs");
process.env.WRANGLER_SEND_METRICS = "false";
const { unstable_dev } = await import("wrangler");
const calls = [];
const upstream = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  calls.push({ path: request.url, method: request.method, authorization: request.headers.authorization, body });
  if (request.url === "/ok") {
    response.writeHead(200).end("accepted");
  } else if (/^\/redirect\/(301|302|303|307|308)$/u.test(request.url ?? "")) {
    response.writeHead(Number(request.url.split("/").at(-1)), { Location: "/forbidden" }).end("private fixture response");
  } else {
    response.writeHead(500).end("unexpected request");
  }
});
let worker;
try {
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  worker = await unstable_dev(fileURLToPath(new URL("../tests/fixtures/httpRuntimeWorker.ts", import.meta.url)), {
    config: fileURLToPath(new URL("../tests/fixtures/httpRuntime.wrangler.jsonc", import.meta.url)),
    local: true,
    ip: "127.0.0.1",
    port: 0,
    inspectorPort: 0,
    persist: false,
    vars: { MOCK_PROVIDER_ORIGIN: `http://127.0.0.1:${upstream.address().port}` },
    logLevel: "error",
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
  });
  const success = await worker.fetch("/ok");
  assert.equal(success.status, 200);
  assert.equal(await success.text(), "accepted");
  for (const status of [301, 302, 303, 307, 308]) {
    const rejected = await worker.fetch(`/redirect/${status}`);
    assert.equal(rejected.status, 502);
    assert.deepEqual(await rejected.json(), { rejected: true });
  }
  assert.deepEqual(calls.map((call) => call.path), ["/ok", ...[301, 302, 303, 307, 308].map((status) => `/redirect/${status}`)]);
  assert(calls.every((call) => call.method === "POST" && call.authorization === "Bearer local-fixture-token" && call.body === "local-fixture-body"));
  console.log("Worker-HTTP-Prüfung bestanden: erfolgreicher Abruf, fünf Weiterleitungen abgelehnt, keine Folgeanfrage.");
} finally {
  await worker?.stop();
  upstream.closeAllConnections();
  await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
}
