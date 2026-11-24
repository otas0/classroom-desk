#Requires -Version 5.1
<#
.SYNOPSIS
  Resolve Windows Node for Classroom Desk: user path, system Node, or MSI (never zip).

.DESCRIPTION
  Order:
    1) -NodeExe / -NodeHome (wizard / CLI)
    2) InstallRoot\node-path.txt  or  $env:CLASSROOM_DESK_NODE
    3) Good node.exe already under InstallRoot\runtime
    4) System Node (Program Files) if valid
    5) Download official MSI + msiexec /i, or /a extract on 1603

  Writes InstallRoot\node-path.txt when a Node is chosen so later starts reuse it.
  Never downloads or extracts Node zip packages.
#>
param(
  [string]$InstallRoot = 'C:\ClassroomDesk',
  [string]$NodeVersion = '22.14.0',
  [string]$MinVersion = '22.5.0',
  [string]$NodeExe = '',
  [string]$NodeHome = '',
  [switch]$ChinaMirrorsFirst,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {}

$InstallRoot = ([string]$InstallRoot).Trim().TrimEnd('\', '/')
if (-not $InstallRoot) { $InstallRoot = 'C:\ClassroomDesk' }

function Write-NodeLog([string]$Msg, [string]$Color = 'Gray') {
  try { Write-Host ("[node] {0}" -f $Msg) -ForegroundColor $Color }
  catch { Write-Host ("[node] {0}" -f $Msg) }
}

function Test-IsAdmin {
  try {
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

function Test-IsWindowsNodeExe([string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $false }
  try {
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($item.Length -lt 1MB) { return $false }
    $fs = [IO.File]::OpenRead($Path)
    try {
      $buf = New-Object byte[] 4
      if ($fs.Read($buf, 0, 4) -lt 2) { return $false }
      return ($buf[0] -eq 0x4D -and $buf[1] -eq 0x5A)
    } finally { $fs.Close() }
  } catch { return $false }
}

function ConvertTo-VersionObject([string]$Text) {
  $t = ([string]$Text).Trim()
  if ($t.StartsWith('v')) { $t = $t.Substring(1) }
  $m = [regex]::Match($t, '^\d+(\.\d+){0,3}')
  if (-not $m.Success) { return $null }
  $parts = @($m.Value -split '\.')
  while ($parts.Count -lt 4) { $parts += '0' }
  try { return [version](($parts[0..3] -join '.')) } catch { return $null }
}

function Get-NodeExeVersion([string]$Exe) {
  try {
    $raw = & $Exe -v 2>$null
    if (-not $raw) { return $null }
    return (ConvertTo-VersionObject ([string]$raw).Trim())
  } catch { return $null }
}

function Test-NodeMeetsMin([string]$Exe, [string]$MinVer) {
  if (-not (Test-IsWindowsNodeExe $Exe)) { return $false }
  $have = Get-NodeExeVersion $Exe
  $need = ConvertTo-VersionObject $MinVer
  if (-not $have -or -not $need) { return $false }
  return ($have -ge $need)
}

function Get-MsiArch {
  $pa = [string]$env:PROCESSOR_ARCHITECTURE
  $arch6432 = [string]$env:PROCESSOR_ARCHITEW6432
  if ($pa -eq 'ARM64' -or $arch6432 -eq 'ARM64') { return 'arm64' }
  if ([Environment]::Is64BitOperatingSystem) { return 'x64' }
  return 'x86'
}

function Get-ZipArchToken {
  $m = Get-MsiArch
  if ($m -eq 'x64') { return 'win-x64' }
  if ($m -eq 'x86') { return 'win-x86' }
  return 'win-arm64'
}

function Enable-SystemProxy {
  if ($env:HTTPS_PROXY -or $env:HTTP_PROXY -or $env:ALL_PROXY) { return }
  try {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
    $enabled = (Get-ItemProperty -Path $key -Name ProxyEnable -ErrorAction SilentlyContinue).ProxyEnable
    $server = (Get-ItemProperty -Path $key -Name ProxyServer -ErrorAction SilentlyContinue).ProxyServer
    if ($enabled -eq 1 -and $server) {
      if ($server -notmatch '://') { $server = "http://$server" }
      $env:HTTP_PROXY = $server
      $env:HTTPS_PROXY = $server
    }
  } catch {}
}

function Get-LikelyChinaNet {
  if ($ChinaMirrorsFirst) { return $true }
  try {
    $geo = [string](Get-WinSystemLocale -ErrorAction SilentlyContinue).Name
    if ($geo -match '^(zh-CN|zh-Hans)') { return $true }
  } catch {}
  try {
    if ([TimeZoneInfo]::Local.Id -match 'China|Beijing|Chongqing|Shanghai') { return $true }
  } catch {}
  return $false
}

function Get-MsiUrlList([string]$Version, [string]$MsiArch) {
  $file = "node-v$Version-$MsiArch.msi"
  $cn = @(
    "https://npmmirror.com/mirrors/node/v$Version/$file",
    "https://cdn.npmmirror.com/binaries/node/v$Version/$file",
    "https://mirrors.cloud.tencent.com/nodejs-release/v$Version/$file",
    "https://mirrors.huaweicloud.com/nodejs/v$Version/$file"
  )
  $ov = @("https://nodejs.org/dist/v$Version/$file")
  if (Get-LikelyChinaNet) { return @($cn + $ov) }
  return @($ov + $cn)
}

function Get-FallbackVersions([string]$Preferred) {
  $list = @($Preferred, '22.14.0', '22.15.1', '22.13.1', '22.12.0', '22.11.0')
  $seen = @{}
  $out = @()
  $min = ConvertTo-VersionObject $MinVersion
  foreach ($v in $list) {
    if (-not $v -or $seen.ContainsKey($v)) { continue }
    $seen[$v] = $true
    $vo = ConvertTo-VersionObject $v
    if ($vo -and $min -and ($vo -lt $min)) { continue }
    $out += $v
  }
  return $out
}

function Save-Url([string]$Url, [string]$OutFile) {
  Write-NodeLog ("download {0}" -f ([uri]$Url).Host)
  $parent = Split-Path $OutFile -Parent
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
  $errs = @()

  $curl = $null
  foreach ($c in @((Join-Path $env:SystemRoot 'System32\curl.exe'), 'curl.exe')) {
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
      $errs += "curl $($p.ExitCode)"
    } catch { $errs += "curl $($_.Exception.Message)" }
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
  }

  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 600
    if ((Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 1MB)) { return }
    $errs += 'IWR small'
  } catch { $errs += "IWR $($_.Exception.Message)" }
  Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue

  try {
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add('User-Agent', 'ClassroomDesk-NodeEnsure/4.0')
    $wc.DownloadFile($Url, $OutFile)
    if ((Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 1MB)) { return }
    $errs += 'WebClient small'
  } catch { $errs += "WebClient $($_.Exception.Message)" }

  throw ("download failed: {0}" -f ($errs -join ' | '))
}

function Save-UrlFirstOk([string[]]$Urls, [string]$OutFile) {
  $errs = @()
  foreach ($url in $Urls) {
    try {
      Save-Url -Url $url -OutFile $OutFile
      return $url
    } catch {
      $errs += $_.Exception.Message
      Write-NodeLog ("retry: {0}" -f $_.Exception.Message) 'Yellow'
      Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
    }
  }
  throw ("all downloads failed: {0}" -f ($errs -join ' | '))
}

function Get-NodePathFile([string]$Root) {
  return (Join-Path $Root 'node-path.txt')
}

function Save-NodePathFile([string]$Root, [string]$Exe) {
  $full = (Resolve-Path -LiteralPath $Exe).Path
  Set-Content -LiteralPath (Get-NodePathFile $Root) -Value $full -Encoding ASCII
  Write-NodeLog "saved node-path.txt"
}

function Read-NodePathFile([string]$Root) {
  $f = Get-NodePathFile $Root
  if (-not (Test-Path -LiteralPath $f)) { return $null }
  $line = (Get-Content -LiteralPath $f -TotalCount 1 -ErrorAction SilentlyContinue)
  if (-not $line) { return $null }
  $p = ([string]$line).Trim().Trim('"')
  if (Test-NodeMeetsMin $p $MinVersion) { return $p }
  return $null
}

function Resolve-UserNodeExe {
  if ($NodeExe -and (Test-NodeMeetsMin $NodeExe $MinVersion)) {
    return (Resolve-Path -LiteralPath $NodeExe).Path
  }
  if ($NodeHome) {
    $p = Join-Path $NodeHome 'node.exe'
    if (Test-NodeMeetsMin $p $MinVersion) {
      return (Resolve-Path -LiteralPath $p).Path
    }
  }
  if ($env:CLASSROOM_DESK_NODE) {
    $p = ([string]$env:CLASSROOM_DESK_NODE).Trim().Trim('"')
    if ((Test-Path -LiteralPath $p) -and (Test-Path -LiteralPath $p -PathType Container)) {
      $p = Join-Path $p 'node.exe'
    }
    if (Test-NodeMeetsMin $p $MinVersion) {
      return (Resolve-Path -LiteralPath $p).Path
    }
  }
  return $null
}

function Find-ExistingPortable([string]$Root, [string]$MinVer) {
  $runtime = Join-Path $Root 'runtime'
  if (-not (Test-Path -LiteralPath $runtime)) { return $null }
  $best = $null
  $bestVer = $null
  Get-ChildItem -LiteralPath $runtime -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue |
    Where-Object { Test-NodeMeetsMin $_.FullName $MinVer } |
    ForEach-Object {
      $v = Get-NodeExeVersion $_.FullName
      if ($v -and (-not $bestVer -or $v -gt $bestVer)) {
        $best = $_.FullName
        $bestVer = $v
      }
    }
  return $best
}

function Find-SystemNode([string]$MinVer) {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-NodeMeetsMin $p $MinVer)) { return $p }
  }
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd -and (Test-NodeMeetsMin $cmd.Source $MinVer)) { return $cmd.Source }
  return $null
}

function Clear-PortableRuntime([string]$Root) {
  $runtime = Join-Path $Root 'runtime'
  if (-not (Test-Path -LiteralPath $runtime)) {
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    return
  }
  Write-NodeLog "clear $runtime"
  Get-ChildItem -LiteralPath $runtime -Force -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Copy-NodeTreeToRuntime([string]$Root, [string]$SourceNodeExe, [string]$Version, [string]$ZipArch) {
  $srcDir = Split-Path $SourceNodeExe -Parent
  $dirName = "node-v$Version-$ZipArch"
  $dest = Join-Path $Root "runtime\$dirName"
  if (Test-Path -LiteralPath $dest) {
    Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
  Write-NodeLog "copy into runtime\$dirName"
  Copy-Item -LiteralPath $srcDir -Destination $dest -Recurse -Force
  $exe = Join-Path $dest 'node.exe'
  if (-not (Test-NodeMeetsMin $exe $MinVersion)) {
    throw "runtime copy invalid: $exe"
  }
  return $exe
}

function Test-IsMsiFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  try {
    if ((Get-Item -LiteralPath $Path).Length -lt 1MB) { return $false }
    $fs = [IO.File]::OpenRead($Path)
    try {
      $b = New-Object byte[] 8
      if ($fs.Read($b, 0, 8) -lt 8) { return $false }
      return ($b[0] -eq 0xD0 -and $b[1] -eq 0xCF -and $b[2] -eq 0x11 -and $b[3] -eq 0xE0)
    } finally { $fs.Close() }
  } catch { return $false }
}

function Find-NodeExeUnder([string]$Dir) {
  if (-not (Test-Path -LiteralPath $Dir)) { return $null }
  $hit = Get-ChildItem -LiteralPath $Dir -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue |
    Where-Object { Test-IsWindowsNodeExe $_.FullName } |
    Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}

function Refresh-ProcessPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Install-NodeMsi([string]$Version, [string]$MsiArch) {
  $msi = Join-Path $env:TEMP "node-v$Version-$MsiArch-cd.msi"
  $urls = Get-MsiUrlList -Version $Version -MsiArch $MsiArch
  Write-NodeLog "MSI Node v$Version ($MsiArch)"
  $used = Save-UrlFirstOk -Urls $urls -OutFile $msi
  Write-NodeLog ("MSI from {0}" -f ([uri]$used).Host)
  if (-not (Test-IsMsiFile $msi)) {
    Remove-Item -LiteralPath $msi -Force -ErrorAction SilentlyContinue
    throw 'download is not a valid MSI'
  }

  $iCode = -1
  try {
    if (Test-IsAdmin) {
      Write-NodeLog 'msiexec /i silent'
      $proc = Start-Process -FilePath 'msiexec.exe' `
        -ArgumentList "/i `"$msi`" /qn /norestart ALLUSERS=1" `
        -Wait -PassThru
      $iCode = [int]$proc.ExitCode
      Refresh-ProcessPath
      if ($iCode -eq 0 -or $iCode -eq 3010) {
        $sys = Find-SystemNode -MinVer $MinVersion
        if (-not $sys) {
          $guess = Join-Path $env:ProgramFiles 'nodejs\node.exe'
          if (Test-IsWindowsNodeExe $guess) { $sys = $guess }
        }
        if ($sys) { return $sys }
      } else {
        Write-NodeLog "msiexec /i exit $iCode — try extract" 'Yellow'
      }
    } else {
      Write-NodeLog 'not admin — try MSI extract only' 'Yellow'
    }

    $extract = Join-Path $env:TEMP "cd-node-msi-$Version-$MsiArch"
    if (Test-Path -LiteralPath $extract) {
      Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $extract -Force | Out-Null
    Write-NodeLog 'msiexec /a extract'
    $procA = Start-Process -FilePath 'msiexec.exe' `
      -ArgumentList "/a `"$msi`" /qn TARGETDIR=`"$extract`"" `
      -Wait -PassThru
    $aCode = [int]$procA.ExitCode
    if ($aCode -eq 0 -or $aCode -eq 3010) {
      $found = Find-NodeExeUnder -Dir $extract
      if ($found) { return $found }
    } else {
      Write-NodeLog "msiexec /a exit $aCode" 'Yellow'
    }

    if ($iCode -gt 0) { throw "msiexec exit $iCode" }
    throw 'MSI produced no node.exe'
  } finally {
    Remove-Item -LiteralPath $msi -Force -ErrorAction SilentlyContinue
  }
}

function Complete-WithNode([string]$Root, [string]$Exe, [bool]$CopyIntoRuntime) {
  if (-not (Test-NodeMeetsMin $Exe $MinVersion)) {
    throw "Node too old or not Windows PE: $Exe (need >= $MinVersion)"
  }
  $final = $Exe
  if ($CopyIntoRuntime) {
    $verObj = Get-NodeExeVersion $Exe
    $verStr = if ($verObj) { "{0}.{1}.{2}" -f $verObj.Major, $verObj.Minor, $verObj.Build } else { $NodeVersion }
    $final = Copy-NodeTreeToRuntime -Root $Root -SourceNodeExe $Exe -Version $verStr -ZipArch (Get-ZipArchToken)
  }
  Save-NodePathFile -Root $Root -Exe $final
  Write-NodeLog ("OK {0} -> {1}" -f (& $final -v), $final) 'Green'
  Write-Output $final
}

# --- main ---
Enable-SystemProxy
$msiArch = Get-MsiArch
Write-NodeLog ("arch=$msiArch admin=$(Test-IsAdmin) force=$Force")

if (-not (Test-Path -LiteralPath $InstallRoot)) {
  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
}

# Explicit user Node always wins (wizard / CLI)
$user = Resolve-UserNodeExe
if ($user) {
  Write-NodeLog "user Node: $user"
  Complete-WithNode -Root $InstallRoot -Exe $user -CopyIntoRuntime:$false
  exit 0
}

if ($Force) {
  Clear-PortableRuntime -Root $InstallRoot
} else {
  $fromFile = Read-NodePathFile -Root $InstallRoot
  if ($fromFile) {
    Write-NodeLog "reuse node-path.txt"
    Complete-WithNode -Root $InstallRoot -Exe $fromFile -CopyIntoRuntime:$false
    exit 0
  }
  $portable = Find-ExistingPortable -Root $InstallRoot -MinVer $MinVersion
  if ($portable) {
    Complete-WithNode -Root $InstallRoot -Exe $portable -CopyIntoRuntime:$false
    exit 0
  }
  $sys = Find-SystemNode -MinVer $MinVersion
  if ($sys) {
    Write-NodeLog "use system Node: $sys"
    Complete-WithNode -Root $InstallRoot -Exe $sys -CopyIntoRuntime:$false
    exit 0
  }
}

# Auto: MSI only (no zip)
$msiErr = $null
foreach ($ver in (Get-FallbackVersions -Preferred $NodeVersion)) {
  try {
    $installed = Install-NodeMsi -Version $ver -MsiArch $msiArch
    # Prefer keeping under runtime when we extracted / installed for isolation
    $underPf = $installed -match '[\\/]Program Files'
    Complete-WithNode -Root $InstallRoot -Exe $installed -CopyIntoRuntime:(-not $underPf -or $Force)
    # If under Program Files and not Force-copy, still save path file (already in Complete)
    if ($underPf -and -not $Force) {
      # Complete already saved; if we skipped copy, good
    }
    exit 0
  } catch {
    $msiErr = $_.Exception.Message
    Write-NodeLog ("MSI v$ver failed: $msiErr") 'Yellow'
  }
}

Write-NodeLog 'FAILED: set your own Node in the Setup wizard, or install Node 22+ then retry' 'Red'
if ($msiErr) { Write-NodeLog $msiErr 'Red' }
exit 1
