# Builds the frontend (if needed) and starts the ED Explorer Kit backend.
#   .\start.ps1          local only:  http://127.0.0.1:8765
#   .\start.ps1 -Lan     also reachable from a phone/tablet on the same Wi-Fi
#   .\start.ps1 -Rebuild rebuild the database projections from stored events
param(
    [switch]$Lan,
    [switch]$Rebuild,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if (-not $SkipBuild) {
    Push-Location (Join-Path $root 'frontend')
    try {
        if (-not (Test-Path 'node_modules')) { npm install }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
    } finally { Pop-Location }
}

$backendArgs = @()
if ($Lan) { $backendArgs += '--lan' }
if ($Rebuild) { $backendArgs += '--rebuild' }

Push-Location (Join-Path $root 'backend')
try {
    uv run python -m app.main @backendArgs
} finally { Pop-Location }
