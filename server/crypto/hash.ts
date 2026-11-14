/** Hash bytes or text with SHA-256; callers choose how the digest is represented. */
export async function sha256Bytes(value: string | Uint8Array, cryptoApi: Crypto = crypto): Promise<Uint8Array> {
  const source = typeof value === "string" ? new TextEncoder().encode(value) : value;
  // Copy into a fresh ArrayBuffer so Web Crypto receives a BufferSource backed
  // by an ordinary ArrayBuffer, even if a caller supplied shared memory.
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return new Uint8Array(await cryptoApi.subtle.digest("SHA-256", bytes.buffer));
}

export async function sha256Hex(value: string, cryptoApi: Crypto = crypto): Promise<string> {
  return Array.from(await sha256Bytes(value, cryptoApi), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
