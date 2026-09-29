import { $, esc, changed, art, ordinal, tierOf, relSpan, fmtDate, num, pct, dec, cardById, cardByName, reducedMotion } from '../util.js';
import { icon } from '../icons.js';
import { ring, placementBars, trendChart } from '../charts.js';

let heroCounted = false;

function skeleton() {
  return `<div class="skel-hero skeleton"></div><div class="tiles">${'<div class="tile skeleton"></div>'.repeat(6)}</div>
    <div class="grid-2"><div class="card skeleton tall"></div><div class="card skeleton tall"></div></div>`;
}

function hero(s, ins) {
  const cl = s.checklist;
  const total = cl?.total ?? 0;
  const official = s.arenaGod;
  const count = official ?? cl?.wonCount ?? 0;
  const manual = (s.cards ?? []).filter((c) => c.manual && !c.wins).length;
  const fromHistory = (cl?.wonCount ?? 0) - manual;
  const gap = official != null && cl ? official - cl.wonCount : 0;
  const remaining = Math.max(0, total - count);
  const newestFirstWin = ins?.session?.newWins?.at(-1) ?? null;
  const backdropCard = cardByName(newestFirstWin) ?? cardByName(s.recent?.[0]?.championName) ?? null;
  const pace = ins?.pace;
  let paceLine = '';
  if (pace?.remaining === 0 || remaining === 0) paceLine = `${icon('crown', 15)}<span>Every champion won. Arena God.</span>`;
  else if (pace?.projectedGames) paceLine = `${icon('trend', 15)}<span>At your recent pace, about <b>${num(pace.projectedGames)}</b> more games — one new win every ${dec(pace.gamesPerNewWin)} games${pace.windowDays ? ` over the last ${pace.windowDays} days` : ''}.</span>`;
  else if (pace) paceLine = `${icon('trend', 15)}<span>No new champions won recently — the pace estimate returns after your next first win.</span>`;
  return `<section class="hero card">
    ${backdropCard ? `<div class="hero-backdrop">${art(backdropCard, 'splash')}</div>` : ''}
    <div class="hero-ring">${ring(count, total)}<div class="hero-ring-label"><span class="hero-count num" id="hero-count">${heroCounted ? count : 0}</span><span class="hero-total num">/ ${total || '–'}</span></div></div>
    <div class="hero-body">
      <div class="eyebrow">${icon('crown', 14)} Arena God · Adapt to All Situations</div>
      <h1 class="hero-title">${remaining === 0 && total ? 'Arena God unlocked' : `<span class="num">${remaining}</span> ${remaining === 1 ? 'champion' : 'champions'} to go`}</h1>
      <div class="hero-chips">
        <span class="stat-chip">${icon('history', 14)}<b class="num">${cl ? fromHistory : '–'}</b> from match history</span>
        <span class="stat-chip manual">${icon('pencil', 14)}<b class="num">${cl ? manual : '–'}</b> manual</span>
        ${gap > 0 ? `<span class="stat-chip muted" title="Wins older than Riot's match history retention; mark remembered ones manually.">${icon('info', 14)}<b class="num">${gap}</b> unrecoverable</span>` : ''}
      </div>
      ${paceLine ? `<p class="hero-pace">${paceLine}</p>` : ''}
    </div>
    <div class="hero-side">
      <div class="hero-stat"><div class="label">Official (Riot)</div><div class="hero-stat-value gold num">${official ?? '–'}</div></div>
      <div class="hero-stat"><div class="label">Provable</div><div class="hero-stat-value num">${cl?.wonCount ?? '–'}</div></div>
    </div>
  </section>`;
}

function tile(iconName, label, value, sub, cls = '') {
  return `<div class="tile ${cls}"><div class="tile-head">${icon(iconName, 16)}<span class="label">${label}</span></div><div class="tile-value num">${value}</div><div class="tile-sub">${sub}</div></div>`;
}

function tiles(s, ins, matches) {
  const owned = (s.cards ?? []).filter((c) => c.owned !== false && !c.won).length;
  const first = matches?.length ? matches[matches.length - 1].gameEnd : 0;
  return `<div class="tiles">
    ${tile('layers', 'Games scanned', num(s.checklist?.gamesScanned), first ? `since ${fmtDate(first, true)}` : 'no games yet')}
    ${tile('trophy', 'Win rate', pct(ins?.winRate), ins ? `${num(ins.wins)} first places` : '&nbsp;', 'gold-tile')}
    ${tile('gauge', 'Avg placement', dec(ins?.avgPlacement), ins?.top4Rate != null ? `top 4 in ${pct(ins.top4Rate)}` : '&nbsp;')}
    ${tile('flame', 'Win streak', num(ins?.currentWinStreak), ins ? `best ${ins.bestWinStreak} · top-4 run ${ins.currentTop4Streak}` : '&nbsp;')}
    ${tile('sparkles', 'New this week', num(ins?.newWinsThisWeek), ins ? `${ins.newWins30d} in the last 30 days` : '&nbsp;', 'cyan-tile')}
    ${tile('target', 'Owned, not won', num(owned), 'ready when you are')}
  </div>`;
}

function placementsCard(s) {
  const cl = s.checklist;
  const win = cl?.placements?.find((p) => p.placement === 1);
  const last = cl?.placements?.find((p) => p.placement === 8);
  return `<section class="card">
    <header class="card-head"><div><h2>${icon('award', 16)} Placements</h2><p class="sub">${cl?.gamesScanned ? `Across ${num(cl.gamesScanned)} scanned games` : 'No scanned Arena games yet'}</p></div>
      <div class="head-stats"><div><div class="label">1st</div><div class="big gold num">${cl?.gamesScanned ? pct(win?.percent) : '–'}</div></div><div><div class="label">8th</div><div class="big coral num">${cl?.gamesScanned ? pct(last?.percent) : '–'}</div></div></div></header>
    ${cl?.gamesScanned ? placementBars(cl.placements) : '<div class="empty-inline">Run a scan to see how you place.</div>'}
  </section>`;
}

function trendCard(ins) {
  const trend = ins?.trend ?? [];
  const recentAvg = trend.length ? trend.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, trend.length) : null;
  return `<section class="card">
    <header class="card-head"><div><h2>${icon('trend', 16)} Form</h2><p class="sub">Last ${trend.length || ''} games · line is a 5-game average</p></div>
      <div class="head-stats"><div><div class="label">Last 10 avg</div><div class="big num">${dec(recentAvg)}</div></div></div></header>
    ${trendChart(trend)}
  </section>`;
}

function sessionCard(ins, matches) {
  const se = ins?.session;
  if (!se) return '';
  const games = (matches ?? []).filter((m) => m.gameEnd >= se.startedAt && m.gameEnd <= se.endedAt).reverse();
  return `<section class="card session">
    <header class="card-head"><div><h2>${icon('zap', 16)} Latest session</h2><p class="sub">${relSpan(se.startedAt)} → ${relSpan(se.endedAt)}</p></div></header>
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
    ${se.newWins.length ? `<div class="session-wins">${icon('sparkles', 14)} New: ${se.newWins.map((n) => `<b>${esc(n)}</b>`).join(', ')}</div>` : '<div class="session-wins muted">No new champions this session — yet.</div>'}
  </section>`;
}

function playNext(ins) {
  const recs = (ins?.recommendations ?? []).map((r) => ({ r, card: cardById(r.id) })).filter((x) => x.card);
  if (!recs.length) return '';
  return `<section class="section">
    <header class="section-head"><h2>${icon('target', 16)} Play next</h2><span class="sub">Needed champions you own, by comfort and how you place on their class</span></header>
    <div class="rail-scroll">${recs.map(({ r, card }) => `<a class="rec" href="#/champion/${encodeURIComponent(card.id)}">
      ${art(card, 'splash', 'rec-art')}
      <div class="rec-body"><div class="rec-name">${esc(card.name)}</div><div class="rec-reason">${esc(r.reason)}</div>
      <div class="rec-score"><div class="bar"><div class="bar-fill" style="width:${Math.min(100, r.score)}%"></div></div><span class="num">${Math.round(r.score)}</span></div></div>
    </a>`).join('')}</div>
  </section>`;
}

function recentGames(matches) {
  const rows = (matches ?? []).slice(0, 8);
  return `<section class="card">
    <header class="card-head"><div><h2>${icon('history', 16)} Recent games</h2></div><a class="link" href="#/history">View all ${icon('arrowRight', 14)}</a></header>
    ${rows.length ? `<div class="game-list">${rows.map((m) => gameRow(m)).join('')}</div>` : '<div class="empty-inline">No Arena games scanned yet.</div>'}
  </section>`;
}

export function gameRow(m) {
  const card = cardById(m.championId) ?? { id: m.championId, name: m.championName };
  return `<a class="game-row" href="#/champion/${encodeURIComponent(card.id)}">
    <span class="place ${tierOf(m.placement)}">${m.placement ?? '?'}</span>
    ${art(card, 'tile', 'game-art')}
    <span class="game-name">${esc(card.name)}${m.firstWin ? `<span class="first-win">${icon('sparkles', 12)} First win</span>` : ''}</span>
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
  root.innerHTML = `${hero(s, ins)}${tiles(s, ins, st.matches)}
    <div class="grid-2">${placementsCard(s)}${trendCard(ins)}</div>
    ${playNext(ins)}
    <div class="grid-2 wide-left">${recentGames(st.matches)}${sessionCard(ins, st.matches) || `<section class="card empty-card"><div class="empty-icon">${icon('zap', 22)}</div><h2>No session right now</h2><p class="sub">Your last few hours of Arena show up here after you play.</p></section>`}</div>`;
  const countEl = document.getElementById('hero-count');
  const target = s.arenaGod ?? s.checklist?.wonCount;
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
