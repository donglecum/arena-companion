# Start-ArenaCompanion.ps1 — launches the Arena Companion desktop app
# (Electron shell, which spawns the backend server itself).
$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path "$appDir\logs" | Out-Null
$out = "$appDir\logs\arena-companion.log"
$err = "$appDir\logs\arena-companion.err.log"
$electron = "$appDir\node_modules\.bin\electron.cmd"
if (Test-Path $electron) {
  Start-Process $electron -ArgumentList 'shell/main.cjs' -WorkingDirectory $appDir -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
} else {
  # Fallback: backend only (UI via browser at localhost:8788)
  Start-Process node -ArgumentList 'src/server.ts' -WorkingDirectory $appDir -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
}
