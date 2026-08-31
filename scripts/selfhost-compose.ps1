[CmdletBinding()]
param(
  [Alias('d')][switch]$Detach,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ComposeArgs
)

function Normalize-ComposeArguments {
  param(
    [Parameter(Mandatory = $true)][string[]]$ComposeArguments,
    [switch]$Detach
  )

  if (-not $Detach) {
    return $ComposeArguments
  }

  $upIndex = -1
  for ($index = 0; $index -lt $ComposeArguments.Count; $index++) {
    if ($ComposeArguments[$index] -eq "--detach") {
      throw "Use either -d or --detach, not both."
    }
    if ($ComposeArguments[$index] -eq "up") {
      if ($upIndex -ne -1) {
        throw "Detach shorthand requires exactly one up subcommand."
      }
      $upIndex = $index
    }
  }
  if ($upIndex -lt 0) {
    throw "Detach shorthand is only valid with the up subcommand."
  }

  $normalized = [System.Collections.Generic.List[string]]::new()
  for ($index = 0; $index -lt $ComposeArguments.Count; $index++) {
    [void]$normalized.Add($ComposeArguments[$index])
    if ($index -eq $upIndex) {
      [void]$normalized.Add("--detach")
    }
  }
  return $normalized.ToArray()
}

if ($MyInvocation.InvocationName -ne '.') {
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

$backupDirectory = Join-Path $repoRoot "backups\selfhost"
if (Test-Path -LiteralPath $backupDirectory -PathType Leaf) {
  throw "Backup path exists but is not a directory: $backupDirectory"
}
[System.IO.Directory]::CreateDirectory($backupDirectory) | Out-Null

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw "selfhost backups require Windows ACL enforcement."
}
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$allowedSids = @(
  $currentSid,
  [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18"),
  [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
)
$allowedSidValues = @($allowedSids | ForEach-Object { $_.Value })

function Set-PrivateBackupAcl {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][System.Security.Principal.SecurityIdentifier[]]$AllowedSids,
    [Parameter(Mandatory = $true)][string[]]$AllowedSidValues
  )

  $item = Get-Item -LiteralPath $Path -Force
  $acl = Get-Acl -LiteralPath $item.FullName
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($existingRule in @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))) {
    $acl.PurgeAccessRules($existingRule.IdentityReference)
  }

  $inheritanceFlags = if ($item.PSIsContainer) {
    [System.Security.AccessControl.InheritanceFlags]::ObjectInherit -bor [System.Security.AccessControl.InheritanceFlags]::ContainerInherit
  } else {
    [System.Security.AccessControl.InheritanceFlags]::None
  }
  foreach ($sid in $AllowedSids) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritanceFlags,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $item.FullName -AclObject $acl

  $verifiedAcl = Get-Acl -LiteralPath $item.FullName
  if (-not $verifiedAcl.AreAccessRulesProtected) {
    throw "Backup ACL must be protected: $($item.FullName)"
  }
  $verifiedRules = @($verifiedAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  foreach ($verifiedRule in $verifiedRules) {
    if ($verifiedRule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny) {
      throw "Backup ACL must not contain Deny rules: $($item.FullName)"
    }
    $ruleSid = $verifiedRule.IdentityReference.Value
    if ($AllowedSidValues -notcontains $ruleSid) {
      throw "Backup ACL contains an unapproved SID: $($item.FullName)"
    }
    if (($verifiedRule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl) {
      throw "Backup ACL grant is not FullControl: $($item.FullName)"
    }
    if ($verifiedRule.InheritanceFlags -ne $inheritanceFlags -or $verifiedRule.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None) {
      throw "Backup ACL inheritance does not match item type: $($item.FullName)"
    }
  }
  foreach ($sid in $AllowedSids) {
    if (@($verifiedRules | Where-Object {
      $_.IdentityReference.Value -eq $sid.Value -and $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow
    }).Count -lt 1) {
      throw "Backup ACL is missing a required SID: $($item.FullName)"
    }
  }
}

$backupItems = @(
  Get-Item -LiteralPath $envPath -Force
  Get-Item -LiteralPath $backupDirectory -Force
  Get-ChildItem -LiteralPath $backupDirectory -Force -Recurse
)
foreach ($backupItem in $backupItems) {
  Set-PrivateBackupAcl -Path $backupItem.FullName -AllowedSids $allowedSids -AllowedSidValues $allowedSidValues
}

$ComposeArgs = Normalize-ComposeArguments -ComposeArguments $ComposeArgs -Detach:$Detach
& docker compose --project-name "workbuddy-selfhost" --env-file $envPath -f $composePath @ComposeArgs
exit $LASTEXITCODE
}
