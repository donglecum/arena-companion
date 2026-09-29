import tls from 'node:tls';
import crypto from 'node:crypto';
import type { Lockfile } from './lockfile.ts';

export interface WsEvent {
  uri: string;
  eventType: string;
}

/** Parsed LCU `[8, "OnJsonApiEvent", { uri, eventType, data }]` payload. */
export interface LcuEvent {
  uri: string;
  eventType: string;
  data: unknown;
}

export interface LcuSubscriberStatus {
  connected: boolean;
  generation: number;
  port: number | null;
  error?: string;
}

export interface LcuSubscriberOptions {
  /** Re-read on every attempt so lockfile rotation (new port/password) is picked up. */
  resolveLockfile: () => Lockfile | null;
  onEvent: (event: LcuEvent) => void;
  /** Called whenever the connection state changes (deduplicated). */
  onStatus?: (status: LcuSubscriberStatus) => void;
  /** Delay between reconnect attempts (default 5000ms). */
  reconnectDelayMs?: number;
  /** false → give up after the first failure instead of reconnecting (default true). */
  retry?: boolean;
  /** Called when the subscriber stops itself after giving up (only with retry: false). */
  onStop?: (error?: string) => void;
}

interface DecodedFrame {
  opcode: number;
  payload?: string;
  remaining?: Buffer;
}

const WAMP_SUBSCRIBE = JSON.stringify([5, 'OnJsonApiEvent']);

function encodeFrame(text: string, opcode = 0x1): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | (opcode & 0x0f), 0x80 | len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/**
 * Decode complete WebSocket frames out of `buf`. The final entry is a sentinel
 * (`opcode: -1`) carrying the unconsumed bytes for the next chunk.
 */
function decodeFrames(buf: Buffer): DecodedFrame[] {
  const out: DecodedFrame[] = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const opcode = buf[offset] & 0x0f;
    const masked = (buf[offset + 1] & 0x80) !== 0;
    let len = buf[offset + 1] & 0x7f;
    let headerLen = 2;
    if (len === 126) {
      if (offset + 4 > buf.length) break;
      len = buf.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (len === 127) {
      if (offset + 10 > buf.length) break;
      len = Number(buf.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (offset + headerLen + maskLen + len > buf.length) break;
    let payload = buf.subarray(offset + headerLen + maskLen, offset + headerLen + maskLen + len);
    if (masked) {
      const mask = buf.subarray(offset + headerLen, offset + headerLen + 4);
      const unmasked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ mask[i % 4];
      payload = unmasked;
    }
    out.push({ opcode, payload: payload.toString('utf8') });
    offset += headerLen + maskLen + len;
  }
  out.push({ opcode: -1, remaining: buf.subarray(offset) });
  return out;
}

/**
 * Long-lived dependency-free LCU WebSocket subscriber (RFC 6455 client).
 * Subscribes to OnJsonApiEvent, re-reads the lockfile on each attempt and
 * reconnects with a delay after failures — so an LCU restart / lockfile
 * rotation self-heals without restarting the process.
 * TLS verification is disabled only for the local LCU socket (self-signed cert).
 * The lockfile password is never logged; statuses carry port/generation only.
 */
export class LcuSubscriber {
  private readonly opts: LcuSubscriberOptions;
  private stopped = true;
  private connectedFlag = false;
  private sock: tls.TLSSocket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private generation = 0;
  private lastStatusKey = '';

  constructor(opts: LcuSubscriberOptions) {
    this.opts = opts;
  }

  get connected(): boolean {
    return this.connectedFlag;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1; // invalidate in-flight attempt callbacks
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const sock = this.sock;
    this.sock = null;
    this.connectedFlag = false;
    if (sock) {
      sock.removeAllListeners();
      try {
        sock.destroy();
      } catch {
        /* already closed */
      }
    }
  }

  private report(status: LcuSubscriberStatus): void {
    const key = `${status.connected}|${status.port ?? ''}|${status.error ?? ''}`;
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    this.opts.onStatus?.(status);
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.opts.reconnectDelayMs ?? 5000);
  }

  private connect(): void {
    if (this.stopped) return;
    const lockfile = this.opts.resolveLockfile();
    if (!lockfile || !Number.isInteger(lockfile.port) || lockfile.port <= 0 || lockfile.port > 65535) {
      this.connectedFlag = false;
      this.report({ connected: false, generation: this.generation, port: null, error: 'no usable lockfile' });
      this.scheduleRetry();
      return;
    }

    const generation = ++this.generation;
    const port = lockfile.port;
    const auth = Buffer.from(`riot:${lockfile.password}`).toString('base64');
    const key = crypto.randomBytes(16).toString('base64');
    let buffer: Buffer = Buffer.alloc(0);
    let upgraded = false;
    let finished = false;

    const sock = tls.connect(
      { host: '127.0.0.1', port, rejectUnauthorized: false },
      () => {
        sock.write(
          `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: wamp\r\n` +
            `Authorization: Basic ${auth}\r\n\r\n`,
        );
      },
    );
    this.sock = sock;

    const finish = (error?: string) => {
      if (finished) return;
      finished = true;
      if (this.sock === sock) this.sock = null;
      try {
        sock.destroy();
      } catch {
        /* already closed */
      }
      if (this.stopped || generation !== this.generation) return;
      this.connectedFlag = false;
      this.report({ connected: false, generation, port, error });
      if (this.opts.retry === false) {
        this.stopped = true;
        this.opts.onStop?.(error);
        return;
      }
      this.scheduleRetry();
    };

    sock.on('error', (err) => finish(String(err)));
    sock.on('close', () => finish(undefined));

    sock.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        if (!/^HTTP\/\d\.\d 101/.test(header)) {
          finish(`WS upgrade rejected: ${header.split('\r\n')[0]}`);
          return;
        }
        upgraded = true;
        buffer = buffer.subarray(headerEnd + 4);
        this.connectedFlag = true;
        this.report({ connected: true, generation, port });
        sock.write(encodeFrame(WAMP_SUBSCRIBE, 0x1));
      }

      const frames = decodeFrames(buffer);
      const rest = frames[frames.length - 1];
      if (rest?.remaining) buffer = rest.remaining;
      for (const frame of frames) {
        if (frame.remaining) continue;
        if (frame.opcode === 0x9) {
          // Ping payloads are echoed byte-for-byte; LCU pings are empty/ASCII.
          sock.write(encodeFrame(frame.payload ?? '', 0xa));
          continue;
        }
        if (frame.opcode === 0x8) {
          finish(undefined);
          return;
        }
        if (frame.opcode !== 0x1 || !frame.payload) continue;
        let arr: unknown;
        try {
          arr = JSON.parse(frame.payload);
        } catch {
          continue; // non-JSON frame
        }
        if (!Array.isArray(arr) || arr[0] !== 8) continue;
        const evt = arr[2] as { uri?: unknown; eventType?: unknown; data?: unknown } | undefined;
        if (!evt || typeof evt.uri !== 'string') continue;
        try {
          this.opts.onEvent({ uri: evt.uri, eventType: String(evt.eventType ?? ''), data: evt.data });
        } catch (err) {
          console.error('[ws] event handler failed:', err instanceof Error ? err.message : String(err));
        }
      }
    });
  }
}

/**
 * One-shot LCU WebSocket subscription: collects event URIs/type for `durationMs`.
 * Used by the probe; gives up immediately on the first connection failure.
 */
export function collectLcuEvents(lockfile: Lockfile, durationMs: number): Promise<{ events: WsEvent[]; error?: string }> {
  const { promise, resolve } = Promise.withResolvers<{ events: WsEvent[]; error?: string }>();
  const events: WsEvent[] = [];
  let error: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  const sub = new LcuSubscriber({
    resolveLockfile: () => lockfile,
    retry: false,
    onEvent: (event) => events.push({ uri: event.uri, eventType: event.eventType }),
    onStatus: (status) => {
      if (!status.connected && status.error) error ??= status.error;
    },
    onStop: () => {
      clearTimeout(timer);
      resolve({ events, error });
    },
  });
  timer = setTimeout(() => {
    sub.stop();
    resolve({ events, error });
  }, durationMs);
  sub.start();
  return promise;
}
