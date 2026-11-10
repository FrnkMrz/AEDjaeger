import { describe, expect, it } from "vitest";
import { moveMapCenter, projectCoordinate, unprojectPixel, zoomToFitMarkers } from "../src/map/positionPicker";

describe("OSM position map projection", () => {
  it("round-trips a normal latitude and longitude at the app's zoom level", () => {
    const position = { latitude: 52.52, longitude: 13.405 };
    const restored = unprojectPixel(projectCoordinate(position, 19), 19);
    expect(restored.latitude).toBeCloseTo(position.latitude, 7);
    expect(restored.longitude).toBeCloseTo(position.longitude, 7);
  });

  it("moves the chosen point under the fixed marker when the map is panned", () => {
    const origin = { latitude: 52.52, longitude: 13.405 };
    const moved = moveMapCenter(origin, 20, 0, 19);
    expect(moved.longitude).toBeLessThan(origin.longitude);
    expect(moved.latitude).toBeCloseTo(origin.latitude, 7);
  });

  it("clamps polar coordinates to the Web Mercator tile range", () => {
    const pixel = projectCoordinate({ latitude: 90, longitude: 0 }, 19);
    const restored = unprojectPixel(pixel, 19);
    expect(restored.latitude).toBeLessThan(86);
    expect(restored.latitude).toBeGreaterThan(85);
  });
});

describe("Zoomstufe für die Umgebungskarte mit AED-Markern", () => {
  const center = { latitude: 52.52, longitude: 13.405 };

  it("bleibt ohne Marker auf der nächsten Zoomstufe", () => {
    expect(zoomToFitMarkers(center, [], 300, 225)).toBe(19);
  });

  it("zoomt so weit heraus, dass ein etwa 100 m entfernter AED noch im Kartenfenster liegt", () => {
    // Rund 100 m nördlich des gesuchten Standorts (0,0009 Grad Breite).
    const marker = { position: { latitude: 52.5209, longitude: 13.405 }, label: "1" };
    const zoom = zoomToFitMarkers(center, [marker], 300, 225);
    expect(zoom).toBeLessThan(19);
    const offset = Math.abs(projectCoordinate(marker.position, zoom).y - projectCoordinate(center, zoom).y);
    // Der Marker liegt innerhalb der halben Kartenhöhe abzüglich des Randabstands (36 px) ...
    expect(offset).toBeLessThanOrEqual(225 / 2 - 36);
    // ... und eine Zoomstufe näher würde er nicht mehr hineinpassen (es wird nicht unnötig herausgezoomt).
    const closer = Math.abs(projectCoordinate(marker.position, zoom + 1).y - projectCoordinate(center, zoom + 1).y);
    expect(closer).toBeGreaterThan(225 / 2 - 36);
  });
});
