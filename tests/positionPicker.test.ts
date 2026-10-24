import { describe, expect, it } from "vitest";
import { moveMapCenter, projectCoordinate, unprojectPixel } from "../src/map/positionPicker";

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
