/**
 * Sicherer Zugriff auf den Browser-Speicher (localStorage).
 *
 * Warum? Der Browser-Speicher ist nicht immer da. Bei "alle Cookies blockieren", in manchen privaten Fenstern oder
 * bei vollem Speicher wirft schon der Zugriff auf `localStorage` einen Fehler (SecurityError, QuotaExceededError).
 * Ein ungefangener Fehler beim Start legt die ganze Seite lahm; ein ungefangener Fehler beim Sprachwechsel verhindert
 * den Wechsel. Der Speicher ist hier nur eine Bequemlichkeit ("merk dir meine Sprache"), kein Muss. Darum gilt:
 *   - Lesen, das nicht geht, ergibt "nichts gespeichert" (null).
 *   - Schreiben, das nicht geht, wird gemeldet (false), aber nie als Fehler geworfen. Die App läuft weiter, und die
 *     Wahl gilt für die offene Seite.
 *
 * Wichtig: Ein offener Speichervorgang nutzt diese Helfer nur für den Zugriffsschutz. Sein Aufrufer muss ein
 * fehlgeschlagenes Schreiben als Fehler behandeln und darf die OSM-Anfrage dann nicht absenden.
 */

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Holt den Speicher des Browsers oder undefined, wenn schon der Zugriff scheitert. */
function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Liest einen Wert. Gibt null zurück, wenn nichts gespeichert ist oder der Speicher nicht lesbar ist. */
export function readStoredValue(key: string, storage: StorageLike | undefined = browserStorage()): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Schreibt einen Wert. Gibt true zurück, wenn er gespeichert wurde, sonst false. Wirft nie. */
export function writeStoredValue(key: string, value: string, storage: StorageLike | undefined = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Entfernt einen Wert. Meldet false, wenn der Zugriff nicht möglich war. */
export function removeStoredValue(key: string, storage: Pick<Storage, "removeItem"> | undefined = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
