/**
 * Gemeinsamer Datenvertrag für die Detailangaben eines AED (Entscheidung vom 13.11.2026).
 *
 * Diese Datei wird von ZWEI Seiten benutzt:
 *  - vom Browser (Formular, Vorschau),
 *  - vom Worker (prüft jede Anfrage erneut, bevor etwas nach OpenStreetMap geschrieben wird).
 * Beide Seiten brauchen genau dieselben Regeln. Stünden sie an zwei Stellen, würden sie sich mit der
 * Zeit auseinanderentwickeln, und der Server würde Dinge annehmen, die der Browser nie senden würde
 * (oder umgekehrt). Darum gibt es sie nur hier.
 *
 * Sicherheitsgrundsatz: Alles, was aus dem Browser kommt, ist nicht vertrauenswürdig. Der Server
 * ruft deshalb `validateDetailTags` auf und schreibt nur, was dort als gültig durchgeht.
 *
 * Die Datei enthält nur reine Funktionen ohne Netzwerk, Speicher oder Browser-Zugriffe. Das macht
 * sie leicht testbar (siehe tests/aedDetails.test.ts).
 */

/**
 * Die einzigen OSM-Schlüssel, die der Detailweg schreiben darf. Alles andere lehnt der Vertrag ab.
 * Bewusst NICHT enthalten:
 *  - `defibrillator:code` (ein Zugangscode könnte ein Schloss aushebeln),
 *  - `name`, `manufacturer`, `model` (noch nicht freigegeben) und alle übrigen Schlüssel.
 * Die Reihenfolge hier ist auch die Reihenfolge in Vorschau und Änderungsliste.
 */
export const DETAIL_KEYS = [
  "defibrillator:location",
  "access",
  "opening_hours",
  "indoor",
  "level",
  "defibrillator:cabinet",
  "operator",
  "phone",
  "description",
  "ref",
] as const;

export type DetailKey = (typeof DETAIL_KEYS)[number];

/** Ein Satz Detail-Tags: Nicht jeder Schlüssel ist gesetzt. Fehlende Schlüssel bedeuten „keine Angabe“. */
export type DetailTags = Partial<Record<DetailKey, string>>;

/**
 * Obergrenzen für Texte. OpenStreetMap erlaubt höchstens 255 Zeichen pro Wert. Wir bleiben bei den
 * kurzen Feldern deutlich darunter, damit Einträge lesbar bleiben.
 * Gezählt wird mit `string.length`; ein Emoji zählt dadurch doppelt. Das ist absichtlich die
 * strengere Seite und kann nie zu einem zu langen Wert in OSM führen.
 */
export const DETAIL_LIMITS = {
  location: 160,
  openingHours: 120,
  operator: 120,
  phone: 40,
  description: 255,
  ref: 60,
  levelMin: -9,
  levelMax: 99,
} as const;

/** Wer darf das Gerät nutzen? („no“ gibt es in OSM auch, bietet die App aber nicht an.) */
export const ACCESS_VALUES = ["yes", "customers", "private"] as const;
export type AccessValue = (typeof ACCESS_VALUES)[number];

export const INDOOR_VALUES = ["yes", "no"] as const;
export type IndoorValue = (typeof INDOOR_VALUES)[number];

/**
 * Werte, die das OSM-Wiki für `defibrillator:cabinet` nennt (Stand der Websuche vom 13.11.2026;
 * die Wiki-Seite selbst war aus der Entwicklungsumgebung nicht lesbar). Der Wert beschreibt die Art
 * des Gehäuses, nicht nur „ja/nein“. Welche davon die Oberfläche anbietet, entscheidet Etappe P2.
 */
export const CABINET_VALUES = ["vertical_door", "horizontal_door", "twist", "mechanical", "no"] as const;
export type CabinetValue = (typeof CABINET_VALUES)[number];

/**
 * Der Zustand des Formulars, so wie die Person ihn eingibt. `null` oder ein leerer Text heißt
 * immer „Weiß ich nicht“ und erzeugt NIE ein Tag.
 */
export interface AedDetailForm {
  /** Freitext: Wo genau hängt das Gerät? */
  location: string;
  access: AccessValue | null;
  /** "always" = „Rund um die Uhr“ (24/7), "times" = „Zu bestimmten Zeiten“ (Text in hoursText). */
  hoursMode: "always" | "times" | null;
  hoursText: string;
  indoor: IndoorValue | null;
  /** Ebene, nur sinnvoll bei indoor = "yes". 0 = Erdgeschoss, −1 = Keller. */
  level: number | null;
  cabinet: CabinetValue | null;
  operator: string;
  phone: string;
  description: string;
  ref: string;
}

/** Ein leeres Formular: nichts ist beantwortet, es entsteht kein Tag. */
export const EMPTY_DETAIL_FORM: Readonly<AedDetailForm> = Object.freeze({
  location: "",
  access: null,
  hoursMode: null,
  hoursText: "",
  indoor: null,
  level: null,
  cabinet: null,
  operator: "",
  phone: "",
  description: "",
  ref: "",
});

/** Warum ein Wert abgelehnt wurde. Die Oberfläche kann daraus eine verständliche Meldung machen. */
export type DetailProblem =
  | "unknown-key"
  | "not-text"
  | "empty"
  | "too-long"
  | "invalid-characters"
  | "invalid-value";

/** Ergebnis der Prüfung: entweder saubere Tags oder genau ein Fehler mit Schlüssel und Grund. */
export type DetailResult =
  | { ok: true; tags: DetailTags }
  | { ok: false; key: string; problem: DetailProblem };

/**
 * Zeichen, die in einem Freitext nichts verloren haben:
 *  - Steuerzeichen (z. B. Zeilenumbruch, Tabulator),
 *  - unsichtbare Zeichen (Zero-Width, Byte-Order-Mark),
 *  - Zeichen, die die Schreibrichtung umdrehen (damit niemand Text in einer anderen App
 *    optisch vertauschen kann).
 */
const FORBIDDEN_TEXT_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/u;

/** Telefonnummer: Ziffern, Leerzeichen, + ( ) - / . und ; für mehrere Nummern. */
const PHONE_PATTERN = /^[+0-9][0-9 ()+\-/.;]*$/u;

/** Ebene als Text: ganze Zahl ohne führende Null, z. B. "0", "-1", "12". */
const LEVEL_PATTERN = /^(0|-?[1-9]\d?)$/u;

/** Grenze je Schlüssel für reine Freitextfelder. */
const TEXT_LIMIT: Partial<Record<DetailKey, number>> = {
  "defibrillator:location": DETAIL_LIMITS.location,
  opening_hours: DETAIL_LIMITS.openingHours,
  operator: DETAIL_LIMITS.operator,
  phone: DETAIL_LIMITS.phone,
  description: DETAIL_LIMITS.description,
  ref: DETAIL_LIMITS.ref,
};

/** Hilfsfunktion: Ist `key` einer der erlaubten Detail-Schlüssel? (Auch als Typprüfung nutzbar.) */
export function isDetailKey(key: string): key is DetailKey {
  return (DETAIL_KEYS as readonly string[]).includes(key);
}

/**
 * Prüft EINEN Wert (bereits getrimmt) gegen die Regeln seines Schlüssels.
 * Gibt `null` zurück, wenn der Wert in Ordnung ist, sonst den Grund der Ablehnung.
 */
function checkValue(key: DetailKey, value: string): DetailProblem | null {
  if (value.length === 0) return "empty";

  // Auswahlfelder: nur genau die vorgesehenen Werte.
  if (key === "access") return (ACCESS_VALUES as readonly string[]).includes(value) ? null : "invalid-value";
  if (key === "indoor") return (INDOOR_VALUES as readonly string[]).includes(value) ? null : "invalid-value";
  if (key === "defibrillator:cabinet") return (CABINET_VALUES as readonly string[]).includes(value) ? null : "invalid-value";
  if (key === "level") {
    if (!LEVEL_PATTERN.test(value)) return "invalid-value";
    const number = Number(value);
    return number >= DETAIL_LIMITS.levelMin && number <= DETAIL_LIMITS.levelMax ? null : "invalid-value";
  }

  // Ab hier sind es Freitexte: erst die Länge, dann die Zeichen.
  const limit = TEXT_LIMIT[key];
  if (limit === undefined) return "unknown-key"; // Sicherheitsnetz: sollte nie eintreten.
  if (value.length > limit) return "too-long";
  if (FORBIDDEN_TEXT_CHARACTERS.test(value)) return "invalid-characters";

  // Die Telefonnummer hat zusätzlich ein festes Muster und mindestens drei Ziffern (z. B. „112“).
  if (key === "phone") {
    if (!PHONE_PATTERN.test(value)) return "invalid-characters";
    if ((value.match(/\d/gu) ?? []).length < 3) return "invalid-value";
  }
  return null;
}

/**
 * Prüft Tags, die von außen kommen (zum Beispiel der JSON-Körper einer Anfrage an den Worker).
 *
 * Regeln:
 *  - Jeder Schlüssel muss in DETAIL_KEYS stehen. Ein einziger fremder Schlüssel lehnt ALLES ab,
 *    damit niemand etwas „mitschmuggeln“ kann.
 *  - Jeder Wert muss ein Text sein, nach dem Trimmen gültig.
 *  - Es wird nichts stillschweigend weggelassen: Ist ein Wert schlecht, bekommt der Aufrufer den Fehler.
 *
 * Die Prüfung, ob bestehende Tags überschrieben werden dürfen (Ergänzen vs. Korrigieren), gehört
 * NICHT hierher, sondern in die Schreibroute (Etappe P4/P5), weil sie das Objekt in OSM kennt.
 *
 * @param input  Beliebiger, unvertrauter Wert (meist ein geparstes JSON-Objekt).
 * @returns      Saubere, getrimmte Tags in fester Reihenfolge oder ein einzelner Fehler.
 */
export function validateDetailTags(input: unknown): DetailResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, key: "", problem: "not-text" };
  }
  const entries = Object.entries(input as Record<string, unknown>);

  // 1. Schritt: erst alle Schlüssel prüfen, bevor ein Wert angeschaut wird.
  for (const [key] of entries) {
    if (!isDetailKey(key)) return { ok: false, key, problem: "unknown-key" };
  }

  // 2. Schritt: jeden Wert prüfen und getrimmt übernehmen.
  const cleaned: DetailTags = {};
  for (const [key, rawValue] of entries as Array<[DetailKey, unknown]>) {
    if (typeof rawValue !== "string") return { ok: false, key, problem: "not-text" };
    const value = rawValue.trim();
    const problem = checkValue(key, value);
    if (problem) return { ok: false, key, problem };
    cleaned[key] = value;
  }
  return { ok: true, tags: inDetailOrder(cleaned) };
}

/** Sortiert Tags in die feste Reihenfolge von DETAIL_KEYS (damit Vorschau und Tests stabil sind). */
function inDetailOrder(tags: DetailTags): DetailTags {
  const ordered: DetailTags = {};
  for (const key of DETAIL_KEYS) {
    const value = tags[key];
    if (value !== undefined) ordered[key] = value;
  }
  return ordered;
}

/**
 * Übersetzt das Formular in OSM-Tags.
 *
 * Wichtige Regeln (siehe docs/osm.md, „Detailangaben“):
 *  - „Weiß ich nicht“ (null oder leerer Text) erzeugt KEIN Tag.
 *  - `opening_hours=24/7` entsteht nur, wenn die Person ausdrücklich „Rund um die Uhr“ gewählt hat.
 *  - „Zu bestimmten Zeiten“ ohne eingetippte Zeiten erzeugt ebenfalls kein Tag.
 *  - `level` wird nur geschrieben, wenn `indoor` auf „drinnen“ steht.
 *  - Ist ein eingegebener Wert ungültig, kommt ein Fehler zurück. Er wird nicht still entfernt,
 *    damit die Person ihn korrigieren kann.
 *
 * @param form      Der aktuelle Formularzustand.
 * @param existing  Optional: die bisherigen OSM-Tags des Objekts (nur beim Ergänzen eines bestehenden AED). Steht dort
 *                  schon `indoor=yes`, darf die Ebene auch dann entstehen, wenn die Person „drinnen“ nicht erneut wählt.
 * @returns         Die Tags (in fester Reihenfolge) oder ein Fehler mit Schlüssel und Grund.
 */
export function buildDetailTags(form: Readonly<AedDetailForm>, existing?: Readonly<Record<string, string>>): DetailResult {
  const candidate: Record<string, string> = {};

  // Hilfsfunktion: Text übernehmen, wenn nach dem Trimmen etwas drinsteht.
  const addText = (key: DetailKey, value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length > 0) candidate[key] = trimmed;
  };

  addText("defibrillator:location", form.location);
  if (form.access !== null) candidate.access = form.access;

  if (form.hoursMode === "always") candidate.opening_hours = "24/7";
  else if (form.hoursMode === "times") addText("opening_hours", form.hoursText);

  if (form.indoor !== null) candidate.indoor = form.indoor;
  // Die Ebene gehört nur zu einem Gerät im Gebäude. Gilt die Wahl der Person; hat sie keine getroffen, zählt der
  // bestehende OSM-Wert (nur beim Ergänzen eines vorhandenen AED).
  const effectiveIndoor = form.indoor ?? existing?.indoor ?? null;
  if (effectiveIndoor === "yes" && form.level !== null) candidate.level = String(form.level);

  if (form.cabinet !== null) candidate["defibrillator:cabinet"] = form.cabinet;
  addText("operator", form.operator);
  addText("phone", form.phone);
  addText("description", form.description);
  addText("ref", form.ref);

  // Zum Schluss laufen die Tags durch dieselbe Prüfung wie beim Server.
  return validateDetailTags(candidate);
}

/** Eine einzelne Änderung gegenüber dem, was in OSM steht. */
export interface DetailChange {
  key: DetailKey;
  /** "add" = Schlüssel fehlte bisher, "change" = Schlüssel hatte einen anderen Wert. */
  kind: "add" | "change";
  /** Bisheriger Wert in OSM. Nur bei kind = "change" vorhanden. */
  before?: string;
  after: string;
}

/**
 * Vergleicht die neuen Detail-Tags mit den bisherigen OSM-Tags eines Objekts.
 *
 * Wichtig:
 *  - Es zählen nur Schlüssel aus DETAIL_KEYS. Alle anderen Tags des Objekts werden nie angefasst.
 *  - Es gibt absichtlich KEIN „Löschen“: Fehlt ein Schlüssel in `after`, ist das keine Änderung.
 *    „Weiß ich nicht“ darf nie etwas entfernen.
 *  - Ein unveränderter Wert taucht nicht in der Liste auf.
 *
 * Die Liste dient der Vorschau („alt → neu“) und der Schreibroute: Im Modus „nur ergänzen“ (P4)
 * sind nur Einträge mit kind = "add" erlaubt, im Modus „korrigieren“ (P5) auch "change".
 *
 * @param before  Die aktuellen OSM-Tags des Objekts (beliebige Schlüssel).
 * @param after   Die geprüften neuen Detail-Tags (Ergebnis von buildDetailTags/validateDetailTags).
 * @returns       Die Änderungen in der festen Reihenfolge von DETAIL_KEYS.
 */
export function diffTags(before: Readonly<Record<string, string>>, after: Readonly<DetailTags>): DetailChange[] {
  const changes: DetailChange[] = [];
  for (const key of DETAIL_KEYS) {
    const newValue = after[key];
    if (newValue === undefined) continue; // nicht beantwortet: nichts tun, nie löschen
    const oldValue = Object.prototype.hasOwnProperty.call(before, key) ? before[key] : undefined;
    if (oldValue === undefined) changes.push({ key, kind: "add", after: newValue });
    else if (oldValue !== newValue) changes.push({ key, kind: "change", before: oldValue, after: newValue });
  }
  return changes;
}
