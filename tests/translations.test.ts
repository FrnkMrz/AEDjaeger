import { describe, expect, it } from "vitest";
import { translations } from "../src/i18n/translations";

describe("first-version UI languages", () => {
  it("includes all six requested languages", () => {
    expect(Object.keys(translations).sort()).toEqual(["de", "en", "es", "fr", "ja", "pl"]);
  });

  it("uses the exact same umlaut-free product name in every language", () => {
    for (const language of Object.keys(translations) as Array<keyof typeof translations>) {
      expect(translations[language].appName).toBe("AEDjaeger");
    }
  });

  it("keeps every visible flow message translated", () => {
    const keys = Object.keys(translations.de) as Array<keyof typeof translations.de>;
    for (const language of Object.keys(translations) as Array<keyof typeof translations>) {
      for (const key of keys) expect(translations[language][key].trim(), `${language}.${key}`).not.toBe("");
      expect(Object.keys(translations[language]).sort()).toEqual([...keys].sort());
    }
  });
});
