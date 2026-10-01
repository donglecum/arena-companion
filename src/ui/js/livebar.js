// Bottom "now playing" strip: what League is doing right now, or your last game.
import { $, esc, changed, art, statusOf, cardByName, cardById, ordinal, relSpan } from './util.js';
import { icon } from './icons.js';
import { arenaProgress } from './progress.js';

const IN_GAME = new Set(['GameStart', 'InProgress', 'Reconnect']);
const POST_GAME = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame']);
/** The backend stops waiting for a match record after about 15 minutes; this is the safety net. */
const PENDING_MAX_MS = 20 * 60_000;

export function renderLiveBar(st) {
  const bar = $('livebar');
  const s = st.status;
  const cl = s?.checklist;
  const { count, total } = arenaProgress(s);
  const pending = s?.lastEvent?.pending === true && Date.now() - Date.parse(s.lastEvent.at) < PENDING_MAX_MS;
  $('lb-progress').style.width = total ? `${Math.min(100, (count / total) * 100).toFixed(2)}%` : '0%';
  let main;
  let href = '';
  if (!st.reachable) {
    main = `<span class="lb-icon danger">${icon('offline', 18)}</span><span class="lb-text"><b>Backend unreachable</b><small>Reconnecting. Your last data stays on screen.</small></span>`;
  } else if (!s) {
    main = `<span class="lb-icon">${icon('refresh', 18, 'spin')}</span><span class="lb-text"><b>Starting up…</b><small>Loading your checklist</small></span>`;
  } else if (s.champSelect?.available) {
    const cur = cardByName(s.champSelect.championName);
    const status = cur ? statusOf(cur) : 'unknown';
    href = '#/champselect';
    main = `${cur ? art(cur, 'tile', 'lb-art') : `<span class="lb-icon live">${icon('target', 18)}</span>`}<span class="lb-text"><b><span class="live-dot"></span>${s.champSelect.isArena ? 'Arena champ select' : 'Champ select'}</b><small>${cur ? `${esc(cur.name)} · <span class="st-${status}">${status === 'needed' ? 'needed, a win counts' : 'already won'}</span>` : 'Hover a champion…'}${s.crowdFavorites?.length ? ` · ${s.crowdFavorites.length} crowd favorites` : ''}</small></span>`;
  } else if (IN_GAME.has(s.gameflowPhase)) {
    main = `<span class="lb-icon live">${icon('zap', 18)}</span><span class="lb-text"><b><span class="live-dot"></span>Game in progress</b><small>The checklist updates when it ends</small></span>`;
  } else if (POST_GAME.has(s.gameflowPhase) || s.scanning) {
    main = `<span class="lb-icon">${icon('refresh', 18, 'spin')}</span><span class="lb-text"><b>${s.scanning ? 'Updating your checklist' : 'Game over'}</b><small>${s.scanning ? 'Scanning new Arena games…' : 'Waiting for results'}</small></span>`;
  } else if (pending) {
    main = `<span class="lb-icon">${icon('history', 18)}</span><span class="lb-text"><b>Game over · waiting for the match record</b><small>Riot publishes it after the last team falls. Checking again soon.</small></span>`;
  } else {
    const lastMatch = st.matches?.[0];
    const lastCard = lastMatch ? cardById(lastMatch.championId) ?? { id: lastMatch.championId, name: lastMatch.championName } : null;
    if (lastMatch) {
      href = '#/history';
      main = `${art(lastCard, 'tile', 'lb-art')}<span class="lb-text"><b>Last game · ${esc(lastCard.name)}</b><small><span class="place-inline t${lastMatch.placement === 1 ? 1 : lastMatch.placement <= 4 ? 2 : lastMatch.placement === 8 ? 4 : 3}">${ordinal(lastMatch.placement)}</span> · ${relSpan(lastMatch.gameEnd)}${lastMatch.firstWin ? ' · first win' : ''}</small></span>`;
    } else {
      main = `<span class="lb-icon">${icon(s.lcuConnected ? 'zap' : 'offline', 18)}</span><span class="lb-text"><b>${s.lcuConnected ? 'Connected to League' : 'League client not running'}</b><small>${s.lcuConnected ? esc(s.gameflowPhase) : 'Open League to track champ select'}</small></span>`;
    }
  }
  const side = `<span class="lb-count"><span class="num">${cl ? count : '–'}</span><span class="dim num"> / ${total || '–'}</span></span><span class="lb-label">Arena God</span>`;
  const sig = `${main}|${side}|${href}`;
  if (!changed(bar, sig)) return;
  $('lb-main').innerHTML = main;
  $('lb-main').setAttribute('href', href || '#');
  $('lb-main').classList.toggle('inert', !href);
  $('lb-side').innerHTML = side;
}
