import { REGIONS } from './regions.ts';

export interface CompanionConfig {
  /** Riot ID override; both halves are set or both are absent. */
  gameName?: string;
  tagLine?: string;
  /** Region override; absent means auto-detect from the League client. */
  regionLabel?: string;
  miniMode?: boolean; // start champ-select view in mini mode
  alwaysOnTop?: boolean;
}

export const DEFAULT_CONFIG: CompanionConfig = {
  miniMode: false,
  alwaysOnTop: false,
};

const MAX_RIOT_ID_PART = 64;

export type ConfigPatchResult =
  | { ok: true; set: CompanionConfig; clear: (keyof CompanionConfig)[] }
  | { ok: false; error: string };

/**
 * Validate a config patch. Unknown keys are ignored; `null` or '' clears the
 * Riot ID or the region override. Strict mode (API writes) rejects a bad value;
 * lenient mode (loading the saved file) drops it so one bad key cannot brick startup.
 */
export function normalizeConfigPatch(input: unknown, lenient = false): ConfigPatchResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return lenient ? { ok: true, set: {}, clear: [] } : { ok: false, error: 'config must be an object' };
  }
  const src = input as Record<string, unknown>;
  const set: CompanionConfig = {};
  const clear: (keyof CompanionConfig)[] = [];
  const errors: string[] = [];
  const isBlank = (v: unknown) => v === null || (typeof v === 'string' && v.trim() === '');

  if ('gameName' in src || 'tagLine' in src) {
    const { gameName, tagLine } = src;
    const valid = (v: unknown) => typeof v === 'string' && v.trim() !== '' && v.trim().length <= MAX_RIOT_ID_PART;
    if (isBlank(gameName) && isBlank(tagLine)) {
      clear.push('gameName', 'tagLine');
    } else if (valid(gameName) && valid(tagLine)) {
      set.gameName = (gameName as string).trim();
      set.tagLine = (tagLine as string).trim().replace(/^#/, '');
    } else {
      errors.push('Riot ID must have both a name and a tag (Name#TAG)');
    }
  }

  if ('regionLabel' in src) {
    const region = src.regionLabel;
    if (isBlank(region)) clear.push('regionLabel');
    else if (typeof region === 'string' && REGIONS.some((r) => r.label === region.trim().toUpperCase())) {
      set.regionLabel = region.trim().toUpperCase();
    } else errors.push(`unknown region: ${String(region).slice(0, 20)}`);
  }

  for (const key of ['miniMode', 'alwaysOnTop'] as const) {
    if (!(key in src)) continue;
    if (typeof src[key] === 'boolean') set[key] = src[key];
    else errors.push(`${key} must be a boolean`);
  }

  if (errors.length && !lenient) return { ok: false, error: errors.join('; ') };
  return { ok: true, set, clear };
}

/** Apply a validated patch to a config, returning a new object. */
export function applyConfigPatch(config: CompanionConfig, patch: { set: CompanionConfig; clear: (keyof CompanionConfig)[] }): CompanionConfig {
  const next: CompanionConfig = { ...config, ...patch.set };
  for (const key of patch.clear) delete next[key];
  return next;
}

/**
 * Build the effective config from the saved file's parsed JSON.
 * Before region auto-detection, every save wrote the implicit default
 * `regionLabel: "NA"` (the UI had no region setting), so a saved "NA" is
 * dropped and the region is detected instead.
 */
export function loadConfig(saved: unknown): CompanionConfig {
  const result = normalizeConfigPatch(saved, true);
  const patch = result.ok ? result : { set: {}, clear: [] };
  const config = applyConfigPatch({ ...DEFAULT_CONFIG }, patch);
  if (config.regionLabel === 'NA') delete config.regionLabel;
  return config;
}
