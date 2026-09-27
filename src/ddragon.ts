export interface DDragonChampion {
  id: string; // ddragon id, e.g. "MonkeyKing"
  key: string; // numeric key as string, e.g. "62"
  name: string; // display name, e.g. "Wukong"
  image: string; // portrait filename
}

/** Flatten a ddragon champion.json payload into a sorted list. */
export function parseChampions(payload: unknown): DDragonChampion[] {
  const data = (payload as { data?: Record<string, any> } | null)?.data;
  if (!data || Object.keys(data).length === 0) {
    throw new Error('Invalid ddragon champion payload');
  }
  return Object.values(data)
    .map((c) => ({ id: c.id, key: String(c.key), name: c.name, image: c.image?.full ?? `${c.id}.png` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetch latest game version, then the full champion list. */
export async function fetchChampions(): Promise<{ version: string; champions: DDragonChampion[] }> {
  const versions = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json()) as string[];
  const version = versions[0];
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`);
  const champions = parseChampions(await res.json());
  return { version, champions };
}
