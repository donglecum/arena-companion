# Arena Companion

Read-only League LCU companion for Arena win tracking, running on WINDOWSPC as a desktop app (Electron shell + local web backend).

> **Just want the app?** Download **Arena Companion Setup.exe** from the [latest release](https://github.com/donglecum/arena-companion/releases/latest). Works with whichever Riot account your League client is logged into.

## What it does

- Connects to the running League client via the LCU API (lockfile auth, local TLS only).
- Detects the logged-in player automatically (Scro#Scro) and reads Riot's **official** "Adapt to All Situations" (Arena God, challenge 602002) count directly from the client.
- Rebuilds the **provable** win checklist by scanning Arena match history through the existing `arena-tracker` server (`https://arena.scrolab.com`), plus Data Dragon champions and manual wins.
- Desktop app (Electron) with a dark UI; the same UI is available locally at `http://localhost:8788`. LAN access is not configured on the current Windows deployment.

## Screens

- **Dashboard** — Arena God hero (official count in gold with progress bar, honest provable/manual/unrecoverable breakdown), stat cards (games scanned, owned, wins, last sync with stale indicator), a Placements card with win rate (1st), last-place rate (8th), and percentages/game counts for 1st–8th across scanned Arena games, recent Arena games strip with placement badges, LCU connection pill in the header.
- **Champions** — portrait grid of all champions with status chips (WON / NEEDED / MANUAL), search, filter chips (Needed/All/Won/Manual), sort (A–Z, Mastery, Recently played), unowned champions desaturated with a lock, click any tile for a detail popover with manual mark/unmark (writes through to arena-tracker).
- **Champ Select** — auto-shows the window when Arena champ select starts (`CHERRY`, queue 1700 or 1750). A separate, small always-on-top **Crowd Favorites** panel displays each lobby favorite's portrait and ✓ won / ✗ still needed (or ? when win data is unavailable); it hides after champ select. On Windows it docks 9 DIP inside the League client's right edge, follows moves/resizes across monitors, and stays hidden while the game process is running. Drag vertically to save its offset from the client top; if the client window is unavailable, the panel uses its last free position. The main view retains the current hover/pick card, needed-owned grid, and mini mode.
- **Post-game** — on leaving an Arena match, runs an incremental rescan and toasts a celebration when you first-win a new champion ("First Arena win on X!").
- **Settings** — Riot ID override, auto-show toggle, mini-mode default, always-on-top, full rescan, and a **Crowd Favorites panel** button to show a clearly labeled sample preview for positioning. With the client visible, drag the preview up/down to set its relative height, then click **Done**; without the client, dragging sets the fallback position. A real Arena champ select takes over while active; if the preview remains enabled, it resumes afterward. Preview mode is not saved and starts off after an app restart.

## Design system

CSS custom properties in `src/ui/app.css`:
- Surfaces: `--bg #0f1117`, `--surface #1a1d29`, `--surface-2 #222634`, `--border #2c3040`
- Text: `--text #e8eaf2`, `--text-dim #9aa0b5`
- Accent: `--accent #6b5ce7` (indigo, primary actions/active states)
- Gold: `--gold #c8a04b` (won / Arena God — League Hextech gold)
- Status: `--ok #3fb970`, `--warn #d9963d`, `--danger #d95f5f`
- Components: `.card`, `.chip` (status badges), `.champ-tile`, `.btn` (primary/ghost), `.progress`, `.toast`, skeleton shimmer
- Motion: 150–200ms ease transitions, portrait fade-in, nothing autoplaying

## Architecture

- `shell/main.cjs`, `shell/windows.cjs`, `shell/dock.cjs` — Electron shell, read-only Win32 window/process discovery via prebuilt Koffi FFI, and pure client-relative dock geometry. Native client pixels are converted to Electron DIP per target display. `ARENA_COMPANION_DOCK_TARGET` overrides `LeagueClient.exe` for safe-window smoke testing.
- `src/server.ts` — backend: LCU polling plus persistent read-only LCU WebSocket subscription to `/lol-lobby-team-builder/champ-select/v1/crowd-favorite-champion-list`; match win checklist, static UI + JSON API on :8788
- `src/ui/` — the SPA (index.html + app.css + app.js, vanilla JS, hash-routed views)
- `assets/` — app logo (gold anvil + green check): `icon.ico` (multi-size, used for the Electron window and tray icons), `icon-256/512/32.png`, `icon.svg` (favicon at `/icon.svg` with `/icon-32.png` fallback, served by `src/server.ts`). The shell sets the AppUserModelId to `com.arena.companion` for Windows taskbar identity.
- `src/postgame.ts` — gameflow transition + win-diff detection (unit-tested)
- `src/lockfile.ts`, `src/lcu.ts`, `src/ws.ts` — read-only LCU primitives; the WebSocket subscriber reconnects after client restarts
- `src/trackerApi.ts`, `src/scan.ts`, `src/ddragon.ts`, `src/regions.ts` — checklist data via arena-tracker + Data Dragon; `scan.ts` aggregates stored match placements into the dashboard rates using games scanned as the denominator (no rescan required for existing caches).
- `src/probe.ts`, `src/checklist.ts` — CLIs

## Shell choice

**Electron** provides native windows/tray/always-on-top. The backend stays plain Node; `Start-ArenaCompanion.ps1` launches Electron if installed, otherwise the backend alone (no overlay).

## Running on WINDOWSPC

- Install dir: `C:\Users\micha\Apps\arena-companion`
- Scheduled task **ArenaCompanion** runs the Electron app interactively at logon; `schtasks /run /tn ArenaCompanion` starts it immediately while signed in.
- Runtime logs: `logs\arena-companion.log` / `.err.log`. Favorite IDs and resolved statuses, WebSocket connection, overlay shown/hidden, and safe errors are recorded there; no lockfile password or auth header.
- Node 24 runs TypeScript directly. Install with `npm install` in the app directory; Koffi includes prebuilt Windows binaries and needs no compiler. If Electron's binary is missing, run `node node_modules\electron\install.js`. The Electron overlay needs a logged-in desktop session.

## Tests

`npm test` — unit tests for lockfile parsing/redaction, scan/manual-win and placement aggregation (including empty and invalid-placement stores), favorite payload/status resolution, client-relative dock/clamp geometry, both Arena queues, and post-game transitions.

## Capability matrix (WINDOWSPC live check 2026-09-27)

| Capability | Status |
|---|---|
| Detect client running (lockfile) | Works |
| LCU connect/auth | Works |
| Gameflow phase | Works |
| Current summoner identity | Works (read from LCU) |
| Riot official Arena God count (challenge 602002) | Works |
| Provable/manual wins via arena-tracker | Works |
| Champ-select current pick/intent | Works (404 gracefully outside champ select; verified session schema live) |
| Manual wins via arena-tracker | Works (mark/unmark round-trips) |
| LCU WebSocket events | Connected to live client on 2026-09-27 |
| Crowd Favorites event + overlay | Real champ select received five favorites, showed ✓/✗ statuses, then hid. The separate GET safety net returned 404 during that lobby; 404 now disables GET for that session without spamming logs, leaving WS authoritative. |
| Client window docking | Safe interactive Electron preview docked 11 physical pixels inside a test window at 125% DPI, then followed its +110 x / +80 y move and +150 width resize (+260 panel x / +80 panel y). Native reader detected the running game and a hidden League client during the earlier match. Real visible League-client dock awaits the next lobby. |
| Old wins lost to match-v5 retention | Their champions cannot be recovered from the aggregate challenge count; mark remembered wins manually |
| LCU swagger/docs | Unavailable (Riot disabled `/swagger/v3/openapi.json` in current client builds) |

## Next features (not built)

- Queue-mate readiness: LCU lobby endpoints can show party members' readiness
- Windows native toast notifications (in-window toast shipped; native is a shell add)
- Multi-account / friends' checklists

