#Requires -Version 5.1
<#
.SYNOPSIS
  One-click Classroom Desk teacher-host install (Windows).

.DESCRIPTION
  Double-click Install-Teacher.bat, or run this script as Administrator.
  - Downloads portable Node 22 into the install folder (no separate Node setup in most cases)
  - Downloads latest GitHub Release source zip to C:\ClassroomDesk (no git required)
  - Writes .env + Desktop\ClassroomDesk-Desk-Login.txt
  - npm install, fonts, build teacher UI
  - Opens firewall TCP 8787, logon autostart, starts API, opens /admin/

.PARAMETER InstallRoot
  Default: C:\ClassroomDesk

.PARAMETER Tag
  Release tag (e.g. v0.1.8). Default: latest GitHub release.

.PARAMETER Repo
  owner/name on GitHub. Default: otas0/classroom-desk

.PARAMETER NodeVersion
  Portable Node version. Default: 22.14.0
#>
param(
  [string]$InstallRoot = 'C:\ClassroomDesk',
  [string]$Tag = '',
  [string]$Repo = 'otas0/classroom-desk',
  [string]$NodeVersion = '22.14.0',
  [switch]$SkipStart,
  [switch]$NoAutostart
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:NodeHome = $null
$script:NpmCmd = $null

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return }

  Write-Host 'Admin required. Re-launching elevated…' -ForegroundColor Yellow
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  if ($PSBoundParameters.ContainsKey('InstallRoot')) { $arg += " -InstallRoot `"$InstallRoot`"" }
  if ($Tag) { $arg += " -Tag `"$Tag`"" }
  if ($Repo) { $arg += " -Repo `"$Repo`"" }
  if ($NodeVersion) { $arg += " -NodeVersion `"$NodeVersion`"" }
  if ($SkipStart) { $arg += ' -SkipStart' }
  if ($NoAutostart) { $arg += ' -NoAutostart' }
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arg | Out-Null
  exit 0
}

function New-Secret([int]$Len = 32) {
  $bytes = New-Object byte[] $Len
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function New-Password {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $buf = New-Object byte[] 12
  $rng.GetBytes($buf)
  -join ($buf | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

function Get-GhHeaders {
  $h = @{
    'User-Agent' = 'ClassroomDesk-InstallTeacher'
    'Accept'     = 'application/vnd.github+json'
  }
  if ($env:GITHUB_TOKEN) { $h['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }
  return $h
}

function Get-LatestTag([string]$Repository) {
  $uri = "https://api.github.com/repos/$Repository/releases/latest"
  $rel = Invoke-RestMethod -Uri $uri -Headers (Get-GhHeaders) -TimeoutSec 60
  if (-not $rel.tag_name) { throw "Cannot read latest release: $uri" }
  return [string]$rel.tag_name
}

function Get-NodeArch {
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($arch -eq 'ARM64') { return 'win-arm64' }
  return 'win-x64'
}

function Ensure-PortableNode([string]$Root, [string]$Version) {
  $arch = Get-NodeArch
  $dirName = "node-v$Version-$arch"
  $nodeRoot = Join-Path $Root "runtime\$dirName"
  $nodeExe = Join-Path $nodeRoot 'node.exe'
  $npmCmd = Join-Path $nodeRoot 'npm.cmd'

  if ((Test-Path $nodeExe) -and (Test-Path $npmCmd)) {
    $script:NodeHome = $nodeRoot
    $script:NpmCmd = $npmCmd
    Write-Host "Portable Node ready: $(& $nodeExe -v)" -ForegroundColor Green
    return
  }

  $zipUrl = "https://nodejs.org/dist/v$Version/$dirName.zip"
  $zipPath = Join-Path $env:TEMP "$dirName.zip"
  $extractTo = Join-Path $Root 'runtime'
  New-Item -ItemType Directory -Path $extractTo -Force | Out-Null

  Write-Host "Downloading portable Node $Version ($arch)…" -ForegroundColor Cyan
  Write-Host "  $zipUrl"
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 600
  Expand-Archive -Path $zipPath -DestinationPath $extractTo -Force
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

  if (-not (Test-Path $nodeExe)) { throw "Portable Node missing after extract: $nodeExe" }
  $script:NodeHome = $nodeRoot
  $script:NpmCmd = $npmCmd
  Write-Host "Portable Node installed: $(& $nodeExe -v)" -ForegroundColor Green
}

function Install-FromZip([string]$Repository, [string]$ReleaseTag, [string]$Root) {
  $zipUrl = "https://github.com/$Repository/archive/refs/tags/$ReleaseTag.zip"
  $tmp = Join-Path $env:TEMP ("classroom-desk-$ReleaseTag.zip")
  Write-Host "Downloading $ReleaseTag source…" -ForegroundColor Cyan
  Invoke-WebRequest -Uri $zipUrl -OutFile $tmp -UseBasicParsing -TimeoutSec 600

  $extractParent = Join-Path $env:TEMP ("cd-src-" + [guid]::NewGuid().ToString('n'))
  New-Item -ItemType Directory -Path $extractParent -Force | Out-Null
  Expand-Archive -Path $tmp -DestinationPath $extractParent -Force
  $inner = Get-ChildItem $extractParent -Directory | Select-Object -First 1
  if (-not $inner) { throw 'Source zip empty' }

  $preserveRels = @('.env', 'apps\server\data', 'runtime')
  $backup = $null
  if (Test-Path $Root) {
    $backup = Join-Path $env:TEMP ("cd-keep-" + [guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($rel in $preserveRels) {
      $src = Join-Path $Root $rel
      if (Test-Path $src) {
        $dest = Join-Path $backup $rel
        New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
        Copy-Item -Path $src -Destination $dest -Recurse -Force
      }
    }
    # Keep runtime outside wipe if possible — remove only non-runtime then overlay
    Get-ChildItem -Path $Root -Force | Where-Object { $_.Name -ne 'runtime' } | Remove-Item -Recurse -Force
  } else {
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
  }

  Copy-Item -Path (Join-Path $inner.FullName '*') -Destination $Root -Recurse -Force

  if ($backup) {
    foreach ($rel in @('.env', 'apps\server\data')) {
      $src = Join-Path $backup $rel
      if (Test-Path $src) {
        $dest = Join-Path $Root $rel
        New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
        Copy-Item -Path $src -Destination $dest -Recurse -Force
      }
    }
  }

  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  Remove-Item $extractParent -Recurse -Force -ErrorAction SilentlyContinue
  if ($backup) { Remove-Item $backup -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Host "Installed to $Root" -ForegroundColor Green
}

function Ensure-EnvFile([string]$Root) {
  $envPath = Join-Path $Root '.env'
  $deskCard = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ClassroomDesk-Desk-Login.txt'
  if (Test-Path $envPath) {
    Write-Host '.env exists — keeping passwords. See Desktop ClassroomDesk-Desk-Login.txt if you still have it.' -ForegroundColor Yellow
    return $false
  }

  $teacherPass = New-Password
  $adminPass = New-Password
  @"
JWT_SECRET=$(New-Secret 32)
TEACHER_USERNAME=teacher
TEACHER_PASSWORD=$teacherPass
ADMIN_PASSWORD=$adminPass
HOST=0.0.0.0
PORT=8787
"@ | Set-Content -Path $envPath -Encoding UTF8

  $ips = @()
  try {
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.PrefixOrigin -ne 'WellKnown' -and
        $_.IPAddress -notlike '169.254.*'
      } | Select-Object -ExpandProperty IPAddress)
  } catch {}

  $lines = @(
    'Classroom Desk — teacher login (keep private)',
    '',
    'Admin UI:     http://127.0.0.1:8787/admin/',
    'Username:     teacher',
    "Password:     $teacherPass",
    "Admin pass:   $adminPass",
    ''
  )
  if ($ips.Count -gt 0) {
    $lines += 'Student apiBase (pick a working LAN IP):'
    foreach ($ip in $ips) { $lines += "  http://${ip}:8787" }
  } else {
    $lines += '(No LAN IPv4 found — check cable/Wi-Fi, then open /health)'
  }
  $lines += ''
  $lines += 'Later updates: Settings → One-click update (teacher host + student packages)'
  $lines -join "`r`n" | Set-Content -Path $deskCard -Encoding UTF8
  Write-Host "Wrote Desktop\ClassroomDesk-Desk-Login.txt" -ForegroundColor Green
  return $true
}

function Open-Firewall([int]$Port = 8787) {
  $ruleName = 'Classroom Desk API'
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if (-not $existing) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
      -LocalPort $Port -Action Allow -Profile Any | Out-Null
  } else {
    Enable-NetFirewallRule -DisplayName $ruleName | Out-Null
  }
  Write-Host "Firewall TCP $Port allowed"
}

function Register-Autostart([string]$Root) {
  $taskName = 'ClassroomDeskServer'
  $npm = $script:NpmCmd
  if (-not $npm) { throw 'npm path missing' }
  $arg = "/c cd /d `"$Root`" && `"$npm`" run start:classroom"
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $arg -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
  Write-Host "Autostart task: $taskName"
}

function Invoke-Npm([string]$Root, [string[]]$NpmArgs) {
  if (-not $script:NpmCmd) { throw 'npm not ready' }
  $env:Path = "$($script:NodeHome);$env:Path"
  Push-Location $Root
  try {
    & $script:NpmCmd @NpmArgs
    if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArgs -join ' ') failed ($LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

function Assert-ProductLayout([string]$Root) {
  $required = @(
    'package.json',
    'apps\server',
    'apps\teacher-web',
    'scripts\start-classroom.mjs'
  )
  foreach ($rel in $required) {
    $p = Join-Path $Root $rel
    if (-not (Test-Path $p)) { throw "Install incomplete — missing $rel under $Root" }
  }
  $pkg = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
  foreach ($s in @('start:classroom', 'start:server', 'build:teacher', 'fonts:cjk')) {
    if (-not $pkg.scripts.$s) { throw "package.json missing script '$s' — refusing to continue" }
  }
  Write-Host 'Product layout OK (server + teacher + start:classroom)' -ForegroundColor Green
}

function Wait-Health([int]$Port = 8787, [int]$Attempts = 30) {
  $uri = "http://127.0.0.1:$Port/health"
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) {
        Write-Host "health OK (attempt $i): HTTP $($r.StatusCode)" -ForegroundColor Green
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  Write-Host "health not ready after $Attempts attempts — open $uri manually" -ForegroundColor Yellow
  return $false
}

# --- main ---
Assert-Admin

if (-not $PSBoundParameters.ContainsKey('InstallRoot')) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
  # Running from a full repo checkout → install in-place
  if (
    (Test-Path (Join-Path $here 'package.json')) -and
    (Test-Path (Join-Path $here 'apps\server')) -and
    (Test-Path (Join-Path $here 'Install-Teacher.bat') -or (Test-Path (Join-Path $here 'install-teacher.ps1')))
  ) {
    $InstallRoot = $here
  }
}

Write-Host '=== Classroom Desk · Install Teacher Host ===' -ForegroundColor Cyan
Write-Host "Folder: $InstallRoot"

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
Ensure-PortableNode -Root $InstallRoot -Version $NodeVersion

if (-not $Tag) {
  Write-Host 'Checking latest GitHub Release…'
  $Tag = Get-LatestTag -Repository $Repo
}
Write-Host "Version: $Tag"

$pkg = Join-Path $InstallRoot 'package.json'
$marker = Join-Path $InstallRoot '.classroom-desk-installed-tag'
$installedTag = if (Test-Path $marker) { (Get-Content $marker -Raw).Trim() } else { '' }

if (-not (Test-Path $pkg)) {
  Install-FromZip -Repository $Repo -ReleaseTag $Tag -Root $InstallRoot
  Set-Content -Path $marker -Value $Tag -Encoding UTF8
  Ensure-PortableNode -Root $InstallRoot -Version $NodeVersion
} elseif ($installedTag -and $installedTag -ne $Tag -and -not (Test-Path (Join-Path $InstallRoot '.git'))) {
  Write-Host "Updating source $installedTag → $Tag (keeps data/.env/runtime)…" -ForegroundColor Cyan
  Install-FromZip -Repository $Repo -ReleaseTag $Tag -Root $InstallRoot
  Set-Content -Path $marker -Value $Tag -Encoding UTF8
  Ensure-PortableNode -Root $InstallRoot -Version $NodeVersion
} else {
  Write-Host 'Existing install kept. Day-to-day upgrades: admin UI one-click update.' -ForegroundColor Yellow
}

Assert-ProductLayout -Root $InstallRoot
$wroteLogin = Ensure-EnvFile -Root $InstallRoot

Write-Host 'npm install (first run may take several minutes)…' -ForegroundColor Cyan
Invoke-Npm $InstallRoot @('install')
Write-Host 'fonts:cjk…'
Invoke-Npm $InstallRoot @('run', 'fonts:cjk')
Write-Host 'build:teacher…'
Invoke-Npm $InstallRoot @('run', 'build:teacher')

# Re-check after build so a broken tree cannot be marked “done”
Assert-ProductLayout -Root $InstallRoot
$teacherDist = Join-Path $InstallRoot 'apps\teacher-web\dist\index.html'
if (-not (Test-Path $teacherDist)) {
  throw "Teacher UI build missing: $teacherDist"
}
Write-Host 'Teacher UI build present' -ForegroundColor Green

Open-Firewall -Port 8787
if (-not $NoAutostart) { Register-Autostart -Root $InstallRoot }

if (-not $SkipStart) {
  Write-Host 'Starting…' -ForegroundColor Cyan
  $startArg = "/c cd /d `"$InstallRoot`" && `"$($script:NpmCmd)`" run start:classroom"
  Start-Process -FilePath 'cmd.exe' -ArgumentList $startArg -WindowStyle Minimized
  $healthy = Wait-Health -Port 8787 -Attempts 36
  try { Start-Process 'http://127.0.0.1:8787/admin/' } catch {}
  if (-not $healthy) {
    Write-Host 'Setup finished files, but /health did not respond yet. Reboot or re-run Install-Teacher.bat if admin UI stays blank.' -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host '=== Done ===' -ForegroundColor Green
Write-Host "Folder:  $InstallRoot"
Write-Host 'Admin:   http://127.0.0.1:8787/admin/'
if ($wroteLogin) {
  Write-Host 'Login:   Desktop\ClassroomDesk-Desk-Login.txt' -ForegroundColor Yellow
}
Write-Host 'Students: install ClassroomDesk-Setup-*.exe from GitHub Releases → Find classroom'
Write-Host 'Updates:  Settings → One-click update (teacher host + student packages)'
