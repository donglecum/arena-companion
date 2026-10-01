// Hand-rolled SVG/HTML charts. All sizes come from viewBoxes, so they scale
// with their card; colors come from CSS variables.
import { esc, ordinal, tierOf, pct } from './util.js';

/** Progress ring for the Arena God hero. */
export function ring(value, total, size = 176) {
  const stroke = 12;
  const r = (size - stroke) / 2 - 6;
  const c = 2 * Math.PI * r;
  const k = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${value} of ${total} champions">
    <defs>
      <linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--cyan)"/><stop offset="1" stop-color="var(--blue-deep)"/></linearGradient>
      <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="${stroke}"/>
    <circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#ring-g)" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - k)).toFixed(1)}" style="--c:${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})" filter="url(#ring-glow)"/>
  </svg>`;
}

/** 1st–8th distribution as columns; `placements` = [{placement, count, percent}]. */
export function placementBars(placements, { compact = false } = {}) {
  const rows = (placements ?? []).filter((p) => p.placement >= 1 && p.placement <= 8);
  const max = Math.max(0, ...rows.map((p) => p.percent || 0));
  return `<div class="pbars ${compact ? 'compact' : ''}">${rows.map(({ placement, count, percent }) => {
    const h = max > 0 && count > 0 ? Math.max(3, (percent / max) * 100) : 0;
    return `<div class="pbar" title="${ordinal(placement)} · ${pct(percent)} · ${count} ${count === 1 ? 'game' : 'games'}">
      <div class="pbar-pct">${compact ? count : pct(percent)}</div>
      <div class="pbar-track"><div class="pbar-fill ${tierOf(placement)}" style="height:${h.toFixed(1)}%"></div></div>
      <div class="pbar-label ${placement === 1 ? 'gold' : ''}">${ordinal(placement)}</div>
      ${compact ? '' : `<div class="pbar-count">${count}</div>`}
    </div>`;
  }).join('')}</div>`;
}

/** Placement counts → the {placement, count, percent} rows placementBars expects. */
export function distribution(placements) {
  const counts = new Array(8).fill(0);
  for (const p of placements) if (p >= 1 && p <= 8) counts[p - 1] += 1;
  const total = counts.reduce((a, b) => a + b, 0);
  return counts.map((count, i) => ({ placement: i + 1, count, percent: total ? Math.round((count / total) * 1000) / 10 : 0 }));
}

/** Last N placements (oldest first): dots by tier, a rolling average line, 1st at the top. */
export function trendChart(trend) {
  const W = 600, H = 230, padX = 16, padY = 22;
  if (!trend?.length) return '<div class="empty-inline">Play a few Arena games to see your trend.</div>';
  const x = (i) => padX + (trend.length === 1 ? (W - 2 * padX) / 2 : (i * (W - 2 * padX)) / (trend.length - 1));
  const y = (p) => padY + ((p - 1) / 7) * (H - 2 * padY);
  const avg = trend.map((_, i) => {
    const slice = trend.slice(Math.max(0, i - 4), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const line = avg.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const grid = [1, 4, 8].map((p) => `<line x1="${padX}" x2="${W - padX}" y1="${y(p)}" y2="${y(p)}" class="grid"/><text x="${W - padX}" y="${y(p) - 6}" class="axis" text-anchor="end">${ordinal(p)}</text>`).join('');
  const dots = trend.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p).toFixed(1)}" r="6" class="dot ${tierOf(p)}"><title>${ordinal(p)}</title></circle>`).join('');
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Placements over your last ${trend.length} games">
    ${grid}<path d="${line}" class="avg"/>${dots}
  </svg>`;
}

/** GitHub-style calendar of games per day for the last `weeks` weeks. */
export function heatmap(matches, weeks = 53) {
  const day = 24 * 3600_000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = today.getTime();
  const start = end - ((weeks - 1) * 7 + today.getDay()) * day;
  const byDay = new Map();
  for (const m of matches ?? []) {
    if (!m.gameEnd || m.gameEnd < start) continue;
    const d = new Date(m.gameEnd);
    d.setHours(0, 0, 0, 0);
    const slot = byDay.get(d.getTime()) ?? { games: 0, newWins: 0 };
    slot.games += 1;
    if (m.firstWin) slot.newWins += 1;
    byDay.set(d.getTime(), slot);
  }
  const cell = 12, gap = 3;
  const cols = Math.ceil((end - start) / day / 7) + 1;
  const level = (g) => (g === 0 ? 0 : g <= 2 ? 1 : g <= 4 ? 2 : g <= 7 ? 3 : 4);
  let rects = '';
  let months = '';
  let lastMonth = -1;
  let lastLabelCol = -9;
  for (let t = start, i = 0; t <= end; t += day, i += 1) {
    const col = Math.floor(i / 7), row = new Date(t).getDay();
    const slot = byDay.get(t) ?? { games: 0, newWins: 0 };
    const label = `${new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${slot.games} ${slot.games === 1 ? 'game' : 'games'}${slot.newWins ? ` · ${slot.newWins} new ${slot.newWins === 1 ? 'win' : 'wins'}` : ''}`;
    rects += `<rect x="${col * (cell + gap)}" y="${16 + row * (cell + gap)}" width="${cell}" height="${cell}" rx="3" class="hm l${level(slot.games)} ${slot.newWins ? 'win' : ''}"><title>${esc(label)}</title></rect>`;
    const month = new Date(t).getMonth();
    if (row === 0 && month !== lastMonth && col - lastLabelCol >= 3) {
      lastMonth = month;
      lastLabelCol = col;
      months += `<text x="${col * (cell + gap)}" y="10" class="axis">${new Date(t).toLocaleDateString(undefined, { month: 'short' })}</text>`;
    }
  }
  const w = cols * (cell + gap);
  const h = 16 + 7 * (cell + gap);
  return `<svg class="heatmap" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Arena games per day">${months}${rects}</svg>`;
}

/** Thin progress bar. */
export function bar(value, total, cls = '') {
  const k = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  return `<div class="bar ${cls}"><div class="bar-fill" style="width:${(k * 100).toFixed(1)}%"></div></div>`;
}
