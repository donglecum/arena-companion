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

![Dashboard](docs/screenshots/after/dashboard-1180x820.png)

The app is a left navigation rail (collapsible), a top bar with the Ctrl+K search, the League client status and sync state, and a bottom **live bar** that shows what League is doing right now (champ select pick and whether it counts, a game in progress, or your last game) with Arena God progress along its top edge.

- **Dashboard** — Arena God ring with the official count, an honest breakdown (from match history / manual / unrecoverable), and the pace toward Arena God ("about N more games at your recent pace"). Stat tiles for games scanned, win rate, average placement, win streak, new champions this week and owned-but-not-won. Placement distribution (1st gold, 2nd–4th blue, 5th–7th slate, 8th coral), a form chart of your last 30 placements, **Play next** picks (needed champions you own, ranked by mastery and how you place on their class, each with its reason), recent games, and your latest play session.
- **Champions** — grid or sortable table (name, games, wins, win rate, average placement, last played, mastery). Filters: Needed / All / Won / Manual, class (Fighter, Mage, Assassin, Tank, Marksman, Support — also clickable in the per-class progress bars), owned only, played / never played. Unowned champions are desaturated with a lock. Layout, filters and sort are remembered.
- **Champion page** — splash hero, classes, status, mastery, Arena record (games, wins, average placement, first-win date), a placement histogram and every Arena game on that champion. Manual mark / unmark (click twice to confirm) writes through to arena-tracker.
- **Match History** — a year-long activity calendar (games per day, new first wins outlined), filters by champion, placement (1st, top 4, bottom 4, 8th, first wins) and date range, and games grouped by day with daily summaries.
- **Champ Select** — the main window stays hidden or where you left it; open it from the tray when needed. During Arena champ select (`CHERRY`, queue 1700 or 1750), only a small always-on-top **Crowd Favorites** panel appears automatically, with each lobby favorite's portrait and ✓ won / ✗ still needed (or ? when win data is unavailable). It hides after champ select and while the game runs. On Windows it docks outside the League client's right edge with a 9 DIP gap, falling inside when there is no room; it follows moves/resizes across monitors. Drag vertically to save its offset from the client top; if the client window is unavailable, the panel uses its last free position. The Champ Select view shows the current pick (and whether a win on it counts), the crowd favorites, and needed champions you own; **Mini mode** turns it into a compact card.
- **Post-game** — on leaving an Arena match, runs an incremental rescan; a first win on a new champion gets a celebration card in the app and a Windows notification (the main window usually stays hidden).
- **Settings** — Riot ID override (leave empty to follow the account logged into League), region (auto-detected from the client, or pinned), **Start with Windows** (on by default: installed copies launch at sign-in straight into the tray, so the Crowd Favorites panel is ready for champ select), mini-mode default and always-on-top switches, full rescan, version and data folder, and a **Crowd Favorites panel** button to show a clearly labeled sample preview for positioning. With the client visible, drag the preview up/down to set its relative height, then click **Done**; without the client, dragging sets the fallback position. A real Arena champ select takes over while active; if the preview remains enabled, it resumes afterward. Preview mode is not saved and starts off after an app restart.

## Keyboard

| Keys | Action |
|---|---|
| `Ctrl+K` / `Ctrl+P` | Command palette: jump to any champion or view, update scan, full rescan, toggle mini mode / always on top / overlay preview, export the checklist as CSV |
| `1`–`5` | Dashboard, Champions, Match History, Champ Select, Settings |
| `/` | Search champions |
| `[` | Collapse or expand the sidebar |
| `?` | Shortcut sheet |
| `Esc` | Close dialogs, leave mini mode |

## Design system

Black and electric blue. Tokens are CSS custom properties at the top of `src/ui/app.css`:
- Surfaces, darkest first: `--bg #07090d`, `--rail #0b0e14`, `--surface #10141c`, `--surface-2 #161b26`, `--hover #1c2230`, borders `--border #1f2633` and `--border-soft`
- Blue: `--blue #3b82f6`, `--blue-bright #60a5fa` (active/focus), `--cyan #38bdf8` (highlights, glow), `--blue-deep #1d4ed8`, `--blue-btn #2563eb` (primary buttons, white text at 5:1), `--blue-tint` (selected states)
- Text: `--text #e6edf7`, `--text-2 #8b97ab`, `--text-3 #7a869a` (all at least 4.5:1 on the surfaces)
- Status: won `--won #2dd4bf`, needed `--needed #f87171`, manual `--manual #a78bfa`, `--warn #fbbf24`; gold `--gold #e8b949` only for Arena God and 1st place
- Placement tiers: `--t1` gold, `--t2` blue, `--t3` slate, `--t4` coral
- Type: Inter for UI, JetBrains Mono (tabular) for numbers — both bundled in `src/ui/fonts/` (SIL OFL, see `LICENSES.txt`); no web font requests
- Components: `.card`, `.tile` (stat tiles), `.chip` / `.stat-chip`, `.btn` (primary/ghost), `.pill-btn` filters, `.switch`, `.champ-tile`, `.art` (champion art with a colored-initials fallback, so offline or missing art never leaves a hole), skeleton shimmer
- Icons: inline Lucide-style line icons (`src/ui/js/icons.js`)
- Charts: hand-rolled SVG/HTML (`src/ui/js/charts.js`) — progress ring, placement bars, form chart, activity calendar
- Motion: 150–250ms ease-out, count-up on the Arena God number, glow on hover/active only; `prefers-reduced-motion` turns it all off. Views only rebuild when their data changes, so the 3-second poll never reloads images.

## Architecture

- `shell/main.cjs`, `shell/windows.cjs`, `shell/dock.cjs` — Electron shell, read-only Win32 window/process discovery via prebuilt Koffi FFI, and pure client-relative dock geometry. Native client pixels are converted to Electron DIP per target display. `ARENA_COMPANION_DOCK_TARGET` overrides `LeagueClient.exe` for safe-window smoke testing.
- `src/server.ts` — backend: LCU polling plus persistent read-only LCU WebSocket subscription to `/lol-lobby-team-builder/champ-select/v1/crowd-favorite-champion-list`; match win checklist, static UI + JSON API on 127.0.0.1:8788. `src/httpGuard.ts` gates requests; `src/config.ts` validates settings.
- `src/ui/` — the SPA: `index.html`, `app.css`, and plain ES modules in `src/ui/js/` (no build step): `main.js` (routing, shell, shortcuts), `store.js` (polling), `views/*.js` (one per screen), `palette.js`, `livebar.js`, `charts.js`, `icons.js`, `util.js`. `overlay.html` is the Crowd Favorites panel.
- `assets/` — app logo (gold anvil + green check): `icon.ico` (multi-size, used for the Electron window and tray icons), `icon-256/512/32.png`, `icon.svg` (favicon at `/icon.svg` with `/icon-32.png` fallback, served by `src/server.ts`). The shell sets the AppUserModelId to `com.arena.companion` for Windows taskbar identity.
- `src/postgame.ts` — gameflow transition + win-diff detection (unit-tested)
- `src/insights.ts` — streaks, pace toward Arena God, latest session and Play next picks, served by `GET /api/insights`; `GET /api/matches` serves every scanned Arena match (both read-only, polled only when the checklist changes)
- `src/fixture.ts` — deterministic sample data for `ARENA_COMPANION_FIXTURE` (see Tests)
- `src/lockfile.ts`, `src/lcu.ts`, `src/ws.ts` — read-only LCU primitives; the WebSocket subscriber reconnects after client restarts
- `src/trackerApi.ts`, `src/scan.ts`, `src/ddragon.ts`, `src/regions.ts` — checklist data via arena-tracker + Data Dragon; `scan.ts` aggregates stored match placements into the dashboard rates using games scanned as the denominator (no rescan required for existing caches).
- `src/probe.ts`, `src/checklist.ts` — CLIs

## Shell choice

**Electron** provides native windows/tray/always-on-top. The backend stays plain Node; `Start-ArenaCompanion.ps1` launches Electron if installed, otherwise the backend alone (no overlay).

## Running on WINDOWSPC

- Install dir: `C:\Users\micha\Apps\arena-companion`
- Start at sign-in: installed copies register a Windows login item (`--hidden`, tray only) unless **Start with Windows** is off; check it under Task Manager › Startup apps. Dev and portable runs never register one. The old **ArenaCompanion** scheduled task is no longer needed — delete it (`schtasks /delete /tn ArenaCompanion /f`) so only one copy starts at sign-in.
- Only one copy runs: starting it again (shortcut, installer) brings the open window forward. Updates are checked at start and every 4 hours; while one downloads or waits to install, the sidebar shows it ("Downloading v…", "Update v… ready"), and Settings › About shows the installed version and update state.
- The main window reopens at the size and position it was left (saved in `main-window.json` in the app data folder); a window left on a disconnected monitor comes back on screen.
- Data: the Electron shell keeps `companion-config.json` and the match `cache/` in the per-user app data folder (`%APPDATA%\<app name>`), which survives updates; older copies in the app folder are copied there once. Running the backend alone (`npm start`) still uses the working directory, or `ARENA_COMPANION_CONFIG` / `ARENA_CACHE`.
- Runtime logs: `logs\arena-companion.log` / `.err.log`. Favorite IDs and resolved statuses, WebSocket connection, overlay shown/hidden, and safe errors are recorded there; no lockfile password or auth header.
- Node 24 runs TypeScript directly. Install with `npm install` in the app directory; Koffi includes prebuilt Windows binaries and needs no compiler. If Electron's binary is missing, run `node node_modules\electron\install.js`. The Electron overlay needs a logged-in desktop session.

## Tests

**Sample data (no League client needed):** `ARENA_COMPANION_FIXTURE=1 npm start` serves a realistic player (171 champions, 760 Arena games, generated placeholder art) at `http://localhost:8788`; `ARENA_COMPANION_FIXTURE=champselect` adds a live Arena champ select with crowd favorites. It never touches the LCU, the tracker or Data Dragon, and manual marks stay in memory. Screenshots in `docs/screenshots/` were taken this way.


`npm run typecheck` — `tsc` over `src/` and `tests/` (no output; Node runs the `.ts` files directly). CI runs it and `npm test` on every push and pull request.

`npm test` — unit tests for request gating, config validation, the Start-with-Windows login item, main-window placement, region detection, the data-folder migration, update-restart deferral, the champion cache (with classes and titles), lockfile parsing/redaction, scan/manual-win and placement aggregation, retrying match batches that failed on an earlier scan (including empty and invalid-placement stores), favorite payload/status resolution, client-relative dock/clamp geometry, both Arena queues, and post-game transitions.

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
- Multi-account / friends' checklists

