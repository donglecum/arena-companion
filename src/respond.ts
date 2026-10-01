// Response bodies for the local UI/API server: JSON for API answers, raw bytes
// for static files. Bytes must go out untouched: String(buffer) decodes them as
// UTF-8, which silently corrupts fonts and images.

export function responseBody(body: unknown, type: string): string | Uint8Array {
  if (type === 'application/json') return JSON.stringify(body);
  if (body instanceof Uint8Array) return body;
  return String(body);
}
