import { describe, expect, it, vi } from "vitest";
import { createSuccessSound, isSuccessSoundEnabled, setSuccessSoundEnabled, SUCCESS_SOUND_PREFERENCE_KEY, type AudioContextLike } from "../src/sound/successSound";

/** Eine Attrappe des Audio-Bausteins, die nur mitschreibt, was passiert. Es klingt nichts. */
function fakeAudio(state = "running") {
  const log = { oscillators: 0, gains: 0, started: 0, stopped: 0, connected: 0, resumes: 0, ramps: 0 };
  const context: AudioContextLike = {
    currentTime: 10,
    state,
    destination: {},
    resume: () => { log.resumes += 1; return Promise.resolve(); },
    createOscillator: () => {
      log.oscillators += 1;
      return { type: "sine", frequency: { value: 0 }, connect: () => { log.connected += 1; }, start: () => { log.started += 1; }, stop: () => { log.stopped += 1; } };
    },
    createGain: () => {
      log.gains += 1;
      return { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => { log.ramps += 1; } }, connect: () => { log.connected += 1; } };
    },
  };
  return { context, log };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

describe("success sound", () => {
  it("plays a short chime of four notes, each with a fade-in and fade-out", () => {
    const { context, log } = fakeAudio();
    const sound = createSuccessSound({ storage: memoryStorage(), createContext: () => context });
    expect(sound.play()).toBe(true);
    expect(log.oscillators).toBe(4);
    expect(log.gains).toBe(4);
    expect(log.started).toBe(4);
    expect(log.stopped).toBe(4);
    expect(log.ramps).toBe(8); // Je Note ein Anstieg und ein Ausklingen.
    expect(log.connected).toBe(8); // Jede Note: Schwingung -> Lautstärke -> Ausgang.
  });

  it("prepares (creates and wakes the audio) when asked, once per tap, without playing anything", () => {
    const { context, log } = fakeAudio("suspended");
    const factory = vi.fn(() => context);
    const sound = createSuccessSound({ storage: memoryStorage(), createContext: factory });
    sound.prepare();
    sound.prepare();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(log.resumes).toBe(2);
    expect(log.oscillators).toBe(0);
  });

  it("wakes a suspended audio context before playing", () => {
    const { context, log } = fakeAudio("suspended");
    const sound = createSuccessSound({ storage: memoryStorage(), createContext: () => context });
    expect(sound.play()).toBe(true);
    expect(log.resumes).toBe(1);
  });

  it("plays even when prepare never ran, for example after a reload in the middle of a save", () => {
    const { context, log } = fakeAudio();
    const sound = createSuccessSound({ storage: memoryStorage(), createContext: () => context });
    expect(sound.play()).toBe(true);
    expect(log.oscillators).toBe(4);
  });

  it("stays completely silent, and creates no audio, when the person switched the sound off", () => {
    const { context, log } = fakeAudio();
    const factory = vi.fn(() => context);
    const sound = createSuccessSound({ storage: memoryStorage({ [SUCCESS_SOUND_PREFERENCE_KEY]: "off" }), createContext: factory });
    sound.prepare();
    expect(sound.play()).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(log.oscillators).toBe(0);
  });

  it("does nothing, and does not throw, when the browser has no Web Audio", () => {
    const sound = createSuccessSound({ storage: memoryStorage(), createContext: () => null });
    expect(() => sound.prepare()).not.toThrow();
    expect(sound.play()).toBe(false);
  });

  it("does nothing, and does not throw, when creating the audio fails", () => {
    const sound = createSuccessSound({ storage: memoryStorage(), createContext: () => { throw new Error("blocked"); } });
    expect(() => sound.prepare()).not.toThrow();
    expect(sound.play()).toBe(false);
  });

  it("survives a rejected resume() and a failing oscillator", () => {
    const { context } = fakeAudio("suspended");
    context.resume = () => Promise.reject(new Error("not allowed"));
    const sound = createSuccessSound({ storage: memoryStorage(), createContext: () => context });
    expect(() => sound.prepare()).not.toThrow();
    context.createOscillator = () => { throw new Error("broken"); };
    expect(sound.play()).toBe(false);
  });
});

describe("success sound preference", () => {
  it("is on by default and off only when stored as off", () => {
    expect(isSuccessSoundEnabled(memoryStorage())).toBe(true);
    expect(isSuccessSoundEnabled(memoryStorage({ [SUCCESS_SOUND_PREFERENCE_KEY]: "on" }))).toBe(true);
    expect(isSuccessSoundEnabled(memoryStorage({ [SUCCESS_SOUND_PREFERENCE_KEY]: "off" }))).toBe(false);
    // Ein unbekannter Wert schaltet den Ton nicht aus.
    expect(isSuccessSoundEnabled(memoryStorage({ [SUCCESS_SOUND_PREFERENCE_KEY]: "maybe" }))).toBe(true);
  });

  it("saves the choice", () => {
    const storage = memoryStorage();
    setSuccessSoundEnabled(false, storage);
    expect(isSuccessSoundEnabled(storage)).toBe(false);
    setSuccessSoundEnabled(true, storage);
    expect(isSuccessSoundEnabled(storage)).toBe(true);
  });

  it("falls back to on when the storage cannot be read or written", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(isSuccessSoundEnabled(broken)).toBe(true);
    expect(() => setSuccessSoundEnabled(false, broken)).not.toThrow();
    expect(isSuccessSoundEnabled(undefined)).toBe(true);
  });
});
