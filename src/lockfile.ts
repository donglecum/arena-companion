export interface Lockfile {
  name: string;
  pid: number;
  port: number;
  password: string;
  protocol: string;
}

/** Parse LCU lockfile content: name:pid:port:password:protocol */
export function parseLockfile(content: string): Lockfile {
  const parts = content.trim().split(':');
  if (parts.length !== 5) {
    throw new Error(`Invalid lockfile: expected 5 fields, got ${parts.length}`);
  }
  const [name, pidStr, portStr, password, protocol] = parts;
  const pid = Number(pidStr);
  const port = Number(portStr);
  if (!name || !Number.isInteger(pid) || !Number.isInteger(port) || !password || !protocol) {
    throw new Error('Invalid lockfile: bad field values');
  }
  return { name, pid, port, password, protocol };
}

/** Lockfile string with the password field redacted, safe for logs/chat. */
export function redactLockfile(content: string): string {
  try {
    const lf = parseLockfile(content);
    return `${lf.name}:${lf.pid}:${lf.port}:<redacted>:${lf.protocol}`;
  } catch {
    return '<unparseable lockfile — fully redacted>';
  }
}
