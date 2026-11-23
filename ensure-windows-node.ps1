#Requires -Version 5.1
<#
.SYNOPSIS
  Wipe portable Node under InstallRoot\runtime, then download official Windows Node
  (win-x64 / win-arm64) via China + overseas mirrors.

.DESCRIPTION
  Never trusts a pre-copied Mac/host node. Works on locked school PCs:
  no fancy curl flags, multiple download fallbacks, COM unzip if needed.
#>
param(
  [string]$InstallRoot = 'C:\ClassroomDesk',
  [string]$NodeVersion = '22.14.0',
  [switch]$ChinaMirrorsFirst,
  [switch]$Force = $true
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {}

# bat often passes trailing "\" which breaks -InstallRoot "C:\path\" quoting — strip it.
$InstallRoot = ([string]$InstallRoot).Trim().TrimEnd('\', '/')
if (-not $InstallRoot) { $InstallRoot = 'C:\ClassroomDesk' }

function Write-NodeLog([string]$Msg, [string]$Color = 'Gray') {
  try { Write-Host ("[node] {0}" -f $Msg) -ForegroundColor $Color }
  catch { Write-Host ("[node] {0}" -f $Msg) }
}

function Test-IsWindowsNodeExe([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  try {
    $fs = [IO.File]::OpenRead($Path)
    try {
      $buf = New-Object byte[] 4
      if ($fs.Read($buf, 0, 4) -lt 2) { return $false }
      return ($buf[0] -eq 0x4D -and $buf[1] -eq 0x5A)
    } finally { $fs.Close() }
  } catch { return $false }
}

function Get-NodeArchName {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { return 'win-arm64' }
  return 'win-x64'
}

function Get-NodeZipUrlSets([string]$Version, [string]$Arch) {
  $cn = @(
    "https://npmmirror.com/mirrors/node/v$Version/node-v$Version-$Arch.zip",
    "https://cdn.npmmirror.com/binaries/node/v$Version/node-v$Version-$Arch.zip"
  )
  $overseas = @(
    "https://nodejs.org/dist/v$Version/node-v$Version-$Arch.zip"
  )
  if ($ChinaMirrorsFirst) {
    return @{ First = ($cn + $overseas); Second = ($overseas + $cn) }
  }
  return @{ First = ($overseas + $cn); Second = ($cn + $overseas) }
}

function Save-Url([string]$Url, [string]$OutFile) {
  Write-NodeLog "GET $Url" 'Cyan'
  $parent = Split-Path $OutFile -Parent
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  if (Test-Path -LiteralPath $OutFile) {
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
  }

  $errs = @()

  # 1) curl.exe — only flags available on old Windows 10 curl builds
  $curl = $null
  foreach ($c in @(
      (Join-Path $env:SystemRoot 'System32\curl.exe'),
      'curl.exe'
    )) {
    if (Get-Command $c -ErrorAction SilentlyContinue) { $curl = (Get-Command $c).Source; break }
    if (Test-Path -LiteralPath $c) { $curl = $c; break }
  }
  if ($curl) {
    try {
      $p = Start-Process -FilePath $curl -ArgumentList @(
        '-fL', '--connect-timeout', '30', '--retry', '5', '--retry-delay', '2',
        '-o', $OutFile, $Url
      ) -Wait -PassThru -NoNewWindow
      if ($p.ExitCode -eq 0 -and (Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 1MB)) {
        return
      }
      $errs += "curl exit $($p.ExitCode)"
    } catch { $errs += "curl: $($_.Exception.Message)" }
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
  }

  # 2) .NET WebClient (works when IWR / IE zones are locked)
  try {
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add('User-Agent', 'ClassroomDesk-NodeEnsure/1.0')
    $wc.DownloadFile($Url, $OutFile)
    if ((Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 1MB)) { return }
    $errs += 'WebClient too small'
  } catch { $errs += "WebClient: $($_.Exception.Message)" }
  Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue

  # 3) BITS (background transfer — often allowed on school nets)
  try {
    if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
      Start-BitsTransfer -Source $Url -Destination $OutFile -ErrorAction Stop
      if ((Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 1MB)) { return }
      $errs += 'BITS too small'
    }
  } catch { $errs += "BITS: $($_.Exception.Message)" }
  Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue

  # 4) Invoke-WebRequest last
  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 600
    if ((Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 1MB)) { return }
    $errs += 'IWR too small'
  } catch { $errs += "IWR: $($_.Exception.Message)" }

  throw ("download failed: {0}" -f ($errs -join ' | '))
}

function Save-UrlFirstOk([string[]]$Urls, [string]$OutFile) {
  $errs = @()
  foreach ($url in $Urls) {
    try {
      Save-Url -Url $url -OutFile $OutFile
      return $url
    } catch {
      $errs += ("{0} => {1}" -f $url, $_.Exception.Message)
      Write-NodeLog ("failed: {0}" -f $_.Exception.Message) 'Yellow'
      Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
    }
  }
  throw ("All Node downloads failed:`n  {0}" -f ($errs -join "`n  "))
}

function Expand-ZipSafe([string]$ZipPath, [string]$DestDir) {
  if (-not (Test-Path -LiteralPath $DestDir)) {
    New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
  }
  if (Get-Command Expand-Archive -ErrorAction SilentlyContinue) {
    try {
      Expand-Archive -Path $ZipPath -DestinationPath $DestDir -Force
      return
    } catch {
      Write-NodeLog ("Expand-Archive failed, trying Shell.Application: {0}" -f $_.Exception.Message) 'Yellow'
    }
  }
  # COM fallback (ancient PowerShell / locked modules)
  $shell = New-Object -ComObject Shell.Application
  $zip = $shell.NameSpace((Resolve-Path $ZipPath).Path)
  $dest = $shell.NameSpace((Resolve-Path $DestDir).Path)
  if (-not $zip -or -not $dest) { throw "Shell.Application cannot open zip/dest" }
  # 0x14 = overwrite + no UI
  $dest.CopyHere($zip.Items(), 0x14)
  $deadline = (Get-Date).AddMinutes(5)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    if (Get-ChildItem -LiteralPath $DestDir -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1) { return }
  }
  throw 'COM unzip timed out (node.exe not found)'
}

function Clear-PortableNode([string]$Root) {
  $runtime = Join-Path $Root 'runtime'
  if (-not (Test-Path -LiteralPath $runtime)) {
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    return
  }
  Write-NodeLog "Clearing portable Node under $runtime …" 'Yellow'
  Get-ChildItem -LiteralPath $runtime -Force -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
  $dl = Join-Path $Root 'downloads'
  if (Test-Path -LiteralPath $dl) {
    Get-ChildItem -LiteralPath $dl -Filter 'node-v*-win-*.zip' -ErrorAction SilentlyContinue |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
}

function Install-WindowsNode([string]$Root, [string]$Version) {
  $arch = Get-NodeArchName
  $dirName = "node-v$Version-$arch"
  $nodeRoot = Join-Path $Root "runtime\$dirName"
  $nodeExe = Join-Path $nodeRoot 'node.exe'

  Clear-PortableNode -Root $Root
  New-Item -ItemType Directory -Path (Join-Path $Root 'runtime') -Force | Out-Null

  $sets = Get-NodeZipUrlSets -Version $Version -Arch $arch
  $zipPath = Join-Path $env:TEMP "$dirName-cd-force.zip"
  $used = $null
  try {
    Write-NodeLog "Force-install official $dirName (Windows only)…" 'Cyan'
    $used = Save-UrlFirstOk -Urls $sets.First -OutFile $zipPath
  } catch {
    Write-NodeLog 'Primary mirror order failed — trying alternate (CN ↔ overseas)…' 'Yellow'
    $used = Save-UrlFirstOk -Urls $sets.Second -OutFile $zipPath
  }
  Write-NodeLog "Downloaded from: $used" 'Green'

  Expand-ZipSafe -ZipPath $zipPath -DestDir (Join-Path $Root 'runtime')
  Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue

  if (-not (Test-Path -LiteralPath $nodeExe)) {
    # Some unzip layouts nest oddly — find node.exe
    $found = Get-ChildItem -LiteralPath (Join-Path $Root 'runtime') -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue |
      Where-Object { Test-IsWindowsNodeExe $_.FullName } |
      Select-Object -First 1
    if ($found) {
      $nodeExe = $found.FullName
    } else {
      throw "node.exe missing after extract under $Root\runtime"
    }
  }
  if (-not (Test-IsWindowsNodeExe $nodeExe)) {
    throw "Downloaded node.exe is not a Windows PE (MZ) binary: $nodeExe"
  }

  $ver = & $nodeExe -v 2>$null
  Write-NodeLog "OK Windows Node $ver → $nodeExe" 'Green'
  return $nodeExe
}

if (-not (Test-Path -LiteralPath $InstallRoot)) {
  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
}

if (-not $Force) {
  $arch = Get-NodeArchName
  $probe = Join-Path $InstallRoot "runtime\node-v$NodeVersion-$arch\node.exe"
  if ((Test-IsWindowsNodeExe $probe) -and ((Get-Item -LiteralPath $probe).Length -gt 1MB)) {
    Write-NodeLog "Reuse existing Windows Node: $probe" 'Green'
    Write-Output $probe
    exit 0
  }
}

$exe = Install-WindowsNode -Root $InstallRoot -Version $NodeVersion
Write-Output $exe
exit 0
