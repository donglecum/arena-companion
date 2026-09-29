# Arena Companion

Read-only League LCU companion for Arena win tracking, running on WINDOWSPC as a desktop app (Electron shell + local web backend).

> **Just want the app?** Download **Arena Companion Setup.exe** from the [latest release](https://github.com/donglecum/arena-companion/releases/latest). Works with whichever Riot account your League client is logged into.

> Updates install silently on app start; the restart waits until League is out of champ select and games (packaged builds check GitHub Releases; the portable build doesn't auto-update).

## What it does

- Connects to the running League client via the LCU API (lockfile auth, local TLS only).
- Detects the logged-in player automatically (Scro#Scro) and reads Riot's **official** "Adapt to All Situations" (Arena God, challenge 602002) count directly from the client.
- Rebuilds the **provable** win checklist by scanning Arena match history through the existing `arena-tracker` server (`https://arena.scrolab.com`), plus Data Dragon champions and manual wins.
- Desktop app (Electron) with a dark UI; the same UI is available locally at `http://localhost:8788`. The server listens on 127.0.0.1 only and rejects requests from other sites (foreign `Host`/`Origin`, non-JSON bodies), so web pages and the LAN cannot drive its API.

## Screens

- **Dashboard** — Arena God hero (official count in gold with progress bar, honest provable/manual/unrecoverable breakdown), stat cards (games scanned, owned, wins, last sync with stale indicator), a Placements card with win rate (1st), last-place rate (8th), and percentages/game counts for 1st–8th across scanned Arena games, recent Arena games strip with placement badges, LCU connection pill in the header.
- **Champions** — portrait grid of all champions with status chips (WON / NEEDED / MANUAL), search, filter chips (Needed/All/Won/Manual), sort (A–Z, Mastery, Recently played), unowned champions desaturated with a lock, click any tile for a detail popover with manual mark/unmark (writes through to arena-tracker).
- **Champ Select** — the main window stays hidden or where you left it; open it from the tray when needed. During Arena champ select (`CHERRY`, queue 1700 or 1750), only a small always-on-top **Crowd Favorites** panel appears automatically, with each lobby favorite's portrait and ✓ won / ✗ still needed (or ? when win data is unavailable). It hides after champ select and while the game runs. On Windows it docks outside the League client's right edge with a 9 DIP gap, falling inside when there is no room; it follows moves/resizes across monitors. Drag vertically to save its offset from the client top; if the client window is unavailable, the panel uses its last free position. The main view retains the current hover/pick card, needed-owned grid, and mini mode.
- **Post-game** — on leaving an Arena match, runs an incremental rescan and toasts a celebration when you first-win a new champion ("First Arena win on X!").
- **Settings** — Riot ID override (leave empty to follow the account logged into League), region (auto-detected from the client, or pinned), mini-mode default, always-on-top, full rescan, and a **Crowd Favorites panel** button to show a clearly labeled sample preview for positioning. With the client visible, drag the preview up/down to set its relative height, then click **Done**; without the client, dragging sets the fallback position. A real Arena champ select takes over while active; if the preview remains enabled, it resumes afterward. Preview mode is not saved and starts off after an app restart.

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
- `src/server.ts` — backend: LCU polling plus persistent read-only LCU WebSocket subscription to `/lol-lobby-team-builder/champ-select/v1/crowd-favorite-champion-list`; match win checklist, static UI + JSON API on 127.0.0.1:8788. `src/httpGuard.ts` gates requests; `src/config.ts` validates settings.
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
- Data: the Electron shell keeps `companion-config.json` and the match `cache/` in the per-user app data folder (`%APPDATA%\<app name>`), which survives updates; older copies in the app folder are copied there once. Running the backend alone (`npm start`) still uses the working directory, or `ARENA_COMPANION_CONFIG` / `ARENA_CACHE`.
- Runtime logs: `logs\arena-companion.log` / `.err.log`. Favorite IDs and resolved statuses, WebSocket connection, overlay shown/hidden, and safe errors are recorded there; no lockfile password or auth header.
- Node 24 runs TypeScript directly. Install with `npm install` in the app directory; Koffi includes prebuilt Windows binaries and needs no compiler. If Electron's binary is missing, run `node node_modules\electron\install.js`. The Electron overlay needs a logged-in desktop session.

## Tests

`npm run typecheck` — `tsc` over `src/` and `tests/` (no output; Node runs the `.ts` files directly). CI runs it and `npm test` on every push and pull request.

`npm test` — unit tests for request gating, config validation, region detection, the data-folder migration, update-restart deferral, the champion cache, lockfile parsing/redaction, scan/manual-win and placement aggregation (including empty and invalid-placement stores), favorite payload/status resolution, client-relative dock/clamp geometry, both Arena queues, and post-game transitions.

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
| Client window docking | Live log identifies `LeagueClientUx.exe` as the 1920×1080 client UI during champ select; the panel docks outside with a 9 DIP gap when display space permits, otherwise inside. It follows moves/resizes, and hides when `League of Legends.exe` starts. |
| Old wins lost to match-v5 retention | Their champions cannot be recovered from the aggregate challenge count; mark remembered wins manually |
| LCU swagger/docs | Unavailable (Riot disabled `/swagger/v3/openapi.json` in current client builds) |

## Next features (not built)

- Queue-mate readiness: LCU lobby endpoints can show party members' readiness
- Windows native toast notifications (in-window toast shipped; native is a shell add)
- Multi-account / friends' checklists

