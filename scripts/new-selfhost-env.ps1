[CmdletBinding()]
param(
  [switch]$Force,
  [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) ".env.selfhost")
)

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
if ((Test-Path -LiteralPath $resolvedOutput) -and -not $Force) {
  throw "Target exists; use -Force to overwrite it."
}

function New-UrlSafeSecret([int]$ByteCount) {
  $bytes = [byte[]]::new($ByteCount)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$dbPassword = New-UrlSafeSecret 24
$authSecret = New-UrlSafeSecret 32
# The fixed suffix satisfies the project's uppercase, lowercase, digit, and special-character policy.
$demoPassword = "$(New-UrlSafeSecret 24)!aA9"
$content = @(
  "SELFHOST_POSTGRES_PASSWORD=$dbPassword"
  "SELFHOST_AUTH_SECRET=$authSecret"
  "SELFHOST_DEMO_PASSWORD=$demoPassword"
  "CLOUDFLARE_TUNNEL_TOKEN="
  "SELFHOST_APP_PORT=3010"
  "SELFHOST_BACKUP_INTERVAL_SECONDS=86400"
  "SELFHOST_BACKUP_RETENTION_DAYS=7"
) -join [Environment]::NewLine

$parent = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $parent)) {
  [System.IO.Directory]::CreateDirectory($parent) | Out-Null
}
$tempPath = Join-Path $parent ("." + [System.IO.Path]::GetRandomFileName())
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
try {
  [System.IO.File]::WriteAllText($tempPath, $content + [Environment]::NewLine, $utf8WithoutBom)
  Move-Item -LiteralPath $tempPath -Destination $resolvedOutput -Force | Out-Null
} finally {
  if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
}

[Console]::Out.WriteLine($resolvedOutput)
