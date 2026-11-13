import { describe, expect, it } from "vitest";
import {
  DETAIL_KEYS,
  DETAIL_LIMITS,
  EMPTY_DETAIL_FORM,
  buildDetailTags,
  diffTags,
  isDetailKey,
  validateDetailTags,
  type AedDetailForm,
} from "../src/contracts/aedDetails";

// Kleine Hilfe: Ein Formular, in dem nur die genannten Felder von „leer“ abweichen.
function form(changes: Partial<AedDetailForm>): AedDetailForm {
  return { ...EMPTY_DETAIL_FORM, ...changes };
}

// Hilfe für Tests, die einen erfolgreichen Aufbau erwarten.
function tagsOf(changes: Partial<AedDetailForm>): Record<string, string> {
  const result = buildDetailTags(form(changes));
  if (!result.ok) throw new Error(`Unerwarteter Fehler: ${result.key} ${result.problem}`);
  return result.tags as Record<string, string>;
}

describe("buildDetailTags: „Weiß ich nicht“ schreibt nichts", () => {
  it("erzeugt aus einem leeren Formular kein einziges Tag", () => {
    expect(tagsOf({})).toEqual({});
  });

  it("behandelt Leerzeichen-Texte wie „nicht beantwortet“", () => {
    expect(tagsOf({ location: "   ", operator: "\t ", phone: " ", description: "  ", ref: " " })).toEqual({});
  });

  it("setzt opening_hours=24/7 nur bei ausdrücklicher Wahl „Rund um die Uhr“", () => {
    expect(tagsOf({ hoursMode: "always" })).toEqual({ opening_hours: "24/7" });
    // Ein eingetippter Text allein genügt nicht, solange der Modus fehlt.
    expect(tagsOf({ hoursMode: null, hoursText: "24/7" })).toEqual({});
  });

  it("schreibt bei „Zu bestimmten Zeiten“ ohne Text kein Tag", () => {
    expect(tagsOf({ hoursMode: "times", hoursText: "" })).toEqual({});
    expect(tagsOf({ hoursMode: "times", hoursText: "Mo-Fr 08:00-18:00" })).toEqual({ opening_hours: "Mo-Fr 08:00-18:00" });
  });

  it("ignoriert Text im Zeiten-Feld, wenn „Rund um die Uhr“ gewählt ist", () => {
    expect(tagsOf({ hoursMode: "always", hoursText: "Mo-Fr 08:00-18:00" })).toEqual({ opening_hours: "24/7" });
  });
});

describe("buildDetailTags: Ebene nur bei „drinnen“", () => {
  it("schreibt level bei indoor=yes", () => {
    expect(tagsOf({ indoor: "yes", level: -1 })).toEqual({ indoor: "yes", level: "-1" });
    expect(tagsOf({ indoor: "yes", level: 0 })).toEqual({ indoor: "yes", level: "0" });
  });

  it("verwirft level bei „draußen“ und bei unbekannter Lage", () => {
    expect(tagsOf({ indoor: "no", level: 2 })).toEqual({ indoor: "no" });
    expect(tagsOf({ indoor: null, level: 2 })).toEqual({});
  });

  it("nimmt beim Ergänzen den bestehenden OSM-Wert indoor=yes, wenn die Person „drinnen“ nicht erneut wählt", () => {
    const build = (changes: Partial<AedDetailForm>, existing?: Record<string, string>) => {
      const result = buildDetailTags(form(changes), existing);
      if (!result.ok) throw new Error(`${result.key} ${result.problem}`);
      return result.tags;
    };
    expect(build({ level: 2 }, { indoor: "yes" })).toEqual({ level: "2" });
    // Steht in OSM „draußen“ oder nichts, gibt es keine Ebene.
    expect(build({ level: 2 }, { indoor: "no" })).toEqual({});
    expect(build({ level: 2 }, {})).toEqual({});
    expect(build({ level: 2 })).toEqual({});
    // Die ausdrückliche Wahl der Person geht vor dem bestehenden Wert.
    expect(build({ level: 2, indoor: "no" }, { indoor: "yes" })).toEqual({ indoor: "no" });
  });

  it("lässt level weg, wenn drinnen gewählt, aber keine Ebene angegeben ist", () => {
    expect(tagsOf({ indoor: "yes", level: null })).toEqual({ indoor: "yes" });
  });

  it("lehnt Ebenen außerhalb von −9 bis 99 und Nicht-Ganzzahlen ab", () => {
    for (const level of [-10, 100, 1.5, Number.NaN]) {
      const result = buildDetailTags(form({ indoor: "yes", level }));
      expect(result.ok, `level ${level}`).toBe(false);
      if (!result.ok) expect(result.key).toBe("level");
    }
  });
});

describe("buildDetailTags: alle Felder zusammen", () => {
  it("liefert die Tags in der festen Reihenfolge von DETAIL_KEYS", () => {
    const tags = tagsOf({
      ref: "A-12", description: "Schlüssel beim Hausmeister", phone: "+49 911 1234567", operator: "Stadtwerke",
      cabinet: "vertical_door", indoor: "yes", level: 1, hoursMode: "always", access: "customers", location: "Foyer links",
    });
    expect(Object.keys(tags)).toEqual([
      "defibrillator:location", "access", "opening_hours", "indoor", "level", "defibrillator:cabinet",
      "operator", "phone", "description", "ref",
    ]);
    expect(tags["defibrillator:location"]).toBe("Foyer links");
  });

  it("trimmt Texte", () => {
    expect(tagsOf({ location: "  Eingang links  " })).toEqual({ "defibrillator:location": "Eingang links" });
  });
});

describe("Grenzen und Zeichen", () => {
  it("nimmt genau die Höchstlänge an und lehnt ein Zeichen mehr ab", () => {
    expect(buildDetailTags(form({ location: "a".repeat(DETAIL_LIMITS.location) })).ok).toBe(true);
    const tooLong = buildDetailTags(form({ location: "a".repeat(DETAIL_LIMITS.location + 1) }));
    expect(tooLong).toEqual({ ok: false, key: "defibrillator:location", problem: "too-long" });
    // OSM erlaubt höchstens 255 Zeichen je Wert.
    expect(buildDetailTags(form({ description: "b".repeat(255) })).ok).toBe(true);
    expect(buildDetailTags(form({ description: "b".repeat(256) }))).toEqual({ ok: false, key: "description", problem: "too-long" });
  });

  it("lehnt Steuerzeichen, unsichtbare und richtungsumkehrende Zeichen ab", () => {
    for (const bad of ["Zeile1\nZeile2", "Tab\there", "null\u0000byte", "zero\u200bwidth", "umkehr\u202eText", "bo\ufeffm"]) {
      expect(buildDetailTags(form({ location: bad })), JSON.stringify(bad)).toEqual({
        ok: false, key: "defibrillator:location", problem: "invalid-characters",
      });
    }
  });

  it("entfernt unsichtbare Leerzeichen am Rand (trim), sodass sie nie im Wert landen", () => {
    expect(tagsOf({ location: "\ufeff" + "Eingang" + "\ufeff" })).toEqual({ "defibrillator:location": "Eingang" });
  });

  it("akzeptiert Umlaute, Polnisch, Japanisch und Akzente", () => {
    for (const text of ["Haupteingang, neben dem Büro", "Wejście główne", "正面玄関の横", "Près de l’entrée", "Junto a la puerta"]) {
      expect(buildDetailTags(form({ location: text })).ok, text).toBe(true);
    }
  });

  it("prüft Telefonnummern auf Zeichen und mindestens drei Ziffern", () => {
    expect(buildDetailTags(form({ phone: "112" })).ok).toBe(true);
    expect(buildDetailTags(form({ phone: "+49 (911) 123-45; 0911/6789" })).ok).toBe(true);
    expect(buildDetailTags(form({ phone: "12" }))).toEqual({ ok: false, key: "phone", problem: "invalid-value" });
    expect(buildDetailTags(form({ phone: "anrufen!" }))).toEqual({ ok: false, key: "phone", problem: "invalid-characters" });
    expect(buildDetailTags(form({ phone: "<script>" })).ok).toBe(false);
  });
});

describe("validateDetailTags: Eingaben von außen", () => {
  it("lehnt jeden Schlüssel außerhalb der Liste ab, vor allem den Zugangscode", () => {
    for (const key of ["defibrillator:code", "name", "emergency", "check_date", "manufacturer", "model", "fixme", "access:conditional"]) {
      expect(validateDetailTags({ [key]: "x" }), key).toEqual({ ok: false, key, problem: "unknown-key" });
    }
  });

  it("lehnt die ganze Anfrage ab, wenn nur ein Schlüssel fremd ist", () => {
    const result = validateDetailTags({ access: "yes", "defibrillator:code": "1234" });
    expect(result).toEqual({ ok: false, key: "defibrillator:code", problem: "unknown-key" });
  });

  it("lehnt Nicht-Objekte und Nicht-Texte ab", () => {
    for (const input of [null, undefined, "access=yes", 5, [], [["access", "yes"]]]) {
      expect(validateDetailTags(input).ok, JSON.stringify(input)).toBe(false);
    }
    expect(validateDetailTags({ level: 1 })).toEqual({ ok: false, key: "level", problem: "not-text" });
    expect(validateDetailTags({ access: null })).toEqual({ ok: false, key: "access", problem: "not-text" });
  });

  it("lehnt leere Werte ab, weil „keine Angabe“ als fehlender Schlüssel gesendet wird", () => {
    expect(validateDetailTags({ operator: "" })).toEqual({ ok: false, key: "operator", problem: "empty" });
    expect(validateDetailTags({ operator: "   " })).toEqual({ ok: false, key: "operator", problem: "empty" });
  });

  it("lässt nur die vorgesehenen Auswahlwerte zu", () => {
    expect(validateDetailTags({ access: "yes" }).ok).toBe(true);
    expect(validateDetailTags({ access: "customers" }).ok).toBe(true);
    expect(validateDetailTags({ access: "private" }).ok).toBe(true);
    for (const access of ["permissive", "no", "Yes", "public"]) {
      expect(validateDetailTags({ access }), access).toEqual({ ok: false, key: "access", problem: "invalid-value" });
    }
    expect(validateDetailTags({ indoor: "maybe" }).ok).toBe(false);
    expect(validateDetailTags({ "defibrillator:cabinet": "yes" }).ok).toBe(false);
    expect(validateDetailTags({ "defibrillator:cabinet": "twist" }).ok).toBe(true);
    for (const level of ["01", "-0", "1.5", "abc", "100", "-10", "+1"]) {
      expect(validateDetailTags({ level }).ok, level).toBe(false);
    }
    for (const level of ["0", "-9", "99", "7"]) expect(validateDetailTags({ level }).ok, level).toBe(true);
  });

  it("trimmt Werte und sortiert in die feste Reihenfolge", () => {
    const result = validateDetailTags({ ref: " 7 ", access: "yes" });
    expect(result).toEqual({ ok: true, tags: { access: "yes", ref: "7" } });
    if (result.ok) expect(Object.keys(result.tags)).toEqual(["access", "ref"]);
  });

  it("nimmt ein leeres Objekt als gültig an (nichts zu schreiben)", () => {
    expect(validateDetailTags({})).toEqual({ ok: true, tags: {} });
  });

  it("erkennt Schlüssel mit isDetailKey", () => {
    expect(isDetailKey("access")).toBe(true);
    expect(isDetailKey("defibrillator:code")).toBe(false);
    expect(DETAIL_KEYS).not.toContain("defibrillator:code");
  });
});

describe("diffTags: nur Ergänzen oder Ändern, nie Löschen", () => {
  it("meldet fehlende Schlüssel als „add“", () => {
    expect(diffTags({ emergency: "defibrillator" }, { access: "yes" })).toEqual([{ key: "access", kind: "add", after: "yes" }]);
  });

  it("meldet abweichende Werte als „change“ mit altem Wert", () => {
    expect(diffTags({ access: "private" }, { access: "yes" })).toEqual([
      { key: "access", kind: "change", before: "private", after: "yes" },
    ]);
  });

  it("meldet gleiche Werte nicht", () => {
    expect(diffTags({ access: "yes", indoor: "no" }, { access: "yes", indoor: "no" })).toEqual([]);
  });

  it("löscht nie: ein fehlender Schlüssel in „after“ ist keine Änderung", () => {
    expect(diffTags({ access: "yes", indoor: "no", level: "1" }, {})).toEqual([]);
    expect(diffTags({ access: "yes" }, { indoor: "yes" })).toEqual([{ key: "indoor", kind: "add", after: "yes" }]);
  });

  it("fasst fremde Tags des Objekts nie an", () => {
    const before = { emergency: "defibrillator", check_date: "2026-01-01", name: "Rathaus", "defibrillator:code": "1234", fixme: "prüfen" };
    expect(diffTags(before, { access: "yes" })).toEqual([{ key: "access", kind: "add", after: "yes" }]);
  });

  it("behandelt geerbte Eigenschaften wie „constructor“ nicht als vorhandene Tags", () => {
    // Ein Objekt-Literal erbt zum Beispiel `toString`. Nur eigene Schlüssel zählen.
    expect(diffTags({}, { ref: "x" })).toEqual([{ key: "ref", kind: "add", after: "x" }]);
  });

  it("liefert mehrere Änderungen in der Reihenfolge von DETAIL_KEYS", () => {
    const changes = diffTags({ opening_hours: "Mo-Fr 08:00-18:00" }, { ref: "9", opening_hours: "24/7", access: "yes" });
    expect(changes.map((change) => change.key)).toEqual(["access", "opening_hours", "ref"]);
    expect(changes[1]).toEqual({ key: "opening_hours", kind: "change", before: "Mo-Fr 08:00-18:00", after: "24/7" });
  });
});
