import { $, esc, changed, art, ordinal, tierOf, relSpan, fmtDate, num, pct, dec, cardById, cardByName, reducedMotion } from '../util.js';
import { icon } from '../icons.js';
import { ring, placementBars, trendChart } from '../charts.js';
import { arenaProgress } from '../progress.js';

let heroCounted = false;

function skeleton() {
  return `<div class="skel-hero skeleton"></div><div class="tiles">${'<div class="tile skeleton"></div>'.repeat(4)}</div>
    <div class="grid-2"><div class="section skeleton tall"></div><div class="section skeleton tall"></div></div>`;
}

function hero(s, ins) {
  const p = arenaProgress(s);
  const newestFirstWin = ins?.session?.newWins?.at(-1) ?? null;
  const backdropCard = cardByName(newestFirstWin) ?? cardByName(s.recent?.[0]?.championName) ?? null;
  const pace = ins?.pace;
  let paceLine = '';
  if (pace?.remaining === 0 || p.complete) paceLine = 'Every champion has a first-place win.';
  else if (pace?.projectedGames) paceLine = `About <b class="num">${num(pace.projectedGames)}</b> more games at your recent pace (a new champion every ${dec(pace.gamesPerNewWin)} games${pace.windowDays ? ` over the last ${pace.windowDays} days` : ''}).`;
  else if (pace) paceLine = 'No new champions recently, so there is no pace estimate yet.';
  const unrecoverable = p.unrecoverable > 0
    ? `<span class="sep">·</span><span class="hb has-tip" title="Wins Riot counts that match history no longer shows. Mark the ones you remember on their champion pages."><b class="num">${p.unrecoverable}</b> unrecoverable</span>`
    : '';
  return `<section class="hero card ${p.complete ? 'complete' : ''}">
    ${backdropCard ? `<div class="hero-backdrop">${art(backdropCard, 'splash')}</div>` : ''}
    <div class="hero-ring">${ring(p.count, p.total)}<div class="hero-ring-label"><span class="hero-count num" id="hero-count">${heroCounted ? p.count : 0}</span><span class="hero-total num">of ${p.total || '–'}</span></div></div>
    <div class="hero-body">
      <div class="eyebrow" title="Adapt to All Situations">Arena God</div>
      <h1 class="hero-title">${p.complete ? 'Arena God unlocked' : `<span class="num">${p.remaining}</span> ${p.remaining === 1 ? 'champion' : 'champions'} to go`}</h1>
      <p class="hero-breakdown"><span class="hb"><b class="num">${p.known ? p.fromHistory : '–'}</b> from match history</span><span class="sep">·</span><span class="hb"><b class="num">${p.known ? p.manual : '–'}</b> marked manually</span>${unrecoverable}</p>
      ${paceLine ? `<p class="hero-pace">${paceLine}</p>` : ''}
    </div>
    <dl class="hero-side">
      <div class="hero-stat"><dt class="label">Official (Riot)</dt><dd class="hero-stat-value gold num">${p.official ?? '–'}</dd></div>
      <div class="hero-stat"><dt class="label">Provable</dt><dd class="hero-stat-value num">${p.known ? p.provable : '–'}</dd></div>
    </dl>
  </section>`;
}

function tile(label, value, sub, href = '') {
  const inner = `<div class="tile-head"><span class="label">${label}</span>${href ? icon('arrowRight', 14, 'tile-go') : ''}</div><div class="tile-value num">${value}</div><div class="tile-sub">${sub}</div>`;
  return href ? `<a class="tile link-tile" href="${href}">${inner}</a>` : `<div class="tile">${inner}</div>`;
}

/** Four numbers for the Arena God grind; streaks and rates live with Form and Placements. */
function tiles(s, ins, matches) {
  const p = arenaProgress(s);
  const ownedNeeded = (s.cards ?? []).filter((c) => c.owned !== false && !c.won).length;
  const first = matches?.length ? matches[matches.length - 1].gameEnd : 0;
  return `<div class="tiles">
    ${tile('New wins in 30 days', num(ins?.newWins30d), ins ? `${num(ins.newWinsThisWeek)} this week` : '&nbsp;')}
    ${tile('Remaining', p.known ? num(p.remaining) : '–', p.known ? (p.complete ? 'Arena God complete' : `${num(ownedNeeded)} of them owned`) : '&nbsp;', '#/remaining')}
    ${tile('Average placement', dec(ins?.avgPlacement), ins?.top4Rate != null ? `Top 4 in ${pct(ins.top4Rate)} of games` : '&nbsp;')}
    ${tile('Games scanned', num(s.checklist?.gamesScanned), first ? `Since ${fmtDate(first, true)}` : 'No games yet')}
  </div>`;
}

function placementsCard(s, ins) {
  const cl = s.checklist;
  const win = cl?.placements?.find((p) => p.placement === 1);
  const last = cl?.placements?.find((p) => p.placement === 8);
  const scanned = Boolean(cl?.gamesScanned);
  return `<section class="section">
    <header class="section-head"><div><h2>Placements</h2><p class="sub">${scanned ? `${num(cl.gamesScanned)} games, ${num(win?.count ?? 0)} first places` : 'No scanned Arena games yet'}</p></div>
      <div class="head-stats">
        <div><div class="label">1st</div><div class="big gold num">${scanned ? pct(win?.percent) : '–'}</div></div>
        <div><div class="label">Top 4</div><div class="big num">${scanned ? pct(ins?.top4Rate) : '–'}</div></div>
        <div><div class="label">8th</div><div class="big coral num">${scanned ? pct(last?.percent) : '–'}</div></div>
      </div></header>
    ${scanned ? placementBars(cl.placements) : '<div class="empty-inline">Run a scan to see how you place.</div>'}
  </section>`;
}

function trendCard(ins) {
  const trend = ins?.trend ?? [];
  const recentAvg = trend.length ? trend.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, trend.length) : null;
  return `<section class="section">
    <header class="section-head"><div><h2>Form</h2><p class="sub">${trend.length ? `Last ${trend.length} games, with a 5-game average` : 'No games yet'}</p></div>
      <div class="head-stats">
        <div><div class="label">Last 10 avg</div><div class="big num">${dec(recentAvg)}</div></div>
        <div title="${ins ? `Best run of 1st places: ${ins.bestWinStreak}` : ''}"><div class="label">Win streak</div><div class="big num">${num(ins?.currentWinStreak)}<small class="big-sub">best ${ins ? num(ins.bestWinStreak) : '–'}</small></div></div>
        <div title="Games in a row placing top 4"><div class="label">Top-4 run</div><div class="big num">${num(ins?.currentTop4Streak)}</div></div>
      </div></header>
    ${trendChart(trend)}
  </section>`;
}

function sessionCard(ins, matches) {
  const se = ins?.session;
  if (!se) return '';
  const games = (matches ?? []).filter((m) => m.gameEnd >= se.startedAt && m.gameEnd <= se.endedAt).reverse();
  return `<section class="section session">
    <header class="section-head"><div><h2>Latest session</h2><p class="sub">Started ${relSpan(se.startedAt)}, last game ${relSpan(se.endedAt)}</p></div></header>
    <div class="session-stats">
      <div><div class="label">Games</div><div class="big num">${se.games}</div></div>
      <div><div class="label">Avg</div><div class="big num">${dec(se.avgPlacement)}</div></div>
      <div><div class="label">Top 4</div><div class="big num">${se.top4}</div></div>
      <div><div class="label">1st</div><div class="big gold num">${se.wins}</div></div>
    </div>
    <div class="session-games">${games.map((m) => {
      const card = cardById(m.championId) ?? { id: m.championId, name: m.championName };
      return `<a class="session-game" href="#/champion/${encodeURIComponent(card.id)}" title="${esc(card.name)} · ${ordinal(m.placement)}">${art(card, 'tile')}<span class="place ${tierOf(m.placement)}">${m.placement ?? '?'}</span></a>`;
    }).join('')}</div>
    ${se.newWins.length ? `<div class="session-wins">New ${se.newWins.length === 1 ? 'champion' : 'champions'}: ${se.newWins.map((n) => `<b>${esc(n)}</b>`).join(', ')}</div>` : '<div class="session-wins muted">No new champions this session.</div>'}
  </section>`;
}

function playNext(ins) {
  const recs = (ins?.recommendations ?? []).map((r) => ({ r, card: cardById(r.id) })).filter((x) => x.card);
  if (!recs.length) return '';
  return `<section class="section">
    <header class="section-head"><div><h2>Play next</h2><p class="sub">Owned and still needed, best fits first</p></div></header>
    <div class="rail-scroll">${recs.map(({ r, card }) => `<a class="rec" href="#/champion/${encodeURIComponent(card.id)}">
      ${art(card, 'splash', 'rec-art')}
      <div class="rec-body"><div class="rec-name">${esc(card.name)}</div><div class="rec-reason">${esc(r.reason)}</div></div>
    </a>`).join('')}</div>
  </section>`;
}

function recentGames(matches) {
  const rows = (matches ?? []).slice(0, 8);
  return `<section class="section">
    <header class="section-head"><h2>Recent games</h2><a class="link" href="#/history">View all</a></header>
    ${rows.length ? `<div class="game-list">${rows.map((m) => gameRow(m)).join('')}</div>` : '<div class="empty-inline">No Arena games scanned yet.</div>'}
  </section>`;
}

export function gameRow(m) {
  const card = cardById(m.championId) ?? { id: m.championId, name: m.championName };
  return `<a class="game-row" href="#/champion/${encodeURIComponent(card.id)}">
    <span class="place ${tierOf(m.placement)}">${m.placement ?? '?'}</span>
    ${art(card, 'tile', 'game-art')}
    <span class="game-name">${esc(card.name)}${m.firstWin ? '<span class="first-win">First win</span>' : ''}</span>
    <span class="game-place">${m.placement ? ordinal(m.placement) : '—'}</span>
    <span class="game-time" title="${esc(new Date(m.gameEnd).toLocaleString())}">${relSpan(m.gameEnd)}</span>
  </a>`;
}

export function renderDashboard(st) {
  const root = $('view-dashboard');
  const s = st.status;
  if (!s) { if (changed(root, 'skeleton')) root.innerHTML = skeleton(); return; }
  const ins = st.insights;
  const sig = JSON.stringify([s.arenaGod, s.checklist, s.ddragonVersion, s.fixture, (s.cards ?? []).map((c) => `${c.id}${c.won ? 1 : 0}${c.manual ? 1 : 0}${c.owned ? 1 : 0}`).join(), ins, st.matches?.length, st.matches?.[0]?.id]);
  if (!changed(root, sig)) return;
  // Progress first (hero, the four numbers, what to play next), then how you place.
  root.innerHTML = `${hero(s, ins)}${tiles(s, ins, st.matches)}
    ${playNext(ins)}
    <div class="grid-2">${placementsCard(s, ins)}${trendCard(ins)}</div>
    <div class="grid-2 wide-left">${recentGames(st.matches)}${sessionCard(ins, st.matches) || '<section class="section"><header class="section-head"><h2>Latest session</h2></header><p class="empty-inline">Play a few games and your session shows up here.</p></section>'}</div>`;
  const countEl = document.getElementById('hero-count');
  const p = arenaProgress(s);
  const target = p.known || p.official !== null ? p.count : null; // count up once there is a number
  if (!heroCounted && Number.isFinite(target) && !reducedMotion()) {
    heroCounted = true;
    const start = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - start) / 1000);
      const el = document.getElementById('hero-count');
      if (el) el.textContent = String(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  } else if (countEl && Number.isFinite(target)) {
    heroCounted = true;
    countEl.textContent = String(target);
  }
}
