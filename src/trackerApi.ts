// Ported from arena-tracker src/lib/api.js — same endpoints, but with an
// explicit base URL instead of browser-relative fetches.

const REQUEST_TIMEOUT_MS = 60_000;

export function makeTrackerApi(baseUrl: string) {
  const riot = (host: string, pathAndQuery: string) => `${baseUrl}/api/riot/${host}/${pathAndQuery}`;

  async function getJSON(url: string, options?: RequestInit): Promise<any> {
    // Match batches fan out to Riot on the tracker side, so allow a generous timeout.
    const res = await fetch(url, { ...options, signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await res.text();
    let body: any;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = (body && body.status && body.status.message) || (body && body.error) || `HTTP ${res.status}`;
      const err = new Error(msg) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return body;
  }

  return {
    getJSON,
    resolveAccount: (cluster: string, gameName: string, tagLine: string) =>
      getJSON(
        riot(cluster, `riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`),
      ),
    getMatchIds: (cluster: string, puuid: string, start: number, count: number) =>
      getJSON(riot(cluster, `lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`)),
    getMatchSummaries: (cluster: string, ids: string[], identity: unknown) =>
      getJSON(`${baseUrl}/api/match-summaries/${cluster}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, identity }),
      }),
    getMasteries: async (platform: string, puuid: string) => {
      try {
        const rows = await getJSON(riot(platform, `lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}`));
        const byId: Record<string, { level: number; points: number }> = {};
        for (const m of rows || []) byId[m.championId] = { level: m.championLevel, points: m.championPoints };
        return byId;
      } catch {
        return {};
      }
    },
    getManualWins: (stableKey: string): Promise<string[]> =>
      getJSON(`${baseUrl}/api/manual-wins/${encodeURIComponent(stableKey)}`),
    addManualWin: (stableKey: string, champion: string) =>
      getJSON(`${baseUrl}/api/manual-wins/${encodeURIComponent(stableKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ champion }),
      }),
    removeManualWin: (stableKey: string, champion: string) =>
      getJSON(`${baseUrl}/api/manual-wins/${encodeURIComponent(stableKey)}/${encodeURIComponent(champion)}`, {
        method: 'DELETE',
      }),
  };
}

export type TrackerApi = ReturnType<typeof makeTrackerApi>;
