import https from 'node:https';
import type { Lockfile } from './lockfile.ts';

export interface LcuResponse {
  status: number;
  body: string;
}

/**
 * Minimal read-only LCU client.
 * TLS verification is disabled ONLY for the local 127.0.0.1 LCU connection,
 * which uses Riot's self-signed cert. Never reuse this agent for remote hosts.
 */
export class LcuClient {
  private auth: string;
  private base: string;
  private agent: https.Agent;

  constructor(lockfile: Lockfile) {
    this.auth = 'Basic ' + Buffer.from(`riot:${lockfile.password}`).toString('base64');
    this.base = `${lockfile.protocol}://127.0.0.1:${lockfile.port}`;
    this.agent = new https.Agent({ rejectUnauthorized: false });
  }

  get(path: string, timeoutMs = 5000): Promise<LcuResponse> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        this.base + path,
        { agent: this.agent, headers: { Authorization: this.auth, Accept: 'application/json' } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        },
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`LCU request timed out: ${path}`)));
      req.on('error', reject);
    });
  }

  async getJson(path: string): Promise<{ status: number; json: unknown }> {
    const res = await this.get(path);
    let json: unknown = null;
    try {
      json = JSON.parse(res.body);
    } catch {
      /* non-JSON body (e.g. plain string phases come as JSON strings anyway) */
    }
    return { status: res.status, json };
  }
}

/** Remove sensitive/noisy fields from LCU payloads before logging or saving. */
export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/password|token|secret|auth/i.test(k)) {
        out[k] = '<redacted>';
      } else if (k === 'puuid' && typeof v === 'string') {
        out[k] = v.slice(0, 8) + '…';
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return value;
}
