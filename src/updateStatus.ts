// Auto-update progress, reported by the Electron shell (which runs
// electron-updater) and shown in the UI's sidebar. Validated here because it
// arrives over the local HTTP API.
export type UpdateState = 'downloading' | 'ready' | 'restarting';

export interface UpdateStatus {
  state: UpdateState;
  version: string;
  /** Download progress, 0–100, while downloading. */
  percent?: number;
}

const STATES = new Set<UpdateState>(['downloading', 'ready', 'restarting']);

/** The status to store, `null` to clear it, or `undefined` for an invalid body. */
export function normalizeUpdateStatus(input: unknown): UpdateStatus | null | undefined {
  if (input === null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const { state, version, percent } = input as Record<string, unknown>;
  if (typeof state !== 'string' || !STATES.has(state as UpdateState)) return undefined;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+[\w.+-]{0,24}$/.test(version)) return undefined;
  const status: UpdateStatus = { state: state as UpdateState, version };
  if (state === 'downloading' && typeof percent === 'number' && Number.isFinite(percent)) {
    status.percent = Math.max(0, Math.min(100, Math.round(percent)));
  }
  return status;
}
