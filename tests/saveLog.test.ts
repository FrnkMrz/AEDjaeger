import { describe, expect, it } from "vitest";
import { buildSaveLogLines, parseOSMApiLog, readSavedIds } from "../src/domain/saveLog";

// Tests für die Protokollzeilen im Speicher-Fenster. Das Protokoll kommt über das Netz und wird darum streng geprüft.
describe("save dialog log", () => {
  it("turns a normal create into readable steps with technical lines", () => {
    const entries = parseOSMApiLog({
      status: "complete",
      osm_log: [
        { method: "GET", path: "/api/0.6/map.json", status: 200 },
        { method: "PUT", path: "/api/0.6/changeset/create", status: 200 },
        { method: "POST", path: "/api/0.6/changeset/77/upload", status: 200 },
        { method: "PUT", path: "/api/0.6/changeset/77/close", status: 200 },
      ],
    });
    expect(buildSaveLogLines(entries)).toEqual([
      { technical: "GET /api/0.6/map.json → 200", stepKey: "saveLogMapRead", ok: true },
      { technical: "PUT /api/0.6/changeset/create → 200", stepKey: "saveLogChangesetCreated", ok: true },
      { technical: "POST /api/0.6/changeset/77/upload → 200", stepKey: "saveLogUploaded", ok: true },
      { technical: "PUT /api/0.6/changeset/77/close → 200", stepKey: "saveLogChangesetClosed", ok: true },
    ]);
  });

  it("marks failed and unanswered calls as not successful", () => {
    const lines = buildSaveLogLines(
      parseOSMApiLog({
        osm_log: [
          { method: "GET", path: "/api/0.6/node/5.json", status: 409 },
          { method: "PUT", path: "/api/0.6/changeset/create", status: 0 },
        ],
      }),
    );
    expect(lines).toEqual([
      { technical: "GET /api/0.6/node/5.json → 409", stepKey: "saveLogNodeRead", ok: false },
      { technical: "PUT /api/0.6/changeset/create → –", stepKey: "saveLogChangesetCreated", ok: false },
    ]);
  });

  it("drops anything that does not match the fixed list, including markup and query strings", () => {
    expect(
      parseOSMApiLog({
        osm_log: [
          { method: "DELETE", path: "/api/0.6/changeset/create", status: 200 },
          { method: "GET", path: "/api/0.6/map.json?bbox=1,2,3,4", status: 200 },
          { method: "GET", path: "<img src=x onerror=alert(1)>", status: 200 },
          { method: "GET", path: "/api/0.6/map.json", status: "200" },
          "PUT /api/0.6/changeset/create",
        ],
      }),
    ).toEqual([]);
    expect(parseOSMApiLog({ osm_log: "nope" })).toEqual([]);
    expect(parseOSMApiLog(null)).toEqual([]);
  });

  it("reads node and changeset numbers only when they are real OSM ids", () => {
    expect(readSavedIds({ node_id: "456", changeset_id: "77" }, undefined)).toEqual({
      nodeId: "456",
      changesetId: "77",
    });
    // Prüfdatum: Die Knotennummer stammt aus dem Ziel, das die App selbst kennt.
    expect(readSavedIds({ changeset_id: "78" }, "node/123")).toEqual({ nodeId: "123", changesetId: "78" });
    expect(readSavedIds({ node_id: "<b>1</b>", changeset_id: "0" }, undefined)).toEqual({
      nodeId: null,
      changesetId: null,
    });
  });
});
