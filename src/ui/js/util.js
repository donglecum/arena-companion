// Shared helpers: DOM access, escaping, formatting, champion art.
import { state } from './store.js';

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Skip an innerHTML rebuild when the content hasn't changed: rebuilding
   recreates every <img> and makes portraits flicker on each poll. */
export function changed(el, signature) {
  if (!el) return false;
  if (el.dataset.sig === signature) return false;
  el.dataset.sig = signature;
  return true;
}

export const CLASSES = ['Fighter', 'Mage', 'Assassin', 'Tank', 'Marksman', 'Support'];
export const plural = (tag) => (tag === 'Marksman' ? 'Marksmen' : `${tag}s`);

export function ordinal(n) {
  if (!Number.isFinite(n)) return '–';
  return n + (['th', 'st', 'nd', 'rd'][n % 10 > 3 || ((n % 100) / 10 | 0) === 1 ? 0 : n % 10] || 'th');
}

export function relTime(ms, now = Date.now()) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d ago`;
  return fmtDate(ms);
}

/** A relative time that main.js keeps fresh in place, so views never rebuild just to age a timestamp. */
export function relSpan(ms) {
  return `<span data-rel="${Number(ms) || 0}">${relTime(ms)}</span>`;
}

export function fmtDate(ms, withYear = false) {
  if (!ms) return '—';
  const d = new Date(ms);
  const opts = { month: 'short', day: 'numeric' };
  if (withYear || d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export const fmtTime = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const num = (n) => (Number.isFinite(n) ? n.toLocaleString() : '–');
export const pct = (n) => (Number.isFinite(n) ? `${Number(n).toFixed(1)}%` : '–');
export const dec = (n) => (Number.isFinite(n) ? Number(n).toFixed(1) : '–');

/** Placement tier for colors: 1st gold, 2–4 blue, 5–7 slate, 8th coral. */
export function tierOf(p) {
  if (p === 1) return 't1';
  if (p >= 2 && p <= 4) return 't2';
  if (p === 8) return 't4';
  return 't3';
}

export function statusOf(card) {
  if (!card) return 'unknown';
  if (card.won && card.manual && !card.wins) return 'manual';
  return card.won ? 'won' : 'needed';
}

const STATUS_LABEL = { won: 'Won', manual: 'Manual', needed: 'Needed', unknown: 'Unknown' };
const STATUS_ICON = { won: 'check', manual: 'pencil', needed: 'x', unknown: 'info' };
export function chip(status, iconFn) {
  return `<span class="chip ${status}">${iconFn(STATUS_ICON[status], 12)}${STATUS_LABEL[status]}</span>`;
}

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
export const hueOf = (id) => hash(id) % 360;

export function initials(name) {
  const words = String(name ?? '?').replace(/[^A-Za-z\s]/g, '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** Champion art URL. `kind`: tile (square portrait), splash (wide), loading (tall). */
export function artUrl(card, kind = 'tile') {
  if (!card?.id) return '';
  const status = state.status;
  if (status?.fixture) return `/fixture-art/${encodeURIComponent(card.id)}.svg`;
  const base = 'https://ddragon.leagueoflegends.com/cdn';
  if (kind === 'splash') return `${base}/img/champion/splash/${encodeURIComponent(card.id)}_0.jpg`;
  if (kind === 'loading') return `${base}/img/champion/loading/${encodeURIComponent(card.id)}_0.jpg`;
  if (!status?.ddragonVersion || !card.image) return '';
  return `${base}/${encodeURIComponent(status.ddragonVersion)}/img/champion/${encodeURIComponent(card.image)}`;
}

/** Art with a colored-initials fallback underneath: offline or missing art never leaves a hole. */
export function art(card, kind = 'tile', cls = '') {
  const url = artUrl(card, kind);
  const name = card?.name ?? card?.id ?? '?';
  return `<span class="art k-${kind} ${cls}" style="--h:${hueOf(card?.id ?? name)}"><span class="art-fallback">${esc(initials(name))}</span>${url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async">` : ''}</span>`;
}

/** Images fade in once loaded and drop out on error, revealing the fallback. */
export function installImageHandlers() {
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLImageElement) e.target.classList.add('loaded');
  }, true);
  document.addEventListener('error', (e) => {
    if (e.target instanceof HTMLImageElement && e.target.closest('.art')) e.target.remove();
  }, true);
}

export function cardById(id) {
  return state.status?.cards?.find((c) => c.id === id) ?? null;
}

export function cardByName(name) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(name);
  return state.status?.cards?.find((c) => norm(c.name) === n || norm(c.id) === n) ?? null;
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Count a number up from 0 once, the first time it has a value. */
export function countUp(el, value, duration = 900) {
  if (!el) return;
  if (!Number.isFinite(value)) { el.textContent = '–'; return; }
  if (el.dataset.counted || reducedMotion()) { el.textContent = String(value); el.dataset.counted = '1'; return; }
  el.dataset.counted = '1';
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / duration);
    el.textContent = String(Math.round(value * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
