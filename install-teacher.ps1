#Requires -Version 5.1
<#
.SYNOPSIS
  One-click Classroom Desk teacher-host install (Windows).

.DESCRIPTION
  Double-click Install-Teacher.bat (Run as administrator), or run this script elevated.
  - If you already unzipped the GitHub source: installs in that folder (no git, no re-download of source)
  - Portable Node 22 (nodejs.org, then China mirror fallback)
  - npm uses npmmirror registry by default (school networks often block registry.npmjs.org)
  - Writes Desktop\ClassroomDesk-Desk-Login.txt + install log
  - Firewall 8787, logon autostart, start API, open /admin/
#>
param(
  [string]$InstallRoot = 'C:\ClassroomDesk',
  [string]$Tag = '',
  [string]$Repo = 'otas0/classroom-desk',
  [string]$NodeVersion = '22.14.0',
  [switch]$SkipStart,
  [switch]$NoAutostart,
  [switch]$SkipSourceDownload
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:NodeHome = $null
$script:NpmCmd = $null
$script:LogPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ClassroomDesk-Install-Log.txt'

function Write-Log([string]$Message, [string]$Color = 'White') {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message
  try { Add-Content -Path $script:LogPath -Value $line -Encoding UTF8 } catch {}
  Write-Host $Message -ForegroundColor $Color
}

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return }

  Write-Log 'Admin required. Re-launching elevated…' 'Yellow'
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  if ($PSBoundParameters.ContainsKey('InstallRoot')) { $arg += " -InstallRoot `"$InstallRoot`"" }
  if ($Tag) { $arg += " -Tag `"$Tag`"" }
  if ($Repo) { $arg += " -Repo `"$Repo`"" }
  if ($NodeVersion) { $arg += " -NodeVersion `"$NodeVersion`"" }
  if ($SkipStart) { $arg += ' -SkipStart' }
  if ($NoAutostart) { $arg += ' -NoAutostart' }
  if ($SkipSourceDownload) { $arg += ' -SkipSourceDownload' }
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

function Get-NodeArch {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { return 'win-arm64' }
  return 'win-x64'
}

function Save-Url([string]$Url, [string]$OutFile) {
  Write-Log "GET $Url"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 600
}

function Save-UrlFirstOk([string[]]$Urls, [string]$OutFile) {
  $errs = @()
  foreach ($url in $Urls) {
    try {
      Save-Url -Url $url -OutFile $OutFile
      if ((Test-Path $OutFile) -and ((Get-Item $OutFile).Length -gt 1000)) { return $url }
    } catch {
      $errs += ("{0} => {1}" -f $url, $_.Exception.Message)
      Write-Log ("failed: {0}" -f $_.Exception.Message) 'Yellow'
    }
  }
  throw ("Download failed. Tried:`n  {0}" -f ($errs -join "`n  "))
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
    Write-Log ("Portable Node ready: {0}" -f (& $nodeExe -v)) 'Green'
    return
  }

  $zipPath = Join-Path $env:TEMP "$dirName.zip"
  $extractTo = Join-Path $Root 'runtime'
  New-Item -ItemType Directory -Path $extractTo -Force | Out-Null

  $urls = @(
    "https://nodejs.org/dist/v$Version/$dirName.zip",
    "https://npmmirror.com/mirrors/node/v$Version/$dirName.zip",
    "https://cdn.npmmirror.com/binaries/node/v$Version/$dirName.zip"
  )
  Write-Log "Downloading portable Node $Version ($arch)…" 'Cyan'
  Save-UrlFirstOk -Urls $urls -OutFile $zipPath | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $extractTo -Force
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

  if (-not (Test-Path $nodeExe)) { throw "Portable Node missing after extract: $nodeExe" }
  $script:NodeHome = $nodeRoot
  $script:NpmCmd = $npmCmd
  Write-Log ("Portable Node installed: {0}" -f (& $nodeExe -v)) 'Green'
}

function Get-LocalTag([string]$Root) {
  $pkgPath = Join-Path $Root 'package.json'
  if (-not (Test-Path $pkgPath)) { return '' }
  try {
    $pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($pkg.version) { return ('v{0}' -f $pkg.version) }
  } catch {}
  return ''
}

function Get-LatestTag([string]$Repository) {
  $headers = @{
    'User-Agent' = 'ClassroomDesk-InstallTeacher'
    'Accept'     = 'application/vnd.github+json'
  }
  if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }
  $uri = "https://api.github.com/repos/$Repository/releases/latest"
  $rel = Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 60
  if (-not $rel.tag_name) { throw "Cannot read latest release: $uri" }
  return [string]$rel.tag_name
}

function Install-FromZip([string]$Repository, [string]$ReleaseTag, [string]$Root) {
  $urls = @(
    "https://github.com/$Repository/archive/refs/tags/$ReleaseTag.zip",
    "https://codeload.github.com/$Repository/zip/refs/tags/$ReleaseTag",
    "https://mirror.ghproxy.com/https://github.com/$Repository/archive/refs/tags/$ReleaseTag.zip"
  )
  $tmp = Join-Path $env:TEMP ("classroom-desk-$ReleaseTag.zip")
  Write-Log "Downloading $ReleaseTag source…" 'Cyan'
  Save-UrlFirstOk -Urls $urls -OutFile $tmp | Out-Null

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
  Write-Log "Installed to $Root" 'Green'
}

function Ensure-EnvFile([string]$Root) {
  $envPath = Join-Path $Root '.env'
  $deskCard = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ClassroomDesk-Desk-Login.txt'
  if (Test-Path $envPath) {
    Write-Log '.env exists — keeping passwords.' 'Yellow'
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
  $lines += "Install log: $script:LogPath"
  $lines -join "`r`n" | Set-Content -Path $deskCard -Encoding UTF8
  Write-Log 'Wrote Desktop\ClassroomDesk-Desk-Login.txt' 'Green'
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
  Write-Log "Firewall TCP $Port allowed"
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
  Write-Log "Autostart task: $taskName"
}

function Invoke-Npm([string]$Root, [string[]]$NpmArgs) {
  if (-not $script:NpmCmd) { throw 'npm not ready' }
  $env:Path = "$($script:NodeHome);$env:Path"
  Push-Location $Root
  try {
    & $script:NpmCmd @NpmArgs
    if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArgs -join ' ') failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

function Assert-ProductLayout([string]$Root) {
  foreach ($rel in @('package.json', 'apps\server', 'apps\teacher-web', 'scripts\start-classroom.mjs')) {
    if (-not (Test-Path (Join-Path $Root $rel))) {
      throw "Install incomplete — missing $rel under $Root"
    }
  }
  $pkg = Get-Content (Join-Path $Root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($s in @('start:classroom', 'start:server', 'build:teacher', 'fonts:cjk')) {
    if (-not $pkg.scripts.$s) { throw "package.json missing script '$s'" }
  }
  Write-Log 'Product layout OK' 'Green'
}

function Wait-Health([int]$Port = 8787, [int]$Attempts = 36) {
  $uri = "http://127.0.0.1:$Port/health"
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) {
        Write-Log ("health OK (attempt {0})" -f $i) 'Green'
        return $true
      }
    } catch { Start-Sleep -Seconds 2 }
  }
  Write-Log "health not ready — open $uri manually" 'Yellow'
  return $false
}

# --- main ---
try {
  try { '' | Set-Content -Path $script:LogPath -Encoding UTF8 } catch {}
  Assert-Admin

  if (-not $PSBoundParameters.ContainsKey('InstallRoot')) {
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
    if (
      (Test-Path (Join-Path $here 'package.json')) -and
      (Test-Path (Join-Path $here 'apps\server')) -and
      ((Test-Path (Join-Path $here 'Install-Teacher.bat')) -or (Test-Path (Join-Path $here 'install-teacher.ps1')))
    ) {
      $InstallRoot = $here
      $SkipSourceDownload = $true
    }
  }

  Write-Log '=== Classroom Desk · Install Teacher Host ===' 'Cyan'
  Write-Log "Folder: $InstallRoot"
  Write-Log "Log:    $script:LogPath"

  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  Ensure-PortableNode -Root $InstallRoot -Version $NodeVersion

  # Prefer local unzip; do not require GitHub API when source is already present
  $pkg = Join-Path $InstallRoot 'package.json'
  $localTag = Get-LocalTag -Root $InstallRoot
  if (-not $Tag) {
    if ($localTag) {
      $Tag = $localTag
      Write-Log "Using local package.json version: $Tag (no GitHub API)"
    } else {
      try {
        Write-Log 'Checking latest GitHub Release…'
        $Tag = Get-LatestTag -Repository $Repo
      } catch {
        throw "Cannot reach GitHub API and no local source. Unzip v0.1.9 source zip first, or fix network. Detail: $($_.Exception.Message)"
      }
    }
  }
  Write-Log "Version: $Tag"

  $marker = Join-Path $InstallRoot '.classroom-desk-installed-tag'
  $installedTag = if (Test-Path $marker) { (Get-Content $marker -Raw).Trim() } else { '' }

  if ($SkipSourceDownload -and (Test-Path $pkg)) {
    Write-Log 'Local source detected — skip GitHub source download.' 'Green'
    Set-Content -Path $marker -Value $Tag -Encoding UTF8
  } elseif (-not (Test-Path $pkg)) {
    Install-FromZip -Repository $Repo -ReleaseTag $Tag -Root $InstallRoot
    Set-Content -Path $marker -Value $Tag -Encoding UTF8
    Ensure-PortableNode -Root $InstallRoot -Version $NodeVersion
  } elseif ($installedTag -and $installedTag -ne $Tag -and -not (Test-Path (Join-Path $InstallRoot '.git'))) {
    Write-Log "Updating source $installedTag → $Tag…" 'Cyan'
    Install-FromZip -Repository $Repo -ReleaseTag $Tag -Root $InstallRoot
    Set-Content -Path $marker -Value $Tag -Encoding UTF8
    Ensure-PortableNode -Root $InstallRoot -Version $NodeVersion
  } else {
    Write-Log 'Existing install kept.' 'Yellow'
  }

  Assert-ProductLayout -Root $InstallRoot
  $wroteLogin = Ensure-EnvFile -Root $InstallRoot

  Write-Log 'Configure npm registry (npmmirror, school-friendly)…'
  Invoke-Npm $InstallRoot @('config', 'set', 'registry', 'https://registry.npmmirror.com')

  Write-Log 'npm install (first run may take several minutes)…' 'Cyan'
  Invoke-Npm $InstallRoot @('install')

  Write-Log 'fonts:cjk…'
  try {
    Invoke-Npm $InstallRoot @('run', 'fonts:cjk')
  } catch {
    Write-Log ("fonts:cjk skipped (optional for first class): {0}" -f $_.Exception.Message) 'Yellow'
  }

  Write-Log 'build:teacher…' 'Cyan'
  Invoke-Npm $InstallRoot @('run', 'build:teacher')

  Assert-ProductLayout -Root $InstallRoot
  $teacherDist = Join-Path $InstallRoot 'apps\teacher-web\dist\index.html'
  if (-not (Test-Path $teacherDist)) { throw "Teacher UI build missing: $teacherDist" }
  Write-Log 'Teacher UI build present' 'Green'

  Open-Firewall -Port 8787
  if (-not $NoAutostart) { Register-Autostart -Root $InstallRoot }

  if (-not $SkipStart) {
    Write-Log 'Starting…' 'Cyan'
    $startArg = "/c cd /d `"$InstallRoot`" && `"$($script:NpmCmd)`" run start:classroom"
    Start-Process -FilePath 'cmd.exe' -ArgumentList $startArg -WindowStyle Minimized
    $healthy = Wait-Health -Port 8787 -Attempts 36
    try { Start-Process 'http://127.0.0.1:8787/admin/' } catch {}
    if (-not $healthy) {
      Write-Log 'Files installed, but /health not ready yet. Re-run bat or open admin URL later.' 'Yellow'
    }
  }

  Write-Log '=== Done ===' 'Green'
  Write-Log "Folder:  $InstallRoot"
  Write-Log 'Admin:   http://127.0.0.1:8787/admin/'
  if ($wroteLogin) { Write-Log 'Login:   Desktop\ClassroomDesk-Desk-Login.txt' 'Yellow' }
  Write-Log "Log:     $script:LogPath"
  exit 0
} catch {
  Write-Log ('INSTALL FAILED: ' + $_.Exception.Message) 'Red'
  Write-Log "See full log: $script:LogPath" 'Yellow'
  Write-Host ''
  Write-Host $_.ScriptStackTrace
  exit 1
}
