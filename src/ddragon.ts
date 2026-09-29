export interface DDragonChampion {
  id: string; // ddragon id, e.g. "MonkeyKing"
  key: string; // numeric key as string, e.g. "62"
  name: string; // display name, e.g. "Wukong"
  image: string; // portrait filename
  title: string; // e.g. "the Nine-Tailed Fox"
  tags: string[]; // classes, e.g. ["Mage", "Assassin"]
}

const FETCH_TIMEOUT_MS = 15_000;
const CACHE_MAX_AGE_MS = 6 * 3600_000;

/** Flatten a ddragon champion.json payload into a sorted list. */
export function parseChampions(payload: unknown): DDragonChampion[] {
  const data = (payload as { data?: Record<string, any> } | null)?.data;
  if (!data || Object.keys(data).length === 0) {
    throw new Error('Invalid ddragon champion payload');
  }
  return Object.values(data)
    .map((c) => ({
      id: c.id,
      key: String(c.key),
      name: c.name,
      image: c.image?.full ?? `${c.id}.png`,
      title: typeof c.title === 'string' ? c.title : '',
      tags: Array.isArray(c.tags) ? c.tags.filter((t: unknown) => typeof t === 'string') : [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ddragon HTTP ${res.status}: ${url}`);
  return res.json();
}

/** Fetch latest game version, then the full champion list. */
export async function fetchChampions(): Promise<{ version: string; champions: DDragonChampion[] }> {
  const versions = (await getJson('https://ddragon.leagueoflegends.com/api/versions.json')) as string[];
  const version = versions[0];
  const champions = parseChampions(await getJson(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`));
  return { version, champions };
}

type ChampionList = Awaited<ReturnType<typeof fetchChampions>>;

/**
 * Memoize a champion fetcher for `maxAgeMs`. Concurrent callers share one
 * request, and a failed fetch is forgotten so the next call retries.
 */
export function cacheChampions(fetcher: () => Promise<ChampionList>, maxAgeMs = CACHE_MAX_AGE_MS, now = () => Date.now()) {
  let cached: { at: number; value: Promise<ChampionList> } | null = null;
  return (): Promise<ChampionList> => {
    if (cached && now() - cached.at < maxAgeMs) return cached.value;
    const entry = { at: now(), value: fetcher() };
    cached = entry;
    entry.value.catch(() => {
      if (cached === entry) cached = null;
    });
    return entry.value;
  };
}

/** The champion list, refetched at most every 6 hours (a patch changes it). */
export const fetchChampionsCached = cacheChampions(fetchChampions);
