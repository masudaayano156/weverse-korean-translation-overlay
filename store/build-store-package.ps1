$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$distRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "dist"))
$stageRoot = [System.IO.Path]::GetFullPath((Join-Path $distRoot "chrome-web-store"))

if (-not $stageRoot.StartsWith($distRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "안전하지 않은 임시 폴더 경로입니다."
}

$manifest = Get-Content -LiteralPath (Join-Path $repoRoot "manifest.json") -Raw | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') {
  throw "manifest 버전 형식이 올바르지 않습니다."
}

$archivePath = Join-Path $distRoot "weverse-instagram-korean-overlay-v$version-chrome-web-store.zip"
$files = @(
  "manifest.json",
  "background.js",
  "content.js",
  "core.js",
  "identity-bridge.js",
  "page-hook.js",
  "privacy.html",
  "privacy.css",
  "privacy.js",
  "PRIVACY.md",
  "THIRD_PARTY_NOTICES.md",
  "vendor/convex.js",
  "LICENSES/Apache-2.0.txt",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "icons/reaction-cute-noto.svg"
)

foreach ($relativePath in $files) {
  $sourcePath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "배포 파일이 없습니다: $relativePath"
  }
}

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

foreach ($relativePath in $files) {
  $sourcePath = Join-Path $repoRoot $relativePath
  $targetPath = Join-Path $stageRoot $relativePath
  $targetDirectory = Split-Path -Parent $targetPath
  New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $targetPath
}

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $archivePath -CompressionLevel Optimal
Remove-Item -LiteralPath $stageRoot -Recurse -Force

$archive = Get-Item -LiteralPath $archivePath
$hash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
[PSCustomObject]@{
  Path = $archive.FullName
  Version = $version
  Bytes = $archive.Length
  SHA256 = $hash.Hash
}
