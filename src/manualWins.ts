import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './scan.ts';
import type { TrackerApi } from './trackerApi.ts';

// Manual wins are saved on this PC first and synced to arena-tracker when it
// accepts them. The tracker can refuse a write (it answers `not_found` for
// players it doesn't know), so a mark must never depend on it. The local file
// records each change as champion id → marked / unmarked, which lets a removal
// here override a mark the tracker still holds.

export type ManualMarks = Record<string, boolean>;

function marksPath(cacheDir: string, playerKey: string) {
  return path.join(cacheDir, `manual-${encodeURIComponent(playerKey)}.json`);
}

export function loadManualMarks(cacheDir: string, playerKey: string): ManualMarks {
  try {
    const parsed = JSON.parse(fs.readFileSync(marksPath(cacheDir, playerKey), 'utf8'));
    const marks: ManualMarks = {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [id, marked] of Object.entries(parsed)) if (typeof marked === 'boolean') marks[id] = marked;
    }
    return marks;
  } catch {
    return {};
  }
}

export function saveManualMark(cacheDir: string, playerKey: string, champion: string, marked: boolean) {
  const marks = loadManualMarks(cacheDir, playerKey);
  marks[champion] = marked;
  fs.mkdirSync(cacheDir, { recursive: true });
  writeFileAtomic(marksPath(cacheDir, playerKey), JSON.stringify(marks));
}

/** The tracker's manual wins with this PC's marks and removals applied on top. */
export function mergeManualWins(remote: Iterable<string>, local: ManualMarks): Set<string> {
  const wins = new Set(remote);
  for (const [id, marked] of Object.entries(local)) {
    if (marked) wins.add(id);
    else wins.delete(id);
  }
  return wins;
}

/** Manual wins for a scan: the tracker's list when it answers, always merged with the local marks. */
export async function manualWinsFor(api: Pick<TrackerApi, 'getManualWins'>, cacheDir: string, playerKey: string): Promise<Set<string>> {
  let remote: string[] = [];
  try {
    const list = await api.getManualWins(playerKey);
    if (Array.isArray(list)) remote = list.filter((id): id is string => typeof id === 'string');
  } catch (err) {
    console.log(`[manual] arena-tracker manual wins unavailable, using this PC's marks: ${String(err).slice(0, 160)}`);
  }
  return mergeManualWins(remote, loadManualMarks(cacheDir, playerKey));
}
