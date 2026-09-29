/* Arena Companion UI — vanilla JS SPA driven by /api/status */
const $ = (id) => document.getElementById(id);
let DATA = null;
let lastEventAt = null;
let ui = { filter: 'needed', sort: 'alpha', search: '', popoverFor: null };

const VIEWS = ['dashboard', 'champions', 'champselect', 'settings'];

function currentView() {
  const h = location.hash.replace('#/', '');
  return VIEWS.includes(h) ? h : 'dashboard';
}

function showView(v) {
  for (const name of VIEWS) $('view-' + name).classList.toggle('hidden', name !== v);
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === v));
}

window.addEventListener('hashchange', () => showView(currentView()));

/* fetch JSON; a non-2xx response throws with the server's error message. */
async function j(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
  return body;
}

const postJson = (url, body) =>
  j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

function portrait(card) {
  if (!DATA?.ddragonVersion || !card?.image) return '';
  return `https://ddragon.leagueoflegends.com/cdn/${DATA.ddragonVersion}/img/champion/${card.image}`;
}

/* Skip an innerHTML rebuild when the rendered content hasn't changed.
   Rebuilding recreates every <img>, resetting them to opacity:0 until
   onload re-fires — that was the 3s icon flicker. */
function changed(el, signature) {
  if (el.dataset.sig === signature) return false;
  el.dataset.sig = signature;
  return true;
}

function chipFor(card) {
  if (!card) return '<span class="chip UNKNOWN">Unknown</span>';
  if (card.won && card.manual && card.wins === 0) return '<span class="chip MANUAL">Manual</span>';
  if (card.won) return '<span class="chip WON">Won</span>';
  return '<span class="chip NEEDED">Needed</span>';
}

/* ---------- dashboard ---------- */
function renderDashboard() {
  const cl = DATA.checklist;
  const god = DATA.arenaGod;
  $('god-count').textContent = god ?? cl?.wonCount ?? '–';
  $('god-total').textContent = cl?.total ?? '–';
  const total = cl?.total || 1;
  $('god-bar').style.width = `${Math.min(100, ((god ?? cl?.wonCount ?? 0) / total) * 100)}%`;
  $('god-official').textContent = god ?? '–';
  $('god-provable').textContent = cl?.wonCount ?? '–';

  if (cl && god != null) {
    const manual = DATA.cards.filter((c) => c.manual && c.wins === 0).length;
    const fromHistory = cl.wonCount - manual;
    const gap = god - cl.wonCount;
    $('god-breakdown').textContent =
      `${fromHistory} from match history + ${manual} manual` +
      (gap > 0 ? ` · ${gap} unrecoverable (pre-retention)` : ' · fully accounted for');
  } else {
    $('god-breakdown').textContent = cl ? '' : 'No checklist yet — press Update scan on the Champions page.';
  }

  $('stat-games').textContent = cl?.gamesScanned ?? '–';
  $('stat-owned').textContent = DATA.ownedCount || '–';
  $('stat-wins').textContent = cl ? `${cl.wonCount}/${cl.total}` : '–';
  const sync = $('stat-sync');
  sync.textContent = DATA.lastSync ? new Date(DATA.lastSync).toLocaleString() : 'never';
  sync.classList.toggle('stale', DATA.stale);

  renderPlacements(cl);

  const strip = $('recent-strip');
  // match-v5 championName drops punctuation ("KogMaw" vs ddragon "Kog'Maw") — normalize.
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const byName = Object.fromEntries(DATA.cards.map((c) => [norm(c.name), c]));
  const stripSig =
    DATA.ddragonVersion + '|' +
    (DATA.recent || []).map((g) => `${g.championName}:${g.placement}:${g.gameEnd}`).join(';');
  if (!changed(strip, stripSig)) return;
  strip.innerHTML = (DATA.recent || [])
    .map((g) => {
      const card = byName[norm(g.championName)];
      const img = portrait(card);
      const p = g.placement;
      const cls = p === 1 ? 'p1' : p <= 4 ? 'p24' : '';
      return `<div class="recent-item" title="${esc(g.championName)} · ${ordinal(p)} · ${new Date(g.gameEnd).toLocaleDateString()}">
        ${img ? `<img src="${esc(img)}" alt="">` : ''}
        <span class="place ${cls}">${esc(p)}</span>
        <div class="rname">${esc(g.championName)}</div></div>`;
    })
    .join('');
}

function ordinal(n) {
  return n + (['th', 'st', 'nd', 'rd'][n % 10 > 3 || ((n % 100) / 10 | 0) === 1 ? 0 : n % 10] || 'th');
}

/* Placements card: percent and game count for each finish, 1st → 8th.
   Rates read '–' until scanned games exist so 0% is never implied. */
function renderPlacements(cl) {
  const entries = (Array.isArray(cl?.placements) ? cl.placements : [])
    .filter((p) => Number.isInteger(p?.placement) && p.placement >= 1 && p.placement <= 8)
    .sort((a, b) => a.placement - b.placement);
  const scanned = Number.isFinite(cl?.gamesScanned) ? cl.gamesScanned : 0;
  const byPlace = new Map(entries.map((p) => [p.placement, p]));
  const pctOf = (n) => {
    const p = byPlace.get(n);
    return scanned && Number.isFinite(p?.percent) ? `${p.percent.toFixed(1)}%` : '–';
  };
  $('placements-win').textContent = pctOf(1);
  $('placements-last').textContent = pctOf(8);
  $('placements-sub').textContent = !scanned
    ? 'No scanned Arena games yet — run Update scan on the Champions page.'
    : entries.length
      ? `Across ${scanned} scanned games · percent and count by finish`
      : 'Placement stats unavailable.';

  const chart = $('placements-chart');
  const max = Math.max(0, ...entries.map((p) => (Number.isFinite(p.percent) ? p.percent : 0)));
  const sig = scanned + '|' + entries.map((p) => `${p.placement}:${p.count}:${p.percent}`).join(';');
  if (!changed(chart, sig)) return;
  chart.innerHTML = scanned && entries.length
    ? entries
        .map(({ placement, count, percent }) => {
          const c = Number.isFinite(count) ? count : 0;
          const pct = Number.isFinite(percent) ? percent : 0;
          const pctText = Number.isFinite(percent) ? `${percent.toFixed(1)}%` : '–';
          const countText = Number.isFinite(count) ? `${count}` : '–';
          const h = max > 0 && c > 0 ? Math.max(4, (pct / max) * 100) : 0;
          const tier = placement === 1 ? 't1' : placement <= 4 ? 't2' : placement === 8 ? 't4' : 't3';
          return `<div class="place-col" title="${ordinal(placement)} place · ${pctText} · ${countText} ${c === 1 ? 'game' : 'games'}">
        <div class="place-pct${placement === 1 ? ' gold' : ''}">${pctText}</div>
        <div class="place-bar"><div class="place-fill ${tier}" style="height:${h.toFixed(1)}%"></div></div>
        <div class="place-label${placement === 1 ? ' gold' : ''}">${ordinal(placement)}</div>
        <div class="place-count">${countText}</div>
      </div>`;
        })
        .join('')
    : '';
}

/* ---------- champions ---------- */
function renderChampions() {
  const grid = $('champ-grid');
  let cards = DATA.cards || [];
  const q = ui.search.toLowerCase();
  if (ui.filter === 'needed') cards = cards.filter((c) => !c.won);
  if (ui.filter === 'won') cards = cards.filter((c) => c.won);
  if (ui.filter === 'manual') cards = cards.filter((c) => c.manual);
  if (q) cards = cards.filter((c) => c.name.toLowerCase().includes(q));
  cards = [...cards].sort((a, b) =>
    ui.sort === 'mastery' ? b.masteryPoints - a.masteryPoints
    : ui.sort === 'recent' ? b.last - a.last
    : a.name.localeCompare(b.name));

  $('champ-count').textContent = `${cards.length} shown`;
  const gridSig =
    `${DATA.ddragonVersion}|${ui.filter}|${ui.sort}|${ui.search}|` +
    cards.map((c) => `${c.name}:${c.won}:${c.manual}:${c.owned}:${c.games}:${c.wins}:${c.masteryLevel}`).join(';');
  if (!changed(grid, gridSig)) return;
  grid.innerHTML = cards
    .map((c) => `<div class="champ-tile ${c.owned === false ? 'unowned' : ''}" data-name="${esc(c.name)}">
      ${c.owned === false ? '<span class="lock">🔒</span>' : ''}
      ${chipFor(c)}
      <img data-src="${esc(portrait(c))}" alt="" onload="this.classList.add('loaded')">
      <div class="cname">${esc(c.name)}</div>
      <div class="csub">${c.masteryLevel ? 'M' + c.masteryLevel + ' · ' : ''}${c.games}g ${c.wins}w</div>
    </div>`)
    .join('');
  // lazy portraits
  for (const img of grid.querySelectorAll('img[data-src]')) {
    img.src = img.dataset.src;
    img.removeAttribute('data-src');
  }
  grid.querySelectorAll('.champ-tile').forEach((t) =>
    t.addEventListener('click', (e) => openPopover(t.dataset.name, e)),
  );
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openPopover(name, e) {
  const card = DATA.cards.find((c) => c.name === name);
  if (!card) return;
  // Only a manual mark can be removed; a match-history win has nothing to toggle.
  const action = card.manual ? 'remove' : card.won ? null : 'add';
  const pop = $('popover');
  pop.innerHTML = `<div class="pname">${esc(card.name)}</div>
    ${chipFor(card)}
    <div class="prow"><span>Games (Arena)</span><b>${card.games}</b></div>
    <div class="prow"><span>Wins</span><b>${card.wins}</b></div>
    <div class="prow"><span>Last played</span><b>${card.last ? new Date(card.last).toLocaleDateString() : '—'}</b></div>
    <div class="prow"><span>Mastery</span><b>${card.masteryLevel ? 'M' + card.masteryLevel + ' · ' + card.masteryPoints.toLocaleString() : '—'}</b></div>
    ${action
      ? `<button class="btn ${action === 'remove' ? 'ghost' : 'primary'}" id="pop-toggle">${action === 'remove' ? 'Remove manual mark' : 'Mark as won (manual)'}</button>`
      : '<div class="pop-msg dim">Won in match history — no manual mark needed.</div>'}
    <div id="pop-msg" class="pop-msg error"></div>`;
  pop.classList.remove('hidden');
  const r = e.currentTarget.getBoundingClientRect();
  pop.style.left = Math.min(window.innerWidth - 250, r.left) + 'px';
  pop.style.top = Math.min(window.innerHeight - 240, r.bottom + 6) + 'px';
  if (!action) return;
  $('pop-toggle').onclick = async () => {
    const btn = $('pop-toggle');
    btn.disabled = true;
    try {
      await j('/api/manual/' + encodeURIComponent(card.id), { method: action === 'remove' ? 'DELETE' : 'POST' });
      pop.classList.add('hidden');
      await tick();
    } catch (err) {
      $('pop-msg').textContent = `Couldn't save: ${err.message}`;
      btn.disabled = false;
    }
  };
}

document.addEventListener('click', (e) => {
  if (!$('popover').classList.contains('hidden') && !$('popover').contains(e.target) && !e.target.closest('.champ-tile')) {
    $('popover').classList.add('hidden');
  }
});

/* ---------- champ select ---------- */
function renderChampSelect() {
  const cs = DATA.champSelect;
  const live = cs && cs.available;
  $('cs-idle').classList.toggle('hidden', live);
  $('cs-live').classList.toggle('hidden', !live);
  if (!live) return;
  if (DATA.config?.miniMode) document.body.classList.add('mini');

  const byName = Object.fromEntries(DATA.cards.map((c) => [c.name, c]));
  const cur = cs.championName ? byName[cs.championName] : null;
  const portraitEl = $('cs-portrait');
  const url = cur ? portrait(cur) : '';
  if (portraitEl.getAttribute('src') !== url) portraitEl.src = url; // don't churn src — resets the image
  portraitEl.style.visibility = cur ? 'visible' : 'hidden';
  $('cs-name').textContent = cs.championName ?? 'Hover a champion…';
  $('cs-status').innerHTML = cur ? chipFor(cur) : '';
  $('cs-mastery').textContent = cur && cur.masteryLevel ? `Mastery ${cur.masteryLevel} · ${cur.masteryPoints.toLocaleString()} pts` : '';

  const neededGrid = $('cs-needed-grid');
  const neededSig =
    DATA.ddragonVersion + '|' +
    (cs.neededOwned || []).map((n) => `${n.name}:${n.masteryLevel || ''}:${byName[n.name]?.won}`).join(';');
  if (!changed(neededGrid, neededSig)) return;
  neededGrid.innerHTML = (cs.neededOwned || [])
    .map((n) => {
      const card = byName[n.name];
      return `<div class="champ-tile" data-name="${esc(n.name)}">
        <span class="chip NEEDED">Needed</span>
        <img src="${esc(portrait(card))}" alt="" onload="this.classList.add('loaded')">
        <div class="cname">${esc(n.name)}</div>
        <div class="csub">${n.masteryLevel ? 'M' + n.masteryLevel : ''}</div>
      </div>`;
    })
    .join('');
  $('cs-needed-grid').querySelectorAll('.champ-tile').forEach((t) =>
    t.addEventListener('click', (e) => openPopover(t.dataset.name, e)),
  );
}

$('btn-mini').onclick = () => document.body.classList.toggle('mini');

/* ---------- settings ---------- */
/* Last toggle failure, kept until the next successful toggle so a status tick
   cannot silently wipe the message. */
let overlayPreviewError = '';

function renderSettings() {
  const cfg = DATA.config || {};
  // Panel preview reflects backend state; sync it even while the Riot ID is focused.
  const preview = DATA.overlayPreview === true;
  const previewBtn = $('btn-overlay-preview');
  previewBtn.textContent = preview ? 'Done' : 'Show panel to position it';
  previewBtn.classList.toggle('primary', preview);
  previewBtn.classList.toggle('ghost', !preview);
  $('overlay-preview-msg').textContent =
    overlayPreviewError || (preview ? 'Drag up or down to set the height beside League, then press Done. Without the client, drag to set a fallback position.' : '');
  $('set-player-cur').textContent = DATA.player ? `(current: ${DATA.player})` : '';
  renderRegionSelect();
  if (document.activeElement === $('set-riotid')) return; // don't clobber typing
  $('set-riotid').value = cfg.gameName ? `${cfg.gameName}#${cfg.tagLine ?? ''}` : '';
  $('set-mini').checked = !!cfg.miniMode;
  $('set-ontop').checked = !!cfg.alwaysOnTop;
  $('set-tracker').value = 'https://arena.scrolab.com';
}

/* Region picker: "Auto-detect" (no override) plus every known region.
   Rebuilt only when its options change; the selection is synced from the
   server unless the user is interacting with it. */
function renderRegionSelect() {
  const sel = $('set-region');
  const region = DATA.region;
  if (!region) return;
  const autoLabel = `Auto-detect${region.detected ? ` (${region.detected})` : ' (client not detected — NA)'}`;
  const sig = autoLabel + '|' + region.options.join(',');
  if (changed(sel, sig)) {
    sel.innerHTML = `<option value="">${esc(autoLabel)}</option>` +
      region.options.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    delete sel.dataset.synced;
  }
  const saved = region.override ?? '';
  if (document.activeElement !== sel && sel.dataset.synced !== saved) {
    sel.value = saved;
    sel.dataset.synced = saved;
  }
}

function flash(msg, ms = 2500) {
  $('settings-msg').textContent = msg;
  if (ms) setTimeout(() => { if ($('settings-msg').textContent === msg) $('settings-msg').textContent = ''; }, ms);
}

$('btn-save').onclick = async () => {
  const riotId = $('set-riotid').value.trim();
  const body = {
    miniMode: $('set-mini').checked,
    alwaysOnTop: $('set-ontop').checked,
    regionLabel: $('set-region').value || null,
  };
  if (!riotId) {
    // An empty field clears the override: back to the account logged into League.
    body.gameName = null;
    body.tagLine = null;
  } else {
    const h = riotId.lastIndexOf('#');
    if (h <= 0 || h === riotId.length - 1) {
      flash('Riot ID must look like Name#TAG (or leave it empty to auto-detect).', 5000);
      return;
    }
    body.gameName = riotId.slice(0, h);
    body.tagLine = riotId.slice(h + 1);
  }
  try {
    await postJson('/api/config', body);
    flash('Saved.');
    await tick();
  } catch (err) {
    flash(`Not saved: ${err.message}`, 6000);
  }
};

$('btn-fullscan').onclick = async () => {
  const btn = $('btn-fullscan');
  btn.disabled = true;
  flash('Full rescan started — this can take several minutes…', 0);
  try {
    const r = await postJson('/api/rescan', { full: true });
    flash(r?.ok ? 'Rescan complete.' : `Rescan failed: ${r?.error ?? 'unknown error'}`, r?.ok ? 2500 : 8000);
  } catch (err) {
    flash(`Rescan failed: ${err.message}`, 8000);
  } finally {
    btn.disabled = false;
    await tick();
  }
};

$('btn-overlay-preview').onclick = async () => {
  const next = DATA?.overlayPreview !== true;
  const btn = $('btn-overlay-preview');
  btn.disabled = true;
  try {
    const res = await postJson('/api/overlay-preview', { enabled: next });
    if (res?.enabled !== next) throw new Error('unexpected response');
    overlayPreviewError = '';
    if (DATA) DATA.overlayPreview = next; // reconcile now; the next status tick confirms
  } catch {
    overlayPreviewError = 'Panel toggle failed — the backend did not accept it.';
  } finally {
    btn.disabled = false;
    if (DATA) renderSettings();
  }
};

/* ---------- shared ---------- */
function renderConn() {
  const version = DATA.version ? `v${DATA.version}` : '';
  if ($('app-version').textContent !== version) $('app-version').textContent = version;
  const pill = $('conn-pill');
  pill.classList.toggle('on', !!DATA.lcuConnected);
  $('conn-text').textContent = DATA.lcuConnected ? `LCU · ${DATA.gameflowPhase}` : 'LCU offline';
}

let toastTimer = null;
function showToast(html, kind, ms) {
  const toast = $('toast');
  toast.className = `toast ${kind}`.trim();
  toast.innerHTML = html;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), ms);
}

function maybeToast() {
  const ev = DATA.lastEvent;
  if (!ev || ev.at === lastEventAt) return;
  lastEventAt = ev.at;
  if (ev.type === 'new-win') {
    showToast(`🏆 First Arena win${ev.champion ? ` on <b>${esc(ev.champion)}</b>` : ''}! ${ev.wonCount}/${DATA.checklist?.total ?? ''}`, '', 8000);
  } else {
    showToast('Checklist updated after your game.', 'quiet', 4000);
  }
}

async function tick() {
  try {
    DATA = await j('/api/status');
  } catch {
    return; // server briefly unreachable; keep last state
  }
  renderConn();
  const v = currentView();
  if (v === 'dashboard') renderDashboard();
  if (v === 'champions') renderChampions();
  if (v === 'champselect') renderChampSelect();
  if (v === 'settings') renderSettings();
  maybeToast();
}

$('search').addEventListener('input', (e) => { ui.search = e.target.value; renderChampions(); });
$('sort').addEventListener('change', (e) => { ui.sort = e.target.value; renderChampions(); });
document.querySelectorAll('.fchip').forEach((b) =>
  b.addEventListener('click', () => {
    ui.filter = b.dataset.f;
    document.querySelectorAll('.fchip').forEach((x) => x.classList.toggle('active', x === b));
    renderChampions();
  }),
);
$('btn-rescan').onclick = async () => {
  const btn = $('btn-rescan');
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  try {
    const r = await postJson('/api/rescan', {});
    if (!r?.ok) showToast(`Scan failed: ${esc(r?.error ?? 'unknown error')}`, 'error', 8000);
  } catch (err) {
    showToast(`Scan failed: ${esc(err.message)}`, 'error', 8000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update scan';
    await tick();
  }
};

showView(currentView());
tick();
setInterval(tick, 3000);
