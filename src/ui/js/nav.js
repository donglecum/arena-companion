// Destinations: their sidebar order, hash routes and number keys. Pure (no
// DOM), so routing and shortcuts are unit-tested (tests/nav.test.mjs).
//
// The primary list follows the Arena God task: where you stand, what is left,
// every champion, past games. Settings sits apart at the foot of the sidebar,
// and Champ Select is transient — it joins the sidebar only while League is in
// champ select (the route and its number key always work).
export const NAV = [
  { view: 'dashboard', title: 'Overview', icon: 'dashboard', key: '1' },
  { view: 'remaining', title: 'Remaining', icon: 'checklist', key: '2' },
  { view: 'champions', title: 'Champions', icon: 'swords', key: '3' },
  { view: 'history', title: 'Match History', label: 'History', icon: 'history', key: '4' },
  { view: 'settings', title: 'Settings', icon: 'settings', key: '5', slot: 'foot' },
  { view: 'champselect', title: 'Champ Select', icon: 'target', key: '6', slot: 'live' },
];

/** Views with no sidebar entry of their own, shown under a parent. */
export const CHILD_VIEWS = { champion: { title: 'Champion', parent: 'champions' } };

export const DEFAULT_VIEW = 'dashboard';

const KNOWN = new Set([...NAV.map((n) => n.view), ...Object.keys(CHILD_VIEWS)]);

/** `#/champion/Kai'Sa` → { view: 'champion', param: "Kai'Sa" }; anything unknown is the Overview. */
export function parseRoute(hash) {
  const [view, ...rest] = String(hash ?? '').replace(/^#\/?/, '').split('/');
  if (!KNOWN.has(view)) return { view: DEFAULT_VIEW, param: '' };
  let param = rest.join('/');
  try { param = decodeURIComponent(param); } catch { /* a malformed escape stays as typed */ }
  return { view, param };
}

export const hrefFor = (view, param = '') => `#/${view}${param ? `/${encodeURIComponent(param)}` : ''}`;

/** The view a number key opens, or null. */
export function viewForKey(key) {
  return NAV.find((n) => n.key === key)?.view ?? null;
}

/** Title and (for child views) parent of a view. */
export function viewMeta(view) {
  const nav = NAV.find((n) => n.view === view);
  if (nav) return { title: nav.title, parent: null };
  return CHILD_VIEWS[view] ?? { title: NAV[0].title, parent: null };
}

/** The sidebar item to highlight for a view (a champion page lights up Champions). */
export const activeNavView = (view) => CHILD_VIEWS[view]?.parent ?? view;

/** Champ Select joins the sidebar while it is live, or while you are on it. */
export const showLiveNav = (champSelectAvailable, view) => Boolean(champSelectAvailable) || view === 'champselect';
