# Builds dist\EDExplorerKit.exe: the frontend, then a one-file PyInstaller exe that contains it.
#   .\packaging\build-exe.ps1
# Failures are caught by exit code: with ErrorActionPreference 'Stop', Windows PowerShell 5.1
# would abort on PyInstaller's ordinary log lines (it writes them to stderr).
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent

Push-Location (Join-Path $root 'frontend')
try {
    if (-not (Test-Path 'node_modules')) {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
} finally { Pop-Location }

Push-Location (Join-Path $root 'backend')
try {
    uv run --group build pyinstaller --noconfirm --clean `
        --distpath (Join-Path $root 'dist') `
        --workpath (Join-Path $root 'build') `
        (Join-Path $PSScriptRoot 'ed-explorer-kit.spec')
    if ($LASTEXITCODE -ne 0) { throw 'pyinstaller failed' }
} finally { Pop-Location }

Write-Host "Built $(Join-Path $root 'dist\EDExplorerKit.exe')"
