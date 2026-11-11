import { describe, expect, it, vi } from "vitest";
import { OBSERVATION_LIMITS, parseVisionObservation, type VisionObservation } from "../src/contracts/visionObservation";
import { explainObservationMismatch, normalizeProviderObservation } from "../server/vision/normalizeObservation";
import { analyzeAedPhoto } from "../server/vision/openai";

const base: VisionObservation = {
  scene: "other_object", device_count: 0, readable_text: [], manufacturer: null, model: null, location_clues: [], image_issues: [],
};

/** Aufbereiten und danach streng prüfen: genau der Weg, den die Antwort des Anbieters nimmt. */
function process(overrides: Record<string, unknown>) {
  return parseVisionObservation(normalizeProviderObservation({ ...base, ...overrides }));
}
function valueOf(overrides: Record<string, unknown>): VisionObservation {
  const result = process(overrides);
  if (!result.ok) throw new Error("Die Beobachtung hätte gültig sein müssen.");
  return result.value;
}

describe("normalizeProviderObservation", () => {
  it("turns line breaks and control characters in text fragments into spaces", () => {
    // Das war der Fall im Handytest: ein Flaschenetikett mit mehrzeiligem Text.
    const value = valueOf({ readable_text: ["ISOPROPANOL\n99,9 %\r\nREINSTALKOHOL", "750\tml"], manufacturer: "MAXXI\nCLEAN" });
    expect(value.readable_text).toEqual(["ISOPROPANOL 99,9 % REINSTALKOHOL", "750 ml"]);
    expect(value.manufacturer).toBe("MAXXI CLEAN");
  });

  it("is rejected by the strict parser alone, which is why the preparation exists", () => {
    expect(parseVisionObservation({ ...base, readable_text: ["a\nb"] }).ok).toBe(false);
  });

  it("shortens long fragments and caps list lengths instead of failing", () => {
    const value = valueOf({
      readable_text: Array.from({ length: 30 }, (_, index) => `${index}`.padEnd(400, "x")),
      location_clues: Array.from({ length: 20 }, () => "Eingang"),
      manufacturer: "H".repeat(500),
    });
    expect(value.readable_text).toHaveLength(OBSERVATION_LIMITS.readableTextItems);
    expect(value.readable_text.every((text) => text.length <= OBSERVATION_LIMITS.textLength)).toBe(true);
    expect(value.location_clues).toHaveLength(OBSERVATION_LIMITS.locationClues);
    expect(value.manufacturer).toHaveLength(OBSERVATION_LIMITS.labelLength);
  });

  it("drops empty and non-text entries and treats an empty label as unreadable", () => {
    const value = valueOf({ readable_text: ["", "  ", 5, null, "AED"], manufacturer: "   ", model: "\n" });
    expect(value.readable_text).toEqual(["AED"]);
    expect(value.manufacturer).toBeNull();
    expect(value.model).toBeNull();
  });

  it("keeps only known image issues, once each", () => {
    expect(valueOf({ image_issues: ["blurry", "blurry", "noisy", 3, "dark"] }).image_issues).toEqual(["blurry", "dark"]);
  });

  describe("when the device count contradicts the scene", () => {
    it("lets a negative scene win and counts zero AED devices", () => {
      // Steckdose und Kopfhörer auf dem Tisch: Das Modell zählt Geräte, meldet aber „anderer Gegenstand“.
      for (const scene of ["other_object", "sign_only", "empty_holder", "enclosure_visible"]) {
        expect(valueOf({ scene, device_count: 3 })).toMatchObject({ scene, device_count: 0 });
      }
    });

    it("keeps the recognized scene and fits the count to it", () => {
      expect(valueOf({ scene: "device_visible", device_count: 0 })).toMatchObject({ scene: "device_visible", device_count: 1 });
      expect(valueOf({ scene: "device_visible", device_count: 3 })).toMatchObject({ scene: "multiple_devices", device_count: 3 });
      expect(valueOf({ scene: "multiple_devices", device_count: 1 })).toMatchObject({ scene: "device_visible", device_count: 1 });
      expect(valueOf({ scene: "multiple_devices", device_count: 0 })).toMatchObject({ scene: "multiple_devices", device_count: 2 });
    });

    it("leaves an unclear scene alone and clamps an oversized count", () => {
      expect(valueOf({ scene: "unclear", device_count: 4 })).toMatchObject({ scene: "unclear", device_count: 4 });
      expect(valueOf({ scene: "multiple_devices", device_count: 99 }).device_count).toBe(OBSERVATION_LIMITS.deviceCount);
    });
  });

  describe("what it deliberately does not repair", () => {
    it.each([
      ["an unknown extra field", { osm_tags: { emergency: "defibrillator" } }],
      ["a scene that does not exist", { scene: "guess" }],
      ["a fractional count", { device_count: 1.5 }],
      ["a text list that is not a list", { readable_text: "AED" }],
      ["a label of the wrong type", { manufacturer: 42 }],
    ])("still rejects %s", (_name, overrides) => {
      expect(process(overrides).ok).toBe(false);
    });

    it("passes a missing field through unchanged so the strict parser rejects it", () => {
      const { model: _removed, ...withoutModel } = base;
      expect(normalizeProviderObservation(withoutModel)).toBe(withoutModel);
      expect(explainObservationMismatch(withoutModel)).toBe("schema_unexpected_keys");
    });

    it("passes non-objects through unchanged", () => {
      for (const input of [null, "text", 7, [], undefined]) expect(normalizeProviderObservation(input)).toBe(input);
    });

    it("never turns a negative scene into a recognized one", () => {
      for (const scene of ["other_object", "sign_only", "empty_holder", "unclear"]) {
        expect(["device_visible", "multiple_devices"]).not.toContain(valueOf({ scene, device_count: 5 }).scene);
      }
    });
  });
});

describe("explainObservationMismatch", () => {
  it.each([
    [null, "schema_not_an_object"],
    [{ ...base, extra: 1 }, "schema_unexpected_keys"],
    [{ ...base, scene: "guess" }, "schema_invalid_scene"],
    [{ ...base, device_count: "1" }, "schema_invalid_count"],
    [{ ...base, readable_text: "x" }, "schema_invalid_text_list"],
    [{ ...base, manufacturer: 1 }, "schema_invalid_label"],
    [{ ...base, location_clues: null }, "schema_invalid_clues"],
    [{ ...base, image_issues: "x" }, "schema_invalid_issues"],
    [base, "schema_mismatch"],
  ])("names the first field that fails (%#)", (input, expected) => {
    expect(explainObservationMismatch(input)).toBe(expected);
  });

  it("only ever returns codes the app accepts for display", () => {
    expect(explainObservationMismatch({ ...base, scene: "guess" })).toMatch(/^[a-z0-9_.-]{1,48}$/u);
  });
});

describe("the check with a photo like the one from the phone test", () => {
  // Ein winziges, aber vollständiges JPEG, damit der Test ohne Netz und ohne Bilddatei auskommt.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
  const answer = (value: unknown) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  })));

  it("returns the scene instead of failing when the label text has line breaks and other devices are counted", async () => {
    const result = await analyzeAedPhoto({ bytes: jpeg, contentType: "image/jpeg" }, "test-secret", answer({
      scene: "other_object", device_count: 2, readable_text: ["ISOPROPANOL\n99,9 %", "750 ml"],
      manufacturer: "MAXXI", model: null, location_clues: ["Schreibtisch"], image_issues: [],
    }));
    expect(result).toMatchObject({ scene: "other_object", device_count: 0, readable_text: ["ISOPROPANOL 99,9 %", "750 ml"] });
  });
});
