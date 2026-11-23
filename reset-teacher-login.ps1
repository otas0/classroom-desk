#Requires -Version 5.1
<#
.SYNOPSIS
  Reset Classroom Desk teacher login to teacher / admin (also ADMIN_PASSWORD=admin).

.DESCRIPTION
  Drop this file (with Reset-Teacher-Login.bat + reset-teacher-login.mjs) into an
  existing install folder (usually C:\ClassroomDesk) and run the bat.
  Restarts ClassroomDeskServer when present. Teachers must change the password in Admin → 设置.
#>
param(
  [string]$InstallRoot = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Resolve-InstallRoot {
  param([string]$Hint)
  if ($Hint -and (Test-Path -LiteralPath (Join-Path $Hint '.env'))) { return (Resolve-Path $Hint).Path }
  if ($Hint -and (Test-Path -LiteralPath (Join-Path $Hint 'Install.bat'))) { return (Resolve-Path $Hint).Path }
  $here = $PSScriptRoot
  if (Test-Path -LiteralPath (Join-Path $here '.env')) { return $here }
  if (Test-Path -LiteralPath (Join-Path $here 'Install.bat')) { return $here }
  if (Test-Path -LiteralPath 'C:\ClassroomDesk\.env') { return 'C:\ClassroomDesk' }
  if (Test-Path -LiteralPath 'C:\ClassroomDesk\Install.bat') { return 'C:\ClassroomDesk' }
  throw 'Cannot find Classroom Desk install root (.env / Install.bat). Copy this patch into C:\ClassroomDesk and retry.'
}

function Find-PortableNode([string]$Root) {
  $runtime = Join-Path $Root 'runtime'
  if (Test-Path -LiteralPath $runtime) {
    $exe = Get-ChildItem -LiteralPath $runtime -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty FullName
    if ($exe) { return $exe }
  }
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
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
    'After login, change the password in 设置.',
    '',
    "Reset ran from: $Root"
  )
  $desk = [Environment]::GetFolderPath('Desktop')
  if (-not $desk) { return }
  $out = Join-Path $desk 'ClassroomDesk-Desk-Login.txt'
  Set-Content -Path $out -Value ($lines -join "`r`n") -Encoding UTF8
  Write-Host "Wrote $out" -ForegroundColor Green
}

$Root = Resolve-InstallRoot -Hint $InstallRoot
Write-Host "[reset] Install root: $Root" -ForegroundColor Cyan

$mjs = Join-Path $Root 'reset-teacher-login.mjs'
if (-not (Test-Path -LiteralPath $mjs)) {
  $mjs = Join-Path $PSScriptRoot 'reset-teacher-login.mjs'
}
if (-not (Test-Path -LiteralPath $mjs)) {
  throw 'reset-teacher-login.mjs missing next to this script'
}

$node = Find-PortableNode -Root $Root
if (-not $node) {
  throw 'node.exe not found. Run Service-Fix / Install.bat first so runtime Node exists.'
}

# Stop API briefly so SQLite is not locked.
$taskName = 'ClassroomDeskServer'
$hadTask = $false
try {
  $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($t) {
    $hadTask = $true
    Write-Host "[reset] Stopping $taskName…" -ForegroundColor Yellow
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
} catch {}

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Root*" -and $_.Name -match 'node' } |
  ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
Start-Sleep -Seconds 1

$env:CLASSROOM_DESK_ROOT = $Root
Push-Location $Root
try {
  Write-Host "[reset] $node $mjs" -ForegroundColor Cyan
  & $node $mjs
  if ($LASTEXITCODE -ne 0) { throw "reset-teacher-login.mjs failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
  Remove-Item Env:CLASSROOM_DESK_ROOT -ErrorAction SilentlyContinue
}

Write-LoginCard -Root $Root

# Keep a clickable copy nested in the install tree.
$batSrc = Join-Path $PSScriptRoot 'Reset-Teacher-Login.bat'
if (-not (Test-Path -LiteralPath $batSrc)) { $batSrc = Join-Path $Root 'Reset-Teacher-Login.bat' }
$patches = Join-Path $Root 'patches'
New-Item -ItemType Directory -Path $patches -Force | Out-Null
foreach ($name in @('Reset-Teacher-Login.bat', 'reset-teacher-login.ps1', 'reset-teacher-login.mjs')) {
  $from = Join-Path $PSScriptRoot $name
  if (-not (Test-Path -LiteralPath $from)) { $from = Join-Path $Root $name }
  if (Test-Path -LiteralPath $from) {
    Copy-Item -LiteralPath $from -Destination (Join-Path $Root $name) -Force
    Copy-Item -LiteralPath $from -Destination (Join-Path $patches $name) -Force
  }
}

if ($hadTask) {
  Write-Host "[reset] Starting $taskName…" -ForegroundColor Yellow
  Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

Write-Host ''
Write-Host 'OK — login with teacher / admin, then change password in Admin → 设置.' -ForegroundColor Green
try { Start-Process 'http://127.0.0.1:8787/admin/' } catch {}
