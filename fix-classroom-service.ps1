#Requires -Version 5.1
<#
.SYNOPSIS
  Classroom Desk — local API service fix patch (double-click Safe Fix).

.DESCRIPTION
  Repairs "http://127.0.0.1:8787/health won't open" without asking the teacher
  to type commands. Finds C:\ClassroomDesk, restores portable Node if needed,
  rewrites autostart with absolute paths, starts the API, waits for /health,
  opens Admin. Designed as a standalone Release asset:
  ClassroomDesk-Service-Fix.exe
#>
param(
  [string]$InstallRoot = 'C:\ClassroomDesk',
  [string]$Repo = 'otas0/classroom-desk',
  [string]$Tag = '',
  [string]$NodeVersion = '22.14.0',
  [switch]$ChinaMirrorsFirst
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:LogPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ClassroomDesk-Service-Fix-Log.txt'
try {
  $pub = [Environment]::GetFolderPath('CommonDesktopDirectory')
  if ($pub) { $script:LogPathPublic = Join-Path $pub 'ClassroomDesk-Service-Fix-Log.txt' }
} catch { $script:LogPathPublic = $null }

function Write-FixLog([string]$Msg, [string]$Color = 'White') {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Msg)
  try { Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8 } catch {}
  if ($script:LogPathPublic) {
    try { Add-Content -LiteralPath $script:LogPathPublic -Value $line -Encoding UTF8 } catch {}
  }
  Write-Host $line -ForegroundColor $Color
}

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if ($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return }
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -InstallRoot `"$InstallRoot`""
  if ($ChinaMirrorsFirst) { $arg += ' -ChinaMirrorsFirst' }
  if ($Tag) { $arg += " -Tag `"$Tag`"" }
  $proc = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arg -Wait -PassThru
  exit $proc.ExitCode
}

function Resolve-InstallRoot([string]$Hint) {
  $candidates = @(
    $Hint,
    'C:\ClassroomDesk',
    (Join-Path $env:ProgramData 'ClassroomDesk'),
    $PSScriptRoot
  ) | Where-Object { $_ } | Select-Object -Unique
  foreach ($c in $candidates) {
    $full = [IO.Path]::GetFullPath($c)
    if (Test-Path (Join-Path $full 'apps\server\dist\index.mjs')) { return $full }
    if (Test-Path (Join-Path $full 'package.json')) { return $full }
    if (Test-Path (Join-Path $full 'install-teacher.ps1')) { return $full }
  }
  return [IO.Path]::GetFullPath($Hint)
}

function Find-NodeExe([string]$Root, [string]$Version) {
  $exact = Join-Path $Root "runtime\node-v$Version-win-x64\node.exe"
  if ((Test-Path $exact) -and ((Get-Item $exact).Length -gt 1MB)) { return $exact }
  $arm = Join-Path $Root "runtime\node-v$Version-win-arm64\node.exe"
  if ((Test-Path $arm) -and ((Get-Item $arm).Length -gt 1MB)) { return $arm }
  Get-ChildItem -Path (Join-Path $Root 'runtime') -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -gt 1MB } |
    Sort-Object Length -Descending |
    Select-Object -First 1 |
    ForEach-Object { $_.FullName }
}

function Save-UrlFirstOk([string[]]$Urls, [string]$OutFile, [int64]$MinBytes = 1000) {
  New-Item -ItemType Directory -Path (Split-Path $OutFile -Parent) -Force | Out-Null
  $i = 0
  $errs = @()
  foreach ($url in $Urls) {
    $i++
    $partial = "$OutFile.part$i"
    try {
      Write-FixLog "GET $url"
      $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
      if ($curl) {
        $p = Start-Process -FilePath $curl.Source -ArgumentList @(
          '-fL', '--connect-timeout', '20', '--retry', '6', '--retry-delay', '2',
          '--retry-all-errors', '-C', '-', '-o', $partial, $url
        ) -Wait -PassThru -NoNewWindow
        if ($p.ExitCode -ne 0) { throw "curl $($p.ExitCode)" }
      } else {
        Invoke-WebRequest -Uri $url -OutFile $partial -UseBasicParsing -TimeoutSec 600
      }
      if ((Test-Path $partial) -and ((Get-Item $partial).Length -gt $MinBytes)) {
        Move-Item -LiteralPath $partial -Destination $OutFile -Force
        return
      }
      throw 'download too small'
    } catch {
      $errs += ("{0} => {1}" -f $url, $_.Exception.Message)
      Write-FixLog ("download failed: {0}" -f $_.Exception.Message) 'Yellow'
    }
  }
  throw ("All downloads failed:`n  {0}" -f ($errs -join "`n  "))
}

function Ensure-PortableNode([string]$Root, [string]$Version) {
  $existing = Find-NodeExe -Root $Root -Version $Version
  if ($existing) {
    Write-FixLog "Portable Node OK: $existing" 'Green'
    return $existing
  }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
  $dirName = "node-v$Version-$arch"
  $zipPath = Join-Path $env:TEMP "$dirName.zip"
  $urls = @(
    "https://npmmirror.com/mirrors/node/v$Version/$dirName.zip",
    "https://cdn.npmmirror.com/binaries/node/v$Version/$dirName.zip",
    "https://nodejs.org/dist/v$Version/$dirName.zip"
  )
  Write-FixLog "Downloading portable Node $Version…" 'Cyan'
  Save-UrlFirstOk -Urls $urls -OutFile $zipPath -MinBytes 1MB
  $runtime = Join-Path $Root 'runtime'
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $runtime -Force
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  $node = Find-NodeExe -Root $Root -Version $Version
  if (-not $node) { throw "Node missing after extract under $runtime" }
  Write-FixLog "Portable Node installed: $node" 'Green'
  return $node
}

function Test-ProductReady([string]$Root) {
  $need = @(
    (Join-Path $Root 'apps\server\dist\index.mjs'),
    (Join-Path $Root 'apps\teacher-web\dist\index.html'),
    (Join-Path $Root 'node_modules\express\package.json')
  )
  foreach ($p in $need) {
    if (-not (Test-Path $p)) { return $false }
  }
  return $true
}

function Repair-FromProductZip([string]$Root, [string]$Repository, [string]$ReleaseTag) {
  $tag = $ReleaseTag
  if (-not $tag) {
    $pkg = Join-Path $Root 'package.json'
    if (Test-Path $pkg) {
      try {
        $ver = (Get-Content $pkg -Raw -Encoding UTF8 | ConvertFrom-Json).version
        if ($ver) { $tag = "v$ver" }
      } catch {}
    }
  }
  if (-not $tag) { $tag = 'v0.1.10' }
  $ver = $tag.TrimStart('v')
  $name = "ClassroomDesk-$ver-win-x64.zip"
  $zipPath = Join-Path $Root "downloads\$name"
  New-Item -ItemType Directory -Path (Split-Path $zipPath -Parent) -Force | Out-Null
  $urls = @(
    "https://mirror.ghproxy.com/https://github.com/$Repository/releases/download/$tag/$name",
    "https://ghproxy.net/https://github.com/$Repository/releases/download/$tag/$name",
    "https://github.com/$Repository/releases/download/$tag/$name"
  )
  Write-FixLog "Repair: download $name (resumable)…" 'Cyan'
  Save-UrlFirstOk -Urls $urls -OutFile $zipPath -MinBytes 5MB
  $extractParent = Join-Path $env:TEMP ("cd-fix-" + [guid]::NewGuid().ToString('n'))
  New-Item -ItemType Directory -Path $extractParent -Force | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $extractParent -Force
  $inner = Get-ChildItem $extractParent -Directory | Where-Object { $_.Name -eq 'ClassroomDesk' } | Select-Object -First 1
  if (-not $inner) { $inner = Get-ChildItem $extractParent -Directory | Select-Object -First 1 }
  if (-not $inner) { throw "Empty product zip: $name" }
  $from = $inner.FullName
  if (Test-Path (Join-Path $from 'ClassroomDesk\package.json')) {
    $from = Join-Path $from 'ClassroomDesk'
  }
  Write-FixLog "Merging product tree → $Root" 'Cyan'
  robocopy $from $Root /E /NFL /NDL /NJH /NJS /nc /ns /np /XD '.git' | Out-Null
  Remove-Item $extractParent -Recurse -Force -ErrorAction SilentlyContinue
  return $tag
}

function Stop-Port8787 {
  try {
    Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object {
        Write-FixLog ("Stopping PID {0} on :8787" -f $_.OwningProcess) 'Yellow'
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
      }
  } catch {}
  Start-Sleep -Milliseconds 400
}

function Open-Firewall8787 {
  try {
    $ruleName = 'Classroom Desk API'
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $existing) {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
        -LocalPort 8787 -Action Allow -Profile Any | Out-Null
    } else {
      Enable-NetFirewallRule -DisplayName $ruleName | Out-Null
    }
    Write-FixLog 'Firewall TCP 8787 allowed' 'Green'
  } catch {
    Write-FixLog ("Firewall: {0}" -f $_.Exception.Message) 'Yellow'
  }
}

function Register-AutostartAbsolute([string]$Root, [string]$NodeExe, [string]$ServerDist) {
  $taskName = 'ClassroomDeskServer'
  $arg = "/c cd /d `"$Root`" && set CLASSROOM_DESK_BUNDLED=1&& set CLASSROOM_DESK_OFFLINE=1&& `"$NodeExe`" `"$ServerDist`" >> `"$Root\apps\server\data\service.log`" 2>&1"
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $arg -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
  Write-FixLog "Autostart task rewritten: $taskName (absolute Node path)" 'Green'
}

function Wait-Health([int]$Attempts = 60) {
  $uri = 'http://127.0.0.1:8787/health'
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) {
        Write-FixLog ("health OK (attempt {0})" -f $i) 'Green'
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $false
}

function Write-DesktopHelpers([string]$Root) {
  $startCmd = @'
@echo off
chcp 65001 >nul
title Classroom Desk API
cd /d "ROOT_PLACEHOLDER"
call "ROOT_PLACEHOLDER\Start-ClassroomDesk.cmd"
'@
  $startCmd = $startCmd.Replace('ROOT_PLACEHOLDER', $Root)
  $desk = [Environment]::GetFolderPath('Desktop')
  $helpers = @(
    (Join-Path $Root 'Start-ClassroomDesk.cmd'),
    (Join-Path $desk 'Start-ClassroomDesk.cmd')
  )
  $srcStart = Join-Path $PSScriptRoot 'Start-ClassroomDesk.cmd'
  if (-not (Test-Path $srcStart)) { $srcStart = Join-Path $Root 'Start-ClassroomDesk.cmd' }
  foreach ($dest in $helpers) {
    try {
      if (Test-Path $srcStart) {
        Copy-Item -LiteralPath $srcStart -Destination $dest -Force
      }
    } catch {}
  }
  # One-click patch launcher on Desktop for next time
  $fixLauncher = Join-Path $desk 'ClassroomDesk-Fix-Service.cmd'
  @"
@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "$Root\fix-classroom-service.ps1" -InstallRoot "$Root" -ChinaMirrorsFirst
"@ | Set-Content -Path $fixLauncher -Encoding ASCII
  Write-FixLog "Desktop helper: $fixLauncher" 'Green'
}

# --- main ---
try {
  Assert-Admin
  try { '' | Set-Content -LiteralPath $script:LogPath -Encoding UTF8 } catch {}
  Write-FixLog '=== Classroom Desk · Service Fix Patch ===' 'Cyan'

  $InstallRoot = Resolve-InstallRoot -Hint $InstallRoot
  Write-FixLog "Install folder: $InstallRoot"

  if ($InstallRoot.StartsWith('\\')) {
    throw 'Install folder must be a local disk (not a network share).'
  }

  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'apps\server\data') -Force | Out-Null

  # Copy this patch script into install root for Desktop re-run helper
  try {
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $InstallRoot 'fix-classroom-service.ps1') -Force
  } catch {}
  $startSrc = Join-Path $PSScriptRoot 'Start-ClassroomDesk.cmd'
  if (Test-Path $startSrc) {
    Copy-Item -LiteralPath $startSrc -Destination (Join-Path $InstallRoot 'Start-ClassroomDesk.cmd') -Force
  }

  if (-not (Test-ProductReady -Root $InstallRoot)) {
    Write-FixLog 'Product pack incomplete — repairing from Dist zip…' 'Yellow'
    $null = Repair-FromProductZip -Root $InstallRoot -Repository $Repo -ReleaseTag $Tag
  }
  if (-not (Test-ProductReady -Root $InstallRoot)) {
    throw "Still incomplete under $InstallRoot — run Teacher-Setup.exe / Teacher-Bootstrap.exe once, then re-run this Fix."
  }

  $nodeExe = Ensure-PortableNode -Root $InstallRoot -Version $NodeVersion
  $serverDist = Join-Path $InstallRoot 'apps\server\dist\index.mjs'
  if (-not (Test-Path $serverDist)) { throw "Missing $serverDist" }

  Open-Firewall8787
  Register-AutostartAbsolute -Root $InstallRoot -NodeExe $nodeExe -ServerDist $serverDist
  Write-DesktopHelpers -Root $InstallRoot

  Stop-Port8787
  Write-FixLog 'Starting API…' 'Cyan'
  $logFile = Join-Path $InstallRoot 'apps\server\data\service.log'
  '' | Set-Content -LiteralPath $logFile -Encoding UTF8
  $cmdArg = "/c cd /d `"$InstallRoot`" && set CLASSROOM_DESK_BUNDLED=1&& set CLASSROOM_DESK_OFFLINE=1&& `"$nodeExe`" `"$serverDist`" >> `"$logFile`" 2>&1"
  Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArg -WindowStyle Hidden
  try { Start-ScheduledTask -TaskName 'ClassroomDeskServer' -ErrorAction SilentlyContinue } catch {}

  $ok = Wait-Health -Attempts 60
  if (-not $ok) {
    Write-FixLog 'First start not healthy — retry once…' 'Yellow'
    Stop-Port8787
    Start-Sleep -Seconds 1
    Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArg -WindowStyle Hidden
    $ok = Wait-Health -Attempts 60
  }

  if ($ok) {
    Write-FixLog 'FIXED — http://127.0.0.1:8787/health is up' 'Green'
    try { Start-Process 'http://127.0.0.1:8787/health' } catch {}
    try { Start-Process 'http://127.0.0.1:8787/admin/' } catch {}
    $card = @"
Classroom Desk — service fix OK

Health: http://127.0.0.1:8787/health
Admin:  http://127.0.0.1:8787/admin/

If it dies again: double-click Desktop\ClassroomDesk-Fix-Service.cmd
Log: $script:LogPath
Service log: $InstallRoot\apps\server\data\service.log
"@
    $desk = [Environment]::GetFolderPath('Desktop')
    Set-Content -Path (Join-Path $desk 'ClassroomDesk-Service-OK.txt') -Value $card -Encoding UTF8
    Write-FixLog 'Wrote Desktop\ClassroomDesk-Service-OK.txt' 'Green'
    exit 0
  }

  Write-FixLog 'FAILED — /health still down. See service.log and this Fix log.' 'Red'
  Write-FixLog "service.log: $logFile" 'Yellow'
  try { Start-Process notepad.exe -ArgumentList $script:LogPath } catch {}
  if (Test-Path $logFile) { try { Start-Process notepad.exe -ArgumentList $logFile } catch {} }
  exit 1
} catch {
  Write-FixLog ('SERVICE FIX FAILED: ' + $_.Exception.Message) 'Red'
  try { Start-Process notepad.exe -ArgumentList $script:LogPath } catch {}
  exit 1
}
