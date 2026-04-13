param(
  [switch]$All
)

$ErrorActionPreference = "Stop"

$textExtensions = @(
  ".ts", ".tsx", ".js", ".jsx", ".json",
  ".wxml", ".wxss", ".scss", ".css",
  ".md", ".d.ts", ".txt", ".yml", ".yaml",
  ".xml", ".html", ".htm"
)

function Get-ChangedFiles {
  $lines = git status --porcelain
  foreach ($line in $lines) {
    if ($line -match '^..\\s+(.+)$') {
      $path = $matches[1].Trim()
      if ($path -match '^(.+) -> (.+)$') {
        $path = $matches[2].Trim()
      }
      if (Test-Path -LiteralPath $path) {
        $path
      }
    }
  }
}

function Get-AllTextFiles {
  Get-ChildItem -Recurse -File miniprogram, typings | Where-Object {
    $path = $_.FullName.Replace('/', '\\')
    (
      -not $path.Contains('\node_modules\') -and
      -not $path.Contains('\miniprogram_npm\') -and
      -not $path.Contains('\vendor\')
    )
  } | ForEach-Object {
    $_.FullName
  }
}

function Resolve-RelativePath([string]$path) {
  $root = (Resolve-Path -LiteralPath ".").Path
  $full = (Resolve-Path -LiteralPath $path).Path
  if ($full.StartsWith($root)) {
    return $full.Substring($root.Length + 1)
  }
  return $path
}

if ($All) {
  $candidates = Get-AllTextFiles
} else {
  $candidates = Get-ChangedFiles
}

$files = @()
foreach ($f in $candidates) {
  if (-not (Test-Path -LiteralPath $f)) {
    continue
  }
  $ext = [System.IO.Path]::GetExtension($f).ToLowerInvariant()
  if ($textExtensions -contains $ext) {
    $files += $f
  }
}
$files = $files | Sort-Object -Unique

$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$bomFiles = @()
$invalidUtf8Files = @()
$replacementCharFiles = @()

foreach ($file in $files) {
  $resolved = Resolve-Path -LiteralPath $file
  $bytes = [System.IO.File]::ReadAllBytes($resolved)
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  if ($hasBom) {
    $bomFiles += (Resolve-RelativePath $file)
  }

  try {
    $text = $utf8Strict.GetString($bytes)
    if ($text.Contains([char]0xFFFD)) {
      $replacementCharFiles += (Resolve-RelativePath $file)
    }
  } catch {
    $invalidUtf8Files += (Resolve-RelativePath $file)
  }
}

$hasError = $false

if ($bomFiles.Count -gt 0) {
  $hasError = $true
  Write-Host "Found UTF-8 BOM in files:" -ForegroundColor Red
  $bomFiles | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}

if ($invalidUtf8Files.Count -gt 0) {
  $hasError = $true
  Write-Host "Found invalid UTF-8 files:" -ForegroundColor Red
  $invalidUtf8Files | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}

if ($replacementCharFiles.Count -gt 0) {
  $hasError = $true
  Write-Host "Found Unicode replacement characters (�) in files:" -ForegroundColor Red
  $replacementCharFiles | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}

if ($hasError) {
  exit 1
}

Write-Host "Encoding check passed." -ForegroundColor Green
