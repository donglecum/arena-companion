// Windows notification text for a post-game event. Pure so it can be
// unit-tested. Only a new champion is worth a notification; the quieter
// ordinary result waits in the app until the window is next opened.
const finite = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

function postGameNotification(event) {
  if (!event || event.type !== 'new-win') return null;
  const champion = typeof event.champion === 'string' && event.champion ? event.champion : 'a new champion';
  const before = finite(event.previousWonCount);
  const gained = Array.isArray(event.newChampions) ? event.newChampions.length : null;
  const official = finite(event.arenaGodBefore);
  const total = finite(event.total);
  // Counted from the new champions, not the won total (a manual mark made
  // meanwhile is not a step). Exact only when Riot counted no wins older than
  // match history — otherwise this win may be one Riot already had.
  if (before !== null && gained && (official === null || official <= before)) {
    const after = before + gained;
    const left = total !== null ? ` · ${Math.max(0, total - after)} to go` : '';
    return { title: 'First Arena win!', body: `${champion} · Arena God ${before} → ${after}${left}` };
  }
  const won = finite(event.wonCount);
  return { title: 'First Arena win!', body: `${champion}${won !== null ? ` · ${won} champions won` : ''}` };
}

module.exports = { postGameNotification };
