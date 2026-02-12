# WLO Metadaten-Agent - Extension Build Script
# Builds the Angular web component and copies dist files into the plugin
# Usage: .\build-extension.ps1

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$webComponentDir = Join-Path (Split-Path -Parent $scriptDir) "metadata-agent-fuerAPI"
$pluginDir = $scriptDir
$targetDir = Join-Path $pluginDir "webcomponent"

Write-Host "=== WLO Metadaten-Agent Extension Builder ===" -ForegroundColor Cyan
Write-Host "Web Component: $webComponentDir"
Write-Host "Plugin:        $pluginDir"
Write-Host "Target:        $targetDir"
Write-Host ""

# 1. Build Angular web component with extension config (no hashing)
Write-Host "[1/3] Building Angular web component (extension config)..." -ForegroundColor Yellow
Push-Location $webComponentDir
try {
    npx ng build --configuration=extension
    if ($LASTEXITCODE -ne 0) { throw "Angular build failed" }
    Write-Host "  Build successful!" -ForegroundColor Green
} finally {
    Pop-Location
}

$distDir = Join-Path $webComponentDir "dist-extension"

# 2. Copy built files to plugin
Write-Host "[2/3] Copying dist files to plugin..." -ForegroundColor Yellow
if (Test-Path $targetDir) {
    Remove-Item $targetDir -Recurse -Force
}
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

Copy-Item (Join-Path $distDir "main.js") $targetDir
Copy-Item (Join-Path $distDir "polyfills.js") $targetDir
Copy-Item (Join-Path $distDir "runtime.js") $targetDir
Copy-Item (Join-Path $distDir "styles.css") $targetDir

$assetsDir = Join-Path $distDir "assets"
if (Test-Path $assetsDir) {
    Copy-Item $assetsDir (Join-Path $targetDir "assets") -Recurse -Force
}

Write-Host "  Files copied!" -ForegroundColor Green

# 3. Copy i18n assets to sidebar/assets/ (Angular resolves paths relative to page URL)
Write-Host "[3/4] Copying i18n assets to sidebar/assets/..." -ForegroundColor Yellow
$sidebarAssetsDir = Join-Path $pluginDir "sidebar\assets\i18n"
New-Item -ItemType Directory -Path $sidebarAssetsDir -Force | Out-Null
$i18nSource = Join-Path $targetDir "assets\i18n"
if (Test-Path $i18nSource) {
    Copy-Item (Join-Path $i18nSource "*") $sidebarAssetsDir -Force
    Write-Host "  i18n assets copied!" -ForegroundColor Green
} else {
    Write-Host "  No i18n assets found (skipped)" -ForegroundColor DarkYellow
}

# 4. Summary
Write-Host "[4/4] Build complete!" -ForegroundColor Yellow
$files = Get-ChildItem $targetDir -Recurse -File
$totalSize = ($files | Measure-Object -Property Length -Sum).Sum
Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Files: $($files.Count)"
Write-Host "Total size: $([math]::Round($totalSize / 1MB, 2)) MB"
Write-Host ""
$files | ForEach-Object {
    $rel = $_.FullName.Substring($targetDir.Length + 1)
    $size = if ($_.Length -gt 1MB) { "$([math]::Round($_.Length / 1MB, 2)) MB" } else { "$([math]::Round($_.Length / 1KB, 1)) KB" }
    Write-Host "  $rel ($size)"
}
Write-Host ""
Write-Host "Plugin ready to load in chrome://extensions/" -ForegroundColor Green
