// Data layer: /api/status every few seconds; matches and insights only when
// the checklist changes (a scan, a manual win, another player), so the poll
// stays light.
export const state = { status: null, matches: null, insights: null, reachable: true, loadedAt: 0 };

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => { for (const fn of listeners) fn(state); };

export async function getJson(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
  return body;
}

export const postJson = (url, body) =>
  getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

let dataKey = '';
let insightsAt = 0;
let inFlight = null;

async function loadDerived(force) {
  const s = state.status;
  const key = [s?.player, s?.lastSync, s?.checklist?.wonCount, (s?.cards ?? []).filter((c) => c.manual).length].join('|');
  // Insights depend on the clock too (sessions expire, "this week" moves).
  if (!force && key === dataKey && Date.now() - insightsAt < 5 * 60_000) return;
  const matchesChanged = key !== dataKey || !state.matches;
  dataKey = key;
  insightsAt = Date.now();
  const [matches, insights] = await Promise.all([
    matchesChanged ? getJson('/api/matches').catch(() => null) : Promise.resolve(null),
    getJson('/api/insights').catch(() => null),
  ]);
  if (matches) state.matches = matches.matches;
  if (insights !== null || !s?.checklist) state.insights = insights;
}

export function refresh({ force = false } = {}) {
  if (inFlight && !force) return inFlight;
  inFlight = (async () => {
    try {
      state.status = await getJson('/api/status');
      state.reachable = true;
      await loadDerived(force);
      state.loadedAt = Date.now();
    } catch {
      state.reachable = false; // keep the last data on screen
    }
    emit();
  })().finally(() => { inFlight = null; });
  return inFlight;
}
