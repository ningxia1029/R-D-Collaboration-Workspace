param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$TargetConfirmation,
  [switch]$Execute
)

$ErrorActionPreference = "Stop"
if (-not $DatabaseUrl) { throw "DATABASE_URL 未配置" }
$resolvedBackup = (Resolve-Path -LiteralPath $BackupFile).Path
if ([System.IO.Path]::GetExtension($resolvedBackup) -ne ".dump") { throw "仅允许恢复 .dump 文件" }
$hashFile = [System.IO.Path]::ChangeExtension($resolvedBackup, ".sha256")
if (-not (Test-Path -LiteralPath $hashFile)) { throw "缺少同名 SHA-256 校验文件: $hashFile" }
$hashLine = (Get-Content -LiteralPath $hashFile -Encoding UTF8 | Select-Object -First 1).Trim()
if ($hashLine -notmatch '^([a-fA-F0-9]{64})\s+(.+)$') { throw "SHA-256 校验文件格式无效" }
$expectedHash = $Matches[1].ToLowerInvariant()
$expectedName = $Matches[2].Trim()
if ($expectedName -ne [System.IO.Path]::GetFileName($resolvedBackup)) { throw "校验文件中的备份文件名不匹配" }
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedBackup).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw "备份文件 SHA-256 校验失败，禁止恢复" }

try { $targetUri = [Uri]$DatabaseUrl } catch { throw "DATABASE_URL 不是有效 URI" }
$targetDatabase = $targetUri.AbsolutePath.Trim('/')
if (-not $targetUri.Host -or -not $targetDatabase) { throw "DATABASE_URL 缺少主机或数据库名" }
$targetLabel = "$($targetUri.Host):$($targetUri.Port)/$targetDatabase"

Write-Host "恢复源: $resolvedBackup"
Write-Host "SHA-256: $actualHash"
Write-Host "目标库: $targetLabel"
Write-Host "默认仅检查归档；必须显式传入 -Execute 才会写数据库。"
& pg_restore --list $resolvedBackup | Select-Object -First 20
if ($LASTEXITCODE -ne 0) { throw "备份归档检查失败" }
if (-not $Execute) { exit 0 }
if ($TargetConfirmation -ne $targetLabel) {
  throw "执行恢复必须传入 -TargetConfirmation '$targetLabel'，以确认 --clean 的准确目标"
}

& pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --single-transaction --dbname=$DatabaseUrl $resolvedBackup
if ($LASTEXITCODE -ne 0) { throw "pg_restore 失败，退出码 $LASTEXITCODE" }
Write-Host "恢复完成；请继续执行应用健康检查与数据抽样核验。"
