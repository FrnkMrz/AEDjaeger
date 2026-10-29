import { describe, expect, it, vi } from "vitest";
import { readPhotoLocation } from "../src/vision/photoLocation";

const photo = new File(["photo"], "photo.jpg", { type: "image/jpeg" });

describe("photo GPS extraction", () => {
  it("returns only valid coordinates and uses bounded uncertainty when EXIF has none", async () => {
    const readGps = vi.fn(async () => ({ latitude: 52.52, longitude: 13.405 }));

    await expect(readPhotoLocation(photo, readGps)).resolves.toEqual({
      latitude: 52.52,
      longitude: 13.405,
      accuracyMeters: 100,
    });
    expect(readGps).toHaveBeenCalledWith(photo);
  });

  it("returns no location for a photo without GPS metadata", async () => {
    await expect(readPhotoLocation(photo, async () => undefined)).resolves.toBeUndefined();
  });

  it("rejects invalid coordinates and ignores parser errors", async () => {
    await expect(readPhotoLocation(photo, async () => ({ latitude: 91, longitude: 13.405 }))).resolves.toBeUndefined();
    await expect(readPhotoLocation(photo, async () => { throw new Error("malformed EXIF"); })).resolves.toBeUndefined();
  });
});
