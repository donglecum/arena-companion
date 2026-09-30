import { $, esc, changed, art, chip, statusOf, cardByName, cardById, num } from '../util.js';
import { icon } from '../icons.js';
import '../crowd.js'; // sets globalThis.ArenaCrowd (shared with the overlay)

const MARK = { needed: 'Need', won: 'Won', unknown: '?' };

let miniApplied = false;

export function toggleMini(force) {
  const on = typeof force === 'boolean' ? force : !document.body.classList.contains('mini');
  document.body.classList.toggle('mini', on);
  const btn = document.getElementById('cs-mini');
  if (btn) btn.innerHTML = `${icon('minimize', 15)} ${on ? 'Exit mini' : 'Mini mode'}`;
  return on;
}

function idle(s) {
  return `<div class="empty card cs-idle">
    <div class="empty-icon big">${icon('target', 28)}</div>
    <h2>Waiting for an Arena champ select</h2>
    <p class="sub">When you queue into Arena, the Crowd Favorites panel docks beside the League client automatically. This view shows your pick, its status and the best needed champions you own.</p>
    <div class="cs-idle-meta"><span class="chip ${s?.lcuConnected ? 'won' : 'muted'}">${icon(s?.lcuConnected ? 'zap' : 'offline', 12)}${s?.lcuConnected ? `Client · ${esc(s.gameflowPhase)}` : 'League client offline'}</span></div>
  </div>`;
}

export function renderChampSelect(st) {
  const root = $('view-champselect');
  const s = st.status;
  const cs = s?.champSelect;
  const live = Boolean(cs?.available);
  if (!live) miniApplied = false;
  else if (!miniApplied) {
    // The mini-mode default applies once per champ select, so the button can still undo it.
    miniApplied = true;
    if (s.config?.miniMode) toggleMini(true);
  }
  if (!live) { if (changed(root, `idle|${s?.lcuConnected}|${s?.gameflowPhase}`)) root.innerHTML = idle(s); return; }
  const cur = cs.championName ? cardByName(cs.championName) : null;
  const crowd = globalThis.ArenaCrowd.crowdModel({ ...s, overlayPreview: false });
  const favorites = crowd.rows.map((row) => ({ row, card: cardById(row.name) ?? cardByName(row.name) }));
  const needed = (cs.neededOwned ?? []).map((n) => cardByName(n.name)).filter(Boolean);
  const sig = JSON.stringify([cs.championName, cur?.won, crowd.rows.map((r) => `${r.key}${r.state}`), needed.map((c) => c.id), s.ddragonVersion]);
  if (!changed(root, sig)) return;
  const st8 = cur ? statusOf(cur) : 'unknown';
  root.innerHTML = `
    <section class="cs-hero card ${st8}">
      ${cur ? `<div class="champ-hero-bg">${art(cur, 'splash')}</div>` : ''}
      <div class="cs-hero-body">
        ${cur ? art(cur, 'loading', 'cs-portrait') : `<span class="art k-loading cs-portrait placeholder"><span class="art-fallback">${icon('target', 30)}</span></span>`}
        <div class="cs-hero-text">
          <div class="eyebrow">${icon('zap', 14)} Live · ${cs.isArena ? 'Arena champ select' : 'Champ select'}</div>
          <h1>${cur ? esc(cur.name) : 'Hover a champion…'}</h1>
          <div class="champ-hero-chips">${cur ? chip(st8, icon) : ''}${cur?.masteryLevel ? `<span class="chip mastery">${icon('award', 12)}Mastery ${cur.masteryLevel} · ${num(cur.masteryPoints)} pts</span>` : ''}</div>
          <p class="cs-verdict">${!cur ? 'Your hovered or locked pick shows here.' : st8 === 'needed' ? `${icon('sparkles', 15)} A win on ${esc(cur.name)} counts toward Arena God.` : `${icon('check', 15)} Already won — no new progress from this pick.`}</p>
          <button id="cs-mini" class="btn ghost">${icon('minimize', 15)} ${document.body.classList.contains('mini') ? 'Exit mini' : 'Mini mode'}</button>
        </div>
      </div>
    </section>
    ${favorites.length ? `<section class="card"><header class="card-head"><div><h2>${icon('crown', 16)} Crowd favorites</h2><p class="sub">Also shown in the panel beside the client</p></div>
      <span class="fav-summary ${crowd.tone}">${esc(crowd.summary)}</span></header>
      <div class="fav-row">${favorites.map(({ row, card }) => `<a class="fav ${row.state}" href="${card ? `#/champion/${encodeURIComponent(card.id)}` : '#/champselect'}" aria-label="${esc(row.label)}">
        ${art(card ?? { id: String(row.id), name: row.name }, 'tile', 'fav-art')}<span class="fav-name">${esc(row.name)}</span><span class="fav-mark">${row.state === 'won' ? icon('check', 13) : ''}${MARK[row.state]}</span></a>`).join('')}</div></section>` : ''}
    <section class="section"><header class="section-head"><h2>${icon('target', 16)} Needed &amp; owned</h2><span class="sub">By mastery · a win on any of these is progress</span></header>
      ${needed.length ? `<div class="pick-grid">${needed.slice(0, 18).map((c) => `<a class="pick" href="#/champion/${encodeURIComponent(c.id)}">${art(c, 'splash', 'pick-art')}<span class="pick-body"><b>${esc(c.name)}</b><small>${c.masteryLevel ? `M${c.masteryLevel} · ${num(Math.round((c.masteryPoints || 0) / 1000))}k` : 'New'}${c.games ? ` · ${c.games}g` : ''}</small></span></a>`).join('')}</div>`
        : `<div class="empty-inline">${icon('crown', 16)} Every champion you own is already won.</div>`}
    </section>`;
  $('cs-mini').addEventListener('click', () => toggleMini());
}
