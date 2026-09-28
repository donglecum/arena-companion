const MARGIN = 9;
const DEFAULT_OFFSET = 16;

function clampOffset(offset, clientHeight, panelHeight) {
  return Math.max(0, Math.min(Math.max(0, clientHeight - panelHeight), Math.round(offset)));
}

// All inputs are DIP; convert the entire physical client rectangle in Electron
// first, so origin and size obey the target monitor's scale factor.
// The panel sits OUTSIDE the client's right edge (MARGIN gap). When display
// bounds are provided and there is no room outside, it falls back to hugging
// the client's right edge from the inside so it can never float off-screen.
function dockBounds(client, panel, offset, display) {
  const y = Math.round(client.y + clampOffset(offset, client.height, panel.height));
  const insideX = client.x + Math.max(0, client.width - panel.width - MARGIN);
  const outsideX = client.x + client.width + MARGIN;
  let x = outsideX;
  if (display) {
    const minX = display.x + MARGIN;
    const maxX = display.x + display.width - panel.width - MARGIN;
    if (outsideX < minX || outsideX > maxX) x = Math.max(minX, Math.min(insideX, maxX));
  }
  return { x: Math.round(x), y, width: panel.width, height: panel.height };
}

module.exports = { DEFAULT_OFFSET, clampOffset, dockBounds };
