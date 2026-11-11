import { describe, expect, it, vi } from "vitest";
import { askForLocationOnce, LOCATION_PROMPTED_KEY, readLocationPermission, watchLocationPermission, type LocationPermission } from "../src/location/phoneLocationPermission";

/** Ein Ersatz für navigator.permissions, dessen Zustand sich im Test ändern lässt. */
function fakePermissions(initial: string) {
  const status = {
    state: initial,
    listeners: new Set<() => void>(),
    addEventListener(_type: "change", listener: () => void) { status.listeners.add(listener); },
    removeEventListener(_type: "change", listener: () => void) { status.listeners.delete(listener); },
  };
  return { status, api: { query: vi.fn(async () => status) } };
}

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, api: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } } };
}

describe("readLocationPermission", () => {
  it.each(["granted", "denied", "prompt"])("passes through the %s state", async (state) => {
    expect(await readLocationPermission(fakePermissions(state).api)).toBe(state);
  });

  it("reports unknown for an unexpected state, a missing API or a failing query", async () => {
    expect(await readLocationPermission(fakePermissions("surprise").api)).toBe("unknown");
    expect(await readLocationPermission(undefined)).toBe("unknown");
    expect(await readLocationPermission({ query: vi.fn(async () => { throw new TypeError("geolocation is not a valid name"); }) })).toBe("unknown");
  });
});

describe("watchLocationPermission", () => {
  it("reports the current state and every later change, and stops on request", async () => {
    const { status, api } = fakePermissions("prompt");
    const seen: LocationPermission[] = [];
    const stop = await watchLocationPermission((permission) => seen.push(permission), api);
    expect(seen).toEqual(["prompt"]);

    status.state = "granted";
    status.listeners.forEach((listener) => listener());
    expect(seen).toEqual(["prompt", "granted"]);

    stop();
    expect(status.listeners.size).toBe(0);
    status.state = "denied";
    status.listeners.forEach((listener) => listener());
    expect(seen).toEqual(["prompt", "granted"]);
  });

  it("does nothing without browser support", async () => {
    const onChange = vi.fn();
    await (await watchLocationPermission(onChange, undefined))();
    expect(onChange).not.toHaveBeenCalled();
    const failing = { query: vi.fn(async () => { throw new TypeError("unsupported"); }) };
    await (await watchLocationPermission(onChange, failing))();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("askForLocationOnce", () => {
  const geolocation = () => ({ getCurrentPosition: vi.fn() });

  it.each<LocationPermission>(["prompt", "unknown"])("asks once while the browser has not decided (%s) and remembers it first", (permission) => {
    const storage = fakeStorage();
    const geo = geolocation();
    // Beim Aufruf von getCurrentPosition muss der Merker schon gesetzt sein.
    geo.getCurrentPosition.mockImplementation(() => { expect(storage.data.get(LOCATION_PROMPTED_KEY)).toBe("1"); });

    expect(askForLocationOnce({ permission, storage: storage.api, geolocation: geo })).toBe(true);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    // Zweiter Start: Der Merker verhindert eine weitere Anfrage.
    expect(askForLocationOnce({ permission, storage: storage.api, geolocation: geo })).toBe(false);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it.each<LocationPermission>(["granted", "denied"])("never asks when the person already decided (%s)", (permission) => {
    const storage = fakeStorage();
    const geo = geolocation();
    expect(askForLocationOnce({ permission, storage: storage.api, geolocation: geo })).toBe(false);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(storage.data.size).toBe(0);
  });

  it("does not ask again after a dismissed dialog", () => {
    const geo = geolocation();
    // Die Person wischt den Dialog weg: Fehler-Rückruf, kein Ergebnis. Der Merker bleibt trotzdem gesetzt.
    geo.getCurrentPosition.mockImplementation((_ok: unknown, fail: (error: unknown) => void) => fail({ code: 1 }));
    const storage = fakeStorage();
    expect(askForLocationOnce({ permission: "prompt", storage: storage.api, geolocation: geo })).toBe(true);
    expect(askForLocationOnce({ permission: "prompt", storage: storage.api, geolocation: geo })).toBe(false);
  });

  it("does not ask when the browser storage is unusable, so it can never repeat on every start", () => {
    const geo = geolocation();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => undefined };
    expect(askForLocationOnce({ permission: "prompt", storage: broken, geolocation: geo })).toBe(false);
    const readOnly = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(askForLocationOnce({ permission: "prompt", storage: readOnly, geolocation: geo })).toBe(false);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("does nothing without a geolocation API", () => {
    expect(askForLocationOnce({ permission: "prompt", storage: fakeStorage().api, geolocation: undefined })).toBe(false);
  });

  it("reports a grant but never keeps or passes on the position", () => {
    const geo = geolocation();
    const onGranted = vi.fn();
    geo.getCurrentPosition.mockImplementation((ok: (position: unknown) => void) => ok({ coords: { latitude: 52.52, longitude: 13.4 } }));
    askForLocationOnce({ permission: "prompt", storage: fakeStorage().api, geolocation: geo, onGranted });
    // onGranted bekommt keine Argumente: Die Koordinaten verlassen das Modul nicht.
    expect(onGranted).toHaveBeenCalledWith();
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it("does not report a grant when the request fails", () => {
    const geo = geolocation();
    const onGranted = vi.fn();
    geo.getCurrentPosition.mockImplementation((_ok: unknown, fail: (error: unknown) => void) => fail({ code: 1 }));
    askForLocationOnce({ permission: "prompt", storage: fakeStorage().api, geolocation: geo, onGranted });
    expect(onGranted).not.toHaveBeenCalled();
  });
});
