[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ComposeArgs
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env.selfhost"
$composePath = Join-Path $repoRoot "docker-compose.selfhost.yml"
$existingProject = [Environment]::GetEnvironmentVariable("COMPOSE_PROJECT_NAME")

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Missing .env.selfhost; run scripts/new-selfhost-env.ps1 first."
}
if (-not (Test-Path -LiteralPath $composePath)) {
  throw "Missing docker-compose.selfhost.yml."
}
if ($existingProject -and $existingProject -ne "workbuddy-selfhost") {
  throw "COMPOSE_PROJECT_NAME must be workbuddy-selfhost when using this wrapper."
}

& docker compose --project-name "workbuddy-selfhost" --env-file $envPath -f $composePath @ComposeArgs
exit $LASTEXITCODE
