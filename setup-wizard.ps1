#Requires -Version 5.1
<#
  Classroom Desk — one Setup wizard (WinForms).
  Steps: install folder, Node (auto MSI / pick existing node.exe), options, install.
  When MSI download fails (common on locked school networks), the UI switches to
  "use your Node" and shows manual install paths — setup does not stop forever.
#>
param(
  [string]$PayloadRoot = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $PayloadRoot) { $PayloadRoot = $PSScriptRoot }
$PayloadRoot = ([string]$PayloadRoot).Trim().TrimEnd('\', '/')

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:NodeDownloadUrl = 'https://nodejs.org/en/download'
$script:NodeCnMirrorHint = 'https://npmmirror.com/mirrors/node/'
$script:NodeMinHint = '22.5+'

function Test-IsAdmin {
  try {
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

function Get-PsExe {
  $p = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (Test-Path -LiteralPath $p) { return $p }
  return (Join-Path $env:SystemRoot 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe')
}

function Test-LooksLikeWindowsNode([string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $false }
  try {
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($item.Length -lt 1MB) { return $false }
    $fs = [IO.File]::OpenRead($Path)
    try {
      $buf = New-Object byte[] 2
      if ($fs.Read($buf, 0, 2) -lt 2) { return $false }
      return ($buf[0] -eq 0x4D -and $buf[1] -eq 0x5A)
    } finally { $fs.Close() }
  } catch { return $false }
}

function Find-InstalledNodeExe {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-LooksLikeWindowsNode $p)) { return $p }
  }
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd -and (Test-LooksLikeWindowsNode $cmd.Source)) { return $cmd.Source }
  return $null
}

function Get-ManualNodeHelpText {
  return @"
School networks often block Node MSI download.

Do this instead:
1) Install Node.js LTS ($script:NodeMinHint) on this PC (USB / IT / phone hotspot OK)
   Download: $script:NodeDownloadUrl
   China mirror listing: $script:NodeCnMirrorHint
2) Typical install path after MSI:
   C:\Program Files\nodejs\node.exe
3) In this wizard: choose "Use Node already on this PC", Browse to that node.exe, Install again.

You can also copy a portable Windows node.exe from another machine and Browse to it.
"@
}

# Re-launch elevated once
if (-not (Test-IsAdmin)) {
  $ps = Get-PsExe
  $args = @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', $PSCommandPath,
    '-PayloadRoot', $PayloadRoot
  )
  try {
    Start-Process -FilePath $ps -Verb RunAs -ArgumentList $args | Out-Null
  } catch {
    [System.Windows.Forms.MessageBox]::Show(
      'Need Administrator to install Classroom Desk.',
      'Classroom Desk',
      'OK',
      'Warning'
    ) | Out-Null
  }
  exit 0
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Classroom Desk Setup'
$form.Size = New-Object System.Drawing.Size(580, 580)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = 'Classroom Desk'
$lblTitle.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16)
$lblTitle.Location = New-Object System.Drawing.Point(20, 16)
$lblTitle.AutoSize = $true
$form.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = 'One-time setup. If Node download fails at school, pick your own node.exe.'
$lblSub.Location = New-Object System.Drawing.Point(22, 48)
$lblSub.Size = New-Object System.Drawing.Size(520, 24)
$form.Controls.Add($lblSub)

# --- Install folder ---
$grpFolder = New-Object System.Windows.Forms.GroupBox
$grpFolder.Text = '1. Install folder'
$grpFolder.Location = New-Object System.Drawing.Point(20, 80)
$grpFolder.Size = New-Object System.Drawing.Size(525, 70)
$form.Controls.Add($grpFolder)

$txtFolder = New-Object System.Windows.Forms.TextBox
$txtFolder.Text = 'C:\ClassroomDesk'
$txtFolder.Location = New-Object System.Drawing.Point(12, 28)
$txtFolder.Size = New-Object System.Drawing.Size(400, 26)
$grpFolder.Controls.Add($txtFolder)

$btnBrowseFolder = New-Object System.Windows.Forms.Button
$btnBrowseFolder.Text = 'Browse...'
$btnBrowseFolder.Location = New-Object System.Drawing.Point(420, 26)
$btnBrowseFolder.Size = New-Object System.Drawing.Size(90, 28)
$grpFolder.Controls.Add($btnBrowseFolder)
$btnBrowseFolder.Add_Click({
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = 'Install Classroom Desk to:'
  $d.SelectedPath = $txtFolder.Text
  if ($d.ShowDialog() -eq 'OK') { $txtFolder.Text = $d.SelectedPath }
})

# --- Node ---
$grpNode = New-Object System.Windows.Forms.GroupBox
$grpNode.Text = '2. Node.js (required, 22.5+ Windows)'
$grpNode.Location = New-Object System.Drawing.Point(20, 160)
$grpNode.Size = New-Object System.Drawing.Size(525, 168)
$form.Controls.Add($grpNode)

$rbAuto = New-Object System.Windows.Forms.RadioButton
$rbAuto.Text = 'Auto: try official MSI (needs network / mirrors)'
$rbAuto.Location = New-Object System.Drawing.Point(12, 24)
$rbAuto.AutoSize = $true
$rbAuto.Checked = $true
$grpNode.Controls.Add($rbAuto)

$rbCustom = New-Object System.Windows.Forms.RadioButton
$rbCustom.Text = 'Use Node already on this PC — pick node.exe'
$rbCustom.Location = New-Object System.Drawing.Point(12, 48)
$rbCustom.AutoSize = $true
$grpNode.Controls.Add($rbCustom)

$txtNode = New-Object System.Windows.Forms.TextBox
$txtNode.Location = New-Object System.Drawing.Point(12, 76)
$txtNode.Size = New-Object System.Drawing.Size(300, 26)
$txtNode.Enabled = $false
$grpNode.Controls.Add($txtNode)

$btnDetectNode = New-Object System.Windows.Forms.Button
$btnDetectNode.Text = 'Detect'
$btnDetectNode.Location = New-Object System.Drawing.Point(318, 74)
$btnDetectNode.Size = New-Object System.Drawing.Size(90, 28)
$btnDetectNode.Enabled = $false
$grpNode.Controls.Add($btnDetectNode)

$btnBrowseNode = New-Object System.Windows.Forms.Button
$btnBrowseNode.Text = 'Browse...'
$btnBrowseNode.Location = New-Object System.Drawing.Point(414, 74)
$btnBrowseNode.Size = New-Object System.Drawing.Size(95, 28)
$btnBrowseNode.Enabled = $false
$grpNode.Controls.Add($btnBrowseNode)

$lblNodeHint = New-Object System.Windows.Forms.Label
$lblNodeHint.Text = "Manual MSI: $script:NodeDownloadUrl`r`nAfter install, path is usually: C:\Program Files\nodejs\node.exe"
$lblNodeHint.Location = New-Object System.Drawing.Point(12, 110)
$lblNodeHint.Size = New-Object System.Drawing.Size(500, 48)
$lblNodeHint.ForeColor = [System.Drawing.Color]::FromArgb(80, 80, 80)
$grpNode.Controls.Add($lblNodeHint)

function Set-CustomNodeMode([bool]$On, [string]$Prefill = '') {
  if ($On) {
    $rbCustom.Checked = $true
    $txtNode.Enabled = $true
    $btnBrowseNode.Enabled = $true
    $btnDetectNode.Enabled = $true
    if ($Prefill) { $txtNode.Text = $Prefill }
  } else {
    $rbAuto.Checked = $true
    $txtNode.Enabled = $false
    $btnBrowseNode.Enabled = $false
    $btnDetectNode.Enabled = $false
  }
}

$rbAuto.Add_CheckedChanged({
  if ($rbAuto.Checked) { Set-CustomNodeMode $false }
})
$rbCustom.Add_CheckedChanged({
  if ($rbCustom.Checked) {
    $txtNode.Enabled = $true
    $btnBrowseNode.Enabled = $true
    $btnDetectNode.Enabled = $true
  }
})

$btnBrowseNode.Add_Click({
  $d = New-Object System.Windows.Forms.OpenFileDialog
  $d.Filter = 'node.exe|node.exe|All|*.*'
  $d.Title = 'Select Windows node.exe (22.5+)'
  $guess = Join-Path $env:ProgramFiles 'nodejs'
  if (Test-Path -LiteralPath $guess) { $d.InitialDirectory = $guess }
  if ($d.ShowDialog() -eq 'OK') { $txtNode.Text = $d.FileName }
})

$btnDetectNode.Add_Click({
  $hit = Find-InstalledNodeExe
  if ($hit) {
    Set-CustomNodeMode $true $hit
    Write-UiLog "Detected Node: $hit"
  } else {
    [System.Windows.Forms.MessageBox]::Show(
      ("No Node found under Program Files.`r`n`r`n" + (Get-ManualNodeHelpText)),
      'Detect Node',
      'OK',
      'Information'
    ) | Out-Null
  }
})

$lnkManual = New-Object System.Windows.Forms.LinkLabel
$lnkManual.Text = 'Open Node.js download page'
$lnkManual.Location = New-Object System.Drawing.Point(12, 148)
$lnkManual.AutoSize = $true
$grpNode.Controls.Add($lnkManual)
$lnkManual.Add_LinkClicked({
  try { Start-Process $script:NodeDownloadUrl } catch {}
})

# --- Options ---
$grpOpt = New-Object System.Windows.Forms.GroupBox
$grpOpt.Text = '3. Options'
$grpOpt.Location = New-Object System.Drawing.Point(20, 338)
$grpOpt.Size = New-Object System.Drawing.Size(525, 90)
$form.Controls.Add($grpOpt)

$chkChina = New-Object System.Windows.Forms.CheckBox
$chkChina.Text = 'Prefer China mirrors (npmmirror) for Node MSI'
$chkChina.Location = New-Object System.Drawing.Point(12, 28)
$chkChina.AutoSize = $true
$chkChina.Checked = $true
$grpOpt.Controls.Add($chkChina)

$chkStart = New-Object System.Windows.Forms.CheckBox
$chkStart.Text = 'Start Classroom Desk when finished'
$chkStart.Location = New-Object System.Drawing.Point(12, 54)
$chkStart.AutoSize = $true
$chkStart.Checked = $true
$grpOpt.Controls.Add($chkStart)

# --- Log + buttons ---
$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ScrollBars = 'Vertical'
$txtLog.ReadOnly = $true
$txtLog.Location = New-Object System.Drawing.Point(20, 438)
$txtLog.Size = New-Object System.Drawing.Size(525, 56)
$txtLog.Font = New-Object System.Drawing.Font('Consolas', 9)
$form.Controls.Add($txtLog)

function Write-UiLog([string]$Msg) {
  $txtLog.AppendText(("[{0}] {1}`r`n" -f (Get-Date -Format 'HH:mm:ss'), $Msg))
  [System.Windows.Forms.Application]::DoEvents()
}

function Show-NodeFallbackUi([string]$Detail) {
  $hit = Find-InstalledNodeExe
  Set-CustomNodeMode $true $(if ($hit) { $hit } else { '' })
  Write-UiLog 'Switched to: use Node already on this PC'
  if ($hit) { Write-UiLog "Pre-filled detected Node: $hit" }

  $help = Get-ManualNodeHelpText
  $card = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ClassroomDesk-Node-Manual.txt'
  try {
    Set-Content -LiteralPath $card -Value ($help + "`r`n---`r`nLast error:`r`n" + $Detail) -Encoding UTF8
    Write-UiLog "Wrote $card"
  } catch {}

  $msg = "Node auto-install failed (school network often blocks MSI).`r`n`r`n" +
    "Wizard switched to ""Use Node already on this PC"".`r`n`r`n" +
    "Yes = Browse for node.exe now`r`n" +
    "No = Open nodejs.org download page (install manually, then Detect/Browse)`r`n" +
    "Cancel = stay here and pick later`r`n`r`n" +
    "Usual path: C:\Program Files\nodejs\node.exe`r`n" +
    "Details also on Desktop: ClassroomDesk-Node-Manual.txt"
  $r = [System.Windows.Forms.MessageBox]::Show(
    $msg,
    'Node download failed — use your Node',
    'YesNoCancel',
    'Warning'
  )
  if ($r -eq 'Yes') {
    $d = New-Object System.Windows.Forms.OpenFileDialog
    $d.Filter = 'node.exe|node.exe|All|*.*'
    $d.Title = 'Select Windows node.exe'
    $guess = Join-Path $env:ProgramFiles 'nodejs'
    if (Test-Path -LiteralPath $guess) { $d.InitialDirectory = $guess }
    if ($d.ShowDialog() -eq 'OK') { $txtNode.Text = $d.FileName }
  } elseif ($r -eq 'No') {
    try { Start-Process $script:NodeDownloadUrl } catch {}
  }
}

$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = 'Install'
$btnInstall.Location = New-Object System.Drawing.Point(340, 506)
$btnInstall.Size = New-Object System.Drawing.Size(100, 32)
$form.Controls.Add($btnInstall)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = 'Close'
$btnClose.Location = New-Object System.Drawing.Point(450, 506)
$btnClose.Size = New-Object System.Drawing.Size(95, 32)
$form.Controls.Add($btnClose)
$btnClose.Add_Click({ $form.Close() })

$btnInstall.Add_Click({
  $btnInstall.Enabled = $false
  $btnClose.Enabled = $false
  try {
    $root = ([string]$txtFolder.Text).Trim().TrimEnd('\', '/')
    if (-not $root) { throw 'Install folder is empty' }
    if ($rbCustom.Checked) {
      $ne = ([string]$txtNode.Text).Trim().Trim('"')
      if (-not $ne -or -not (Test-LooksLikeWindowsNode $ne)) {
        throw 'Select a valid Windows node.exe (22.5+). Use Detect or Browse — usual path: C:\Program Files\nodejs\node.exe'
      }
    }

    Write-UiLog "Install folder: $root"
    if (-not (Test-Path -LiteralPath $root)) {
      New-Item -ItemType Directory -Path $root -Force | Out-Null
    }

    Write-UiLog 'Unblock files...'
    Get-ChildItem -LiteralPath $PayloadRoot -Recurse -Force -ErrorAction SilentlyContinue |
      Unblock-File -ErrorAction SilentlyContinue

    if ($PayloadRoot -ne $root) {
      Write-UiLog 'Copying product files...'
      $keep = Join-Path $env:TEMP ("cd-keep-" + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $keep -Force | Out-Null
      if (Test-Path -LiteralPath (Join-Path $root '.env')) {
        Copy-Item (Join-Path $root '.env') (Join-Path $keep '.env') -Force
      }
      $dataSrc = Join-Path $root 'apps\server\data'
      if (Test-Path -LiteralPath $dataSrc) {
        New-Item -ItemType Directory -Path (Join-Path $keep 'data') -Force | Out-Null
        & robocopy $dataSrc (Join-Path $keep 'data') /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
      }
      & robocopy $PayloadRoot $root /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "copy failed (robocopy $LASTEXITCODE)" }
      if (Test-Path -LiteralPath (Join-Path $keep '.env')) {
        Copy-Item (Join-Path $keep '.env') (Join-Path $root '.env') -Force
        Write-UiLog 'Kept existing .env'
      }
      if (Test-Path -LiteralPath (Join-Path $keep 'data')) {
        New-Item -ItemType Directory -Path $dataSrc -Force | Out-Null
        & robocopy (Join-Path $keep 'data') $dataSrc /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
        Write-UiLog 'Kept classroom data'
      }
      Remove-Item -LiteralPath $keep -Recurse -Force -ErrorAction SilentlyContinue
    }

    $ps = Get-PsExe
    $ensure = Join-Path $root 'ensure-windows-node.ps1'
    if (-not (Test-Path -LiteralPath $ensure)) { $ensure = Join-Path $PayloadRoot 'ensure-windows-node.ps1' }
    if (-not (Test-Path -LiteralPath $ensure)) { throw 'ensure-windows-node.ps1 missing' }

    Write-UiLog 'Configuring Node...'
    # No -Force on auto: reuse embedded runtime / node-path / system first; MSI only if needed.
    $nodeArgs = @(
      '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', $ensure,
      '-InstallRoot', $root
    )
    if ($chkChina.Checked) { $nodeArgs += '-ChinaMirrorsFirst' }
    if ($rbCustom.Checked) {
      $nodeArgs += @('-NodeExe', ([string]$txtNode.Text).Trim().Trim('"'))
    }
    $pNode = Start-Process -FilePath $ps -ArgumentList $nodeArgs -Wait -PassThru -NoNewWindow
    if ($pNode.ExitCode -ne 0) {
      $detail = "ensure-windows-node exit $($pNode.ExitCode)"
      if ($rbCustom.Checked) {
        throw ("Selected node.exe was rejected ($detail). Need Windows Node $script:NodeMinHint.`r`n" + (Get-ManualNodeHelpText))
      }
      Show-NodeFallbackUi $detail
      throw 'NODE_FALLBACK'  # stop install; user picks Node and clicks Install again
    }
    Write-UiLog 'Node OK'

    $installPs1 = Join-Path $root 'install-teacher.ps1'
    if (-not (Test-Path -LiteralPath $installPs1)) { throw 'install-teacher.ps1 missing' }
    Write-UiLog 'Finishing product install...'
    $instArgs = @(
      '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', $installPs1,
      '-InstallRoot', $root,
      '-SkipSourceDownload'
    )
    if ($chkChina.Checked) { $instArgs += '-ChinaMirrorsFirst' }
    if (-not $chkStart.Checked) { $instArgs += '-SkipStart' }
    $pInst = Start-Process -FilePath $ps -ArgumentList $instArgs -Wait -PassThru -NoNewWindow
    if ($pInst.ExitCode -ne 0) {
      throw "Install failed (exit $($pInst.ExitCode)). See Desktop\ClassroomDesk-Install-Log.txt"
    }

    Write-UiLog 'Done. Use Desktop: Classroom Desk'
    [System.Windows.Forms.MessageBox]::Show(
      "Installed to:`n$root`n`nLogin: teacher / admin`nDesktop shortcut: Classroom Desk",
      'Classroom Desk',
      'OK',
      'Information'
    ) | Out-Null
  } catch {
    $msg = $_.Exception.Message
    if ($msg -ne 'NODE_FALLBACK') {
      Write-UiLog ("ERROR: " + $msg)
      [System.Windows.Forms.MessageBox]::Show(
        $msg,
        'Classroom Desk Setup',
        'OK',
        'Error'
      ) | Out-Null
    } else {
      Write-UiLog 'Waiting for you to pick node.exe, then click Install again.'
    }
  } finally {
    $btnInstall.Enabled = $true
    $btnClose.Enabled = $true
  }
})

# Prefill path if system Node already present (Auto MSI still selected for first try)
$existing = Find-InstalledNodeExe
if ($existing) {
  $txtNode.Text = $existing
  Write-UiLog "Found existing Node (optional): $existing — choose ""Use Node already on this PC"" to use it."
}

[void]$form.ShowDialog()
exit 0
