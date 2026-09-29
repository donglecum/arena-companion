import { isEntryPoint } from './entry.ts';
import { makeTrackerApi } from './trackerApi.ts';
import { fetchChampions } from './ddragon.ts';
import { fullScan, update, aggregate, loadStore, saveStore } from './scan.ts';
import { REGIONS, regionByLabel } from './regions.ts';

const CACHE_DIR = process.env.ARENA_CACHE ?? 'cache';

export interface ChecklistOptions {
  trackerBase: string;
  regionLabel: string;
  gameName: string;
  tagLine: string;
  onProgress?: (p: { phase: string; done: number; total: number }) => void;
}

export async function buildChecklist(opts: ChecklistOptions) {
  const api = makeTrackerApi(opts.trackerBase);
  const region = regionByLabel(opts.regionLabel);
  const { gameName, tagLine } = opts;

  let store = loadStore(CACHE_DIR, region.platform, gameName, tagLine);
  if (store) {
    store = await update(api, region, store, opts.onProgress);
  } else {
    store = await fullScan(
      api,
      { region, gameName, tagLine, depth: Number.POSITIVE_INFINITY },
      opts.onProgress,
    );
  }
  saveStore(CACHE_DIR, region.platform, gameName, tagLine, store);

  const { version, champions } = await fetchChampions();
  const masteries = await api.getMasteries(region.platform, store.account.puuid);
  const manual = new Set(await api.getManualWins(`${region.platform}:${gameName.toLowerCase()}#${tagLine.toLowerCase()}`));

  const result = aggregate(store, champions, masteries, manual);
  return { version, store, result };
}

// CLI entry: node src/checklist.ts "Name#TAG" [NA]
if (isEntryPoint(import.meta.url)) {
  const riotId = process.argv[2];
  const regionLabel = process.argv[3] ?? 'NA';
  if (!riotId || !riotId.includes('#')) {
    console.error('usage: node src/checklist.ts "GameName#TAG" [REGION]');
    process.exit(1);
  }
  const hash = riotId.lastIndexOf('#');
  const gameName = riotId.slice(0, hash);
  const tagLine = riotId.slice(hash + 1);

  const { version, store, result } = await buildChecklist({
    trackerBase: process.env.ARENA_TRACKER ?? 'https://arena.scrolab.com',
    regionLabel,
    gameName,
    tagLine,
    onProgress: (p) => {
      if (p.phase === 'matches' && p.done % 100 === 0) process.stderr.write(`\rscanning ${p.done}/${p.total}`);
    },
  });
  process.stderr.write('\n');

  const needed = result.cards.filter((c) => !c.won);
  console.log(`Arena checklist for ${gameName}#${tagLine} (ddragon ${version})`);
  console.log(`Won: ${result.wonCount}/${result.total} champions | Games scanned: ${result.gamesScanned}`);
  console.log(`History exhausted: ${store.historyExhausted ? 'yes' : 'no (older games not retained)'}`);
  console.log(`\nNeeded (${needed.length}):`);
  for (const c of needed) console.log(`  ${c.name}`);
}
