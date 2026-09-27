const MARGIN = 9;
const DEFAULT_OFFSET = 16;

function clampOffset(offset, clientHeight, panelHeight) {
  return Math.max(0, Math.min(Math.max(0, clientHeight - panelHeight), Math.round(offset)));
}

// All inputs are DIP; convert the entire physical client rectangle in Electron
// first, so origin and size obey the target monitor's scale factor.
function dockBounds(client, panel, offset) {
  return {
    x: Math.round(client.x + Math.max(0, client.width - panel.width - MARGIN)),
    y: Math.round(client.y + clampOffset(offset, client.height, panel.height)),
    width: panel.width,
    height: panel.height,
  };
}

module.exports = { DEFAULT_OFFSET, clampOffset, dockBounds };
