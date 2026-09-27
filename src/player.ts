/** Normalized player identity used across arena-tracker APIs: `region:gameName#tagLine` (lowercase). */
export function normalizePlayerKey(region: string, riotId: string): string {
  const r = region.trim().toLowerCase();
  const id = riotId.trim().toLowerCase();
  const hash = id.lastIndexOf('#');
  if (hash <= 0 || hash === id.length - 1) {
    throw new Error(`Riot ID must include a tag (gameName#tagLine): ${riotId}`);
  }
  return `${r}:${id}`;
}

export function parsePlayerKey(playerKey: string): { region: string; gameName: string; tagLine: string } {
  const colon = playerKey.indexOf(':');
  const hash = playerKey.lastIndexOf('#');
  if (colon <= 0 || hash <= colon + 1 || hash === playerKey.length - 1) {
    throw new Error(`Invalid playerKey: ${playerKey}`);
  }
  return {
    region: playerKey.slice(0, colon),
    gameName: playerKey.slice(colon + 1, hash),
    tagLine: playerKey.slice(hash + 1),
  };
}
