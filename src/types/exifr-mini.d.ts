declare module "exifr/dist/mini.esm.mjs" {
  /** Read GPS coordinates from an in-memory image buffer without loading unrelated EXIF fields. */
  export function gps(input: Blob | ArrayBuffer | Uint8Array | DataView): Promise<{ latitude: number; longitude: number } | undefined>;
}
