import { describe, expect, it } from "vitest";
import { translations } from "../src/i18n/translations";
import { translateFlow, type FlowMessageKey } from "../src/i18n/flowTranslations";

describe("first-version UI languages", () => {
  it("includes all six requested languages", () => {
    expect(Object.keys(translations).sort()).toEqual(["de", "en", "es", "fr", "ja", "pl"]);
  });

  it("uses the exact same umlaut-free product name in every language", () => {
    for (const language of Object.keys(translations) as Array<keyof typeof translations>) {
      expect(translations[language].appName).toBe("AEDjaeger");
    }
  });

  it("keeps all photo and search flow copy complete in all six languages", () => {
    const keys = Object.keys(translations.de) as Array<keyof typeof translations.de>;
    const flowKeys = Object.keys(translations.de).length > 0
      ? ["sightingConfirm", "photoDateTitle", "photoDateHelp", "photoDateLabel", "photoDateConfirm", "photoStaysLocal", "photoCheckAction", "photoCheckNotice", "photoChecking", "photoRejectedTitle", "photoRejectedBody", "photoUnclearTitle", "photoUnclearBody", "photoCheckUnavailable", "connectionOff", "photoCheckCode", "photoOverrideAction", "photoOverrideTitle", "photoOverrideBody", "photoOverrideConfirm", "updateAvailable", "updateReload", "buildVersion", "soundToggle", "unnamedAed", "updateLosesPhoto", "updateWaitSave", "locationTitle", "photoLocationMissing", "usePhoneLocation", "chooseMapLocation", "mapLocationHelp", "mapLocationCoordinates", "locationSourcePhoto", "locationSourcePhone", "locationSourceMap", "searchAction", "searchProgress", "searchTitle", "searchPartial", "searchFound", "searchNoMatch", "searchFailedResult", "distance", "locationUnavailable", "locationDenied", "locationUncertain", "searchRateLimited", "searchUnavailable", "searchFailed", "errorInvalidResponse", "errorSignIn", "selectCandidate", "noneMatchAction", "newEntryStart", "newAbsenceConfirm", "overviewMapLabel", "overviewMapLegend", "previewTitle", "previewOldDate", "previewNewDate", "previewUnsupported", "previewUnsupportedShort", "previewNoWrite", "previewBack", "newPreviewAction", "newPreviewTitle", "newPositionConfirm", "newPositionRequired", "newPreviewCoordinates", "newPreviewTags", "newPreviewReviewedCandidates", "newPreviewCaution", "newPreviewFoundCandidate", "newPreviewSearchInvalid", "newPositionMapLabel", "newPositionMapHelp", "newPositionMapPrivacy", "newPositionMapTileError", "newPositionMapZoomIn", "newPositionMapZoomOut", "searchRetry", "searchWait", "return"] as FlowMessageKey[]
      : [];

    for (const language of Object.keys(translations) as Array<keyof typeof translations>) {
      for (const key of keys) expect(translations[language][key].trim(), `${language}.${key}`).not.toBe("");
      expect(Object.keys(translations[language]).sort()).toEqual([...keys].sort());
      for (const key of flowKeys) expect(translateFlow(language, key).trim(), `${language}.${key}`).not.toBe("");
      expect(translateFlow(language, "searchFound", { count: 2 })).not.toContain("{count}");
    }
  });

  // Detailformular (Etappe P2): jeder Text in jeder Sprache vorhanden, die Platzhalter ersetzt, kein Rest in geschweiften Klammern.
  it("keeps the AED detail form copy complete in all six languages", () => {
    const detailKeys = Object.keys(translations.de).length > 0
      ? ["detailsTitle", "detailsIntro", "detailLocationLabel", "detailLocationHint", "detailLocationPlaceholder", "detailLocEntrance", "detailLocFoyer", "detailLocOutside", "detailLocReception", "detailLocStairs", "detailAccessLabel", "detailAccessHint", "detailAccessYes", "detailAccessCustomers", "detailAccessPrivate", "detailUnknown", "detailHoursLabel", "detailHoursHint", "detailHoursAlways", "detailHoursTimes", "detailHoursTextLabel", "detailIndoorLabel", "detailIndoorYes", "detailIndoorNo", "detailLevelLabel", "detailLevelLower", "detailLevelHigher", "detailMoreTitle", "detailMoreOptional", "detailMoreCount", "detailOperatorLabel", "detailPhoneLabel", "detailPhoneHint", "detailDescriptionLabel", "detailRefLabel", "detailNoCode", "detailContinueNone", "detailContinueOne", "detailContinueMany", "detailInvalid", "detailsBackToForm", "detailsBackToMap"] as FlowMessageKey[]
      : [];
    expect(detailKeys).toHaveLength(42);
    for (const language of Object.keys(translations) as Array<keyof typeof translations>) {
      for (const key of detailKeys) expect(translateFlow(language, key).trim(), `${language}.${key}`).not.toBe("");
      // Zähler-Texte: Die Zahl wird eingesetzt, und es bleibt kein Platzhalter stehen.
      for (const key of ["detailContinueMany", "detailMoreCount"] as const) {
        const filled = translateFlow(language, key, { count: 3 });
        expect(filled, `${language}.${key}`).toContain("3");
        expect(filled, `${language}.${key}`).not.toContain("{");
      }
      // Ergänzen bestehender AEDs (Etappe P4): Texte vorhanden, der Platzhalter für den bestehenden Wert wird ersetzt.
      for (const key of ["detailsExistingTitle", "detailsExistingIntro", "detailLoading", "detailLoadFailed", "detailLoadChanged", "detailLoadRetry", "detailsAddAction", "detailsAddedTitle", "detailsAllPresent"] as FlowMessageKey[]) {
        expect(translateFlow(language, key).trim(), `${language}.${key}`).not.toBe("");
      }
      const existing = translateFlow(language, "detailExistingValue", { value: "WERT" });
      expect(existing, language).toContain("WERT");
      expect(existing, language).not.toContain("{");
      // Die Frage nach dem Zugang muss das Gerät meinen; der Hinweis darf in keiner Sprache fehlen oder leer sein.
      expect(translateFlow(language, "detailAccessHint").length, language).toBeGreaterThan(8);
    }
  });
});
