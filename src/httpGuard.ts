// Request gate for the local UI/API server. The server binds to loopback only,
// but a browser on this machine can still reach it: any web page may POST to
// http://localhost:8788, and DNS rebinding can make a remote name resolve to
// 127.0.0.1. So every request must name a loopback Host, and state-changing
// requests must come from our own origin (or from a non-browser client, which
// sends no Origin at all).

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True when a Host header is a loopback name on `port` (e.g. "localhost:8788"). */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host.trim().toLowerCase());
  return !!m && LOOPBACK_HOSTS.has(m[1]) && Number(m[2]) === port;
}

/** True when an Origin header is this server's own http://<loopback>:<port>. */
export function isLoopbackOrigin(origin: string, port: number): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname) && Number(u.port) === port;
  } catch {
    return false; // includes the literal "null" origin of sandboxed/file pages
  }
}

export interface GuardInput {
  method?: string;
  headers: { host?: string; origin?: string; 'content-type'?: string };
}

/** Returns a rejection reason, or null when the request may proceed. */
export function rejectRequest(req: GuardInput, port: number): string | null {
  if (!isLoopbackHost(req.headers.host, port)) return 'forbidden host';
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return null;
  const origin = req.headers.origin;
  if (origin !== undefined && !isLoopbackOrigin(origin, port)) return 'forbidden origin';
  return null;
}

/** True for an application/json request body (charset parameters allowed). */
export function isJsonContentType(contentType: string | undefined): boolean {
  return (contentType ?? '').split(';')[0].trim().toLowerCase() === 'application/json';
}
