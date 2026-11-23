#Requires -Version 5.1
<#
.SYNOPSIS
  Wipe any existing portable Node under InstallRoot\runtime, then download
  official Windows Node (win-x64 / win-arm64) via China + overseas mirrors.

.DESCRIPTION
  Always uses auto-install (never trusts a pre-copied Mac/host node).
  Called from Install.bat / setup-from-*.cmd / Start-ClassroomDesk.cmd.
#>
param(
  [string]$InstallRoot = 'C:\ClassroomDesk',
  [string]$NodeVersion = '22.14.0',
  [switch]$ChinaMirrorsFirst,
  [switch]$Force = $true
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-NodeLog([string]$Msg, [string]$Color = 'Gray') {
  Write-Host ("[node] {0}" -f $Msg) -ForegroundColor $Color
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
  # Teacher lab PCs are almost always x64 Windows.
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
  New-Item -ItemType Directory -Path (Split-Path $OutFile -Parent) -Force | Out-Null
  if (Test-Path -LiteralPath $OutFile) {
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
  }
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    $args = @(
      '-fL', '--connect-timeout', '20', '--retry', '5', '--retry-delay', '2',
      '--retry-all-errors', '-C', '-', '-o', $OutFile, $Url
    )
    $p = Start-Process -FilePath $curl.Source -ArgumentList $args -Wait -PassThru -NoNewWindow
    if ($p.ExitCode -ne 0) { throw "curl exit $($p.ExitCode)" }
  } else {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 600
  }
  if (-not (Test-Path -LiteralPath $OutFile) -or ((Get-Item -LiteralPath $OutFile).Length -lt 1MB)) {
    throw 'download too small or missing'
  }
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
  # Also drop any leftover downloads zip so we never reuse a bad host copy.
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

  Expand-Archive -Path $zipPath -DestinationPath (Join-Path $Root 'runtime') -Force
  Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue

  if (-not (Test-Path -LiteralPath $nodeExe)) {
    throw "node.exe missing after extract: $nodeExe"
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

# Always force auto-install unless explicitly disabled (Force defaults to $true).
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
