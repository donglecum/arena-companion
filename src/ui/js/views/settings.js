import { $, esc, changed } from '../util.js';
import { icon } from '../icons.js';
import { postJson, refresh } from '../store.js';
import { rescan } from './champions.js';

let built = false;
let previewError = '';

function flash(text, kind = 'ok') {
  window.dispatchEvent(new CustomEvent('ac-toast', { detail: { kind, text } }));
}

const sw = (id, label, hint, iconName) => `<label class="setting switch-row" for="${id}">
  <span class="setting-icon">${icon(iconName, 17)}</span>
  <span class="setting-text"><b>${label}</b><small>${hint}</small></span>
  <span class="switch"><input type="checkbox" id="${id}" role="switch"><span class="switch-track"><span class="switch-thumb"></span></span></span></label>`;

function layout() {
  return `<div class="page-head"><div><div class="eyebrow">${icon('settings', 14)} Settings</div><h1 class="page-title">Preferences</h1></div></div>
  <div class="settings">
    <section class="card settings-group"><h2>${icon('user', 16)} Account &amp; region</h2>
      <div class="setting"><span class="setting-icon">${icon('user', 17)}</span><span class="setting-text"><b>Riot ID</b><small id="set-player-cur">Leave empty to follow the account logged into League.</small></span>
        <input id="set-riotid" placeholder="Name#TAG — auto-detect" aria-label="Riot ID override"></div>
      <div class="setting"><span class="setting-icon">${icon('globe', 17)}</span><span class="setting-text"><b>Region</b><small>Detected from the client unless pinned here.</small></span>
        <select id="set-region" aria-label="Region"></select></div>
      <div class="settings-actions"><button id="set-save" class="btn primary">Save account</button></div>
    </section>
    <section class="card settings-group"><h2>${icon('sparkles', 16)} Behavior</h2>
      ${sw('set-mini', 'Mini mode in champ select', 'The Champ Select view starts as a compact card.', 'minimize')}
      ${sw('set-ontop', 'Always on top', 'Keep the main window above other windows (also in the tray menu).', 'pin')}
    </section>
    <section class="card settings-group"><h2>${icon('crown', 16)} Overlay · Crowd Favorites</h2>
      <div class="setting"><span class="setting-icon">${icon('eye', 17)}</span><span class="setting-text"><b>Panel position</b><small id="overlay-msg">Show a sample panel, drag it beside League, then press Done.</small></span>
        <button id="set-preview" class="btn ghost">Show panel</button></div>
    </section>
    <section class="card settings-group"><h2>${icon('layers', 16)} Data &amp; scanning</h2>
      <div class="setting"><span class="setting-icon">${icon('globe', 17)}</span><span class="setting-text"><b>Arena tracker</b><small>Match history and manual wins come from here.</small></span><code class="value">https://arena.scrolab.com</code></div>
      <div class="setting"><span class="setting-icon">${icon('refresh', 17)}</span><span class="setting-text"><b>Full rescan</b><small>Rebuilds the checklist from your entire match history. Takes a few minutes.</small></span>
        <button id="set-fullscan" class="btn ghost">${icon('refresh', 15)} Full rescan</button></div>
    </section>
    <section class="card settings-group"><h2>${icon('info', 16)} About</h2>
      <div class="setting"><span class="setting-icon">${icon('info', 17)}</span><span class="setting-text"><b>Version</b><small>Updates install automatically on start and are re-checked every few hours.</small></span><code class="value" id="set-version">–</code></div>
      <div class="setting"><span class="setting-icon">${icon('folder', 17)}</span><span class="setting-text"><b>Data folder</b><small>Config and match cache. Survives updates.</small></span><code class="value path" id="set-data">–</code></div>
      <div class="setting"><span class="setting-icon">${icon('keyboard', 17)}</span><span class="setting-text"><b>Keyboard shortcuts</b><small>Ctrl+K opens the command palette.</small></span><button class="btn ghost" data-action="shortcuts">Show shortcuts</button></div>
    </section>
  </div>`;
}

async function saveConfig(patch, okText) {
  try {
    await postJson('/api/config', patch);
    if (okText) flash(okText);
  } catch (err) {
    flash(`Not saved: ${err.message}`, 'error');
  }
  await refresh({ force: true });
}

function bind() {
  $('set-save').addEventListener('click', () => {
    const riotId = $('set-riotid').value.trim();
    const body = { regionLabel: $('set-region').value || null };
    if (!riotId) { body.gameName = null; body.tagLine = null; }
    else {
      const h = riotId.lastIndexOf('#');
      if (h <= 0 || h === riotId.length - 1) { flash('Riot ID must look like Name#TAG (or leave it empty to auto-detect).', 'error'); return; }
      body.gameName = riotId.slice(0, h);
      body.tagLine = riotId.slice(h + 1);
    }
    void saveConfig(body, 'Account saved.');
  });
  $('set-mini').addEventListener('change', (e) => saveConfig({ miniMode: e.target.checked }));
  $('set-ontop').addEventListener('change', (e) => saveConfig({ alwaysOnTop: e.target.checked }));
  $('set-fullscan').addEventListener('click', () => { flash('Full rescan started — this can take several minutes…'); void rescan($('set-fullscan'), true); });
  $('set-preview').addEventListener('click', () => togglePreview());
}

export async function togglePreview() {
  const { state } = await import('../store.js');
  const next = state.status?.overlayPreview !== true;
  try {
    const res = await postJson('/api/overlay-preview', { enabled: next });
    if (res?.enabled !== next) throw new Error('unexpected response');
    previewError = '';
  } catch {
    previewError = 'Panel toggle failed — the backend did not accept it.';
  }
  await refresh({ force: true });
}

export function renderSettings(st) {
  const root = $('view-settings');
  if (!built) { root.innerHTML = layout(); built = true; bind(); }
  const s = st.status;
  if (!s) return;
  const cfg = s.config ?? {};
  const preview = s.overlayPreview === true;
  const btn = $('set-preview');
  btn.textContent = preview ? 'Done' : 'Show panel';
  btn.classList.toggle('primary', preview);
  btn.classList.toggle('ghost', !preview);
  $('overlay-msg').textContent = previewError || (preview
    ? 'Drag the panel up or down beside League, then press Done. Without the client, drag to set a fallback spot.'
    : 'Show a sample panel, drag it beside League, then press Done.');
  const who = s.summoner?.gameName ? `${s.summoner.gameName}#${s.summoner.tagLine}` : '';
  $('set-player-cur').textContent = cfg.gameName ? 'Pinned. Clear it to follow the account logged into League.' : `Following the League client${who ? ` (${who})` : ''}.`;
  $('set-riotid').placeholder = who ? `${who} — from the client` : 'Name#TAG';
  const sel = $('set-region');
  const region = s.region;
  if (region) {
    const autoLabel = `Auto-detect${region.detected ? ` (${region.detected})` : ' (client not detected — NA)'}`;
    if (changed(sel, autoLabel + region.options.join())) {
      sel.innerHTML = `<option value="">${esc(autoLabel)}</option>${region.options.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}`;
      delete sel.dataset.synced;
    }
    const saved = region.override ?? '';
    if (document.activeElement !== sel && sel.dataset.synced !== saved) { sel.value = saved; sel.dataset.synced = saved; }
  }
  const riot = $('set-riotid');
  const riotValue = cfg.gameName ? `${cfg.gameName}#${cfg.tagLine ?? ''}` : '';
  if (document.activeElement !== riot && riot.dataset.synced !== riotValue) { riot.value = riotValue; riot.dataset.synced = riotValue; }
  $('set-mini').checked = !!cfg.miniMode;
  $('set-ontop').checked = !!cfg.alwaysOnTop;
  $('set-version').textContent = s.app?.version ? `v${s.app.version}${s.fixture ? ' · sample data' : ''}` : '–';
  $('set-data').textContent = s.app?.dataDir ?? '–';
  $('set-data').title = s.app?.dataDir ?? '';
}
