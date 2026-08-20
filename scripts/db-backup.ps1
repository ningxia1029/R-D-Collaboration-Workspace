param(
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"
if (-not $DatabaseUrl) { throw "DATABASE_URL 未配置" }
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $resolvedOutput "workbuddy-$stamp.dump"
$metaPath = Join-Path $resolvedOutput "workbuddy-$stamp.sha256"

& pg_dump --format=custom --no-owner --no-acl --file=$backupPath $DatabaseUrl
if ($LASTEXITCODE -ne 0) { throw "pg_dump 失败，退出码 $LASTEXITCODE" }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backupPath).Hash.ToLowerInvariant()
Set-Content -LiteralPath $metaPath -Encoding UTF8 -Value "$hash  $([System.IO.Path]::GetFileName($backupPath))"
Write-Host "备份完成: $backupPath"
Write-Host "校验文件: $metaPath"
