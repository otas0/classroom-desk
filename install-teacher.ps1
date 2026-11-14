#Requires -Version 5.1
<#
.SYNOPSIS
  Classroom Desk teacher-host install (Windows).

.DESCRIPTION
  Run Install.bat as administrator.
  - Prefers a complete local product pack
  - If files are missing, auto-repairs via network mirrors (npmmirror + GitHub mirrors)
  - Portable Node (bundled zip or download)
  - Desktop login + student LAN install tips
  - Firewall 8787, logon autostart, start API
#>
param(
  [string]$InstallRoot = 'C:\ClassroomDesk',
  [string]$Tag = '',
  [string]$Repo = 'otas0/classroom-desk',
  [string]$NodeVersion = '22.14.0',
  [switch]$SkipStart,
  [switch]$NoAutostart,
  [switch]$SkipSourceDownload,
  [switch]$ChinaMirrorsFirst,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:NodeHome = $null
$script:NpmCmd = $null

function Get-InteractiveUserDesktopDirs {
  # Desktops of the person at the keyboard (not Public, not necessarily Administrator).
  $dirs = New-Object System.Collections.Generic.List[string]
  function Add-Desk([string]$d) {
    if (-not $d) { return }
    try {
      if (-not (Test-Path -LiteralPath $d)) { return }
    } catch { return }
    if (-not $dirs.Contains($d)) { [void]$dirs.Add($d) }
  }

  $userNames = New-Object System.Collections.Generic.List[string]
  try {
    $ex = Get-Process -Name explorer -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ex) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($ex.Id)" -ErrorAction SilentlyContinue
      if ($proc) {
        $ow = Invoke-CimMethod -InputObject $proc -MethodName GetOwner -ErrorAction SilentlyContinue
        if ($ow -and $ow.ReturnValue -eq 0 -and $ow.User) { [void]$userNames.Add([string]$ow.User) }
      }
    }
  } catch {}
  try {
    $cs = (Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue).UserName
    if ($cs) { [void]$userNames.Add(($cs -split '\\')[-1]) }
  } catch {}

  foreach ($name in @($userNames | Select-Object -Unique)) {
    if (-not $name -or $name -match '^(SYSTEM|LOCAL SERVICE|NETWORK SERVICE|defaultuser0)$') { continue }
    try {
      Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList' -ErrorAction SilentlyContinue | ForEach-Object {
        $img = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).ProfileImagePath
        if ($img -and ($img -eq "C:\Users\$name" -or $img.EndsWith("\$name"))) {
          Add-Desk (Join-Path $img 'Desktop')
        }
      }
    } catch {}
    Add-Desk (Join-Path "C:\Users\$name" 'Desktop')
  }

  # Last resort when elevated as the same teacher account.
  Add-Desk ([Environment]::GetFolderPath('Desktop'))
  return @($dirs)
}

# Public Desktop: non-secret tips + install log (students may see — never put passwords here).
$script:PublicDesk = [Environment]::GetFolderPath('CommonDesktopDirectory')
$script:PrivateDeskDirs = @(Get-InteractiveUserDesktopDirs)
$script:LogDirs = @(
  @($script:PrivateDeskDirs) + @($script:PublicDesk)
) | Where-Object { $_ } | Select-Object -Unique
$script:LogPath = Join-Path ($(if ($script:PrivateDeskDirs.Count) { $script:PrivateDeskDirs[0] } else { $script:PublicDesk })) 'ClassroomDesk-Install-Log.txt'

function Write-Log([string]$Message, [string]$Color = 'White') {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message
  foreach ($d in $script:LogDirs) {
    try {
      Add-Content -Path (Join-Path $d 'ClassroomDesk-Install-Log.txt') -Value $line -Encoding UTF8
    } catch {}
  }
  Write-Host $Message -ForegroundColor $Color
}

function Write-PublicDeskFile([string]$FileName, [string]$Content) {
  # Visible to all local users — no passwords.
  $targets = @($script:PublicDesk) + @($script:PrivateDeskDirs) | Where-Object { $_ } | Select-Object -Unique
  foreach ($d in $targets) {
    try { Set-Content -Path (Join-Path $d $FileName) -Value $Content -Encoding UTF8 } catch {}
  }
}

function Write-PrivateDeskFile([string]$FileName, [string]$Content) {
  # Secrets only on the interactive teacher's Desktop(s) — never Public Desktop.
  $targets = @($script:PrivateDeskDirs)
  if (-not $targets.Count) { $targets = @([Environment]::GetFolderPath('Desktop')) }
  foreach ($d in $targets) {
    if (-not $d) { continue }
    try { Set-Content -Path (Join-Path $d $FileName) -Value $Content -Encoding UTF8 } catch {}
  }
  # Remove accidental copies from older installs on Public Desktop.
  if ($script:PublicDesk) {
    $leak = Join-Path $script:PublicDesk $FileName
    if (Test-Path -LiteralPath $leak) {
      try { Remove-Item -LiteralPath $leak -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
}

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return }

  Write-Host 'Admin required. Re-launching elevated (waiting)…' -ForegroundColor Yellow
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  # Always pass InstallRoot so elevation does not guess wrong folder.
  $arg += " -InstallRoot `"$InstallRoot`""
  if ($Tag) { $arg += " -Tag `"$Tag`"" }
  if ($Repo) { $arg += " -Repo `"$Repo`"" }
  if ($NodeVersion) { $arg += " -NodeVersion `"$NodeVersion`"" }
  if ($SkipStart) { $arg += ' -SkipStart' }
  if ($NoAutostart) { $arg += ' -NoAutostart' }
  if ($SkipSourceDownload) { $arg += ' -SkipSourceDownload' }
  if ($ChinaMirrorsFirst) { $arg += ' -ChinaMirrorsFirst' }
  if ($CheckOnly) { $arg += ' -CheckOnly' }
  # CRITICAL: wait + propagate exit code (Teacher-Setup used to think install succeeded instantly).
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arg -Wait -PassThru
  if ($null -eq $p) { exit 1 }
  exit $p.ExitCode
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
  New-Item -ItemType Directory -Path (Split-Path $OutFile -Parent) -Force | Out-Null
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    # Resume (-C -) so flaky school nets can continue instead of restarting.
    $args = @(
      '-fL', '--connect-timeout', '20', '--retry', '8', '--retry-delay', '3',
      '--retry-all-errors', '-C', '-', '-o', $OutFile, $Url
    )
    $p = Start-Process -FilePath $curl.Source -ArgumentList $args -Wait -PassThru -NoNewWindow
    if ($p.ExitCode -ne 0) { throw "curl exit $($p.ExitCode) for $Url" }
  } else {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 600
  }
}

function Save-UrlFirstOk([string[]]$Urls, [string]$OutFile, [int64]$MinBytes = 1000) {
  $errs = @()
  $i = 0
  foreach ($url in $Urls) {
    $i++
    # Per-URL partial so resume never mixes bytes from different mirrors.
    $partial = "$OutFile.part$i"
    try {
      Save-Url -Url $url -OutFile $partial
      if ((Test-Path $partial) -and ((Get-Item $partial).Length -gt $MinBytes)) {
        Move-Item -LiteralPath $partial -Destination $OutFile -Force
        return $url
      }
      throw "download too small"
    } catch {
      $errs += ("{0} => {1}" -f $url, $_.Exception.Message)
      Write-Log ("failed: {0}" -f $_.Exception.Message) 'Yellow'
      # Keep .part for resume of the same mirror on next Install.bat run.
    }
  }
  throw ("Download failed. Tried:`n  {0}" -f ($errs -join "`n  "))
}

function Find-BundledNodeZip([string]$Root, [string]$DirName) {
  $names = @("$DirName.zip", "node-win-x64.zip", "node.zip")
  $dirs = @(
    (Join-Path $Root 'downloads'),
    (Join-Path $Root 'runtime'),
    (Join-Path (Split-Path $Root -Parent) 'downloads'),
    (Join-Path $PSScriptRoot 'downloads'),
    (Join-Path (Split-Path $PSScriptRoot -Parent) 'downloads')
  )
  foreach ($d in $dirs) {
    if (-not $d -or -not (Test-Path $d)) { continue }
    foreach ($n in $names) {
      $p = Join-Path $d $n
      if ((Test-Path $p) -and ((Get-Item $p).Length -gt 1MB)) { return $p }
    }
    $hit = Get-ChildItem -Path $d -Filter 'node-v*-win-*.zip' -ErrorAction SilentlyContinue |
      Sort-Object Length -Descending | Select-Object -First 1
    if ($hit -and $hit.Length -gt 1MB) { return $hit.FullName }
  }
  return $null
}

function Ensure-PortableNode([string]$Root, [string]$Version) {
  $arch = Get-NodeArch
  $dirName = "node-v$Version-$arch"
  $nodeRoot = Join-Path $Root "runtime\$dirName"
  $nodeExe = Join-Path $nodeRoot 'node.exe'
  $npmCmd = Join-Path $nodeRoot 'npm.cmd'

  if (
    (Test-Path $nodeExe) -and ((Get-Item $nodeExe).Length -gt 1MB) -and
    (Test-Path $npmCmd)
  ) {
    $script:NodeHome = $nodeRoot
    $script:NpmCmd = $npmCmd
    Write-Log ("Portable Node ready: {0}" -f (& $nodeExe -v)) 'Green'
    return
  }

  $extractTo = Join-Path $Root 'runtime'
  New-Item -ItemType Directory -Path $extractTo -Force | Out-Null

  $bundled = Find-BundledNodeZip -Root $Root -DirName $dirName
  if ($bundled) {
    Write-Log ("Using bundled Node zip: {0}" -f $bundled) 'Green'
    Expand-Archive -Path $bundled -DestinationPath $extractTo -Force
  } else {
    $zipPath = Join-Path $env:TEMP "$dirName.zip"
    $urls = @(
      "https://npmmirror.com/mirrors/node/v$Version/$dirName.zip",
      "https://cdn.npmmirror.com/binaries/node/v$Version/$dirName.zip",
      "https://nodejs.org/dist/v$Version/$dirName.zip"
    )
    Write-Log "Downloading portable Node $Version ($arch)…" 'Cyan'
    Save-UrlFirstOk -Urls $urls -OutFile $zipPath | Out-Null
    $dlDir = Join-Path $Root 'downloads'
    New-Item -ItemType Directory -Path $dlDir -Force | Out-Null
    Copy-Item -LiteralPath $zipPath -Destination (Join-Path $dlDir "$dirName.zip") -Force
    Expand-Archive -Path $zipPath -DestinationPath $extractTo -Force
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path $nodeExe)) { throw "Portable Node missing after extract: $nodeExe" }
  $script:NodeHome = $nodeRoot
  $script:NpmCmd = $npmCmd
  Write-Log ("Portable Node installed: {0}" -f (& $nodeExe -v)) 'Green'
}

function Get-NetworkMinimumHelp {
  return @"
NETWORK MINIMUM (Classroom Desk)

After a COMPLETE install, public internet required: NONE.
Classroom needs only teacher↔student LAN.

Easiest path: double-click Teacher-Setup.exe (or Install.bat as Administrator).

To finish install when auto-repair cannot fill gaps, you need ONE of:
  A) One complete ClassroomDesk folder (from ClassroomDesk-*-win-x64.zip / Dist)
     → then Teacher-Setup / Install.bat uses ZERO public network
  B) Enough network to finish ONE resumable download:
     ClassroomDesk-<version>-win-x64.zip (via GitHub mirrors)
     → re-run Teacher-Setup.exe or Install.bat; curl -C - resumes per mirror

Do NOT npm-install from scratch on a flaky school net if you can get the Dist zip once.
Log: your Desktop\ClassroomDesk-Install-Log.txt

--- If install failed, check the LAST 30 lines of the log, then:

Port 8787 already in use
  → Close the old Classroom Desk window, or reboot, then re-run Setup.
  → Task Scheduler → ClassroomDeskServer (SYSTEM @ startup)

Incomplete pack / download failed
  → Need ONE Dist zip once (mirrors + curl resume). Then re-run Setup offline.

SmartScreen / blocked exe
  → More info → Run anyway (expected until Setup is code-signed)
  → Or run Unblock-ClassroomDesk.bat — do NOT turn off Defender

Network share / UNC path
  → Copy to C:\ClassroomDesk on a local disk first

Teacher laptop hotspot
  → Not for real classes (IP changes / sleep). Use classroom Ethernet or fixed AP.
"@
}

function Get-ProductPackHelp {
  return (Get-NetworkMinimumHelp)
}

function Write-NetworkMinimumCard {
  Write-PublicDeskFile -FileName 'ClassroomDesk-Network-Minimum.txt' -Content (Get-NetworkMinimumHelp)
  Write-Log 'Wrote Desktop\ClassroomDesk-Network-Minimum.txt' 'Yellow'
}

function Stop-ListeningPort([int]$Port = 8787) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in @($conns)) {
      try {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Log ("Stopped process on port {0} (pid {1})" -f $Port, $c.OwningProcess) 'Yellow'
      } catch {}
    }
  } catch {}
  Start-Sleep -Seconds 1
}

function Test-PackManifest([string]$Root) {
  $manifestPath = Join-Path $Root 'PACK-MANIFEST.json'
  if (-not (Test-Path $manifestPath)) { return $true }
  try {
    $m = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Write-Log 'PACK-MANIFEST.json unreadable — will repair' 'Yellow'
    return $false
  }
  $ok = $true
  foreach ($item in @($m.files)) {
    $p = Join-Path $Root ([string]$item.path)
    if (-not (Test-Path $p)) {
      Write-Log ("missing: {0}" -f $item.path) 'Yellow'
      $ok = $false
      continue
    }
    $min = [int64]$item.minBytes
    if ($min -gt 0) {
      $len = (Get-Item -LiteralPath $p).Length
      if ($len -lt $min) {
        Write-Log ("too small (corrupt download?): {0} size={1} need>={2}" -f $item.path, $len, $min) 'Yellow'
        $ok = $false
      }
    }
  }
  return $ok
}

function Set-ChinaNpmEnv {
  $env:npm_config_registry = 'https://registry.npmmirror.com'
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
  $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
}

function Write-ReadyMarker([string]$Root, [string]$Ver) {
  $marker = @{
    product   = $true
    version   = $Ver
    repairedAt = (Get-Date).ToString('o')
    platform  = 'win32-x64'
    serverEntry = 'apps/server/dist/index.mjs'
    note      = 'Ready after install/repair. Install.bat may skip rebuild when present.'
  } | ConvertTo-Json
  Set-Content -Path (Join-Path $Root '.classroom-desk-ready') -Value $marker -Encoding UTF8
  Set-Content -Path (Join-Path $Root '.classroom-desk-offline-ready') -Value $marker -Encoding UTF8
}

function Repair-StudentSetup([string]$Root, [string]$Repository, [string]$ReleaseTag) {
  $ver = $ReleaseTag.TrimStart('v')
  if (-not $ver) { return @() }
  $name = "ClassroomDesk-Setup-$ver-x64.exe"
  $destDir = Join-Path $Root 'apps\server\data\upgrades'
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  $dest = Join-Path $destDir $name
  if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 1MB)) {
    Unblock-File -LiteralPath $dest -ErrorAction SilentlyContinue
    return @($name)
  }
  $beside = Join-Path (Split-Path $Root -Parent) "students\$name"
  if ((Test-Path $beside) -and ((Get-Item $beside).Length -gt 1MB)) {
    Copy-Item -LiteralPath $beside -Destination $dest -Force
    Unblock-File -LiteralPath $dest -ErrorAction SilentlyContinue
    return @($name)
  }
  $urls = @(
    "https://mirror.ghproxy.com/https://github.com/$Repository/releases/download/$ReleaseTag/$name",
    "https://ghproxy.net/https://github.com/$Repository/releases/download/$ReleaseTag/$name",
    "https://github.com/$Repository/releases/download/$ReleaseTag/$name"
  )
  Write-Log "Repair: downloading student Setup $name…" 'Cyan'
  try {
    Save-UrlFirstOk -Urls $urls -OutFile $dest | Out-Null
    Unblock-File -LiteralPath $dest -ErrorAction SilentlyContinue
    $stu = Join-Path (Split-Path $Root -Parent) 'students'
    New-Item -ItemType Directory -Path $stu -Force | Out-Null
    Copy-Item -LiteralPath $dest -Destination (Join-Path $stu $name) -Force -ErrorAction SilentlyContinue
    return @($name)
  } catch {
    Write-Log ("Student Setup download skipped: {0}" -f $_.Exception.Message) 'Yellow'
    return @()
  }
}

function Merge-ClassroomDeskTree([string]$FromDir, [string]$Root) {
  if (-not (Test-Path $FromDir)) { return }
  $preserve = @('.env', 'apps\server\data')
  $backup = $null
  foreach ($rel in $preserve) {
    $src = Join-Path $Root $rel
    if (Test-Path $src) {
      if (-not $backup) {
        $backup = Join-Path $env:TEMP ("cd-keep-" + [guid]::NewGuid().ToString('n'))
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
      }
      $dest = Join-Path $backup $rel
      New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
      Copy-Item -Path $src -Destination $dest -Recurse -Force
    }
  }
  Copy-Item -Path (Join-Path $FromDir '*') -Destination $Root -Recurse -Force
  if ($backup) {
    foreach ($rel in $preserve) {
      $src = Join-Path $backup $rel
      if (Test-Path $src) {
        $dest = Join-Path $Root $rel
        New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
        Copy-Item -Path $src -Destination $dest -Recurse -Force
      }
    }
    Remove-Item $backup -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Repair-FromProductZip([string]$Root, [string]$Repository, [string]$ReleaseTag) {
  # Lowest-network repair: ONE resumable Dist zip (has Node + node_modules + dist).
  $tag = $ReleaseTag
  if (-not $tag) { $tag = 'v0.1.10' }
  $ver = $tag.TrimStart('v')
  $name = "ClassroomDesk-$ver-win-x64.zip"
  $dlDir = Join-Path $Root 'downloads'
  New-Item -ItemType Directory -Path $dlDir -Force | Out-Null
  $zipPath = Join-Path $dlDir $name
  $urls = @(
    "https://mirror.ghproxy.com/https://github.com/$Repository/releases/download/$tag/$name",
    "https://ghproxy.net/https://github.com/$Repository/releases/download/$tag/$name",
    "https://github.com/$Repository/releases/download/$tag/$name"
  )
  Write-Log "Repair (min network): one product zip $name (resumable)…" 'Cyan'
  Save-UrlFirstOk -Urls $urls -OutFile $zipPath -MinBytes 5MB | Out-Null

  $extractParent = Join-Path $env:TEMP ("cd-dist-" + [guid]::NewGuid().ToString('n'))
  New-Item -ItemType Directory -Path $extractParent -Force | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $extractParent -Force
  $inner = Get-ChildItem $extractParent -Directory | Where-Object { $_.Name -eq 'ClassroomDesk' } | Select-Object -First 1
  if (-not $inner) {
    $inner = Get-ChildItem $extractParent -Directory | Select-Object -First 1
  }
  if (-not $inner) { throw "Product zip empty: $name" }
  $from = $inner.FullName
  if (Test-Path (Join-Path $from 'ClassroomDesk\package.json')) {
    $from = Join-Path $from 'ClassroomDesk'
  }
  Merge-ClassroomDeskTree -FromDir $from -Root $Root
  Remove-Item $extractParent -Recurse -Force -ErrorAction SilentlyContinue
  Write-Log 'Product zip merged into install folder.' 'Green'
  return $tag
}

function Repair-ProductPack([string]$Root, [string]$Repository, [string]$ReleaseTag, [string]$NodeVer) {
  Write-Log 'Incomplete pack — repair with minimal network…' 'Cyan'
  Set-ChinaNpmEnv
  New-Item -ItemType Directory -Path $Root -Force | Out-Null

  $tag = $ReleaseTag
  if (-not $tag) {
    $tag = Get-LocalTag -Root $Root
  }
  if (-not $tag) { $tag = 'v0.1.10' }

  # 1) Prefer ONE Dist zip (fewest round-trips). Skip GitHub API.
  $zipOk = $false
  try {
    $tag = Repair-FromProductZip -Root $Root -Repository $Repository -ReleaseTag $tag
    $zipOk = $true
  } catch {
    Write-Log ("Product zip repair skipped: {0}" -f $_.Exception.Message) 'Yellow'
  }

  if (-not (Test-ProductReady -Root $Root)) {
    # 2) Piecewise fill — only missing pieces (more network; last resort).
    Ensure-PortableNode -Root $Root -Version $NodeVer
    $pkg = Join-Path $Root 'package.json'
    if (-not (Test-Path $pkg)) {
      Write-Log "Repair: source zip $tag (heavier)…" 'Cyan'
      Install-FromZip -Repository $Repository -ReleaseTag $tag -Root $Root
      Ensure-PortableNode -Root $Root -Version $NodeVer
    }

    $tagNow = Get-LocalTag -Root $Root
    if ($tagNow) { $tag = $tagNow }

    try {
      Invoke-Npm $Root @('config', 'set', 'registry', 'https://registry.npmmirror.com')
    } catch {}

    $express = Join-Path $Root 'node_modules\express\package.json'
    if (-not (Test-Path $express)) {
      Write-Log 'Repair: npm install --omit=dev (npmmirror)…' 'Cyan'
      Invoke-Npm $Root @('install', '--omit=dev', '--no-audit', '--no-fund')
    }

    $teacherDist = Join-Path $Root 'apps\teacher-web\dist\index.html'
    if (-not (Test-Path $teacherDist)) {
      Write-Log 'Repair: build:teacher…' 'Cyan'
      try { Invoke-Npm $Root @('run', 'fonts:cjk') } catch {
        Write-Log ("fonts:cjk optional: {0}" -f $_.Exception.Message) 'Yellow'
      }
      Invoke-Npm $Root @('run', 'build:teacher')
    }

    $serverDist = Join-Path $Root 'apps\server\dist\index.mjs'
    if (-not (Test-Path $serverDist)) {
      Write-Log 'Repair: bundle server…' 'Cyan'
      $entry = Join-Path $Root 'apps\server\src\index.ts'
      $outDir = Join-Path $Root 'apps\server\dist'
      New-Item -ItemType Directory -Path $outDir -Force | Out-Null
      Invoke-Npm $Root @(
        'exec', '--yes', '--', 'esbuild', $entry,
        '--bundle', '--platform=node', '--format=esm', '--packages=external',
        "--outfile=$serverDist"
      )
    }
  }

  if (-not (Test-ProductReady -Root $Root)) {
    Write-NetworkMinimumCard
    throw (Get-NetworkMinimumHelp)
  }

  $tagNow = Get-LocalTag -Root $Root
  if (-not $tagNow) { $tagNow = $tag }
  Write-ReadyMarker -Root $Root -Ver ($tagNow.TrimStart('v'))
  if ($zipOk) {
    Write-Log 'Repair finished via product zip (minimum network path).' 'Green'
  } else {
    Write-Log 'Repair finished via piecewise fill.' 'Green'
  }
  return $tagNow
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
  # Prefer China-reachable mirrors; GitHub last (often blocked in schools).
  $urls = @(
    "https://mirror.ghproxy.com/https://github.com/$Repository/archive/refs/tags/$ReleaseTag.zip",
    "https://ghproxy.net/https://github.com/$Repository/archive/refs/tags/$ReleaseTag.zip",
    "https://gitclone.com/github.com/$Repository/archive/refs/tags/$ReleaseTag.zip",
    "https://codeload.github.com/$Repository/zip/refs/tags/$ReleaseTag",
    "https://github.com/$Repository/archive/refs/tags/$ReleaseTag.zip"
  )
  $tmp = Join-Path $env:TEMP ("classroom-desk-$ReleaseTag.zip")
  Write-Log "Downloading $ReleaseTag source (mirrors first)…" 'Cyan'
  try {
    Save-UrlFirstOk -Urls $urls -OutFile $tmp | Out-Null
  } catch {
    throw @"
Cannot download source from mirrors.
Tried ghproxy / gitclone / codeload / GitHub.
Re-run Install.bat when the network allows, or place a complete ClassroomDesk folder first.
Detail: $($_.Exception.Message)
"@
  }

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

function Get-LanIPv4 {
  try {
    return @(Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.PrefixOrigin -ne 'WellKnown' -and
        $_.IPAddress -notlike '169.254.*'
      } | Select-Object -ExpandProperty IPAddress)
  } catch {
    return @()
  }
}

function Write-HealthShortcut {
  # One-click “is the service alive?” — opens /health in the default browser.
  $targets = @($script:PrivateDeskDirs) + @($script:PublicDesk) | Where-Object { $_ } | Select-Object -Unique
  $url = 'http://127.0.0.1:8787/health'
  foreach ($d in $targets) {
    try {
      $path = Join-Path $d 'ClassroomDesk-Health.url'
      Set-Content -Path $path -Value @"
[InternetShortcut]
URL=$url
"@ -Encoding ASCII
    } catch {}
  }
  Write-Log 'Wrote Desktop\ClassroomDesk-Health.url' 'Green'
}

function Write-LoginCard([string]$TeacherPass, [string]$AdminPass) {
  $ips = @(Get-LanIPv4)
  $lines = @(
    'Classroom Desk — login (keep private)',
    '',
    'Open:     http://127.0.0.1:8787/admin/',
    'Username: teacher',
    "Password: $TeacherPass",
    "Admin:    $AdminPass",
    ''
  )
  if ($ips.Count -gt 0) {
    $lines += 'Students: Desktop\ClassroomDesk-Student-Install.txt (one link)'
    $lines += "Teacher LAN: http://$($ips[0]):8787"
  } else {
    $lines += 'No LAN IP yet — plug Ethernet, then reopen this card / Admin.'
  }
  $lines += ''
  $lines += 'Next: log in → import roster → students Find classroom'
  $lines += "Log: $script:LogPath"
  Write-PrivateDeskFile -FileName 'ClassroomDesk-Desk-Login.txt' -Content ($lines -join "`r`n")
  Write-Log 'Wrote teacher Desktop\ClassroomDesk-Desk-Login.txt (not Public Desktop)' 'Green'
}

function Read-EnvValue([string]$EnvPath, [string]$Key) {
  if (-not (Test-Path $EnvPath)) { return $null }
  foreach ($line in Get-Content -LiteralPath $EnvPath -Encoding UTF8) {
    if ($line -match ("^\s*{0}=(.*)$" -f [regex]::Escape($Key))) {
      return $Matches[1].Trim()
    }
  }
  return $null
}

function Ensure-EnvFile([string]$Root) {
  $envPath = Join-Path $Root '.env'
  if (Test-Path $envPath) {
    Write-Log '.env exists — keeping passwords; refreshing Desktop login card.' 'Yellow'
    $teacherPass = Read-EnvValue -EnvPath $envPath -Key 'TEACHER_PASSWORD'
    $adminPass = Read-EnvValue -EnvPath $envPath -Key 'ADMIN_PASSWORD'
    if ($teacherPass -and $adminPass) {
      Write-LoginCard -TeacherPass $teacherPass -AdminPass $adminPass
    }
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

  Write-LoginCard -TeacherPass $teacherPass -AdminPass $adminPass
  return $true
}

function Unblock-Tree([string]$Path) {
  if (-not (Test-Path $Path)) { return }
  try {
    Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
      Unblock-File -ErrorAction SilentlyContinue
    Unblock-File -LiteralPath $Path -ErrorAction SilentlyContinue
    Write-Log "Cleared download mark (Unblock-File): $Path" 'Green'
  } catch {
    Write-Log ("Unblock-File skipped: {0}" -f $_.Exception.Message) 'Yellow'
  }
}

function Publish-StudentSetupToLan([string]$Root) {
  $dest = Join-Path $Root 'apps\server\data\upgrades'
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  $copied = @()

  # Already seeded inside product pack
  Get-ChildItem -Path $dest -Filter 'ClassroomDesk-Setup-*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
    Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue
    $copied += $_.Name
  }

  $searchDirs = @(
    (Join-Path (Split-Path $Root -Parent) 'students'),
    (Join-Path $Root 'students'),
    (Join-Path $Root '..\students'),
    (Split-Path $Root -Parent), # Give-To-Teacher
    $Root
  )
  $ver = ''
  try {
    $pkg = Get-Content (Join-Path $Root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($pkg.version) { $ver = [string]$pkg.version }
  } catch {}
  $canonName = if ($ver) { "ClassroomDesk-Setup-$ver-x64.exe" } else { 'ClassroomDesk-Setup-x64.exe' }

  foreach ($d in $searchDirs) {
    if (-not $d -or -not (Test-Path $d)) { continue }
    Get-ChildItem -Path $d -Filter 'ClassroomDesk-Setup-*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
      $target = Join-Path $dest $_.Name
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
      Unblock-File -LiteralPath $target -ErrorAction SilentlyContinue
      if ($copied -notcontains $_.Name) { $copied += $_.Name }
      Write-Log ("LAN student Setup published: {0}" -f $_.Name) 'Green'
    }
    # Give-To-Teacher uses Student-Setup.exe
    $alias = Join-Path $d 'Student-Setup.exe'
    if ((Test-Path $alias) -and ((Get-Item $alias).Length -gt 1MB)) {
      $target = Join-Path $dest $canonName
      Copy-Item -LiteralPath $alias -Destination $target -Force
      Unblock-File -LiteralPath $target -ErrorAction SilentlyContinue
      if ($copied -notcontains $canonName) { $copied += $canonName }
      Write-Log ("LAN student Setup published from Student-Setup.exe → {0}" -f $canonName) 'Green'
    }
  }

  if (-not $copied.Count) {
    Write-Log 'No student Setup found yet — LAN card will explain manual copy.' 'Yellow'
    return @()
  }
  return ($copied | Select-Object -Unique)
}

function Write-StudentInstallCard([string]$Root, [string[]]$SetupNames) {
  $ips = @(Get-LanIPv4)

  $lines = @(
    'Classroom Desk — student install',
    '',
    '1) On the student PC open one of these links (same LAN as teacher).',
    '   If several IPs appear, try the one you can ping from the student PC',
    '   (often the lab switch IP, not the campus Wi-Fi IP).',
    ''
  )
  if ($SetupNames.Count -gt 0 -and $ips.Count -gt 0) {
    foreach ($ip in $ips) {
      foreach ($name in $SetupNames) {
        $lines += "  http://${ip}:8787/upgrades/$name"
      }
    }
  } elseif ($SetupNames.Count -gt 0) {
    $lines += "  (Teacher LAN IP unknown — check cable/Wi-Fi)"
    $lines += "  Files on teacher: $Root\apps\server\data\upgrades\"
  } else {
    $lines += '  No Setup on teacher yet — copy Student-Setup.exe from Give-To-Teacher.'
  }
  $lines += ''
  $lines += '2) If SmartScreen blocks: More info → Run anyway (unsigned — expected)'
  $lines += '3) Install → Find classroom'
  $lines += ''
  $lines += 'Do not use a teacher laptop hotspot for class (IP changes / sleep).'
  Write-PublicDeskFile -FileName 'ClassroomDesk-Student-Install.txt' -Content ($lines -join "`r`n")
  Write-Log 'Wrote Desktop\ClassroomDesk-Student-Install.txt' 'Green'
}

function Open-Firewall([int]$Port = 8787) {
  try {
    $ruleName = 'Classroom Desk API'
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $existing) {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
        -LocalPort $Port -Action Allow -Profile Any | Out-Null
    } else {
      Enable-NetFirewallRule -DisplayName $ruleName | Out-Null
    }
    Write-Log "Firewall TCP $Port allowed"
  } catch {
    Write-Log ("Firewall rule skipped: {0}" -f $_.Exception.Message) 'Yellow'
  }
}

function Register-Autostart([string]$Root, [bool]$Offline) {
  try {
    $taskName = 'ClassroomDeskServer'
    $npm = $script:NpmCmd
    if (-not $npm) { throw 'npm path missing' }
    $bundledEnv = if ($Offline) { 'set CLASSROOM_DESK_BUNDLED=1&& set CLASSROOM_DESK_OFFLINE=1&& set ELECTRON_SKIP_BINARY_DOWNLOAD=1&& ' } else { '' }
    # Prefer starting bundled server directly when present (fewer npm surprises).
    $serverDist = Join-Path $Root 'apps\server\dist\index.mjs'
    $nodeExe = Join-Path $script:NodeHome 'node.exe'
    if ((Test-Path $serverDist) -and (Test-Path $nodeExe) -and $Offline) {
      $arg = "/c cd /d `"$Root`" && set CLASSROOM_DESK_BUNDLED=1&& set CLASSROOM_DESK_OFFLINE=1&& `"$nodeExe`" `"$serverDist`""
    } else {
      $arg = "/c cd /d `"$Root`" && $bundledEnv`"$npm`" run start:classroom"
    }
    $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $arg -WorkingDirectory $Root
    # At startup as SYSTEM — not tied to Administrator vs teacher interactive login.
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
      -Principal $principal -Settings $settings -Force | Out-Null
    Write-Log "Autostart task: $taskName (SYSTEM @ startup)"
  } catch {
    Write-Log ("Autostart skipped: {0}" -f $_.Exception.Message) 'Yellow'
  }
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

function Test-ProductReady([string]$Root) {
  $markerNew = Join-Path $Root '.classroom-desk-ready'
  $markerLegacy = Join-Path $Root '.classroom-desk-offline-ready'
  $nm = Join-Path $Root 'node_modules'
  $dist = Join-Path $Root 'apps\teacher-web\dist\index.html'
  $server = Join-Path $Root 'apps\server\dist\index.mjs'
  if (-not ((Test-Path $markerNew) -or (Test-Path $markerLegacy))) { return $false }
  if (-not (Test-Path $nm)) { return $false }
  if (-not (Test-Path $dist)) { return $false }
  if (-not (Test-Path $server)) {
    Write-Log 'product marker present but server dist missing' 'Yellow'
    return $false
  }
  return $true
}

# Alias for older verify / docs.
function Test-OfflineReady([string]$Root) { return (Test-ProductReady -Root $Root) }

function Wait-Health([int]$Port = 8787, [int]$Attempts = 40) {
  # Fast poll: bundled Node usually answers in 2–8s. Cap wait ~20s (not 90s).
  $uri = "http://127.0.0.1:$Port/health"
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) {
        Write-Log ("health OK (attempt {0})" -f $i) 'Green'
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  Write-Log "health not ready — open $uri manually" 'Yellow'
  return $false
}

# --- main ---
try {
  if (-not $PSBoundParameters.ContainsKey('InstallRoot')) {
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
    if (
      (Test-Path (Join-Path $here 'package.json')) -or
      (Test-Path (Join-Path $here 'Install.bat')) -or
      (Test-Path (Join-Path $here 'install-teacher.ps1'))
    ) {
      if (
        (Test-Path (Join-Path $here 'Install.bat')) -or
        (Test-Path (Join-Path $here 'install-teacher.ps1')) -or
        (Test-Path (Join-Path $here 'package.json'))
      ) {
        $InstallRoot = $here
        $SkipSourceDownload = $true
      }
    }
  }

  if ($CheckOnly) {
    Write-Host "Check pack: $InstallRoot"
    $ready = (Test-ProductReady -Root $InstallRoot) -and (Test-PackManifest -Root $InstallRoot)
    if (-not $ready) {
      Write-Host 'INCOMPLETE — run Install.bat as Administrator to auto-repair via network mirrors.'
      exit 1
    }
    Write-Host 'Pack OK.'
    exit 0
  }

  try { '' | Set-Content -Path $script:LogPath -Encoding UTF8 } catch {}
  Assert-Admin

  # SQLite + portable Node must live on a local disk (USB/LAN share installs break mid-class).
  $fullRoot = [IO.Path]::GetFullPath($InstallRoot)
  if ($fullRoot.StartsWith('\\')) {
    throw "Install folder must be a local disk path, not a network share.`nCopy to C:\ClassroomDesk first.`nRefused: $fullRoot"
  }
  try {
    $letter = $fullRoot.Substring(0, 1)
    $driveType = (New-Object -ComObject Scripting.FileSystemObject).GetDrive("$letter`:").DriveType
    # 4 = Network drive mapped as letter
    if ($driveType -eq 4) {
      throw "Install folder is on a network drive ($letter`:). Copy to C:\ClassroomDesk first."
    }
  } catch {
    if ($_.Exception.Message -match 'network') { throw }
  }
  $InstallRoot = $fullRoot

  Write-Log '=== Classroom Desk · Install ===' 'Cyan'
  Write-Log "Folder: $InstallRoot"
  Write-Log "Log:    $script:LogPath"
  if ($ChinaMirrorsFirst) { Write-Log 'Mirror preference: China-friendly (npmmirror + GitHub proxies)' 'Cyan' }

  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  Set-ChinaNpmEnv

  # Avoid GitHub API (often blocked). Prefer local package.json, else pinned default.
  $localTag = Get-LocalTag -Root $InstallRoot
  if (-not $Tag) {
    if ($localTag) { $Tag = $localTag }
    else { $Tag = 'v0.1.10' }
  }
  Write-Log "Version: $Tag (no GitHub API)"

  if (Test-ProductReady -Root $InstallRoot) {
    Write-Log 'Product pack complete — ZERO public network needed for install.' 'Green'
  } else {
    Write-Log 'Pack incomplete — trying minimum-network repair (1 Dist zip, resumable)…' 'Yellow'
    try {
      $Tag = Repair-ProductPack -Root $InstallRoot -Repository $Repo -ReleaseTag $Tag -NodeVer $NodeVersion
    } catch {
      Write-NetworkMinimumCard
      throw
    }
  }
  if (-not (Test-ProductReady -Root $InstallRoot)) {
    Write-NetworkMinimumCard
    throw (Get-NetworkMinimumHelp)
  }

  $env:CLASSROOM_DESK_OFFLINE = '1'
  $env:CLASSROOM_DESK_BUNDLED = '1'
  $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
  $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'

  Set-Content -Path (Join-Path $InstallRoot '.classroom-desk-installed-tag') -Value $Tag -Encoding UTF8

  Unblock-Tree -Path $InstallRoot
  $studentsBeside = Join-Path (Split-Path $InstallRoot -Parent) 'students'
  if (Test-Path $studentsBeside) { Unblock-Tree -Path $studentsBeside }

  Ensure-PortableNode -Root $InstallRoot -Version $NodeVersion
  Assert-ProductLayout -Root $InstallRoot
  $wroteLogin = Ensure-EnvFile -Root $InstallRoot
  Write-HealthShortcut
  $setupNames = @(Publish-StudentSetupToLan -Root $InstallRoot)
  if (-not $setupNames.Count) {
    $setupNames = @(Repair-StudentSetup -Root $InstallRoot -Repository $Repo -ReleaseTag $Tag)
  }
  Write-StudentInstallCard -Root $InstallRoot -SetupNames $setupNames

  $teacherDist = Join-Path $InstallRoot 'apps\teacher-web\dist\index.html'
  if (-not (Test-Path $teacherDist)) { throw "Teacher UI still missing after repair: $teacherDist" }
  Write-Log 'Teacher UI present' 'Green'

  Open-Firewall -Port 8787
  if (-not $NoAutostart) { Register-Autostart -Root $InstallRoot -Offline $true }

  if (-not $SkipStart) {
    Write-Log 'Starting…' 'Cyan'
    Stop-ListeningPort -Port 8787
    $serverDist = Join-Path $InstallRoot 'apps\server\dist\index.mjs'
    $nodeExe = Join-Path $script:NodeHome 'node.exe'
    if ((Test-Path $serverDist) -and (Test-Path $nodeExe)) {
      $startArg = "/c cd /d `"$InstallRoot`" && set CLASSROOM_DESK_BUNDLED=1&& set CLASSROOM_DESK_OFFLINE=1&& `"$nodeExe`" `"$serverDist`""
    } else {
      $bundledPrefix = 'set CLASSROOM_DESK_BUNDLED=1&& set CLASSROOM_DESK_OFFLINE=1&& set ELECTRON_SKIP_BINARY_DOWNLOAD=1&& '
      $startArg = "/c cd /d `"$InstallRoot`" && $bundledPrefix`"$($script:NpmCmd)`" run start:classroom"
    }
    Start-Process -FilePath 'cmd.exe' -ArgumentList $startArg -WindowStyle Minimized
    # Open Admin immediately; health poll continues in parallel-ish (user can refresh).
    try { Start-Process 'http://127.0.0.1:8787/admin/' } catch {}
    $healthy = Wait-Health -Port 8787 -Attempts 40
    if (-not $healthy) {
      Write-Log 'Files installed, but /health not ready yet. Re-run Teacher-Setup.exe / Install.bat later.' 'Yellow'
    }
  }

  Write-Log '=== Done ===' 'Green'
  Write-Log "Folder:  $InstallRoot"
  Write-Log 'Admin:   http://127.0.0.1:8787/admin/'
  if ($wroteLogin) { Write-Log 'Login:   Desktop\ClassroomDesk-Desk-Login.txt' 'Yellow' }
  Write-Log 'Students: Desktop\ClassroomDesk-Student-Install.txt'
  Write-Log 'Time target: USB/local Setup → under 5 min to first class (often ~1–2 min).'
  Write-Log "Log:     $script:LogPath"
  exit 0
} catch {
  Write-Log ('INSTALL FAILED: ' + $_.Exception.Message) 'Red'
  Write-Log "See full log: $script:LogPath" 'Yellow'
  try { Write-NetworkMinimumCard } catch {}
  Write-Host ''
  Write-Host $_.ScriptStackTrace
  exit 1
}
