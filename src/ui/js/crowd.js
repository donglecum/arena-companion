// Crowd Favorites view model, shared by the overlay (overlay.html loads this
// as a classic script) and the main window's Champ Select view. It sets
// globalThis.ArenaCrowd instead of exporting, so the same file works as a
// classic script, as a module import and from file:// in the shell's smoke
// mode. Pure, so tests/crowd.test.mjs covers it.
//
// The panel answers one question — "do I still need any of these?" — so each
// row carries that answer (needed / won / unknown) and the header sums it up.
(function (root) {
  'use strict';

  // Sample cards for the Settings position preview (never real LCU data): five
  // rows like a real lobby, so the panel is its real height while you place
  // it, covering every win state (each row's tag names it), with no portraits.
  var SAMPLE_CARDS = [
    { id: -1, name: 'Sample 1', image: '', won: false },
    { id: -2, name: 'Sample 2', image: '', won: true },
    { id: -3, name: 'Sample 3', image: '', won: false },
    { id: -4, name: 'Sample 4', image: '', won: null },
    { id: -5, name: 'Sample 5', image: '', won: true },
  ];

  var LABEL = { needed: 'still needed', won: 'already won', unknown: 'win data unavailable' };

  function rowState(won) {
    return won === true ? 'won' : won === false ? 'needed' : 'unknown';
  }

  function initials(name) {
    var words = String(name || '').replace(/[^A-Za-z\s]/g, '').split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  }

  /** Portrait URL for a favorite's ddragon image name ('Ahri.png'); sample data uses the generated art. */
  function portraitUrl(status, image) {
    if (typeof image !== 'string' || !image) return '';
    if (status && status.fixture === true) {
      return '/fixture-art/' + encodeURIComponent(image.replace(/\.png$/i, '')) + '.svg';
    }
    var version = status && typeof status.ddragonVersion === 'string' ? status.ddragonVersion : '';
    if (!version) return '';
    return 'https://ddragon.leagueoflegends.com/cdn/' + encodeURIComponent(version) + '/img/champion/' + encodeURIComponent(image);
  }

  function crowdModel(status) {
    var s = status && typeof status === 'object' ? status : {};
    var favorites = Array.isArray(s.crowdFavorites) ? s.crowdFavorites : [];
    // The position preview shows only outside a real Arena champ select — a
    // real champ select supersedes it even with an empty list.
    var realActive = s.crowdFavoritesActive === true;
    var preview = s.overlayPreview === true && !realActive;
    if (preview) favorites = SAMPLE_CARDS;
    var counts = { needed: 0, won: 0, unknown: 0 };
    var rows = favorites.map(function (fav, index) {
      var f = fav && typeof fav === 'object' ? fav : {};
      var state = rowState(f.won === true ? true : f.won === false ? false : null);
      var name = typeof f.name === 'string' ? f.name : '';
      counts[state] += 1;
      return {
        key: Number.isFinite(f.id) ? 'id:' + f.id : 'i:' + index,
        id: Number.isFinite(f.id) ? f.id : null,
        name: name,
        image: typeof f.image === 'string' ? f.image : '',
        state: state,
        portrait: portraitUrl(s, f.image),
        initials: initials(name),
        label: name + ' — ' + LABEL[state],
      };
    });
    // Sample counts mean nothing, so the preview's tag just says what it is.
    var tone = preview ? 'preview' : counts.needed ? 'need' : counts.unknown ? 'unknown' : rows.length ? 'won' : 'none';
    var summary = tone === 'preview' ? 'Preview'
      : tone === 'need' ? counts.needed + ' needed'
      : tone === 'won' ? 'All won'
      : tone === 'unknown' ? (counts.unknown === rows.length ? 'No win data' : counts.unknown + ' unknown')
      : '';
    return {
      active: preview || (realActive && rows.length > 0),
      preview: preview,
      title: preview ? 'Crowd Favorites · preview' : 'Crowd Favorites',
      heading: 'Crowd Favorites',
      rows: rows,
      counts: counts,
      tone: tone,
      summary: summary,
    };
  }

  root.ArenaCrowd = { crowdModel: crowdModel, portraitUrl: portraitUrl, rowState: rowState, SAMPLE_CARDS: SAMPLE_CARDS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
