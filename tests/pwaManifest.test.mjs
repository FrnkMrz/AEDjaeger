import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Prüft, dass die installierbare App (PWA) vollständige Symbole mitbringt.
// Hintergrund: Android/Chrome verlangt für die Installation PNG-Symbole in 192 und 512 Pixeln,
// und das iPhone nutzt ausschließlich das "apple-touch-icon" aus der index.html.

// Diese Datei ist bewusst reines JavaScript (.mjs): Sie liest Dateien mit Node, und die
// TypeScript-Prüfung des Projekts kennt absichtlich keine Node-Typen.
const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));

/** Liest Breite und Höhe direkt aus dem PNG-Kopf (Bytes 16–23), ohne Bildbibliothek. */
function pngSize(path) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("latin1"), `${path} ist kein PNG`).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("PWA-Symbole", () => {
  it("behält den Produktnamen ohne Umlaute", () => {
    expect(manifest.name).toBe("AEDjaeger");
    expect(manifest.short_name).toBe("AEDjaeger");
  });

  it("verweist nur auf vorhandene Dateien, und jedes PNG hat die angegebene Größe", () => {
    for (const icon of manifest.icons) {
      const path = `public${icon.src}`;
      expect(existsSync(path), `${icon.src} fehlt`).toBe(true);
      if (icon.type === "image/png") {
        const [width, height] = icon.sizes.split("x").map(Number);
        expect(pngSize(path)).toEqual({ width, height });
      }
    }
  });

  it("enthält die für die Installation nötigen PNG-Größen und ein eigenes maskable-Symbol", () => {
    const pngs = manifest.icons.filter((icon) => icon.type === "image/png");
    expect(pngs.some((icon) => icon.sizes === "192x192" && icon.purpose === "any")).toBe(true);
    expect(pngs.some((icon) => icon.sizes === "512x512" && icon.purpose === "any")).toBe(true);
    expect(pngs.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable")).toBe(true);
  });

  it("bindet ein 180-Pixel-Symbol für iPhone und iPad ein", () => {
    expect(readFileSync("index.html", "utf8")).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(pngSize("public/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });
});
