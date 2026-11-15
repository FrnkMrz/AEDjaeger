import { describe, expect, it } from "vitest";
import {
  compareMigrationNames,
  migrationFilesFromDirectory,
  readAppliedMigrationNames,
} from "../scripts/check-d1-migrations.mjs";

describe("D1-Migrationsschutz", () => {
  it("liest den Namen bereits angewendeter Migrationen aus dem Wrangler-JSON", () => {
    expect(
      readAppliedMigrationNames([
        {
          success: true,
          results: [{ name: "0001_analysis_budget.sql" }, { name: "0002_osm_oauth_transactions.sql" }],
        },
      ]),
    ).toEqual(["0001_analysis_budget.sql", "0002_osm_oauth_transactions.sql"]);
  });

  it("nimmt alle von Wrangler erkannten SQL-Dateinamen auf, auch mit Großbuchstaben", () => {
    expect(
      migrationFilesFromDirectory([
        { name: "0001_first.sql", isFile: () => true },
        { name: "0012_Add_index.sql", isFile: () => true },
        { name: "notes.md", isFile: () => true },
        { name: "backup.sql", isFile: () => false },
      ]),
    ).toEqual(["0001_first.sql", "0012_Add_index.sql"]);
    expect(readAppliedMigrationNames([{ success: true, results: [{ name: "0012_Add_index.sql" }] }])).toEqual([
      "0012_Add_index.sql",
    ]);
  });

  it("blockiert bei ausstehenden oder im Repository fehlenden Migrationen", () => {
    expect(
      compareMigrationNames(["0001_first.sql", "0002_second.sql"], ["0001_first.sql", "0003_removed.sql"]),
    ).toEqual({
      pending: ["0002_second.sql"],
      unknown: ["0003_removed.sql"],
    });
  });

  it("erkennt einen übereinstimmenden Migrationsstand", () => {
    expect(compareMigrationNames(["0001_first.sql", "0002_second.sql"], ["0002_second.sql", "0001_first.sql"])).toEqual(
      { pending: [], unknown: [] },
    );
  });

  it("bricht bei fehlender D1-Tabelle oder einer unerwarteten Abfrageantwort geschlossen ab", () => {
    expect(() => readAppliedMigrationNames([])).toThrow(/nicht genau ein Abfrageergebnis/u);
    expect(() => readAppliedMigrationNames([{ success: false, results: [] }])).toThrow(/nicht erfolgreich/u);
    expect(() => readAppliedMigrationNames([{ success: true, results: [{ name: "unsafe; DROP TABLE" }] }])).toThrow(
      /ungültigen/u,
    );
  });
});
