/** A bounded request or provider response exceeded its declared byte budget. */
export class BodyTooLargeError extends Error {}

/** Keep JSON replies private from caches and disable content-type sniffing. */
export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders,
    },
  });
}

/** Reject cross-site requests even when older clients omit the Origin header. */
export function isCrossOrigin(request: Request, expectedOrigin: string): boolean {
  const origin = request.headers.get("Origin");
  return (origin !== null && origin !== expectedOrigin) || request.headers.get("Sec-Fetch-Site") === "cross-site";
}

/** Parse exactly one bounded session cookie; duplicate names are ambiguous and rejected. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header || header.length > 8_192) return null;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
}

/** Read a stream only up to its declared application limit, even without Content-Length. */
export async function readLimitedBody(source: Request | Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = source.headers.get("Content-Length");
  if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    throw new BodyTooLargeError();
  }
  if (!source.body) return new Uint8Array();

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readLimitedText(response: Response, maximumBytes: number): Promise<string> {
  const body = await readLimitedBody(response, maximumBytes);
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
