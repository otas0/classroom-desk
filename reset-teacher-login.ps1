#Requires -Version 5.1
<#
.SYNOPSIS
  Reset Classroom Desk teacher login to teacher / admin.

.DESCRIPTION
  Drop-in for old installs. Avoids Get-ScheduledTask / Get-CimInstance / PATH-dependent tools.
  Prefer reset-teacher-login.mjs when Windows Node works; otherwise still rewrites .env.
#>
param(
  [string]$InstallRoot = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$DEFAULT_USER = 'teacher'
$DEFAULT_PASS = 'admin'

function Write-ResetLog([string]$Msg, [string]$Color = 'Gray') {
  try { Write-Host ("[reset] {0}" -f $Msg) -ForegroundColor $Color }
  catch { Write-Host ("[reset] {0}" -f $Msg) }
}

function Resolve-InstallRoot {
  param([string]$Hint)
  $candidates = @()
  if ($Hint) { $candidates += $Hint.Trim().TrimEnd('\', '/') }
  if ($PSScriptRoot) { $candidates += $PSScriptRoot }
  $candidates += 'C:\ClassroomDesk'
  foreach ($c in $candidates) {
    if (-not $c) { continue }
    if ((Test-Path -LiteralPath (Join-Path $c '.env')) -or
        (Test-Path -LiteralPath (Join-Path $c 'Install.bat')) -or
        (Test-Path -LiteralPath (Join-Path $c 'apps\server\dist\index.mjs'))) {
      return (Resolve-Path -LiteralPath $c).Path
    }
  }
  throw 'Cannot find Classroom Desk install root. Copy this patch into C:\ClassroomDesk and retry.'
}

function Set-EnvKey([string]$EnvPath, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path -LiteralPath $EnvPath) {
    $lines = @(Get-Content -LiteralPath $EnvPath -ErrorAction SilentlyContinue)
  }
  $found = $false
  $next = foreach ($line in $lines) {
    if ($line -match ('^\s*' + [regex]::Escape($Key) + '\s*=')) {
      $found = $true
      "{0}={1}" -f $Key, $Value
    } else { $line }
  }
  if (-not $found) { $next = @($next) + ("{0}={1}" -f $Key, $Value) }
  $text = (($next | Where-Object { $_ -ne $null }) -join "`r`n").TrimEnd() + "`r`n"
  Set-Content -Path $EnvPath -Value $text -Encoding ASCII
}

function Find-WindowsNode([string]$Root) {
  $runtime = Join-Path $Root 'runtime'
  if (Test-Path -LiteralPath $runtime) {
    $candidates = Get-ChildItem -LiteralPath $runtime -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue
    foreach ($f in $candidates) {
      try {
        $fs = [IO.File]::OpenRead($f.FullName)
        try {
          $buf = New-Object byte[] 2
          if ($fs.Read($buf, 0, 2) -ge 2 -and $buf[0] -eq 0x4D -and $buf[1] -eq 0x5A) {
            return $f.FullName
          }
        } finally { $fs.Close() }
      } catch {}
    }
  }
  return $null
}

function Write-LoginCard([string]$Root) {
  $lines = @(
    'Classroom Desk — backup login (keep private)',
    '',
    'Username: teacher',
    'Password: admin',
    'Admin:    admin',
    '',
    'Open: http://127.0.0.1:8787/admin/',
    'After login, change the password in Settings.',
    '',
    "Reset ran from: $Root"
  )
  $desk = [Environment]::GetFolderPath('Desktop')
  if (-not $desk) { return }
  $out = Join-Path $desk 'ClassroomDesk-Desk-Login.txt'
  Set-Content -Path $out -Value ($lines -join "`r`n") -Encoding ASCII
  Write-ResetLog "Wrote $out" 'Green'
}

function Stop-ClassroomApi {
  # schtasks.exe is always present; ScheduledTasks module often is not.
  cmd /c "schtasks /End /TN ClassroomDeskServer /F >nul 2>&1"
  # Kill listeners on 8787 via netstat (no Get-NetTCPConnection)
  try {
    $lines = netstat -ano 2>$null | Select-String ':8787'
    foreach ($line in $lines) {
      if ($line -match 'LISTENING\s+(\d+)\s*$') {
        $procId = [int]$Matches[1]
        if ($procId -gt 0) { cmd /c "taskkill /F /PID $procId >nul 2>&1" }
      }
    }
  } catch {}
  Start-Sleep -Seconds 1
}

function Start-ClassroomApi {
  cmd /c "schtasks /Run /TN ClassroomDeskServer >nul 2>&1"
}

$Root = Resolve-InstallRoot -Hint $InstallRoot
Write-ResetLog "Install root: $Root" 'Cyan'

$envPath = Join-Path $Root '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  Write-ResetLog '.env missing — creating minimal file' 'Yellow'
  @(
    'JWT_SECRET=change-me-after-reset-please-rotate'
    "TEACHER_USERNAME=$DEFAULT_USER"
    "TEACHER_PASSWORD=$DEFAULT_PASS"
    "ADMIN_PASSWORD=$DEFAULT_PASS"
    'HOST=0.0.0.0'
    'PORT=8787'
  ) | Set-Content -Path $envPath -Encoding ASCII
} else {
  Set-EnvKey -EnvPath $envPath -Key 'TEACHER_USERNAME' -Value $DEFAULT_USER
  Set-EnvKey -EnvPath $envPath -Key 'TEACHER_PASSWORD' -Value $DEFAULT_PASS
  Set-EnvKey -EnvPath $envPath -Key 'ADMIN_PASSWORD' -Value $DEFAULT_PASS
}
Write-ResetLog "Updated $envPath → teacher / admin" 'Green'

Stop-ClassroomApi

$mjs = Join-Path $PSScriptRoot 'reset-teacher-login.mjs'
if (-not (Test-Path -LiteralPath $mjs)) { $mjs = Join-Path $Root 'reset-teacher-login.mjs' }

$dbOk = $false
$node = Find-WindowsNode -Root $Root
if ($node -and (Test-Path -LiteralPath $mjs)) {
  Write-ResetLog "DB reset via $node" 'Cyan'
  $env:CLASSROOM_DESK_ROOT = $Root
  Push-Location $Root
  try {
    & $node $mjs
    if ($LASTEXITCODE -eq 0) { $dbOk = $true }
    else { Write-ResetLog "mjs exit $LASTEXITCODE — .env still updated; restart API to align hash" 'Yellow' }
  } catch {
    Write-ResetLog ("mjs failed: {0}" -f $_.Exception.Message) 'Yellow'
  } finally {
    Pop-Location
    Remove-Item Env:CLASSROOM_DESK_ROOT -ErrorAction SilentlyContinue
  }
} else {
  Write-ResetLog 'No Windows node.exe or mjs — .env-only reset. Start API once to apply hashes.' 'Yellow'
}

# Keep clickable copies nested in install tree
$patches = Join-Path $Root 'patches'
try { New-Item -ItemType Directory -Path $patches -Force | Out-Null } catch {}
foreach ($name in @(
    'Reset-Teacher-Login.bat', 'reset-teacher-login.ps1', 'reset-teacher-login.mjs',
    'Force-Windows-Node.bat', 'ensure-windows-node.ps1', 'Start-ClassroomDesk.cmd'
  )) {
  foreach ($fromRoot in @($PSScriptRoot, $Root)) {
    $from = Join-Path $fromRoot $name
    if (Test-Path -LiteralPath $from) {
      Copy-Item -LiteralPath $from -Destination (Join-Path $Root $name) -Force -ErrorAction SilentlyContinue
      Copy-Item -LiteralPath $from -Destination (Join-Path $patches $name) -Force -ErrorAction SilentlyContinue
      break
    }
  }
}

Write-LoginCard -Root $Root
Start-ClassroomApi
Start-Sleep -Seconds 2

Write-Host ''
if ($dbOk) {
  Write-ResetLog 'OK — login teacher / admin, then change password in Settings.' 'Green'
} else {
  Write-ResetLog 'OK (.env) — start Start-ClassroomDesk.cmd once, then login teacher / admin.' 'Green'
}
try { Start-Process 'http://127.0.0.1:8787/admin/' } catch {}
exit 0
