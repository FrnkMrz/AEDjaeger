/**
 * Der "Ka-Ching"-Ton nach einem erfolgreich bestätigten Speichern.
 *
 * Wann klingt er?
 *   Genau dann, wenn der Server ein Speichern ausdrücklich als "erfolgreich" bestätigt hat (Status "complete").
 *   Nicht bei der Vorschau, nicht beim Senden, nicht bei einem Fehler und nicht bei "Ergebnis unklar".
 *   Der Ton ist ein kleines Dankeschön für einen bestätigten Vorgang. Er zählt nichts, zeigt keine Punkte und
 *   führt keine Rangliste.
 *
 * Woher kommt der Ton?
 *   Er wird im Browser aus ein paar Schwingungen erzeugt (Web Audio). Es gibt keine Tondatei, also auch keine
 *   Rechte-, Lade- oder Cache-Frage.
 *
 * Warum "prepare" VOR dem Ton?
 *   Browser, besonders Safari auf dem iPhone, erlauben Ton erst, wenn ihn eine Berührung der Person freigeschaltet
 *   hat. Das Speichern dauert aber einen Moment; die Antwort des Servers kommt erst danach und gilt nicht mehr als
 *   Berührung. Darum wird der Audio-Baustein schon beim Tippen auf "Speichern" angelegt und aufgeweckt
 *   (prepare). Der Ton selbst (play) erklingt später, wenn der Erfolg feststeht.
 *
 * Was ist, wenn der Ton nicht geht?
 *   Dann passiert nichts. Fehlt Web Audio, ist das Handy stumm geschaltet oder der Ton ausgestellt, bleibt die App
 *   unverändert. Kein Fehler darf das Speichern oder die Erfolgsmeldung stören.
 */

/** Browser-Speicher-Schlüssel der Einstellung. Der Wert "off" schaltet den Ton aus; alles andere heißt "an". */
export const SUCCESS_SOUND_PREFERENCE_KEY = "aedjaeger-success-sound";

/** Der kleine Ausschnitt von AudioContext, den wir brauchen. So lässt er sich in Tests durch eine Attrappe ersetzen. */
export type AudioContextLike = {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  createOscillator(): {
    type: string;
    frequency: { value: number };
    connect(target: unknown): unknown;
    start(when: number): void;
    stop(when: number): void;
  };
  createGain(): {
    gain: {
      setValueAtTime(value: number, when: number): void;
      exponentialRampToValueAtTime(value: number, when: number): void;
    };
    connect(target: unknown): unknown;
  };
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type SuccessSoundOptions = {
  /** Wo die Einstellung liegt. Standard: der Browser-Speicher. */
  storage?: StorageLike | undefined;
  /** Erzeugt den Audio-Baustein. Standard: AudioContext des Browsers; fehlt er, bleibt die App stumm. */
  createContext?: () => AudioContextLike | null;
};

/** Eine Note: ein Ton mit weichem Anschlag und langsamem Ausklingen. */
type Note = { frequency: number; type: "sine" | "triangle"; startOffset: number; duration: number; volume: number };

/**
 * Das "Ka-Ching": erst ein kurzes, dunkleres "Ka", dann ein helles, klingelndes "Ching" aus drei Obertönen.
 * Die Zahlen sind Frequenzen in Hertz (Schwingungen pro Sekunde); höhere Zahl heißt höherer Ton.
 * Die Lautstärke ist bewusst leise (höchstens 0,22 von 1), damit es neben dem Handy nicht erschreckt.
 */
const NOTES: readonly Note[] = [
  { frequency: 988, type: "triangle", startOffset: 0, duration: 0.08, volume: 0.18 }, // "Ka"
  { frequency: 2093, type: "sine", startOffset: 0.09, duration: 0.9, volume: 0.22 }, // "Ching": Grundton
  { frequency: 2637, type: "sine", startOffset: 0.09, duration: 0.7, volume: 0.12 }, // Oberton 1
  { frequency: 3136, type: "sine", startOffset: 0.09, duration: 0.5, volume: 0.08 }, // Oberton 2
];

/** Standard-Audio-Baustein des Browsers. Gibt null zurück, wenn es keinen gibt oder das Anlegen scheitert. */
function createBrowserAudioContext(): AudioContextLike | null {
  try {
    // Safari kannte lange nur "webkitAudioContext".
    const Constructor = (globalThis as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike }).AudioContext
      ?? (globalThis as { webkitAudioContext?: new () => AudioContextLike }).webkitAudioContext;
    return Constructor ? new Constructor() : null;
  } catch {
    return null;
  }
}

/** Liest die Einstellung. Standard ist "an". Ist der Speicher nicht lesbar (zum Beispiel im privaten Modus), bleibt es "an". */
export function isSuccessSoundEnabled(storage: StorageLike | undefined = safeLocalStorage()): boolean {
  try {
    return storage?.getItem(SUCCESS_SOUND_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Speichert die Einstellung im Browser-Speicher (nur diese Funktion; die Wahl für die laufende Sitzung hält der
 * Spieler selbst im Arbeitsspeicher, siehe createSuccessSound). Scheitert das Speichern, geht nur das Merken über das
 * Neuladen hinaus verloren; die App läuft weiter.
 */
export function setSuccessSoundEnabled(enabled: boolean, storage: StorageLike | undefined = safeLocalStorage()): void {
  try {
    storage?.setItem(SUCCESS_SOUND_PREFERENCE_KEY, enabled ? "on" : "off");
  } catch {
    // Nicht schreibbar: unwichtig für den Ablauf.
  }
}

function safeLocalStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Baut den Ton-Spieler. Die App nutzt genau eine Instanz; Tests geben Attrappen mit.
 * - prepare(): beim Tippen aufrufen (legt den Audio-Baustein an und weckt ihn auf).
 * - play(): beim bestätigten Erfolg aufrufen. Gibt true zurück, wenn der Ton angestoßen wurde.
 * - isEnabled() / setEnabled(): die Wahl der Person (Schalter im Info-Dialog).
 */
export function createSuccessSound(options: SuccessSoundOptions = {}) {
  const createContext = options.createContext ?? createBrowserAudioContext;
  let context: AudioContextLike | null = null;
  // Die Wahl der Person, solange die Seite offen ist. Sie hat Vorrang vor dem Browser-Speicher. Wichtig, wenn der
  // Speicher gesperrt ist (zum Beispiel im privaten Modus): Dann lässt sich der Ton trotzdem ausschalten, und die
  // Wahl gilt bis zum Neuladen. Ohne diese Wahl im Arbeitsspeicher spielte der Ton weiter und der Schalter sprang zurück.
  let sessionChoice: boolean | undefined;
  const enabled = (): boolean => sessionChoice ?? isSuccessSoundEnabled(options.storage ?? safeLocalStorage());

  /** Setzt die Wahl: erst im Arbeitsspeicher (wirkt sofort), dann im Browser-Speicher (bleibt nach dem Neuladen). */
  function setEnabled(value: boolean): void {
    sessionChoice = value;
    setSuccessSoundEnabled(value, options.storage ?? safeLocalStorage());
  }

  function prepare(): void {
    if (!enabled()) return; // Ist der Ton aus, wird nicht einmal ein Audio-Baustein angelegt (schont Musik im Hintergrund).
    try {
      context ??= createContext();
      // resume() muss in der Berührung der Person gestartet werden. Das Ergebnis ist hier egal.
      void context?.resume().catch(() => undefined);
    } catch {
      context = null;
    }
  }

  function play(): boolean {
    if (!enabled()) return false;
    try {
      // Falls prepare() nie lief (zum Beispiel nach dem Neuladen mitten in einem Vorgang), versuchen wir es trotzdem.
      context ??= createContext();
      if (!context) return false;
      const audio = context;
      if (audio.state === "suspended") void audio.resume().catch(() => undefined);
      const now = audio.currentTime;
      for (const note of NOTES) {
        const start = now + note.startOffset;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = note.type;
        oscillator.frequency.value = note.frequency;
        // Lautstärke-Verlauf: von (fast) Null schnell auf die Spitze, dann langsam wieder auf (fast) Null.
        // Null selbst geht bei dieser Rampe nicht, darum 0,0001.
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(note.volume, start + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + note.duration + 0.05);
      }
      return true;
    } catch {
      return false;
    }
  }

  return { prepare, play, isEnabled: enabled, setEnabled };
}

/** Die eine Instanz, die die App benutzt. */
export const successSound = createSuccessSound();
