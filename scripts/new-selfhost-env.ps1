[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$Upgrade,
  [string]$OutputPath
)

if ($Force -and $Upgrade) {
  throw "Use either -Force or -Upgrade, not both."
}

if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
  throw "Script root is unavailable."
}
$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $repoRoot ".env.selfhost"
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$targetExists = Test-Path -LiteralPath $resolvedOutput
if ($targetExists -and -not $Force -and -not $Upgrade) {
  throw "Target exists; use -Upgrade to add missing settings or -Force to replace it."
}
if ($Upgrade -and -not $targetExists) {
  throw "Upgrade requires an existing target."
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

$existing = @{}
if ($Upgrade) {
  foreach ($line in Get-Content -LiteralPath $resolvedOutput -Encoding UTF8) {
    if ($line -match '^([^#=][^=]*)=(.*)$') {
      $name = $matches[1]
      if ($existing.ContainsKey($name)) { throw "Target contains a duplicate setting name." }
      $existing[$name] = $matches[2]
    }
  }
  foreach ($requiredName in @('SELFHOST_POSTGRES_PASSWORD', 'SELFHOST_AUTH_SECRET', 'SELFHOST_DEMO_PASSWORD')) {
    if (-not $existing.ContainsKey($requiredName) -or [string]::IsNullOrWhiteSpace([string]$existing[$requiredName])) {
      throw "Existing target is missing a required legacy secret."
    }
  }
}

function Existing-OrDefault([string]$Name, [string]$DefaultValue) {
  if ($Upgrade -and $existing.ContainsKey($Name)) { return [string]$existing[$Name] }
  return $DefaultValue
}

function Existing-NonEmptyOrDefault([string]$Name, [string]$DefaultValue) {
  if ($Upgrade -and $existing.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace([string]$existing[$Name])) {
    return [string]$existing[$Name]
  }
  return $DefaultValue
}

$dbPassword = Existing-OrDefault 'SELFHOST_POSTGRES_PASSWORD' (New-UrlSafeSecret 24)
$authSecret = Existing-OrDefault 'SELFHOST_AUTH_SECRET' (New-UrlSafeSecret 32)
$agentInternalServiceSecret = Existing-NonEmptyOrDefault 'SELFHOST_AGENT_INTERNAL_SERVICE_SECRET' (New-UrlSafeSecret 32)
$agentDelegationSecret = Existing-NonEmptyOrDefault 'SELFHOST_AGENT_DELEGATION_SECRET' (New-UrlSafeSecret 32)
$agentCursorSecret = Existing-NonEmptyOrDefault 'SELFHOST_AGENT_CURSOR_SECRET' (New-UrlSafeSecret 32)
$agentActionApprovalSecret = Existing-NonEmptyOrDefault 'SELFHOST_AGENT_ACTION_APPROVAL_SECRET' (New-UrlSafeSecret 32)
# The fixed suffix satisfies the project's uppercase, lowercase, digit, and special-character policy.
$demoPassword = Existing-OrDefault 'SELFHOST_DEMO_PASSWORD' "$(New-UrlSafeSecret 24)!aA9"
$contentLines = @(
  "SELFHOST_POSTGRES_PASSWORD=$dbPassword"
  "SELFHOST_AUTH_SECRET=$authSecret"
  "SELFHOST_DEMO_PASSWORD=$demoPassword"
  "SELFHOST_AGENT_INTERNAL_SERVICE_SECRET=$agentInternalServiceSecret"
  "SELFHOST_AGENT_DELEGATION_SECRET=$agentDelegationSecret"
  "SELFHOST_AGENT_CURSOR_SECRET=$agentCursorSecret"
  "SELFHOST_AGENT_ACTION_APPROVAL_SECRET=$agentActionApprovalSecret"
  "AGENT_MODEL_API_KEY=$(Existing-OrDefault 'AGENT_MODEL_API_KEY' '')"
  "CLOUDFLARE_TUNNEL_TOKEN=$(Existing-OrDefault 'CLOUDFLARE_TUNNEL_TOKEN' '')"
  "SELFHOST_APP_PORT=$(Existing-OrDefault 'SELFHOST_APP_PORT' '3010')"
  "SELFHOST_BACKUP_INTERVAL_SECONDS=$(Existing-OrDefault 'SELFHOST_BACKUP_INTERVAL_SECONDS' '86400')"
  "SELFHOST_BACKUP_RETENTION_DAYS=$(Existing-OrDefault 'SELFHOST_BACKUP_RETENTION_DAYS' '7')"
  "AGENT_MODEL_PROVIDER=$(Existing-OrDefault 'AGENT_MODEL_PROVIDER' 'openai-compatible')"
  "AGENT_MODEL_BASE_URL=$(Existing-OrDefault 'AGENT_MODEL_BASE_URL' 'https://api.deepseek.com')"
  "AGENT_MODEL_NAME=$(Existing-OrDefault 'AGENT_MODEL_NAME' 'deepseek-v4-flash')"
  "AGENT_MODEL_THINKING=$(Existing-OrDefault 'AGENT_MODEL_THINKING' 'disabled')"
  "AGENT_MODEL_MAX_OUTPUT_TOKENS=$(Existing-OrDefault 'AGENT_MODEL_MAX_OUTPUT_TOKENS' '2048')"
)
$knownNames = @($contentLines | ForEach-Object { ($_ -split '=', 2)[0] })
if ($Upgrade) {
  foreach ($extraName in @($existing.Keys | Sort-Object)) {
    if ($knownNames -notcontains $extraName) { $contentLines += "$extraName=$($existing[$extraName])" }
  }
}
$content = $contentLines -join [Environment]::NewLine

function Set-PrivateFileAcl([string]$Path) {
  if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw "Secret file ACL enforcement requires Windows."
  }
  $allowedSids = @(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
    [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
    [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  )
  $acl = [System.IO.File]::GetAccessControl($Path)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))) {
    $acl.PurgeAccessRules($rule.IdentityReference)
  }
  foreach ($sid in $allowedSids) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  [System.IO.File]::SetAccessControl($Path, $acl)
}

$parent = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $parent)) {
  [System.IO.Directory]::CreateDirectory($parent) | Out-Null
}
$tempPath = Join-Path $parent ("." + [System.IO.Path]::GetRandomFileName())
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
try {
  [System.IO.File]::WriteAllBytes($tempPath, [byte[]]::new(0))
  Set-PrivateFileAcl $tempPath
  [System.IO.File]::WriteAllText($tempPath, $content + [Environment]::NewLine, $utf8WithoutBom)
  if ($Force -or $Upgrade) {
    Move-Item -LiteralPath $tempPath -Destination $resolvedOutput -Force | Out-Null
  } else {
    [System.IO.File]::Move($tempPath, $resolvedOutput)
  }
  Set-PrivateFileAcl $resolvedOutput
} finally {
  if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
}

[Console]::Out.WriteLine($resolvedOutput)
