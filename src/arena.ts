export interface ChampionInfo {
  id: number;
  key: string;
  name: string;
}

export type WinSource = 'match-history' | 'manual' | 'none';

export interface ChampionStatus extends ChampionInfo {
  won: boolean;
  source: WinSource;
}

export interface BuildStatusInput {
  champions: ChampionInfo[];
  /** Champion IDs with placement===1 found in retained match history (may contain duplicates). */
  scannedWins: number[];
  /** Champion IDs manually marked as won. */
  manualWins: number[];
}

/**
 * Aggregate per-champion Arena win status.
 * A champion is won if it appears in match history OR manual marks.
 * Match history takes precedence as the source; manual-only wins are 'manual'.
 */
export function buildChampionStatus(input: BuildStatusInput): ChampionStatus[] {
  const scanned = new Set(input.scannedWins);
  const manual = new Set(input.manualWins);
  return input.champions.map((c) => {
    if (scanned.has(c.id)) return { ...c, won: true, source: 'match-history' as const };
    if (manual.has(c.id)) return { ...c, won: true, source: 'manual' as const };
    return { ...c, won: false, source: 'none' as const };
  });
}
